import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { createUser, randCode, warmPool } from './helpers';

/** L3-08: GET /me/coupons/history tách ba nhánh phải trả đúng như câu OR + EXISTS + `#>` cũ trên Postgres thật. */
describe('LoyaltyService.getCouponHistory tách nhánh vs câu cũ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  const tag = randCode(6);
  const DAY = 864e5;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, LoyaltyService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    loyalty = moduleRef.get(LoyaltyService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const mk = (suffix: string, data: Partial<Prisma.CouponUncheckedCreateInput>) =>
    prisma.coupon.create({
      data: { code: `H${tag}-${suffix}`, type: 'AMOUNT', value: 10000, startAt: new Date(Date.now() - 200 * DAY), endAt: new Date(Date.now() + DAY), perUserLimit: 1, scope: 'PUBLIC', ...data },
    });

  async function legacy(userId: string, now: Date) {
    const since = new Date(now.getTime() - 90 * DAY);
    const used = await prisma.couponRedemption.groupBy({
      by: ['couponId'], where: { userId }, _count: { _all: true }, _max: { redeemedAt: true }, orderBy: { _max: { redeemedAt: 'desc' } }, take: 50,
    });
    const usage = new Map(used.map((u) => [u.couponId, { n: u._count._all, at: u._max.redeemedAt }]));
    const coupons = await prisma.coupon.findMany({
      where: {
        OR: [
          ...(used.length > 0 ? [{ id: { in: used.map((u) => u.couponId) } }] : []),
          { scope: 'CLAIM' as const, claims: { some: { userId } }, endAt: { lt: now, gte: since } },
          { scope: 'USER_GROUP' as const, scopeMeta: { path: ['userId'], equals: userId }, endAt: { lt: now, gte: since } },
        ],
      },
    });
    const items = coupons.flatMap((c) => {
      const u = usage.get(c.id);
      const exhausted = c.perUserLimit > 0 && (u?.n ?? 0) >= c.perUserLimit;
      const state = exhausted ? ('used' as const) : c.endAt < now ? ('expired' as const) : null;
      if (!state) return [];
      return [{ code: c.code, title: c.title, type: c.type, value: c.value, minOrder: c.minOrder, maxDiscount: c.maxDiscount, endAt: c.endAt, state, usedAt: exhausted ? (u?.at ?? null) : null }];
    });
    const at = (i: (typeof items)[number]) => (i.usedAt ?? i.endAt).getTime();
    return items.sort((a, b) => at(b) - at(a)).slice(0, 50);
  }

  it('cùng kết quả với cách cũ: mã đã dùng, đã nhận hết hạn, mã riêng hết hạn; loại mã ngoài 90 ngày và mã của người khác', async () => {
    const me = await createUser(prisma);
    const other = await createUser(prisma);
    const now = new Date();
    const past = (d: number) => new Date(now.getTime() - d * DAY);

    const usedStill = await mk('used-live', {});
    const usedExpired = await mk('used-expired', { endAt: past(5) });
    const claimExpired = await mk('claim-exp', { scope: 'CLAIM', endAt: past(10) });
    const claimOld = await mk('claim-old', { scope: 'CLAIM', endAt: past(120) });
    const claimLive = await mk('claim-live', { scope: 'CLAIM' });
    const claimOfOther = await mk('claim-other', { scope: 'CLAIM', endAt: past(10) });
    const personalExpired = await mk('pers-exp', { scope: 'USER_GROUP', scopeMeta: { userId: me.id }, endAt: past(20) });
    const personalOld = await mk('pers-old', { scope: 'USER_GROUP', scopeMeta: { userId: me.id }, endAt: past(100) });
    const personalOther = await mk('pers-other', { scope: 'USER_GROUP', scopeMeta: { userId: other.id }, endAt: past(20) });
    const both = await mk('both', { scope: 'CLAIM', endAt: past(7) });

    await prisma.couponRedemption.createMany({
      data: [
        { couponId: usedStill.id, userId: me.id, redeemedAt: past(2) },
        { couponId: usedExpired.id, userId: me.id, redeemedAt: past(8) },
        { couponId: both.id, userId: me.id, redeemedAt: past(9) },
      ],
    });
    await prisma.couponClaim.createMany({
      data: [claimExpired, claimOld, claimLive, both].map((c) => ({ couponId: c.id, userId: me.id })).concat([{ couponId: claimOfOther.id, userId: other.id }]),
    });

    const expected = await legacy(me.id, now);
    const actual = await loyalty.getCouponHistory(me.id, now);
    expect(actual).toEqual(expected);
    expect(actual.map((c) => c.code).sort()).toEqual(
      [usedStill, usedExpired, claimExpired, personalExpired, both].map((c) => c.code).sort(),
    );
    expect(actual.map((c) => c.code)).not.toEqual(expect.arrayContaining([personalOld.code, personalOther.code, claimOld.code]));
    expect(await loyalty.getCouponHistory(other.id, now)).toEqual(await legacy(other.id, now));
  });

  it('quá 50 dòng: cùng 50 dòng đầu như cách cũ', async () => {
    const me = await createUser(prisma);
    const now = new Date();
    for (let i = 0; i < 55; i += 1) {
      await mk(`many-${i}`, { scope: 'USER_GROUP', scopeMeta: { userId: me.id }, endAt: new Date(now.getTime() - (i + 1) * 60_000 * 7) });
    }
    const actual = await loyalty.getCouponHistory(me.id, now);
    expect(actual).toHaveLength(50);
    expect(actual).toEqual(await legacy(me.id, now));
  });
});
