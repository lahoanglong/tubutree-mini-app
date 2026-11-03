import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * QTAPI-01: redeemInTx chỉ tăng usedCount khi mã có trần, nên mã đang không giới hạn có usedCount = 0 dù đã có lượt dùng.
 * Admin đặt Tổng lượt = N lên mã như vậy thì updateCoupon phải đếm lại redemption và ghi usedCount, nếu không cả lô checkout
 * song song lọt qua chốt `usedCount < usageLimit` và vượt trần.
 */
describe('admin-coupon-limit-resync: đổi Tổng lượt khi mã đã có lượt dùng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let coupons: CouponsService;
  let admin: AdminService;
  const couponIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    coupons = new CouponsService(prisma);
    // updateCoupon chỉ dùng prisma (và config khi người sửa là nhân viên).
    admin = new AdminService(prisma, ...(Array(10).fill(undefined) as [never, never, never, never, never, never, never, never, never, never]));
  });

  afterAll(async () => {
    if (couponIds.length > 0) {
      await prisma?.couponRedemption.deleteMany({ where: { couponId: { in: couponIds } } });
      await prisma?.coupon.deleteMany({ where: { id: { in: couponIds } } });
    }
    await moduleRef?.close();
  });

  async function unlimitedCouponUsedTimes(n: number) {
    const now = Date.now();
    const c = await prisma.coupon.create({
      data: {
        code: `RS${randCode(8)}`,
        type: 'AMOUNT',
        value: 10_000,
        minOrder: 0,
        startAt: new Date(now - 3_600_000),
        endAt: new Date(now + 86_400_000),
        usageLimit: null,
        scope: 'PUBLIC',
      },
    });
    couponIds.push(c.id);
    for (let i = 0; i < n; i++) {
      const u = await createUser(prisma);
      const o = await createOrder(prisma, { userId: u.id });
      await prisma.couponRedemption.create({ data: { couponId: c.id, userId: u.id, orderId: o.id } });
    }
    return c;
  }

  async function raceRedeem(code: string, k: number) {
    const users = await Promise.all(Array.from({ length: k }, () => createUser(prisma)));
    const orders = await Promise.all(users.map((u) => createOrder(prisma, { userId: u.id })));
    return summarize(await Promise.allSettled(users.map((u, i) => coupons.redeem(code, u.id, orders[i].id))));
  }

  it('mã không giới hạn đã dùng 3 lượt, đặt Tổng lượt = 3, rồi 6 lượt song song → không lượt nào lọt', async () => {
    const c = await unlimitedCouponUsedTimes(3);
    await admin.updateCoupon(c.id, { usageLimit: 3 });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).usedCount).toBe(3);

    const s = await raceRedeem(c.code, 6);
    expect(s.fulfilled).toHaveLength(0);
    expect(new Set(s.errors)).toEqual(new Set(['BadRequestException: Mã giảm giá đã hết lượt sử dụng.']));
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(3);
  });

  it('đặt Tổng lượt = 4 (N+1), 6 lượt song song → đúng 1 lượt lọt, tổng 4', async () => {
    const c = await unlimitedCouponUsedTimes(3);
    await admin.updateCoupon(c.id, { usageLimit: 4 });

    const s = await raceRedeem(c.code, 6);
    expect(s.fulfilled).toHaveLength(1);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(4);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).usedCount).toBe(4);
  });

  it('Tổng lượt nhỏ hơn số đã dùng → 400, không ghi gì', async () => {
    const c = await unlimitedCouponUsedTimes(2);
    await expect(admin.updateCoupon(c.id, { usageLimit: 1 })).rejects.toThrow('đã được dùng 2 lượt');
    const row = await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ usageLimit: null, usedCount: 0 });
  });
});
