import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrderStatusService, InvalidOrderTransitionError } from './order-status.service';
import { UnpaidPrepaidTransitionError } from './order-transition';
import { OrderReversalService } from './order-reversal.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    code: 'TUBU1',
    userId: 'u1',
    status: 'CONFIRMED',
    note: null,
    total: 100000,
    paymentMethod: 'WALLET',
    paymentStatus: 'PAID',
    items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null }],
    ...overrides,
  };
}

describe('OrderStatusService', () => {
  let service: OrderStatusService;
  let prisma: {
    order: { findFirst: jest.Mock; findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let loyalty: { creditOrderPoints: jest.Mock; reverseOrderPoints: jest.Mock };
  let affiliate: {
    lockCommissionsForOrder: jest.Mock;
    grantReferralReward: jest.Mock;
    reverseCommissionsForOrder: jest.Mock;
  };
  let notifications: { notify: jest.Mock };
  let reversal: { reverseFinancials: jest.Mock };
  // Task 6 review finding: nếu không wiring thật, this.analytics luôn undefined trong mọi test
  // (@Optional() no-op câm lặng) → không test nào từng chứng minh order_status_changed thật sự
  // ghi đúng from/to trên nhánh thắng race. Mock record() thật để assert được (giống fix Task 5
  // cho PancakeProcessor, xem pancake.processor.spec.ts:72-73).
  let analytics: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      order: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
      $transaction: jest.fn(),
    };
    loyalty = { creditOrderPoints: jest.fn().mockResolvedValue(undefined), reverseOrderPoints: jest.fn().mockResolvedValue(undefined) };
    affiliate = {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    reversal = { reverseFinancials: jest.fn().mockResolvedValue(undefined) };
    analytics = { record: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        OrderStatusService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoyaltyService, useValue: loyalty },
        { provide: AffiliateService, useValue: affiliate },
        { provide: NotificationsService, useValue: notifications },
        { provide: OrderReversalService, useValue: reversal },
        { provide: AnalyticsEventsService, useValue: analytics },
      ],
    }).compile();
    service = module.get(OrderStatusService);
  });

  function mockTx(flipCount = 1) {
    const tx = {
      order: { updateMany: jest.fn().mockResolvedValue({ count: flipCount }), findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 'u1' }) },
      // Sổ ghi vết đổi trạng thái — ghi trong CÙNG transaction với lần lật status.
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
    return tx;
  }

  /**
   * Đổi trạng thái trước đây chỉ để lại một dòng log ứng dụng (xoay vòng theo container) và một
   * chuỗi note nối thêm, không có actor. Một tài khoản admin bị chiếm chuyển 50 đơn đã giao sang
   * CANCELLED là mỗi đơn tự động hoàn tổng tiền vào ví khách, mà sau đó không truy được ai làm gì.
   */
  it('ghi vết đúng from/to + actor trong CÙNG transaction với lần lật status', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'PACKED' });
    const tx = mockTx();

    await service.setStatus('o1', 'PACKED' as never, {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      note: 'gói xong',
    });

    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        orderId: 'o1',
        fromStatus: 'CONFIRMED',
        toStatus: 'PACKED',
        actorType: 'ADMIN',
        actorId: 'admin-1',
        note: 'gói xong',
      },
    });
  });

  it('D4: patch (hãng + mã vận đơn) ghi trong CÙNG câu lật trạng thái', async () => {
    const order = makeOrder({ status: 'PACKED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'SHIPPING' });
    const tx = mockTx();
    const shippedAt = new Date('2026-10-14T03:00:00Z');

    await service.setStatus('o1', 'SHIPPING' as never, {
      actorType: 'MERCHANT',
      patch: { shippingPartner: 'GHTK', shippingCode: 'S123', trackingLink: null, shippedAt },
    });

    expect(tx.order.updateMany.mock.calls[0][0].data).toEqual({
      status: 'SHIPPING',
      shippingPartner: 'GHTK',
      shippingCode: 'S123',
      trackingLink: null,
      shippedAt,
    });
  });

  it('D4: khách/admin/hệ thống huỷ đơn đối tác tự giao → báo chủ gian hàng; đối tác tự huỷ thì không báo lại chính họ', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CANCELLED' });
    (prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest
      .fn()
      .mockResolvedValue({ fulfiller: 'MERCHANT', fulfillerStorefront: { ownerUserId: 'shop-owner' } });
    mockTx();

    await service.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', note: 'Admin: Khách đổi ý' });
    expect(notifications.notify).toHaveBeenCalledWith('shop-owner', 'MERCHANT_ORDER_CANCELLED', {
      order_code: 'TUBU1',
      reason: 'Tubu Tree huỷ đơn',
    });

    notifications.notify.mockClear();
    prisma.order.findFirst.mockResolvedValue(order);
    mockTx();
    await service.setStatus('o1', 'CANCELLED' as never, { actorType: 'MERCHANT', note: 'Hết hàng' });
    expect(notifications.notify).not.toHaveBeenCalledWith('shop-owner', 'MERCHANT_ORDER_CANCELLED', expect.anything());
  });

  it.each([
    ['CUSTOMER', 'Khách huỷ đơn'],
    ['ADMIN', 'Tubu Tree huỷ đơn'],
    ['PANCAKE', 'Kho Pancake báo huỷ đơn'],
    ['SYSTEM', 'Hệ thống tự huỷ đơn quá hạn thanh toán'],
    [undefined, 'Hệ thống tự huỷ đơn quá hạn thanh toán'],
  ])('SYNC-9: huỷ bởi %s → chủ gian hàng đọc "%s", không bao giờ thấy ghi chú nội bộ', async (actorType, label) => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CANCELLED' });
    (prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest
      .fn()
      .mockResolvedValue({ fulfiller: 'MERCHANT', fulfillerStorefront: { ownerUserId: 'shop-owner' } });
    mockTx();
    const internal = 'Tự huỷ: quá 24 giờ chưa thanh toán — đã mở lệnh ZALOPAY: đối chiếu ZALOPAY, đã trừ tiền thì hoàn thủ công';
    await service.setStatus('o1', 'CANCELLED' as never, { actorType: actorType as never, note: internal });
    const call = notifications.notify.mock.calls.find((c) => c[1] === 'MERCHANT_ORDER_CANCELLED');
    expect(call?.[2]).toEqual({ order_code: 'TUBU1', reason: label });
    expect(JSON.stringify(call)).not.toContain('hoàn thủ công');
  });

  // R2-LIFECYCLE-5: đơn đã trả bị admin/hệ thống/Pancake huỷ hoặc trả — khách được báo số tiền hoàn và nơi tiền về.
  it.each([
    ['CANCELLED', 'ORDER_CANCELLED'],
    ['RETURNED', 'ORDER_RETURNED'],
  ])('lật %s đơn đã trả → thông báo kèm refund_note (tiền vào Ví + Điểm Xanh hoàn lại)', async (to, code) => {
    const order = makeOrder({ status: to === 'RETURNED' ? 'DELIVERED' : 'CONFIRMED', paymentStatus: 'PAID' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: to });
    (prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(null);
    reversal.reverseFinancials.mockResolvedValue({ moneyRefunded: true, pointsRefunded: 15, refund: { amount: 103_000, to: 'WALLET' } });
    mockTx();
    await service.setStatus('o1', to as never, { actorType: 'ADMIN' });
    expect(notifications.notify).toHaveBeenCalledWith('u1', code, {
      order_code: 'TUBU1',
      refund_note: ' Đã hoàn 103.000đ vào Ví Tubu. Đã hoàn 15 Điểm Xanh.',
    });
  });

  it('R3-MONEY-7: admin huỷ kèm lý do → tin nói lý do và cả Điểm Xanh thường (lô STANDARD) được hoàn sau tx', async () => {
    const order = makeOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CANCELLED' });
    (prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(null);
    reversal.reverseFinancials.mockResolvedValue({ moneyRefunded: true, pointsRefunded: 0, refund: { amount: 95_000, to: 'WALLET' } });
    loyalty.reverseOrderPoints.mockResolvedValue(19);
    mockTx();
    await service.setStatus('o1', 'CANCELLED' as never, {
      actorType: 'ADMIN',
      note: 'Admin: Hết hàng nhà cung cấp',
      customerReason: 'Hết hàng nhà cung cấp.',
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CANCELLED', {
      order_code: 'TUBU1',
      refund_note: ' Lý do: Hết hàng nhà cung cấp. Đã hoàn 95.000đ vào Ví Tubu. Đã hoàn 19 Điểm Xanh.',
    });
  });

  it('đơn chưa thu tiền bị huỷ → refund_note rỗng (không nói gì về tiền)', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CANCELLED' });
    (prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(null);
    reversal.reverseFinancials.mockResolvedValue({ moneyRefunded: false, pointsRefunded: 0, refund: null });
    mockTx();
    await service.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM' });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CANCELLED', { order_code: 'TUBU1', refund_note: '' });
  });

  it('UAT GOMDON-10: ghi chú hệ thống (webhook/cron/admin) KHÔNG nối vào Order.note — ô "Ghi chú" khách tự viết', async () => {
    const order = makeOrder({ status: 'SHIPPING', note: 'Giao giờ hành chính' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'DELIVERED' });
    const tx = mockTx();

    await service.setStatus('o1', 'DELIVERED' as never, { actorType: 'SYSTEM', note: 'Gomdon webhook: Giao thành công (status 7)' });

    const data = tx.order.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('note');
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: 'Gomdon webhook: Giao thành công (status 7)' }),
    });
  });

  /**
   * Task 6 review finding: trước đây this.analytics luôn undefined trong test (không wiring),
   * nên if(this.analytics) no-op câm lặng và không ai chứng minh được from/to không bị đảo
   * ngược (tsc không bắt được vì cả hai đều cùng kiểu OrderStatus). Test này wiring analytics
   * thật (mock ở beforeEach) để assert đúng from = status GỐC (CONFIRMED, trước khi lật), to =
   * targetStatus, ghi trong CÙNG tx với lần lật status.
   */
  it('ghi order_status_changed đúng from/to (không đảo ngược) trên nhánh thắng race', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'PACKED' });
    const tx = mockTx();

    await service.setStatus('o1', 'PACKED' as never, { actorType: 'ADMIN', note: 'gói xong' });

    expect(analytics.record).toHaveBeenCalledTimes(1);
    expect(analytics.record).toHaveBeenCalledWith(tx, {
      eventName: 'order_status_changed',
      userId: 'u1',
      platform: 'system',
      props: {
        orderId: 'o1',
        from: 'CONFIRMED',
        to: 'PACKED',
        actorType: 'ADMIN',
        reason: 'gói xong',
      },
    });
  });

  it('không truyền actor (webhook/cron) → SYSTEM, vẫn có vết', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'PACKED' });
    const tx = mockTx();

    await service.setStatus('o1', 'PACKED' as never);

    expect(tx.orderStatusHistory.create.mock.calls[0][0].data).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
    });
  });

  it('thua race (flip count 0) → KHÔNG ghi vết giả', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue(order);
    const tx = mockTx(0);

    await service.setStatus('o1', 'PACKED' as never);

    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    // Task 6 review finding: nhánh thua race không được ghi order_status_changed — trước đây
    // không test nào chứng minh được vì analytics luôn undefined (no-op câm lặng che mất cả
    // 2 khả năng: "không gọi" và "gọi nhưng bị nuốt lỗi").
    expect(analytics.record).not.toHaveBeenCalled();
  });

  it('DELIVERED: credit điểm + lock hoa hồng + refer-reward, KHÔNG gọi reversal', async () => {
    const order = makeOrder({ status: 'SHIPPING' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'DELIVERED' });
    mockTx();

    await service.setStatus('o1', 'DELIVERED' as never);

    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.lockCommissionsForOrder).toHaveBeenCalledWith('o1');
    expect(affiliate.grantReferralReward).toHaveBeenCalledWith('o1');
    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_DELIVERED', { order_code: 'TUBU1' });
  });

  // C-053 (A1-019): lời ORDER_DELIVERED từng khẳng định "Điểm Xanh đã được cộng" kể cả đơn trả bằng xu (không tích điểm).
  it('DELIVERED: đơn có tích điểm → tin báo kèm số Điểm Xanh được cộng (points_note)', async () => {
    const order = makeOrder({ status: 'SHIPPING', pointsEarned: 12 });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'DELIVERED' });
    mockTx();

    await service.setStatus('o1', 'DELIVERED' as never);

    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_DELIVERED', {
      order_code: 'TUBU1',
      points_note: ' Bạn được cộng 12 Điểm Xanh.',
    });
  });

  it('DELIVERED: đơn không tích điểm (trả bằng xu) → tin báo KHÔNG nhắc điểm', async () => {
    const order = makeOrder({ status: 'SHIPPING', paymentMethod: 'XU', pointsEarned: 0 });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'DELIVERED' });
    mockTx();

    await service.setStatus('o1', 'DELIVERED' as never);

    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_DELIVERED', { order_code: 'TUBU1' });
  });

  it('chỉ DELIVERED mới có points_note: đơn tích điểm chuyển PACKED vẫn chỉ gửi order_code', async () => {
    const order = makeOrder({ status: 'CONFIRMED', pointsEarned: 12 });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'PACKED' });
    mockTx();

    await service.setStatus('o1', 'PACKED' as never);

    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_PACKED', { order_code: 'TUBU1' });
  });

  it('DELIVERED: xét thưởng giới thiệu lỗi (khoá/deadlock) → đơn vẫn giao xong, vẫn notify', async () => {
    const order = makeOrder({ status: 'SHIPPING' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'DELIVERED' });
    mockTx();
    affiliate.grantReferralReward.mockRejectedValue(new Error('deadlock detected'));

    await expect(service.setStatus('o1', 'DELIVERED' as never)).resolves.toMatchObject({ status: 'DELIVERED' });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_DELIVERED', { order_code: 'TUBU1' });
  });

  it('CANCELLED: gọi reversal trong tx + đảo điểm/hoa hồng, KHÔNG credit', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CANCELLED' });
    const tx = mockTx();

    await service.setStatus('o1', 'CANCELLED' as never);

    expect(reversal.reverseFinancials).toHaveBeenCalledWith(tx, order);
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
  });

  it('ném InvalidOrderTransitionError khi chuyển DELIVERED → CONFIRMED (regression)', async () => {
    const order = makeOrder({ status: 'DELIVERED' });
    prisma.order.findFirst.mockResolvedValue(order);

    await expect(service.setStatus('o1', 'CONFIRMED' as never)).rejects.toThrow(InvalidOrderTransitionError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
  });

  it('ném InvalidOrderTransitionError khi chuyển CANCELLED → bất kỳ đâu khác', async () => {
    const order = makeOrder({ status: 'CANCELLED' });
    prisma.order.findFirst.mockResolvedValue(order);
    await expect(service.setStatus('o1', 'DELIVERED' as never)).rejects.toThrow(InvalidOrderTransitionError);
  });

  it('no-op khi target trùng status hiện tại — không chạy side-effect, không mở transaction', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);

    const result = await service.setStatus('o1', 'CONFIRMED' as never);

    expect(result).toBe(order);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
  });

  it('thua race (flip count=0) → bail êm, không chạy side-effect', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CANCELLED' });
    mockTx(0);

    await service.setStatus('o1', 'CANCELLED' as never);

    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
  });

  it.each(['SHIPPING', 'DELIVERED'])(
    'thua race vì đơn vừa bị HUỶ, Pancake báo %s → ném InvalidOrderTransitionError như lúc đọc tuần tự (processor gắn "Cần xử lý") (R3-CANCEL-5)',
    async (target) => {
      const order = makeOrder({ status: 'PACKED', paymentMethod: 'COD' });
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CANCELLED' });
      mockTx(0);
      const err = await service.setStatus('o1', target as never, { actorType: 'PANCAKE' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidOrderTransitionError);
      expect(err).toMatchObject({ from: 'CANCELLED', to: target });
      expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
    },
  );

  it('ném NotFoundException khi không tìm thấy đơn', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.setStatus('missing', 'CANCELLED' as never)).rejects.toThrow(NotFoundException);
  });

  it('tìm đơn theo id HOẶC code', async () => {
    const order = makeOrder({ status: 'CONFIRMED' });
    prisma.order.findFirst.mockResolvedValue(order);
    await service.setStatus('TUBU1', 'CONFIRMED' as never);
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: 'TUBU1' }, { code: 'TUBU1' }] },
      include: { items: true },
    });
  });
});

