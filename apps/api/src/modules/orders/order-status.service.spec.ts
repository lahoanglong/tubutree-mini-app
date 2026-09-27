import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrderStatusService, InvalidOrderTransitionError } from './order-status.service';
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
      order: { updateMany: jest.fn().mockResolvedValue({ count: flipCount }) },
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
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
    expect(queue.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, { jobId: 'cancel-o1' });
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
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
