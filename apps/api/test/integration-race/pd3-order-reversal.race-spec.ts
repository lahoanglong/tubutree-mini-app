import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * PD-3 hoàn điểm khi huỷ đơn trên Postgres thật (spec 2.5, 6.2; T10, T11).
 *  - T10: đơn tiêu cả hai lô → huỷ trả mỗi lô đúng phần đã tiêu, đúng một lần, dù khách huỷ và luồng
 *    admin/webhook (gọi thẳng reverseOrderPoints, xem order-status.service.ts / admin.service.ts) chạy chồng.
 *  - T11: đơn XU cũ (trước PD-3) bị huỷ → hoàn ceil(total/1000) điểm lô CONVERTED, không hoàn Ví, không
 *    đụng coinsBalance (đã đóng băng bằng CHECK users_coins_frozen), không hoàn hai lần.
 */
describe('PD-3 hoàn điểm theo lô khi huỷ đơn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let loyalty: LoyaltyService;
  let reversal: OrderReversalService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrdersService,
        DealerService,
        { provide: CartService, useValue: {} },
        { provide: AffiliateService, useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orders = moduleRef.get(OrdersService);
    loyalty = moduleRef.get(LoyaltyService);
    reversal = moduleRef.get(OrderReversalService);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** User có số dư hai lô khớp sổ (mỗi lô một dòng mở đầu). */
  async function userWithLots(standard: number, converted: number) {
    const user = await createUser(prisma, { pointsBalance: standard, pointsConvertedBalance: converted });
    touched.push(user.id);
    await prisma.pointsTransaction.createMany({
      data: [
        { userId: user.id, delta: standard, lot: 'STANDARD', reason: 'IT_SEED_STANDARD', refType: 'IT' },
        { userId: user.id, delta: converted, lot: 'CONVERTED', reason: 'IT_SEED_CONVERTED', refType: 'IT' },
      ],
    });
    return user;
  }

  /** Đơn đã đặt bằng điểm hai lô, ghi sổ và trừ số dư như CheckoutService.create. */
  async function orderSpendingBothLots(userId: string, usedStandard: number, usedConverted: number) {
    const order = await createOrder(prisma, {
      userId,
      pointsUsed: usedStandard + usedConverted,
      pointsUsedConverted: usedConverted,
    });
    await prisma.pointsTransaction.createMany({
      data: [
        { userId, delta: -usedStandard, lot: 'STANDARD', reason: `ORDER_REDEEM:${order.code}`, refType: 'ORDER', refId: order.id },
        { userId, delta: -usedConverted, lot: 'CONVERTED', reason: `ORDER_REDEEM_CONVERTED:${order.code}`, refType: 'ORDER', refId: order.id },
      ],
    });
    await prisma.user.update({
      where: { id: userId },
      data: { pointsBalance: { decrement: usedStandard }, pointsConvertedBalance: { decrement: usedConverted } },
    });
    return order;
  }

  async function refundRows(orderId: string) {
    return prisma.pointsTransaction.findMany({
      where: { refId: orderId, delta: { gt: 0 } },
      select: { reason: true, lot: true, delta: true, expiresAt: true },
      orderBy: { reason: 'asc' },
    });
  }

  it('T10: huỷ đơn tiêu 30 STANDARD + 120 CONVERTED → mỗi lô nhận lại đúng phần của nó', async () => {
    const user = await userWithLots(500, 300);
    const order = await orderSpendingBothLots(user.id, 30, 120);

    await orders.cancel(user.id, order.code);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsBalance).toBe(500);
    expect(after.pointsConvertedBalance).toBe(300);
    expect(await refundRows(order.id)).toEqual([
      { reason: `ORDER_REFUND_CONVERTED:${order.code}`, lot: 'CONVERTED', delta: 120, expiresAt: null },
      // OQ-15: điểm thường hoàn có hạn; lô quy đổi (tiền trả trước) không bao giờ có hạn.
      { reason: `ORDER_REFUND_POINTS:${order.code}`, lot: 'STANDARD', delta: 30, expiresAt: expect.any(Date) },
    ]);
  });

  it('T10: 2 lần khách huỷ + 3 lần reverseOrderPoints (admin/webhook) ĐỒNG THỜI → mỗi lô hoàn đúng 1 lần', async () => {
    const user = await userWithLots(500, 300);
    const order = await orderSpendingBothLots(user.id, 30, 120);

    const results = await Promise.allSettled([
      orders.cancel(user.id, order.code),
      loyalty.reverseOrderPoints(order.id),
      orders.cancel(user.id, order.code),
      loyalty.reverseOrderPoints(order.id),
      loyalty.reverseOrderPoints(order.id),
    ]);
    const s = summarize(results);
    console.log('[T10] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    // reverseOrderPoints nuốt P2002 của lần thua; cancel thua thấy CANCELLED rồi trả detail.
    expect(s.rejected).toHaveLength(0);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsBalance).toBe(500);
    expect(after.pointsConvertedBalance).toBe(300);
    const rows = await refundRows(order.id);
    expect(rows.map((r) => [r.reason.split(':')[0], r.lot, r.delta])).toEqual([
      ['ORDER_REFUND_CONVERTED', 'CONVERTED', 120],
      ['ORDER_REFUND_POINTS', 'STANDARD', 30],
    ]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
  });

  // Review B1: lô CONVERTED là tiền trả trước, phải hoàn TRONG tx huỷ (reverseFinancials). reverseOrderPoints chạy
  // sau commit và có thể ném (đứt DB, SIGTERM); lần huỷ lại bị guard trạng thái chặn nên không có đường thử lại.
  it('B1: reverseOrderPoints ném lỗi sau khi tx huỷ commit → lô CONVERTED đã hoàn, retry chỉ hoàn STANDARD (không hoàn lô quy đổi lần 2)', async () => {
    const user = await userWithLots(500, 300);
    const order = await orderSpendingBothLots(user.id, 30, 120);

    const spy = jest.spyOn(loyalty, 'reverseOrderPoints').mockRejectedValueOnce(new Error('connection reset'));
    await expect(orders.cancel(user.id, order.code)).rejects.toThrow('connection reset');
    spy.mockRestore();

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    const mid = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(mid.pointsConvertedBalance).toBe(300);
    expect(mid.pointsBalance).toBe(470);

    await loyalty.reverseOrderPoints(order.id);
    await loyalty.reverseOrderPoints(order.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsBalance).toBe(500);
    expect(after.pointsConvertedBalance).toBe(300);
    expect((await refundRows(order.id)).map((r) => [r.reason.split(':')[0], r.lot, r.delta])).toEqual([
      ['ORDER_REFUND_CONVERTED', 'CONVERTED', 120],
      ['ORDER_REFUND_POINTS', 'STANDARD', 30],
    ]);
  });

  it('B1: đơn chỉ tiêu lô CONVERTED, reverseOrderPoints ném lỗi → vẫn đã hoàn đủ; gọi lại không hoàn thêm', async () => {
    const user = await userWithLots(0, 200);
    const order = await orderSpendingBothLots(user.id, 0, 200);

    const spy = jest.spyOn(loyalty, 'reverseOrderPoints').mockRejectedValueOnce(new Error('pool timeout'));
    await expect(orders.cancel(user.id, order.code)).rejects.toThrow('pool timeout');
    spy.mockRestore();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pointsConvertedBalance).toBe(200);
    await loyalty.reverseOrderPoints(order.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsConvertedBalance).toBe(200);
    expect(await refundRows(order.id)).toHaveLength(1);
  });

  it('T10: đơn cũ trước PD-3 (pointsUsedConverted = 0) → hoàn toàn bộ về STANDARD như trước', async () => {
    const user = await userWithLots(200, 50);
    const order = await createOrder(prisma, { userId: user.id, pointsUsed: 40 });
    await prisma.pointsTransaction.create({
      data: { userId: user.id, delta: -40, lot: 'STANDARD', reason: `ORDER_REDEEM:${order.code}`, refType: 'ORDER', refId: order.id },
    });
    await prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { decrement: 40 } } });

    await orders.cancel(user.id, order.code);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsBalance).toBe(200);
    expect(after.pointsConvertedBalance).toBe(50);
    expect((await refundRows(order.id)).map((r) => [r.reason.split(':')[0], r.lot, r.delta])).toEqual([
      ['ORDER_REFUND_POINTS', 'STANDARD', 40],
    ]);
  });

  /** Đơn XU tạo trước PD-3: đã trả bằng xu (PAID), user giờ coinsBalance = 0 sau migration B/C. */
  async function legacyXuOrder(total: number) {
    const user = await createUser(prisma, { walletBalance: 0 });
    touched.push(user.id);
    const order = await createOrder(prisma, {
      userId: user.id,
      paymentMethod: 'XU',
      paymentStatus: 'PAID',
      total,
      subtotal: total,
    });
    return { user, order };
  }

  async function walletRows(userId: string) {
    return prisma.walletTransaction.count({ where: { userId } });
  }

  it('T11: khách huỷ đơn XU cũ 123.456đ → +124 điểm lô CONVERTED, Ví và xu không đổi, đơn REFUNDED', async () => {
    const { user, order } = await legacyXuOrder(123_456);

    await orders.cancel(user.id, order.code);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsConvertedBalance).toBe(124);
    expect(after.pointsBalance).toBe(0);
    expect(after.coinsBalance).toBe(0);
    expect(after.walletBalance).toBe(0);
    expect(await walletRows(user.id)).toBe(0);
    expect(await refundRows(order.id)).toEqual([
      { reason: `ORDER_REFUND_XU:${order.code}`, lot: 'CONVERTED', delta: 124, expiresAt: null },
    ]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect([o.status, o.paymentStatus]).toEqual(['CANCELLED', 'REFUNDED']);
  });

  it('T11: 2 lần khách huỷ + 3 lần reverseFinancials (admin trả hàng) ĐỒNG THỜI → hoàn đúng 1 lần', async () => {
    const { user, order } = await legacyXuOrder(50_000);
    const snap = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });

    const results = await Promise.allSettled([
      orders.cancel(user.id, order.code),
      prisma.$transaction((tx) => reversal.reverseFinancials(tx, snap)),
      orders.cancel(user.id, order.code),
      prisma.$transaction((tx) => reversal.reverseFinancials(tx, snap)),
      prisma.$transaction((tx) => reversal.reverseFinancials(tx, snap)),
    ]);
    const s = summarize(results);
    console.log('[T11] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    expect(s.rejected).toHaveLength(0);
    const refundedNow = [results[1], results[3], results[4]].filter(
      (r) => r.status === 'fulfilled' && (r.value as { moneyRefunded: boolean }).moneyRefunded,
    );
    expect(refundedNow.length).toBeLessThanOrEqual(1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsConvertedBalance).toBe(50);
    expect(after.coinsBalance).toBe(0);
    expect(after.walletBalance).toBe(0);
    expect(await walletRows(user.id)).toBe(0);
    expect(await refundRows(order.id)).toHaveLength(1);
  });

  it('T11: đơn lỡ bị lật lại PAID rồi đảo lần nữa (3 lần song song) → khoá converted_refund_unique chặn hoàn lần 2', async () => {
    const { user, order } = await legacyXuOrder(9_001);
    await orders.cancel(user.id, order.code);
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
    const snap = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => prisma.$transaction((tx) => reversal.reverseFinancials(tx, snap))),
    );
    expect(summarize(results).rejected).toHaveLength(0);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsConvertedBalance).toBe(10);
    expect(after.walletBalance).toBe(0);
    expect(await refundRows(order.id)).toHaveLength(1);
  });
});