/**
 * Đổi trạng thái trước đây chỉ để lại một dòng log ứng dụng (xoay vòng theo container) và một
 * chuỗi note nối thêm, không có actor. Một tài khoản admin bị chiếm chuyển 50 đơn đã giao sang
 * CANCELLED là mỗi đơn tự động hoàn tổng tiền vào ví khách, mà sau đó không truy được ai làm gì.
 */

describe('OrderStatusService — huỷ đơn thu gom tái chế → huỷ vận đơn Gomdon', () => {
  function make(order: Record<string, unknown>, queueAdd = jest.fn().mockResolvedValue({})) {
    const tx = {
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: order.userId }) },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order), findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    const queue = { getJob: jest.fn().mockResolvedValue(undefined), add: queueAdd };
    const svc = new OrderStatusService(
      prisma as unknown as PrismaService,
      { creditOrderPoints: jest.fn(), reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService,
      {
        lockCommissionsForOrder: jest.fn(),
        grantReferralReward: jest.fn(),
        reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      } as unknown as AffiliateService,
      { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      { reverseFinancials: jest.fn().mockResolvedValue(undefined) } as unknown as OrderReversalService,
      queue as never,
    );
    return { svc, queue };
  }

  it('admin/merchant/Pancake huỷ đơn thu gom → enqueue job huỷ vận đơn (jobId cancel-<id>)', async () => {
    const { svc, queue } = make(makeOrder({ hasRecyclingPickup: true, gomdonOrderId: '77' }));
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' });
    expect(queue.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, expect.objectContaining({ jobId: 'cancel-o1' }));
  });

  it('đơn thường / chuyển sang trạng thái khác CANCELLED → không enqueue', async () => {
    const a = make(makeOrder({ hasRecyclingPickup: false }));
    await a.svc.setStatus('o1', 'CANCELLED' as never);
    expect(a.queue.add).not.toHaveBeenCalled();
    const b = make(makeOrder({ hasRecyclingPickup: true }));
    await b.svc.setStatus('o1', 'PACKED' as never);
    expect(b.queue.add).not.toHaveBeenCalled();
  });

  it('enqueue lỗi (Redis) → đơn vẫn CANCELLED, không ném (cron Gomdon quét lại)', async () => {
    const { svc } = make(makeOrder({ hasRecyclingPickup: true }), jest.fn().mockRejectedValue(new Error('redis')));
    await expect(svc.setStatus('o1', 'CANCELLED' as never)).resolves.toBeDefined();
  });
});

