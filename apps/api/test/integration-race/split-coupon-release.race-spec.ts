import { PrismaService } from '../../src/prisma/prisma.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * Lần đặt bị tách theo nơi giao (D4): phần giảm của mã chia cho mọi đơn con, lượt dùng mã gắn đơn đầu. Huỷ đơn đầu khi đơn
 * gian hàng còn sống không được trả lượt (mã dùng lại được trong khi đơn kia vẫn hưởng giảm); huỷ hết cả nhóm, kể cả cùng
 * lúc, thì trả đúng một lần. CouponsService, OrderReversalService, OrderStatusService là bản thật trên Postgres.
 */
describe('Trả lượt dùng mã của lần đặt bị tách (real Postgres)', () => {
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let coupons: CouponsService;
  let reversal: OrderReversalService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    coupons = new CouponsService(prisma);
    reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      coupons,
    );
    orderStatus = new OrderStatusService(
      prisma,
      {
        creditOrderPoints: jest.fn().mockResolvedValue(undefined),
        reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
      } as unknown as LoyaltyService,
      {
        lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
        reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      } as unknown as AffiliateService,
      { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      reversal,
      undefined,
      new AnalyticsEventsService(prisma),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Một lần đặt: đơn Tubu (giữ lượt dùng mã một lần) + đơn gian hàng, cùng checkoutGroup. */
  async function splitGroup() {
    const user = await createUser(prisma);
    const coupon = await prisma.coupon.create({
      data: {
        code: `ITSPLIT${randCode(8)}`,
        type: 'AMOUNT',
        value: 50_000,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
        usageLimit: 1,
        perUserLimit: 1,
        scope: 'PUBLIC',
      },
    });
    const primary = await createOrder(prisma, { userId: user.id, total: 20_000, discount: 1_000, couponCode: coupon.code });
    await prisma.order.update({ where: { id: primary.id }, data: { checkoutGroup: primary.code } });
    const shop = await createOrder(prisma, {
      userId: user.id,
      total: 480_000,
      discount: 49_000,
      fulfiller: 'MERCHANT',
      checkoutGroup: primary.code,
    });
    await coupons.redeem(coupon.code, user.id, primary.id);
    return { user, coupon, primary, shop };
  }

  const cancel = (orderId: string) =>
    orderStatus.setStatus(orderId, 'CANCELLED', {
      actorType: 'ADMIN',
      actorId: 'admin-it',
      note: 'Khách đổi ý',
      expectedStatus: 'CONFIRMED',
    });

  /** Hai lần huỷ cùng lật trạng thái rồi mới vào bước đảo tiền: mỗi bên đọc nhóm khi bên kia chưa commit. */
  function bothFlippedBeforeReversal() {
    const original = reversal.reverseFinancials.bind(reversal);
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    return jest.spyOn(reversal, 'reverseFinancials').mockImplementation(async (...args) => {
      if (++arrived === 2) release();
      await gate;
      return original(...args);
    });
  }

  async function couponState(couponId: string) {
    const [c, redemptions] = await Promise.all([
      prisma.coupon.findUniqueOrThrow({ where: { id: couponId } }),
      prisma.couponRedemption.count({ where: { couponId } }),
    ]);
    return { usedCount: c.usedCount, redemptions };
  }

  it('(a) huỷ đơn đầu (giữ lượt) khi đơn gian hàng còn sống → mã vẫn đã dùng; huỷ nốt đơn gian hàng → trả lượt đúng 1 lần', async () => {
    const { coupon, primary, shop } = await splitGroup();
    expect(await couponState(coupon.id)).toEqual({ usedCount: 1, redemptions: 1 });

    await cancel(primary.id);
    const afterPrimary = await couponState(coupon.id);
    await cancel(shop.id);
    const afterAll = await couponState(coupon.id);
    console.log('[a] sau huỷ đơn đầu=%j sau huỷ hết=%j', afterPrimary, afterAll);

    expect(afterPrimary).toEqual({ usedCount: 1, redemptions: 1 });
    expect(afterAll).toEqual({ usedCount: 0, redemptions: 0 });
  });

  it('(b) huỷ hai đơn con cùng lúc (10 vòng) → mỗi vòng trả lượt đúng 1 lần, không vòng nào kẹt lượt', async () => {
    for (let round = 0; round < 10; round++) {
      const { coupon, primary, shop } = await splitGroup();
      const order = round % 2 ? [shop.id, primary.id] : [primary.id, shop.id];
      const spy = bothFlippedBeforeReversal();
      const results = await Promise.allSettled(order.map(cancel)).finally(() => spy.mockRestore());
      const s = summarize(results);
      const state = await couponState(coupon.id);
      const statuses = await prisma.order.findMany({ where: { id: { in: order } }, select: { status: true } });
      console.log('[b#%d] state=%j errors=%j', round, state, s.errors);

      expect(s.fulfilled).toHaveLength(2);
      expect(statuses.every((o) => o.status === 'CANCELLED')).toBe(true);
      expect(state).toEqual({ usedCount: 0, redemptions: 0 });
    }
  });
});
