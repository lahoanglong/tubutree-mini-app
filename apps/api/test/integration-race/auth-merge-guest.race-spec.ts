import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
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
  let loyalty: LoyaltyService;
  let zaloIdForNextCall = '';

  const DAY = '2026-10-09';
  const OTHER_DAY = '2026-10-08';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, LoyaltyService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    loyalty = moduleRef.get(LoyaltyService);
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

  it('merge: subscriptions, payouts, wishlist, reminders and brand follows move to target', async () => {
    const { guest, target } = await guestAndTarget({}, {});
    const tag = randCode(6);
    const a = await makeVariation(`${tag}A`);
    const b = await makeVariation(`${tag}B`);

    const addr = await prisma.address.create({
      data: {
        userId: guest.id,
        recipient: 'Khách',
        phone: '0900000000',
        province: 'HCM',
        district: 'Q1',
        ward: 'P1',
        street: '1 Lê Lợi',
        provinceCode: '79',
        districtCode: '760',
        wardCode: '26734',
      },
    });
    const sub = await prisma.subscription.create({
      data: {
        userId: guest.id,
        variationId: a.variation.id,
        intervalWeeks: 4,
        addressId: addr.id,
        nextRunAt: new Date(Date.now() + 86_400_000),
      },
    });
    // Lệnh rút đang chờ duyệt: admin từ chối sẽ hoàn tiền về payout.userId (affiliate.service).
    const payout = await prisma.payout.create({
      data: { userId: guest.id, amount: 47_000, fee: 3_000, method: 'BANK', status: 'REQUESTED' },
    });

    await prisma.wishlist.create({ data: { userId: guest.id, productId: a.product.id } });
    await prisma.wishlist.create({ data: { userId: guest.id, productId: b.product.id } });
    await prisma.wishlist.create({ data: { userId: target.id, productId: a.product.id } });

    const sale = await prisma.flashSale.create({
      data: { title: 'IT', startAt: new Date(Date.now() + 3_600_000), endAt: new Date(Date.now() + 7_200_000), createdBy: 'it' },
    });
    const fsA = await prisma.flashSaleItem.create({
      data: { flashSaleId: sale.id, variationId: a.variation.id, flashPrice: 1_000, quota: 10, perUserLimit: 1 },
    });
    const fsB = await prisma.flashSaleItem.create({
      data: { flashSaleId: sale.id, variationId: b.variation.id, flashPrice: 1_000, quota: 10, perUserLimit: 1 },
    });
    await prisma.flashSaleReminder.create({ data: { userId: guest.id, flashSaleItemId: fsA.id } });
    await prisma.flashSaleReminder.create({ data: { userId: guest.id, flashSaleItemId: fsB.id } });
    await prisma.flashSaleReminder.create({ data: { userId: target.id, flashSaleItemId: fsA.id } });

    const brand = await prisma.brand.create({ data: { slug: `itm-b-${tag.toLowerCase()}`, name: `IT Brand ${tag}` } });
    await prisma.brandFollow.create({ data: { userId: guest.id, brandId: brand.id } });
    await prisma.reorderReminder.create({
      data: { userId: guest.id, variationId: b.variation.id, productName: 'SP B', lastOrderAt: new Date() },
    });

    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');

    // Gói định kỳ phải đi cùng địa chỉ của nó: subscriptions.service tạm dừng gói khi
    // address.userId !== sub.userId.
    const s = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    const ad = await prisma.address.findUniqueOrThrow({ where: { id: addr.id } });
    expect(s.userId).toBe(target.id);
    expect(ad.userId).toBe(s.userId);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).userId).toBe(target.id);

    const wl = await prisma.wishlist.findMany({ where: { userId: target.id } });
    expect(wl.map((w) => w.productId).sort()).toEqual([a.product.id, b.product.id].sort());
    const rem = await prisma.flashSaleReminder.findMany({ where: { userId: target.id } });
    expect(rem.map((r) => r.flashSaleItemId).sort()).toEqual([fsA.id, fsB.id].sort());
    expect(await prisma.brandFollow.count({ where: { userId: target.id, brandId: brand.id } })).toBe(1);
    expect(await prisma.reorderReminder.count({ where: { userId: target.id, variationId: b.variation.id } })).toBe(1);
  });

  it('merge: guest check-ins newer than the target latest stay on the guest, so the target streak is not inherited', async () => {
    const { guest, target } = await guestAndTarget({}, {});
    await prisma.loyaltyCheckIn.create({
      data: { userId: target.id, dayKey: '2026-10-07', cycleDay: 2, streakDays: 2, points: 10 },
    });
    await prisma.loyaltyCheckIn.create({
      data: { userId: guest.id, dayKey: '2026-10-05', cycleDay: 1, streakDays: 1, points: 10 },
    });
    await prisma.loyaltyCheckIn.create({
      data: { userId: guest.id, dayKey: '2026-10-09', cycleDay: 5, streakDays: 5, points: 25 },
    });

    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');

    const latest = await prisma.loyaltyCheckIn.findFirstOrThrow({ where: { userId: target.id }, orderBy: { dayKey: 'desc' } });
    expect([latest.dayKey, latest.streakDays]).toEqual(['2026-10-07', 2]);
    const tDays = await prisma.loyaltyCheckIn.findMany({ where: { userId: target.id }, orderBy: { dayKey: 'asc' } });
    expect(tDays.map((c) => c.dayKey)).toEqual(['2026-10-05', '2026-10-07']);
    expect((await prisma.loyaltyCheckIn.findMany({ where: { userId: guest.id } })).map((c) => c.dayKey)).toEqual([
      '2026-10-09',
    ]);

    // Target chưa từng điểm danh: lịch sử của khách là lịch sử duy nhất → chuyển hết.
    const other = await guestAndTarget({}, {});
    await prisma.loyaltyCheckIn.create({
      data: { userId: other.guest.id, dayKey: '2026-10-09', cycleDay: 3, streakDays: 3, points: 15 },
    });
    zaloIdForNextCall = other.target.zaloId!;
    await auth.ensurePhoneForCurrentUser(other.guest.id, 'code', 'access');
    expect(await prisma.loyaltyCheckIn.count({ where: { userId: other.target.id } })).toBe(1);
    expect(await prisma.loyaltyCheckIn.count({ where: { userId: other.guest.id } })).toBe(0);
  });

  /** Ngày giờ VN lệch `offset` ngày so với hôm nay — cùng quy tắc với common/vn-time vnDateKey. */
  const vnDay = (offset: number) =>
    new Date(Date.now() + 7 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

  /** Mỗi dòng sổ CHECKIN mang khoá ngày thường của user phải có dòng điểm danh cùng ngày của user đó. */
  async function expectLedgerMatchesCheckIns(userId: string) {
    const ledger = await prisma.pointsTransaction.findMany({ where: { userId, refType: 'CHECKIN' } });
    const days = new Set((await prisma.loyaltyCheckIn.findMany({ where: { userId } })).map((c) => c.dayKey));
    const orphans = ledger.filter((p) => p.refId && !p.refId.startsWith('MERGED:') && !days.has(p.refId));
    expect(orphans.map((p) => p.refId)).toEqual([]);
  }

  it('merge: guest checked in today, target last checked in yesterday -> target can check in today and keeps its streak', async () => {
    const { guest, target } = await guestAndTarget({ pointsBalance: 10 }, { pointsBalance: 10 });
    const today = vnDay(0);
    const yesterday = vnDay(-1);
    await checkIn(guest.id, today, 10);
    await checkIn(target.id, yesterday, 10);

    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    await expectLedgerMatchesCheckIns(target.id);

    const before = await loyalty.getDailyCheckInStatus(target.id);
    expect([before.checkedInToday, before.streakDays]).toEqual([false, 1]);
    const res = await loyalty.dailyCheckIn(target.id);
    expect(res.streakDays).toBe(2);

    const t = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(t.pointsBalance).toBe(20 + res.pointsEarned);
    const refIds = (await prisma.pointsTransaction.findMany({ where: { userId: target.id, refType: 'CHECKIN' } }))
      .map((p) => p.refId)
      .sort();
    expect(refIds).toEqual([today, yesterday, `MERGED:${guest.id}:${today}`].sort());
    expect((await loyalty.getDailyCheckInStatus(target.id)).checkedInToday).toBe(true);
  });

  it('merge: both checked in on the same day -> target keeps its own row, both points kept, next day check-in continues the target streak', async () => {
    const { guest, target } = await guestAndTarget({ pointsBalance: 10 }, { pointsBalance: 10 });
    const yesterday = vnDay(-1);
    await checkIn(guest.id, yesterday, 10);
    await checkIn(target.id, yesterday, 10);

    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    await expectLedgerMatchesCheckIns(target.id);

    const res = await loyalty.dailyCheckIn(target.id);
    expect(res.streakDays).toBe(2);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).pointsBalance).toBe(20 + res.pointsEarned);
  });

  it('merge: guest check-in older than the target latest moves to target with its ledger row, target streak unaffected', async () => {
    const { guest, target } = await guestAndTarget({ pointsBalance: 10 }, { pointsBalance: 10 });
    const older = vnDay(-3);
    const yesterday = vnDay(-1);
    await checkIn(guest.id, older, 10);
    await checkIn(target.id, yesterday, 10);

    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    await expectLedgerMatchesCheckIns(target.id);

    const days = await prisma.loyaltyCheckIn.findMany({ where: { userId: target.id }, orderBy: { dayKey: 'asc' } });
    expect(days.map((c) => c.dayKey)).toEqual([older, yesterday]);
    const refIds = (await prisma.pointsTransaction.findMany({ where: { userId: target.id, refType: 'CHECKIN' } }))
      .map((p) => p.refId)
      .sort();
    expect(refIds).toEqual([older, yesterday].sort());

    const res = await loyalty.dailyCheckIn(target.id);
    expect(res.streakDays).toBe(2);
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