describe('OrderStatusService — ghi deliveredAt khi lật DELIVERED (mốc hạn đổi/trả)', () => {
  it('DELIVERED → data có deliveredAt; trạng thái khác → không', async () => {
    const tx = {
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 'u1' }) },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const order = makeOrder({ status: 'SHIPPING' });
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order), findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    const svc = new OrderStatusService(
      prisma as unknown as PrismaService,
      { creditOrderPoints: jest.fn().mockResolvedValue(undefined), reverseOrderPoints: jest.fn() } as unknown as LoyaltyService,
      {
        lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
        grantReferralReward: jest.fn().mockResolvedValue(undefined),
        reverseCommissionsForOrder: jest.fn(),
      } as unknown as AffiliateService,
      { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      { reverseFinancials: jest.fn() } as unknown as OrderReversalService,
    );
    await svc.setStatus('o1', 'DELIVERED' as never);
    expect(tx.order.updateMany.mock.calls[0][0].data.deliveredAt).toBeInstanceOf(Date);

    prisma.order.findFirst.mockResolvedValue(makeOrder({ status: 'CONFIRMED' }));
    await svc.setStatus('o1', 'PACKED' as never);
    expect(tx.order.updateMany.mock.calls[1][0].data.deliveredAt).toBeUndefined();
  });
});

