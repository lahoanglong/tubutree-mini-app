import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Coupon, Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { isCouponEligible, requiresRealUser } from '../../src/modules/coupons/coupon-scope';
import { couponProductIds } from '../../src/modules/coupons/coupons.service';
import { isRealUser } from '../../src/common/real-user';
import { createUser, randCode, warmPool } from './helpers';

/**
 * GET /me/coupons (C-012): lọc scope trong SQL phải trả CÙNG tập coupon với thuật toán cũ
 * (nạp mọi coupon còn hạn rồi lọc isCouponEligible + perUserLimit bằng JS) trên dữ liệu thật.
 */
describe('LoyaltyService.getAvailableCoupons SQL filter vs legacy (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  const tag = randCode(6);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, LoyaltyService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    loyalty = moduleRef.get(LoyaltyService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const DAY = 864e5;
  const mk = (suffix: string, data: Partial<Prisma.CouponUncheckedCreateInput>) =>
    prisma.coupon.create({
      data: {
        code: `T${tag}-${suffix}`,
        type: 'AMOUNT',
        value: 10000,
        startAt: new Date(Date.now() - DAY),
        endAt: new Date(Date.now() + DAY),
        perUserLimit: 1,
        scope: 'PUBLIC',
        ...data,
      },
    });

  async function legacy(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = new Date();
    const all: Coupon[] = await prisma.coupon.findMany({ where: { startAt: { lte: now }, endAt: { gte: now } } });
    const filtered = all.filter(
      (c) => isCouponEligible(c, user) && c.isActive !== false && (isRealUser(user) || !requiresRealUser(c)),
    );
    const grouped = await prisma.couponRedemption.groupBy({
      by: ['couponId'],
      where: { userId, couponId: { in: filtered.map((c) => c.id) } },
      _count: { _all: true },
    });
    const used = new Map(grouped.map((g) => [g.couponId, g._count._all]));
    return filtered
      .filter((c) => !(c.perUserLimit > 0 && (used.get(c.id) ?? 0) >= c.perUserLimit))
      .map((c) => ({
        code: c.code,
        type: c.type,
        value: c.value,
        minOrder: c.minOrder,
        maxDiscount: c.maxDiscount,
        endAt: c.endAt,
        productIds: couponProductIds(c.applyTo),
      }));
  }

  /** Bản mới kèm tên sản phẩm áp dụng; so với thuật toán cũ theo id sản phẩm. */
  const withProductIds = (xs: Awaited<ReturnType<LoyaltyService['getAvailableCoupons']>>) =>
    xs.map(({ products, ...rest }) => ({ ...rest, productIds: products?.map((p) => p.id) ?? null }));

  const byCode = <T extends { code: string }>(xs: T[]) => [...xs].sort((a, b) => a.code.localeCompare(b.code));

  it('cùng kết quả với thuật toán cũ cho user có hạng, user không hạng, user khác', async () => {
    const tierId = `T_${tag}_1`;
    const tier2 = `T_${tag}_2`;
    for (const id of [tierId, tier2]) {
      await prisma.membershipTier.create({ data: { id, name: id, minPoints: 0, perks: {}, sortOrder: 99 } });
    }
    const a = await createUser(prisma, { tierId, phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}` });
    const b = await createUser(prisma, { zaloId: `zl_${randCode(12)}` });
    // Tài khoản khách: mã công khai giới hạn lượt/khách bị ẩn (MONEY-1), mã không giới hạn lượt vẫn thấy.
    const c = await createUser(prisma, { tierId: tier2, zaloId: `guest_${randCode(12)}` });

    await mk('PUB', {});
    await mk('PUB_PUL0', { perUserLimit: 0 });
    await mk('PUB_FUTURE', { startAt: new Date(Date.now() + DAY), endAt: new Date(Date.now() + 2 * DAY) });
    await mk('PUB_EXPIRED', { startAt: new Date(Date.now() - 2 * DAY), endAt: new Date(Date.now() - DAY) });
    await mk('A_MINE', { scope: 'USER_GROUP', scopeMeta: { userId: a.id } });
    await mk('A_MINE_USED', { scope: 'USER_GROUP', scopeMeta: { userId: a.id } });
    await mk('A_MINE_EXPIRED', { scope: 'USER_GROUP', scopeMeta: { userId: a.id }, startAt: new Date(Date.now() - 2 * DAY), endAt: new Date(Date.now() - DAY) });
    await mk('B_MINE', { scope: 'USER_GROUP', scopeMeta: { userId: b.id } });
    await mk('UG_NOMETA', { scope: 'USER_GROUP', scopeMeta: {} });
    await mk('UG_NULLMETA', { scope: 'USER_GROUP' });
    await mk('UG_NUMERIC', { scope: 'USER_GROUP', scopeMeta: { userId: 123 } });
    await mk('TIER1', { scope: 'TIER', scopeMeta: { tierId } });
    await mk('TIER2', { scope: 'TIER', scopeMeta: { tierId: tier2 } });
    await mk('TIER_NOMETA', { scope: 'TIER', scopeMeta: {} });
    await mk('TIER_NULLMETA', { scope: 'TIER' });
    await mk('BDAY', { scope: 'BIRTHDAY', scopeMeta: { userId: a.id } });
    await mk('INVITE', { scope: 'INVITE', scopeMeta: { userId: a.id } });

    const used = await prisma.coupon.findUniqueOrThrow({ where: { code: `T${tag}-A_MINE_USED` } });
    await prisma.couponRedemption.create({ data: { couponId: used.id, userId: a.id } });

    const ours = (xs: { code: string }[]) => xs.filter((x) => x.code.startsWith(`T${tag}-`)).map((x) => x.code);
    for (const u of [a, b, c]) {
      const [fresh, old] = await Promise.all([loyalty.getAvailableCoupons(u.id), legacy(u.id)]);
      expect(byCode(withProductIds(fresh))).toEqual(byCode(old));
      console.log('[compare] user=%s mới=%j', u.id.slice(-4), ours(byCode(fresh)));
    }

    expect(ours(await loyalty.getAvailableCoupons(a.id)).sort()).toEqual(
      [`T${tag}-PUB`, `T${tag}-PUB_PUL0`, `T${tag}-A_MINE`, `T${tag}-TIER1`].sort(),
    );
    expect(ours(await loyalty.getAvailableCoupons(b.id)).sort()).toEqual(
      [`T${tag}-PUB`, `T${tag}-PUB_PUL0`, `T${tag}-B_MINE`].sort(),
    );
    expect(ours(await loyalty.getAvailableCoupons(c.id)).sort()).toEqual([`T${tag}-PUB_PUL0`, `T${tag}-TIER2`].sort());
  });

  it('kết quả có thứ tự ổn định theo id', async () => {
    const u = await createUser(prisma);
    await mk('ORD1', { scope: 'USER_GROUP', scopeMeta: { userId: u.id } });
    await mk('ORD2', { scope: 'USER_GROUP', scopeMeta: { userId: u.id } });
    const [x, y] = await Promise.all([loyalty.getAvailableCoupons(u.id), loyalty.getAvailableCoupons(u.id)]);
    expect(x).toEqual(y);
  });
});
