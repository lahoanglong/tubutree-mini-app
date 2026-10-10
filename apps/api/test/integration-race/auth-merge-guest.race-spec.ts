import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { barrierOnFirstCalls, createOrder, createUser, randCode, summarize, warmPool } from './helpers';

type Balances = Partial<Record<'pointsBalance' | 'walletBalance' | 'coinsBalance' | 'cashbackPending', number>>;

/**
 * Gộp phiên khách vào tài khoản Zalo có sẵn (ensurePhoneForCurrentUser → mergeGuestInto) trên
 * Postgres thật. Fake Prisma không tái hiện được việc Postgres huỷ cả transaction sau một lỗi
 * unique (25P02), nên các kịch bản ở đây phải chạy trên DB thật.
 */
describe('AuthService mergeGuestInto (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;
  let zaloIdForNextCall = '';

  const DAY = '2026-10-09';
  const OTHER_DAY = '2026-10-08';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);

    const cfg: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'it-secret-merge',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL_DAYS: 30,
    };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function guestAndTarget(guestBal: Balances, targetBal: Balances) {
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khách', ...guestBal });
    const target = await createUser(prisma, { zaloId: `zalo_${randCode(10)}`, ...targetBal });
    await prisma.refreshToken.create({
      data: { userId: guest.id, tokenHash: `it-${randCode(16)}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    return { guest, target };
  }

  async function checkIn(userId: string, dayKey: string, points: number) {
    await prisma.loyaltyCheckIn.create({ data: { userId, dayKey, cycleDay: 1, streakDays: 1, points } });
    await prisma.pointsTransaction.create({
      data: { userId, delta: points, reason: 'DAILY_CHECKIN:DAY_1', refType: 'CHECKIN', refId: dayKey },
    });
  }

  async function makeVariation(tag: string) {
    const product = await prisma.product.create({
      data: {
        pancakeId: `itm-p-${tag}`,
        brand: 'IT Brand',
        slug: `itm-sp-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 50_000,
        isActive: true,
        approvalStatus: 'APPROVED',
        thumbnail: `https://img.test/${tag}.jpg`,
      },
    });
    const variation = await prisma.variation.create({
      data: {
        pancakeId: `itm-v-${tag}`,
        productId: product.id,
        sku: `ITM-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 50_000,
        stock: 100,
        isActive: true,
      },
    });
    return { product, variation };
  }

  it('merge: guest and target both checked in on the same VN day -> merge commits, target tokens, both check-in points kept', async () => {
    const { guest, target } = await guestAndTarget(
      { pointsBalance: 15, coinsBalance: 7, walletBalance: 20_000, cashbackPending: 3_000 },
      { pointsBalance: 100, coinsBalance: 1, walletBalance: 5_000, cashbackPending: 0 },
    );
    await checkIn(guest.id, DAY, 10);
    await checkIn(guest.id, OTHER_DAY, 5);
    await checkIn(target.id, DAY, 10);
    // Cùng một nhiệm vụ ở cả hai bên đụng partial unique (userId, reason) WHERE refType='QUEST'.
    for (const userId of [guest.id, target.id]) {
      await prisma.coinTransaction.create({
        data: { userId, delta: 1, reason: 'STOREFRONT_QUEST:FIRST', refType: 'QUEST', refId: 'sf' },
      });
    }

    zaloIdForNextCall = target.zaloId!;
    const res = await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');

    expect(res.user.id).toBe(target.id);
    const t = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const g = await prisma.user.findUniqueOrThrow({ where: { id: guest.id } });
    expect(t.pointsBalance).toBe(115);
    expect(t.coinsBalance).toBe(8);
    expect(t.walletBalance).toBe(25_000);
    expect(t.cashbackPending).toBe(3_000);
    expect([g.pointsBalance, g.coinsBalance, g.walletBalance, g.cashbackPending]).toEqual([0, 0, 0, 0]);
    expect(g.zaloId).not.toBe(guest.zaloId);

    const pts = await prisma.pointsTransaction.findMany({ where: { userId: { in: [guest.id, target.id] } } });
    expect(pts.every((p) => p.userId === target.id)).toBe(true);
    expect(pts.map((p) => p.refId).sort()).toEqual([DAY, OTHER_DAY, `MERGED:${guest.id}:${DAY}`].sort());

    const coins = await prisma.coinTransaction.findMany({ where: { userId: { in: [guest.id, target.id] } } });
    expect(coins.every((c) => c.userId === target.id)).toBe(true);
    expect(coins.map((c) => c.reason).sort()).toEqual(
      ['STOREFRONT_QUEST:FIRST', `MERGED:${guest.id}:STOREFRONT_QUEST:FIRST`].sort(),
    );

    // Ngày trùng: dòng điểm danh của khách ở lại (dayKey phải giữ định dạng ngày để tính chuỗi);
    // ngày không trùng chuyển sang target để target không điểm danh lại được ngày đó.
    const tCheckIns = await prisma.loyaltyCheckIn.findMany({ where: { userId: target.id }, orderBy: { dayKey: 'asc' } });
    expect(tCheckIns.map((c) => c.dayKey)).toEqual([OTHER_DAY, DAY]);
    const gCheckIns = await prisma.loyaltyCheckIn.findMany({ where: { userId: guest.id } });
    expect(gCheckIns.map((c) => c.dayKey)).toEqual([DAY]);

    expect(await prisma.refreshToken.count({ where: { userId: guest.id, revokedAt: null } })).toBe(0);
  });

  it('merge: coupon redemptions, flash-sale purchases, reviews, return requests, orders and cart move to target', async () => {
    const { guest, target } = await guestAndTarget({}, {});
    const tag = randCode(6);
    const a = await makeVariation(`${tag}A`);
    const b = await makeVariation(`${tag}B`);

    const coupon = await prisma.coupon.create({
      data: {
        code: `ITM${tag}`,
        type: 'AMOUNT',
        value: 10_000,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
        scope: 'PUBLIC',
        perUserLimit: 1,
      },
    });
    const guestOrder = await createOrder(prisma, { userId: guest.id, status: 'DELIVERED' });
    await prisma.couponRedemption.create({ data: { couponId: coupon.id, userId: guest.id, orderId: guestOrder.id } });

    const sale = await prisma.flashSale.create({
      data: { title: 'IT', startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + 3_600_000), createdBy: 'it' },
    });
    const fsA = await prisma.flashSaleItem.create({
      data: { flashSaleId: sale.id, variationId: a.variation.id, flashPrice: 1_000, quota: 100, perUserLimit: 2 },
    });
    const fsB = await prisma.flashSaleItem.create({
      data: { flashSaleId: sale.id, variationId: b.variation.id, flashPrice: 1_000, quota: 100, perUserLimit: 2 },
    });
    await prisma.flashSalePurchase.create({ data: { flashSaleItemId: fsA.id, userId: guest.id, quantity: 1 } });
    await prisma.flashSalePurchase.create({ data: { flashSaleItemId: fsA.id, userId: target.id, quantity: 1 } });
    await prisma.flashSalePurchase.create({ data: { flashSaleItemId: fsB.id, userId: guest.id, quantity: 2 } });

    await prisma.review.create({ data: { userId: guest.id, productId: a.product.id, orderId: guestOrder.id, rating: 5 } });
    await prisma.review.create({ data: { userId: guest.id, productId: b.product.id, orderId: guestOrder.id, rating: 4 } });
    await prisma.review.create({ data: { userId: target.id, productId: a.product.id, orderId: 'other-order', rating: 3 } });
    await prisma.returnRequest.create({ data: { orderId: guestOrder.id, userId: guest.id, reason: 'IT' } });

    const guestCart = await prisma.cart.create({ data: { userId: guest.id } });
    const targetCart = await prisma.cart.create({ data: { userId: target.id } });
    const gItemA = await prisma.cartItem.create({ data: { cartId: guestCart.id, variationId: a.variation.id, quantity: 2 } });
    const gItemB = await prisma.cartItem.create({ data: { cartId: guestCart.id, variationId: b.variation.id, quantity: 1 } });
    const tItemA = await prisma.cartItem.create({ data: { cartId: targetCart.id, variationId: a.variation.id, quantity: 3 } });

    zaloIdForNextCall = target.zaloId!;
    const res = await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    expect(res.user.id).toBe(target.id);

    expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id, userId: target.id } })).toBe(1);
    expect(await prisma.couponRedemption.count({ where: { userId: guest.id } })).toBe(0);

    const fs = await prisma.flashSalePurchase.findMany({ where: { userId: { in: [guest.id, target.id] } } });
    expect(fs.every((p) => p.userId === target.id)).toBe(true);
    expect(fs.find((p) => p.flashSaleItemId === fsA.id)?.quantity).toBe(2);
    expect(fs.find((p) => p.flashSaleItemId === fsB.id)?.quantity).toBe(2);

    const tReviews = await prisma.review.findMany({ where: { userId: target.id } });
    expect(tReviews.map((r) => r.productId).sort()).toEqual([a.product.id, b.product.id].sort());
    expect(tReviews.find((r) => r.productId === a.product.id)?.rating).toBe(3);

    expect(await prisma.returnRequest.count({ where: { userId: target.id, orderId: guestOrder.id } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: guestOrder.id } })).userId).toBe(target.id);

    const items = await prisma.cartItem.findMany({ where: { cartId: targetCart.id } });
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === tItemA.id)?.quantity).toBe(5);
    expect(items.find((i) => i.id === gItemB.id)?.cartId).toBe(targetCart.id);
    expect(await prisma.cartItem.findUnique({ where: { id: gItemA.id } })).toBeNull();
    expect(await prisma.cart.findUnique({ where: { id: guestCart.id } })).toBeNull();
  });

  it('merge: game data moves only when the target never played', async () => {
    const { guest, target } = await guestAndTarget({}, {});
    await prisma.gameProfile.create({ data: { userId: guest.id, totalSeeds: 40 } });
    await prisma.gardenPlot.create({ data: { userId: guest.id, slot: 1 } });
    await prisma.gameSpin.create({ data: { userId: guest.id, prizeId: 'p', prizeName: 'P', rewardType: 'SEEDS' } });

    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');

    expect((await prisma.gameProfile.findUniqueOrThrow({ where: { userId: target.id } })).totalSeeds).toBe(40);
    expect(await prisma.gardenPlot.count({ where: { userId: target.id } })).toBe(1);
    expect(await prisma.gameSpin.count({ where: { userId: target.id } })).toBe(1);

    const other = await guestAndTarget({}, {});
    await prisma.gameProfile.create({ data: { userId: other.guest.id, totalSeeds: 40 } });
    await prisma.gameProfile.create({ data: { userId: other.target.id, totalSeeds: 9 } });
    await prisma.gardenPlot.create({ data: { userId: other.guest.id, slot: 1 } });
    zaloIdForNextCall = other.target.zaloId!;
    await auth.ensurePhoneForCurrentUser(other.guest.id, 'code', 'access');
    expect((await prisma.gameProfile.findUniqueOrThrow({ where: { userId: other.target.id } })).totalSeeds).toBe(9);
    expect(await prisma.gameProfile.count({ where: { userId: other.guest.id } })).toBe(1);
    expect(await prisma.gardenPlot.count({ where: { userId: other.guest.id } })).toBe(1);
  });

  it('merge: two concurrent ensurePhone calls for one guest credit the guest balance to the target exactly once', async () => {
    const { guest, target } = await guestAndTarget(
      { pointsBalance: 50, coinsBalance: 10, walletBalance: 30_000, cashbackPending: 2_000 },
      { pointsBalance: 1, coinsBalance: 1, walletBalance: 1, cashbackPending: 1 },
    );
    zaloIdForNextCall = target.zaloId!;

    // Cả hai request đọc dòng khách (còn số dư) trước khi bên nào kịp gộp.
    const gate = barrierOnFirstCalls(prisma.user, 'findUniqueOrThrow', 2);
    const results = await Promise.allSettled([
      auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access'),
      auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access'),
    ]);
    gate.mockRestore();
    const s = summarize(results);
    console.log('[race] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, s.errors);

    expect(s.fulfilled).toHaveLength(2);
    for (const r of s.fulfilled) expect(r.value.user.id).toBe(target.id);
    const t = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect([t.pointsBalance, t.coinsBalance, t.walletBalance, t.cashbackPending]).toEqual([51, 11, 30_001, 2_001]);
  });

  it('merge: two guest devices upgrading to the same new Zalo account at once -> loser merges into winner, no 500', async () => {
    const g1 = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, pointsBalance: 3 });
    const g2 = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, pointsBalance: 4 });
    zaloIdForNextCall = `zalo_new_${randCode(10)}`;

    // Cả hai cùng thấy "chưa ai giữ zaloId này" rồi cùng nâng cấp tại chỗ.
    const gate = barrierOnFirstCalls(prisma.user, 'findUnique', 2);
    const results = await Promise.allSettled([
      auth.ensurePhoneForCurrentUser(g1.id, 'code', 'access'),
      auth.ensurePhoneForCurrentUser(g2.id, 'code', 'access'),
    ]);
    gate.mockRestore();
    const s = summarize(results);
    console.log('[upgrade-race] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, s.errors);

    expect(s.fulfilled).toHaveLength(2);
    const winner = await prisma.user.findUniqueOrThrow({ where: { zaloId: zaloIdForNextCall } });
    for (const r of s.fulfilled) expect(r.value.user.id).toBe(winner.id);
    expect(winner.pointsBalance).toBe(7);
  });
});