/**
 * C-024: admin/merchant/webhook từng đẩy được đơn chuyển khoản CHƯA trả tiền lên DELIVERED → cộng điểm
 * + chốt hoa hồng cho một đơn không ai trả. Trả trước (mọi phương thức trừ COD) phải PAID mới được
 * SHIPPING/DELIVERED; đơn đại lý ghi công nợ (có dòng DealerCreditLedger refType=ORDER) được miễn.
 */
describe('OrderStatusService — chặn giao đơn trả trước chưa thanh toán (C-024)', () => {
  function make(order: Record<string, unknown>, opts: { creditDebit?: boolean; flipCount?: number } = {}) {
    const tx = {
      order: { updateMany: jest.fn().mockResolvedValue({ count: opts.flipCount ?? 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: order.userId }) },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order), findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(opts.creditDebit ? { id: 'l1' } : null) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const loyalty = { creditOrderPoints: jest.fn().mockResolvedValue(undefined), reverseOrderPoints: jest.fn() };
    const affiliate = {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn(),
    };
    const svc = new OrderStatusService(
      prisma as unknown as PrismaService,
      loyalty as unknown as LoyaltyService,
      affiliate as unknown as AffiliateService,
      { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      { reverseFinancials: jest.fn() } as unknown as OrderReversalService,
    );
    return { svc, prisma, tx, loyalty, affiliate };
  }

  it.each(['SHIPPING', 'DELIVERED'])('BANK_TRANSFER UNPAID → %s bị chặn, không mở tx, không cộng điểm/hoa hồng', async (to) => {
    const { svc, prisma, loyalty, affiliate } = make(
      makeOrder({ status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }),
    );
    await expect(svc.setStatus('o1', to as never, { actorType: 'ADMIN' })).rejects.toThrow(UnpaidPrepaidTransitionError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.lockCommissionsForOrder).not.toHaveBeenCalled();
  });

  it('PENDING_PAYMENT → DELIVERED (nhảy cóc) cho đơn chuyển khoản chưa trả → chặn', async () => {
    const { svc } = make(makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    await expect(svc.setStatus('o1', 'DELIVERED' as never)).rejects.toThrow(InvalidOrderTransitionError);
  });

  it('ZALOPAY UNPAID → DELIVERED bị chặn', async () => {
    const { svc } = make(makeOrder({ status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID' }));
    await expect(svc.setStatus('o1', 'DELIVERED' as never)).rejects.toThrow(UnpaidPrepaidTransitionError);
  });

  it('BANK_TRANSFER đã PAID → DELIVERED đi được, lật có guard paymentStatus=PAID', async () => {
    const { svc, tx, loyalty } = make(makeOrder({ status: 'SHIPPING', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }));
    await svc.setStatus('o1', 'DELIVERED' as never);
    expect(tx.order.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'o1', status: 'SHIPPING', paymentStatus: 'PAID' });
    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
  });

  it('COD UNPAID → DELIVERED đi được (thu tiền khi giao), không tra sổ công nợ', async () => {
    const { svc, prisma, loyalty } = make(makeOrder({ status: 'SHIPPING', paymentMethod: 'COD', paymentStatus: 'UNPAID' }));
    await svc.setStatus('o1', 'DELIVERED' as never);
    expect(loyalty.creditOrderPoints).toHaveBeenCalled();
    expect(prisma.dealerCreditLedger.findFirst).not.toHaveBeenCalled();
  });

  it('đơn đại lý ghi công nợ (BANK_TRANSFER UNPAID + dòng nợ ORDER) → SHIPPING đi được', async () => {
    const { svc, prisma, tx } = make(
      makeOrder({ type: 'DEALER', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }),
      { creditDebit: true },
    );
    await svc.setStatus('o1', 'SHIPPING' as never);
    expect(prisma.dealerCreditLedger.findFirst).toHaveBeenCalledWith({
      where: { refType: 'ORDER', refId: 'o1' },
      select: { id: true },
    });
    expect(tx.order.updateMany).toHaveBeenCalled();
  });

  it('đơn đại lý TRẢ TRƯỚC (không có dòng nợ) chưa PAID → DELIVERED bị chặn', async () => {
    const { svc } = make(makeOrder({ type: 'DEALER', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    await expect(svc.setStatus('o1', 'DELIVERED' as never)).rejects.toThrow(UnpaidPrepaidTransitionError);
  });

  it('BANK_TRANSFER UNPAID → PACKED / CANCELLED vẫn đi được', async () => {
    const a = make(makeOrder({ status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    await expect(a.svc.setStatus('o1', 'PACKED' as never)).resolves.toBeDefined();
    const b = make(makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    await expect(b.svc.setStatus('o1', 'CANCELLED' as never)).resolves.toBeDefined();
  });

  it.each(['CONFIRMED', 'PACKED'])(
    'PENDING_PAYMENT chuyển khoản chưa trả → %s bị chặn (không để lọt khỏi cron huỷ quá hạn)',
    async (to) => {
      const { svc, prisma } = make(makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
      await expect(svc.setStatus('o1', to as never, { actorType: 'ADMIN' })).rejects.toThrow(UnpaidPrepaidTransitionError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('PENDING_PAYMENT đã PAID → CONFIRMED đi được, lật có guard paymentStatus=PAID', async () => {
    const { svc, tx } = make(makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }));
    await svc.setStatus('o1', 'CONFIRMED' as never);
    expect(tx.order.updateMany.mock.calls[0][0].where).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'PAID' });
  });

  // Review lượt 1: webhook vận chuyển báo giao/đang giao khi tiền chuyển khoản chưa đối soát bị bỏ qua êm và không
  // bao giờ phát lại — để lại dấu trên ghi chú đơn để sau khi nhận tiền admin biết cần đẩy trạng thái tay.
  it.each(['PANCAKE', 'SYSTEM', undefined])(
    'webhook (%s) báo DELIVERED cho đơn chưa trả → vẫn chặn, nhưng ghi dấu vào ghi chú đơn (không lặp)',
    async (actorType) => {
      const { svc, prisma } = make(makeOrder({ status: 'PACKED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
      await expect(
        svc.setStatus('o1', 'DELIVERED' as never, actorType ? { actorType: actorType as never } : {}),
      ).rejects.toThrow(UnpaidPrepaidTransitionError);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const sqlParts = (prisma.$executeRaw.mock.calls[0] as unknown[])[0] as string[];
      const values = (prisma.$executeRaw.mock.calls[0] as unknown[]).slice(1);
      expect(sqlParts.join('?')).toMatch(/position\(/);
      expect(values).toEqual(expect.arrayContaining([expect.stringContaining('DELIVERED'), 'o1']));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('admin bấm DELIVERED cho đơn chưa trả → chỉ 400, không ghi dấu', async () => {
    const { svc, prisma } = make(makeOrder({ status: 'PACKED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    await expect(svc.setStatus('o1', 'DELIVERED' as never, { actorType: 'ADMIN' })).rejects.toThrow(UnpaidPrepaidTransitionError);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('ghi dấu lỗi (DB) → vẫn ném lỗi chuyển trạng thái gốc để webhook bỏ qua êm', async () => {
    const { svc, prisma } = make(makeOrder({ status: 'PACKED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    prisma.$executeRaw.mockRejectedValueOnce(new Error('db blip'));
    await expect(svc.setStatus('o1', 'SHIPPING' as never, { actorType: 'PANCAKE' })).rejects.toThrow(UnpaidPrepaidTransitionError);
  });

  it('chuyển lùi vẫn bị chặn như cũ (DELIVERED → CONFIRMED)', async () => {
    const { svc } = make(makeOrder({ status: 'DELIVERED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }));
    await expect(svc.setStatus('o1', 'CONFIRMED' as never)).rejects.toThrow(InvalidOrderTransitionError);
  });
});

/**
 * C-024: hệ quả của "đã nhận tiền" (UNPAID → PAID, PENDING_PAYMENT → CONFIRMED, paidAt, order_paid,
 * đặt bưu tá thu gom, báo khách) gom về MỘT hàm để nút admin và webhook đối soát không lệch nhau.
 */
describe('OrderStatusService.markPaid', () => {
  function make(reads: Record<string, unknown>[], flipCounts: number[] = [1]) {
    const flips = [...flipCounts];
    const tx = {
      order: { updateMany: jest.fn(async () => ({ count: flips.length ? flips.shift()! : 1 })), findUniqueOrThrow: jest.fn(async () => ({ userId: reads[0]?.userId })) },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const findFirst = jest.fn();
    for (const r of reads) findFirst.mockResolvedValueOnce(r);
    findFirst.mockResolvedValue(reads[reads.length - 1]);
    const prisma = {
      order: {
        findFirst,
        findUniqueOrThrow: jest.fn(async () => reads[reads.length - 1]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const queue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) };
    const analytics = { record: jest.fn().mockResolvedValue(undefined) };
    const loyalty = { creditOrderPoints: jest.fn(), reverseOrderPoints: jest.fn() };
    const svc = new OrderStatusService(
      prisma as unknown as PrismaService,
      loyalty as unknown as LoyaltyService,
      {
        lockCommissionsForOrder: jest.fn(),
        grantReferralReward: jest.fn(),
        reverseCommissionsForOrder: jest.fn(),
      } as unknown as AffiliateService,
      notifications as unknown as NotificationsService,
      { reverseFinancials: jest.fn() } as unknown as OrderReversalService,
      queue as never,
      analytics as unknown as AnalyticsEventsService,
    );
    return { svc, prisma, tx, notifications, queue, analytics, loyalty };
  }
  const pending = (over: Record<string, unknown> = {}) =>
    makeOrder({
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      platform: 'miniapp',
      ...over,
    });
  type FlipCall = [{ where: unknown; data: Record<string, unknown> }];

  it('lật PAID → gỡ cảnh báo "Khách chuyển thiếu" (đơn đã đủ tiền), không đụng lý do khác', async () => {
    const { svc, prisma } = make([pending()]);
    await svc.markPaid('TUBU1', { actorType: 'PANCAKE' });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', OR: [{ pancakeAttention: { startsWith: 'Khách chuyển thiếu' } }] },
      data: { pancakeAttention: null, pancakeAttentionAt: null },
    });
  });

  it('PENDING_PAYMENT+UNPAID → lật PAID + CONFIRMED có guard, ghi lịch sử (ai bấm) + order_paid trong CÙNG tx, báo khách', async () => {
    const { svc, tx, analytics, notifications } = make([pending()]);

    const res = await svc.markPaid('TUBU1', { actorType: 'ADMIN', actorId: 'admin-1', note: 'Mã GD FT123' });

    expect(res.outcome).toBe('PAID');
    const call = tx.order.updateMany.mock.calls[0] as unknown as FlipCall;
    expect(call[0].where).toEqual({ id: 'o1', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' });
    expect(call[0].data).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED' });
    expect(call[0].data.paidAt).toBeInstanceOf(Date);
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'o1',
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CONFIRMED',
        actorType: 'ADMIN',
        actorId: 'admin-1',
        note: expect.stringContaining('Mã GD FT123'),
      }),
    });
    expect(analytics.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventName: 'order_paid',
        occurredAt: call[0].data.paidAt,
        props: expect.objectContaining({ orderId: 'o1', method: 'BANK_TRANSFER', amount: 100000 }),
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU1' });
  });

  it('đơn đã xác nhận trước khi tiền về → chỉ lật PAID, giữ trạng thái', async () => {
    const { svc, tx } = make([pending({ status: 'PACKED' })]);
    const res = await svc.markPaid('o1', { actorType: 'ADMIN', actorId: 'a' });
    expect(res.outcome).toBe('PAID');
    const call = tx.order.updateMany.mock.calls[0] as unknown as FlipCall;
    expect(call[0].where).toEqual({ id: 'o1', paymentStatus: 'UNPAID', status: 'PACKED' });
    expect(call[0].data.status).toBeUndefined();
    expect(tx.orderStatusHistory.create.mock.calls[0][0].data).toMatchObject({ fromStatus: 'PACKED', toStatus: 'PACKED' });
  });

  it('đã PAID → ALREADY_PAID, không mở tx, không báo lại (idempotent)', async () => {
    const { svc, prisma, notifications } = make([pending({ status: 'CONFIRMED', paymentStatus: 'PAID' })]);
    const res = await svc.markPaid('o1', { actorType: 'ADMIN' });
    expect(res.outcome).toBe('ALREADY_PAID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'RETURNED'])('đơn %s → CLOSED, không hồi sinh thành PAID', async (status) => {
    const { svc, prisma } = make([pending({ status })]);
    const res = await svc.markPaid('o1', { actorType: 'ADMIN' });
    expect(res.outcome).toBe('CLOSED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Đơn đã nhận tiền, rồi huỷ/trả và đã hoàn: một xác nhận tiền đến sau (webhook gửi lại) không phải tiền mới —
  // CLOSED sẽ khiến caller tạo khoản hoàn tiền về muộn thứ hai.
  it.each(['CANCELLED', 'RETURNED'])('đơn %s đã REFUNDED → NOT_PAYABLE (không phải CLOSED)', async (status) => {
    const { svc, prisma } = make([pending({ status, paymentStatus: 'REFUNDED' })]);
    expect((await svc.markPaid('o1', { actorType: 'PANCAKE' })).outcome).toBe('NOT_PAYABLE');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('thua race: đọc lại thấy đơn vừa huỷ và đã hoàn (REFUNDED) → NOT_PAYABLE', async () => {
    const { svc } = make([pending(), pending({ status: 'CANCELLED', paymentStatus: 'REFUNDED' })], [0]);
    expect((await svc.markPaid('o1', { actorType: 'PANCAKE' })).outcome).toBe('NOT_PAYABLE');
  });

  it('paymentStatus REFUNDED → NOT_PAYABLE', async () => {
    const { svc, prisma } = make([pending({ status: 'CONFIRMED', paymentStatus: 'REFUNDED' })]);
    expect((await svc.markPaid('o1', { actorType: 'ADMIN' })).outcome).toBe('NOT_PAYABLE');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('thua race (người khác vừa lật PAID) → đọc lại thấy PAID → ALREADY_PAID, không ghi vết/không báo lần 2', async () => {
    const { svc, tx, notifications, analytics } = make(
      [pending(), pending({ status: 'CONFIRMED', paymentStatus: 'PAID' })],
      [0],
    );
    const res = await svc.markPaid('o1', { actorType: 'ADMIN' });
    expect(res.outcome).toBe('ALREADY_PAID');
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(analytics.record).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('thua race vì khách vừa huỷ → đọc lại thấy CANCELLED → CLOSED', async () => {
    const { svc } = make([pending(), pending({ status: 'CANCELLED' })], [0]);
    expect((await svc.markPaid('o1', { actorType: 'ADMIN' })).outcome).toBe('CLOSED');
  });

  it('đơn thu gom tái chế → đặt vận đơn Gomdon sau khi PAID; lỗi enqueue không làm hỏng kết quả', async () => {
    const a = make([pending({ hasRecyclingPickup: true })]);
    await a.svc.markPaid('o1', { actorType: 'ADMIN' });
    expect(a.queue.add).toHaveBeenCalledWith('push', { orderId: 'o1' }, expect.objectContaining({ jobId: 'o1' }));

    const b = make([pending({ hasRecyclingPickup: true })]);
    b.queue.add.mockRejectedValue(new Error('redis'));
    await expect(b.svc.markPaid('o1', { actorType: 'ADMIN' })).resolves.toMatchObject({ outcome: 'PAID' });

    const c = make([pending({ hasRecyclingPickup: false })]);
    await c.svc.markPaid('o1', { actorType: 'ADMIN' });
    expect(c.queue.add).not.toHaveBeenCalled();
  });

  it('không cộng điểm/hoa hồng khi PAID (chỉ DELIVERED mới cộng)', async () => {
    const { svc, loyalty } = make([pending()]);
    await svc.markPaid('o1', { actorType: 'ADMIN' });
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
  });

  it('không tìm thấy đơn → NotFoundException', async () => {
    const { svc, prisma } = make([pending()]);
    prisma.order.findFirst.mockReset().mockResolvedValue(null);
    await expect(svc.markPaid('nope', { actorType: 'ADMIN' })).rejects.toThrow(NotFoundException);
  });
});

describe('OrderStatusService.setStatus — onlyIfUnpaid (cron huỷ đơn quá hạn thanh toán, C-024)', () => {
  function make(order: Record<string, unknown>, flipCount = 1) {
    const tx = {
      order: { updateMany: jest.fn().mockResolvedValue({ count: flipCount }), findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: order.userId }) },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order), findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    const reversal = { reverseFinancials: jest.fn().mockResolvedValue({ moneyRefunded: false }) };
    const notify = jest.fn().mockResolvedValue(undefined);
    const svc = new OrderStatusService(
      prisma as unknown as PrismaService,
      { creditOrderPoints: jest.fn(), reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService,
      {
        lockCommissionsForOrder: jest.fn(),
        grantReferralReward: jest.fn(),
        reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      } as unknown as AffiliateService,
      { notify } as unknown as NotificationsService,
      reversal as unknown as OrderReversalService,
    );
    return { svc, prisma, tx, reversal, notify };
  }

  it('lật CANCELLED có guard paymentStatus=UNPAID trong where', async () => {
    const { svc, tx, reversal } = make(makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    await svc.setStatus('o1', 'CANCELLED' as never, { onlyIfUnpaid: true });
    expect(tx.order.updateMany.mock.calls[0][0].where).toEqual({ id: 'o1', status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' });
    expect(reversal.reverseFinancials).toHaveBeenCalledTimes(1);
  });

  it('đơn đọc ra đã PAID → không mở tx, không huỷ, không báo khách', async () => {
    const { svc, prisma, reversal, notify } = make(
      makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }),
    );
    const res = await svc.setStatus('o1', 'CANCELLED' as never, { onlyIfUnpaid: true });
    expect(res.status).toBe('PENDING_PAYMENT');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  // Review lượt 1: cron đọc danh sách rồi huỷ tuần tự; admin đẩy đơn đi tiếp chen giữa thì setStatus đọc lại
  // thấy trạng thái mới (vẫn huỷ được) — expectedStatus giữ đúng ảnh chụp lúc quét.
  it('expectedStatus khác trạng thái hiện tại → không mở tx, không huỷ', async () => {
    const { svc, prisma, reversal } = make(makeOrder({ status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    const res = await svc.setStatus('o1', 'CANCELLED' as never, { onlyIfUnpaid: true, expectedStatus: 'PENDING_PAYMENT' });
    expect(res.status).toBe('CONFIRMED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
  });

  it('expectedStatus khớp → lật như thường', async () => {
    const { svc, tx } = make(makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
    await svc.setStatus('o1', 'CANCELLED' as never, { onlyIfUnpaid: true, expectedStatus: 'PENDING_PAYMENT' });
    expect(tx.order.updateMany.mock.calls[0][0].where).toEqual({ id: 'o1', status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' });
  });

  it('không truyền onlyIfUnpaid → where giữ nguyên như cũ', async () => {
    const { svc, tx } = make(makeOrder({ status: 'CONFIRMED' }));
    await svc.setStatus('o1', 'CANCELLED' as never);
    expect(tx.order.updateMany.mock.calls[0][0].where).toEqual({ id: 'o1', status: 'CONFIRMED' });
  });
});

describe('OrderStatusService — hook thu kèm rác sau commit (§12.2 bước 3)', () => {
  function setup(from: string, opts: { flip?: number; credit?: jest.Mock; hooks?: Partial<Record<'onOrderCancelled' | 'onOrderDelivered', jest.Mock>> } = {}) {
    const tx = {
      order: { updateMany: jest.fn().mockResolvedValue({ count: opts.flip ?? 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 'u1' }) },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const order = makeOrder({ status: from });
    const seen: string[] = [];
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order), findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => {
        const r = await fn(tx);
        seen.push('tx end');
        return r;
      }),
    };
    const loyalty = {
      creditOrderPoints: opts.credit ?? jest.fn(async () => { seen.push('creditOrderPoints'); return true; }),
      reverseOrderPoints: jest.fn().mockResolvedValue(0),
    };
    const hooks = {
      onOrderCancelled: jest.fn(async () => { seen.push('onOrderCancelled'); }),
      onOrderDelivered: jest.fn(async () => { seen.push('onOrderDelivered'); }),
      ...opts.hooks,
    };
    const svc = new OrderStatusService(
      prisma as unknown as PrismaService,
      loyalty as unknown as LoyaltyService,
      { lockCommissionsForOrder: jest.fn().mockResolvedValue(0), grantReferralReward: jest.fn().mockResolvedValue(undefined), reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } as unknown as AffiliateService,
      { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      { reverseFinancials: jest.fn().mockResolvedValue(null) } as unknown as OrderReversalService,
      undefined,
      undefined,
      undefined,
      hooks as never,
    );
    return { svc, prisma, loyalty, hooks, seen };
  }

  it('DELIVERED thắng → onOrderDelivered(o1) sau khi tx đổi trạng thái đã xong (không chạy trong callback, spec 10.1), TRƯỚC runDeliveredEffects (cộng điểm đơn)', async () => {
    const { svc, hooks, seen } = setup('SHIPPING');
    await svc.setStatus('o1', 'DELIVERED' as never);
    expect(hooks.onOrderDelivered).toHaveBeenCalledWith('o1');
    expect(seen.indexOf('tx end')).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf('tx end')).toBeLessThan(seen.indexOf('onOrderDelivered'));
    expect(seen.indexOf('onOrderDelivered')).toBeLessThan(seen.indexOf('creditOrderPoints'));
    expect(hooks.onOrderCancelled).not.toHaveBeenCalled();
  });

  it('runDeliveredEffects ném lỗi → hook vẫn đã chạy', async () => {
    const { svc, hooks } = setup('SHIPPING', { credit: jest.fn().mockRejectedValue(new Error('points db')) });
    await expect(svc.setStatus('o1', 'DELIVERED' as never)).rejects.toThrow('points db');
    expect(hooks.onOrderDelivered).toHaveBeenCalledTimes(1);
  });

  it('hook lỗi (ngoài hợp đồng) → đường giao vẫn xong, việc sau giao vẫn chạy', async () => {
    const { svc, loyalty } = setup('SHIPPING', { hooks: { onOrderDelivered: jest.fn().mockRejectedValue(new Error('hook')) } });
    await expect(svc.setStatus('o1', 'DELIVERED' as never)).resolves.toBeDefined();
    expect(loyalty.creditOrderPoints).toHaveBeenCalledTimes(1);
  });

  it('CANCELLED thắng → onOrderCancelled(o1) trong cùng lần gọi, sau khi tx đổi trạng thái đã xong (§17.3, admin huỷ)', async () => {
    const { svc, hooks, seen } = setup('CONFIRMED');
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' });
    expect(hooks.onOrderCancelled).toHaveBeenCalledWith('o1');
    expect(seen.indexOf('tx end')).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf('tx end')).toBeLessThan(seen.indexOf('onOrderCancelled'));
    expect(hooks.onOrderDelivered).not.toHaveBeenCalled();
  });

  it('thua đua (count 0), trạng thái khác, hay DELIVERED lặp → không gọi hook (quét bù lo phần sót)', async () => {
    const lost = setup('SHIPPING', { flip: 0 });
    await lost.svc.setStatus('o1', 'DELIVERED' as never).catch(() => undefined);
    expect(lost.hooks.onOrderDelivered).not.toHaveBeenCalled();
    const packed = setup('CONFIRMED');
    await packed.svc.setStatus('o1', 'PACKED' as never);
    expect(packed.hooks.onOrderCancelled).not.toHaveBeenCalled();
    expect(packed.hooks.onOrderDelivered).not.toHaveBeenCalled();
    const repeat = setup('DELIVERED');
    await repeat.svc.setStatus('o1', 'DELIVERED' as never);
    expect(repeat.hooks.onOrderDelivered).not.toHaveBeenCalled();
  });
});
