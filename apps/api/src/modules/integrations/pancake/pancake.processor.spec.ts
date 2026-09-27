import { PancakeProcessor } from './pancake.processor';
import { OrderReversalService } from '../../orders/order-reversal.service';
import { OrderStatusService } from '../../orders/order-status.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { LoyaltyService } from '../../loyalty/loyalty.service';
import type { AffiliateService } from '../../affiliate/affiliate.service';
import type { FlashSaleService } from '../../flash-sale/flash-sale.service';
import type { CouponsService } from '../../coupons/coupons.service';

/**
 * PancakeProcessor giờ ủy quyền toàn bộ việc ghi Order.status cho OrderStatusService
 * (dùng chung với admin/merchant — xem docs/2026-09-08-review-progress.md P0-1/P0-4).
 * Setup dựng OrderStatusService THẬT (không mock) trên top của prisma giả lập có
 * $transaction interactive thật sự gọi callback — khác `jest.fn().mockResolvedValue([])`
 * đơn thuần, để assertTransition + atomic flip + side-effect chạy đúng như production.
 */
function setup(
  order: Record<string, unknown> | null,
  gomdonQueue?: { getJob: jest.Mock; add: jest.Mock },
  alerts?: { alert: jest.Mock },
) {
  const orderFindFirst = jest.fn().mockResolvedValue(order);
  const orderFindUniqueOrThrow = jest.fn().mockResolvedValue(order);
  const orderUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const orderUpdate = jest.fn().mockResolvedValue({}); // onShippingUpdated gọi trực tiếp order.update
  // onPaymentReconcile giờ bọc updateMany trong $transaction (Task 5, docs analytics-foundation) —
  // txUpdateMany delegate CHÍNH jest.fn() orderUpdateMany, để tx.order.updateMany vẫn là đúng mock
  // mà các test onPaymentReconcile bên dưới đã assert (không tạo mock tx tách biệt riêng cho case
  // này) — trong khi onStatusUpdated/onCancelled (qua OrderStatusService, không đổi ở Task 5) vẫn
  // nhìn thấy đúng cùng lịch sử gọi qua tên `txUpdateMany`.
  const txUpdateMany = orderUpdateMany;
  const txUserUpdate = jest.fn().mockResolvedValue({});
  const txCoinCreate = jest.fn().mockResolvedValue({});
  /** Tồn kho (hoàn kho khi huỷ) đi bằng SQL thô — xem catalog/variation-stock.ts. */
  const txExecuteRaw = jest.fn().mockResolvedValue(1);
  const $transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      order: { updateMany: txUpdateMany },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      user: { update: txUserUpdate },
      coinTransaction: { create: txCoinCreate },
      $executeRaw: txExecuteRaw,
    }),
  );
  const prisma = {
    order: {
      findFirst: orderFindFirst,
      findUniqueOrThrow: orderFindUniqueOrThrow,
      findUnique: jest.fn().mockResolvedValue(order ?? null),
      updateMany: orderUpdateMany,
      update: orderUpdate,
    },
    pancakeWebhookEvent: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction,
  } as unknown as PrismaService;
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
  const loyalty = {
    creditOrderPoints: jest.fn().mockResolvedValue(undefined),
    reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
  } as unknown as LoyaltyService;
  const affiliate = {
    lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    grantReferralReward: jest.fn().mockResolvedValue(undefined),
  } as unknown as AffiliateService;
  const flashSale = { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService;
  const coupons = { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService;
  const reversal = new OrderReversalService(flashSale, coupons);
  const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, gomdonQueue as never);
  const proc = new PancakeProcessor(prisma, notifications, orderStatus, gomdonQueue as never, alerts as never) as unknown as {
    onStatusUpdated(d: Record<string, unknown>): Promise<void>;
    onCancelled(d: Record<string, unknown>): Promise<void>;
    onPaymentReconcile(d: Record<string, unknown>): Promise<void>;
    onShippingUpdated(d: Record<string, unknown>): Promise<void>;
    extractOrderCode(d: Record<string, unknown>): string | null;
    process(job: { data: { eventId: string } }): Promise<void>;
  };
  return {
    proc,
    prisma,
    notifications,
    loyalty,
    affiliate,
    txUpdateMany,
    txUserUpdate,
    txExecuteRaw,
    orderUpdateMany,
    orderUpdate,
  };
}

describe('PancakeProcessor.extractOrderCode', () => {
  const { proc } = setup(null);
  it('ưu tiên extension.external_order_id', () => {
    expect(proc.extractOrderCode({ extension: { external_order_id: 'TUBU9' }, note: 'TUBU1' })).toBe('TUBU9');
  });
  it('fallback regex TUBU... trong note', () => {
    expect(proc.extractOrderCode({ note: 'Khách dặn giao chiều - Order code: TUBU20260613001' })).toBe(
      'TUBU20260613001',
    );
  });
  it('không có gì → null', () => {
    expect(proc.extractOrderCode({})).toBeNull();
  });
});

describe('PancakeProcessor.onStatusUpdated', () => {
  it('DELIVERED → flip status + credit điểm + lock hoa hồng + notify', async () => {
    const { proc, txUpdateMany, loyalty, affiliate, notifications } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
      note: null,
      items: [],
    });
    await proc.onStatusUpdated({ id: 'p1', status: 'delivered' });
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', status: 'SHIPPING' }, data: expect.objectContaining({ status: 'DELIVERED' }) }),
    );
    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.lockCommissionsForOrder).toHaveBeenCalledWith('o1');
    expect(affiliate.grantReferralReward).toHaveBeenCalledWith('o1');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_DELIVERED', { order_code: 'TUBU1' });
  });

  it('trạng thái không đổi → no-op (idempotent, không credit lại)', async () => {
    const { proc, txUpdateMany, loyalty } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'DELIVERED',
      note: null,
      items: [],
    });
    await proc.onStatusUpdated({ id: 'p1', status: 'delivered' });
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
  });

  it('status không map được → no-op', async () => {
    const { proc, txUpdateMany } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING', note: null, items: [] });
    await proc.onStatusUpdated({ id: 'p1', status: 'gibberish' });
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it('CANCELLED → flip status + reverse điểm + reverse hoa hồng', async () => {
    const { proc, txUpdateMany, loyalty, affiliate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'CONFIRMED',
      note: null,
      items: [],
    });
    await proc.onStatusUpdated({ id: 'p1', status: 'cancelled' });
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', status: 'CONFIRMED' }, data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('đơn không tìm thấy → no-op', async () => {
    const { proc, txUpdateMany } = setup(null);
    await proc.onStatusUpdated({ id: 'p1', status: 'delivered' });
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it('DELIVERED trễ SAU khi đơn đã CANCELLED (queue không FIFO per-order) → KHÔNG credit, KHÔNG đè status', async () => {
    const { proc, txUpdateMany, loyalty, affiliate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'CANCELLED',
      note: null,
      items: [],
    });
    await proc.onStatusUpdated({ id: 'p1', status: 'delivered' });
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.lockCommissionsForOrder).not.toHaveBeenCalled();
  });

  it('DELIVERED trễ SAU khi đơn đã RETURNED → KHÔNG credit, KHÔNG đè status', async () => {
    const { proc, txUpdateMany, loyalty } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'RETURNED',
      note: null,
      items: [],
    });
    await proc.onStatusUpdated({ id: 'p1', status: 'delivered' });
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
  });

  it('lỗi thật (loyalty throw) → NÉM TIẾP, không bị nuốt như InvalidOrderTransitionError', async () => {
    const { proc, loyalty } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING', note: null, items: [] });
    (loyalty.creditOrderPoints as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(proc.onStatusUpdated({ id: 'p1', status: 'delivered' })).rejects.toThrow('db down');
  });
});

describe('PancakeProcessor.onCancelled', () => {
  it('đơn đã CANCELLED → không xử lý lại', async () => {
    const { proc, txUpdateMany, loyalty } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'CANCELLED',
      note: null,
      items: [],
    });
    await proc.onCancelled({ id: 'p1' });
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
  });

  it('đơn DELIVERED → KHÔNG hủy được qua webhook cancelled (đơn đã giao chỉ hủy qua luồng RETURNED)', async () => {
    // DELIVERED chỉ đi tiếp được sang RETURNED trong bảng chuyển trạng thái chung
    // (order-transition.ts) — một webhook "cancelled" trễ trên đơn đã giao KHÔNG được
    // phép bỏ qua quy trình đổi/trả (admin.reviewReturn) để hoàn tiền/restock trực tiếp.
    const { proc, txUpdateMany, loyalty, affiliate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'DELIVERED',
      note: null,
      total: 100000,
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null, backorderedQty: 0 }],
    });
    await proc.onCancelled({ id: 'p1' });
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
  });

  it('đơn CONFIRMED (chưa giao) → hủy được qua webhook cancelled → hoàn tiền/restock/reverse', async () => {
    const { proc, txUpdateMany, txExecuteRaw, loyalty, affiliate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'CONFIRMED',
      note: null,
      total: 100000,
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null, backorderedQty: 0 }],
    });
    await proc.onCancelled({ id: 'p1' });
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', status: 'CONFIRMED' }, data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    // Tham số câu UPDATE hoàn kho: (số lượng, số lượng, variationId).
    expect(txExecuteRaw.mock.calls[0]!.slice(1)).toEqual([1, 1, 'v1']);
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
  });
});

describe('PancakeProcessor.onPaymentReconcile', () => {
  const paidPayload = { id: 'p1', is_paid: true };

  it('đơn BANK_TRANSFER UNPAID nhận xác nhận thanh toán → lật PAID + notify', async () => {
    const { proc, orderUpdateMany, notifications } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    await proc.onPaymentReconcile(paidPayload);
    // Guard theo trạng thái HIỆN TẠI trong DB: chỉ lật CONFIRMED khi đơn còn PENDING_PAYMENT.
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'o1', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED', paidAt: expect.any(Date) },
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU1' });
  });

  it('RACE: đọc thấy PENDING_PAYMENT nhưng khách vừa HUỶ (đã hoàn kho) trước khi lật → KHÔNG hồi sinh đơn thành PAID+CONFIRMED', async () => {
    const { proc, orderUpdateMany, notifications } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    orderUpdateMany.mockResolvedValue({ count: 0 }); // DB giờ là CANCELLED → cả 2 guard đều trượt
    await proc.onPaymentReconcile(paidPayload);
    for (const [args] of orderUpdateMany.mock.calls) {
      const st = args.where.status;
      // Không lần lật nào được phép khớp đơn đã huỷ/trả.
      expect(st === 'PENDING_PAYMENT' || (st?.notIn?.includes('CANCELLED') && st.notIn.includes('RETURNED'))).toBe(true);
    }
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('đơn đã CONFIRMED (xác nhận trước khi tiền về) → chỉ lật PAID, KHÔNG đụng status, guard loại đơn huỷ/trả', async () => {
    const { proc, orderUpdateMany, notifications } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    orderUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await proc.onPaymentReconcile(paidPayload);
    expect(orderUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 'o1', paymentStatus: 'UNPAID', status: { notIn: ['CANCELLED', 'RETURNED', 'PENDING_PAYMENT'] } },
      data: { paymentStatus: 'PAID', paidAt: expect.any(Date) },
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU1' });
  });

  // P1-3 (docs/2026-09-08-review-progress.md): tiền chuyển khoản tới SAU khi đơn đã hủy/trả
  // trước đây vẫn bị lật PAID êm — đơn đứng CANCELLED/RETURNED + PAID, không ai tự hoàn tiền
  // thật cho khách.
  it('đơn ĐÃ HỦY nhận xác nhận thanh toán trễ → KHÔNG lật PAID, không notify', async () => {
    const { proc, orderUpdateMany, notifications } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'CANCELLED',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    await proc.onPaymentReconcile(paidPayload);
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('đơn ĐÃ TRẢ HÀNG nhận xác nhận thanh toán trễ → KHÔNG lật PAID', async () => {
    const { proc, orderUpdateMany } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'RETURNED',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    await proc.onPaymentReconcile(paidPayload);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('đơn không phải BANK_TRANSFER → bỏ qua', async () => {
    const { proc, orderUpdateMany } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'PENDING_PAYMENT',
      paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 100000,
    });
    await proc.onPaymentReconcile(paidPayload);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });
});

describe('PancakeProcessor.onShippingUpdated', () => {
  it('nhận payload Pancake POS chuẩn (partner object): cập nhật hãng VC, mã vận đơn, trạng thái và link tracking', async () => {
    const { proc, orderUpdate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
      shippingPartner: null,
      shippingCode: null,
      shippingStatus: null,
      trackingLink: null,
      shippingHistory: [],
    });

    const payload = {
      id: 'p1',
      partner: {
        partner_name: 'Giao Hàng Nhanh',
        extend_code: 'GHN123456789',
        partner_status: 'ready_to_pick',
        printed_form: 'https://tracking.ghn.vn/?code=GHN123456789',
      },
    };

    await proc.onShippingUpdated(payload);

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: expect.objectContaining({
        shippingPartner: 'Giao Hàng Nhanh',
        shippingCode: 'GHN123456789',
        shippingStatus: 'ready_to_pick',
        trackingLink: 'https://tracking.ghn.vn/?code=GHN123456789',
        shippingHistory: expect.arrayContaining([
          expect.objectContaining({
            carrier: 'Giao Hàng Nhanh',
            code: 'GHN123456789',
            status: 'ready_to_pick',
          }),
        ]),
      }),
    });
  });

  it('fallback nhận payload phẳng cũ (partner_name, tracking_number, shipping_status, tracking_link)', async () => {
    const { proc, orderUpdate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
      shippingPartner: null,
      shippingCode: null,
      shippingStatus: null,
      trackingLink: null,
      shippingHistory: [],
    });

    const payload = {
      id: 'p1',
      partner_name: 'Viettel Post',
      tracking_number: 'VT987654321',
      shipping_status: 'delivering',
      tracking_link: 'https://viettelpost.vn/tracking/VT987654321',
    };

    await proc.onShippingUpdated(payload);

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: expect.objectContaining({
        shippingPartner: 'Viettel Post',
        shippingCode: 'VT987654321',
        shippingStatus: 'delivering',
        trackingLink: 'https://viettelpost.vn/tracking/VT987654321',
        shippingHistory: expect.arrayContaining([
          expect.objectContaining({
            carrier: 'Viettel Post',
            code: 'VT987654321',
            status: 'delivering',
          }),
        ]),
      }),
    });
  });

  it('tích luỹ timeline nhiều mốc (shippingHistory) khi trạng thái thay đổi', async () => {
    const initialHistory = [
      { at: '2026-09-18T10:00:00.000Z', status: 'ready_to_pick', carrier: 'GHN', code: 'GHN001' },
    ];
    const { proc, orderUpdate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
      shippingPartner: 'GHN',
      shippingCode: 'GHN001',
      shippingStatus: 'ready_to_pick',
      trackingLink: null,
      shippingHistory: initialHistory,
    });

    const payload = {
      id: 'p1',
      partner: {
        partner_name: 'GHN',
        extend_code: 'GHN001',
        partner_status: 'delivering',
      },
    };

    await proc.onShippingUpdated(payload);

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: expect.objectContaining({
        shippingStatus: 'delivering',
        shippingHistory: expect.arrayContaining([
          initialHistory[0],
          expect.objectContaining({
            status: 'delivering',
            code: 'GHN001',
            carrier: 'GHN',
          }),
        ]),
      }),
    });
  });

  it('không thêm mốc trùng lặp vào shippingHistory nếu status và code không đổi', async () => {
    const initialHistory = [
      { at: '2026-09-18T10:00:00.000Z', status: 'delivering', carrier: 'GHN', code: 'GHN001' },
    ];
    const { proc, orderUpdate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
      shippingPartner: 'GHN',
      shippingCode: 'GHN001',
      shippingStatus: 'delivering',
      trackingLink: null,
      shippingHistory: initialHistory,
    });

    // Cùng status & code với mốc cuối
    const payload = {
      id: 'p1',
      partner: {
        partner_name: 'GHN',
        extend_code: 'GHN001',
        partner_status: 'delivering',
      },
    };

    await proc.onShippingUpdated(payload);

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: expect.objectContaining({
        shippingHistory: initialHistory, // giữ nguyên, không push thêm
      }),
    });
  });

  it('đơn hàng không tồn tại → bỏ qua không ném lỗi', async () => {
    const { proc, orderUpdate } = setup(null);
    await proc.onShippingUpdated({ id: 'nonexistent-p1', partner: { partner_name: 'GHN' } });
    expect(orderUpdate).not.toHaveBeenCalled();
  });
});

describe('PancakeProcessor.process', () => {
  it('event đã PROCESSED → bỏ qua', async () => {
    const { proc, prisma, notifications } = setup(null);
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'e1', status: 'PROCESSED' });
    await proc.process({ data: { eventId: 'e1' } });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.pancakeWebhookEvent.update).not.toHaveBeenCalled();
  });

  it('xử lý thành công → đánh dấu PROCESSED', async () => {
    const { proc, prisma, txUpdateMany } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
      note: null,
      items: [],
    });
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e1',
      status: 'RECEIVED',
      eventType: 'order.status_updated',
      rawPayload: { event: 'order.status_updated', data: { id: 'p1', status: 'delivered' } },
    });
    await proc.process({ data: { eventId: 'e1' } });
    expect(txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED' }) }));
    expect((prisma.pancakeWebhookEvent.update as jest.Mock).mock.calls[0][0].data.status).toBe('PROCESSED');
  });

  it('payload Pancake THẬT (type=orders, object đơn top-level, không có data) → xử lý đúng', async () => {
    const { proc, prisma, txUpdateMany, loyalty } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
      note: null,
      items: [],
    });
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e2',
      status: 'RECEIVED',
      eventType: 'orders',
      // Pancake POS: nguyên object đơn ở top-level, KHÔNG bọc {event,data}
      rawPayload: { type: 'orders', id: 'p1', status_name: 'delivered', note: 'Order code: TUBU1' },
    });
    await proc.process({ data: { eventId: 'e2' } });
    expect(txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED' }) }));
    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
    expect((prisma.pancakeWebhookEvent.update as jest.Mock).mock.calls[0][0].data.status).toBe('PROCESSED');
  });

  it('handler ném lỗi → đánh dấu FAILED + rethrow (BullMQ retry)', async () => {
    const { proc, prisma, loyalty } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
      note: null,
      items: [],
    });
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e1',
      status: 'RECEIVED',
      eventType: 'order.status_updated',
      rawPayload: { event: 'order.status_updated', data: { id: 'p1', status: 'delivered' } },
    });
    (loyalty.creditOrderPoints as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(proc.process({ data: { eventId: 'e1' } })).rejects.toThrow('boom');
    expect((prisma.pancakeWebhookEvent.update as jest.Mock).mock.calls[0][0].data.status).toBe('FAILED');
  });
});

describe('PancakeProcessor — đơn thu gom tái chế (Gomdon)', () => {
  const gomdonQueue = () => ({ getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) });

  it('chuyển khoản về (UNPAID→PAID) cho đơn thu gom → enqueue tạo vận đơn Gomdon (lúc này mới đặt bưu tá)', async () => {
    const q = gomdonQueue();
    const { proc } = setup(
      { id: 'o1', code: 'TUBU1', userId: 'u1', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000, hasRecyclingPickup: true },
      q,
    );
    await proc.onPaymentReconcile({ id: 'p1', is_paid: true });
    expect(q.add).toHaveBeenCalledWith('push', { orderId: 'o1' }, { jobId: 'o1' });
  });

  it('đơn thường (không thu gom) → không enqueue Gomdon; enqueue lỗi không làm hỏng event đã lật PAID', async () => {
    const q = gomdonQueue();
    const { proc } = setup(
      { id: 'o1', code: 'TUBU1', userId: 'u1', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000, hasRecyclingPickup: false },
      q,
    );
    await proc.onPaymentReconcile({ id: 'p1', is_paid: true });
    expect(q.add).not.toHaveBeenCalled();

    const q2 = gomdonQueue();
    q2.add.mockRejectedValueOnce(new Error('redis'));
    const b = setup(
      { id: 'o1', code: 'TUBU1', userId: 'u1', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000, hasRecyclingPickup: true },
      q2,
    );
    await expect(b.proc.onPaymentReconcile({ id: 'p1', is_paid: true })).resolves.toBeUndefined();
    expect(b.notifications.notify).toHaveBeenCalled();
  });

  it('Pancake huỷ đơn thu gom (onCancelled → OrderStatusService) → enqueue huỷ vận đơn Gomdon', async () => {
    const q = gomdonQueue();
    const { proc } = setup(
      { id: 'o1', code: 'TUBU1', userId: 'u1', status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 100000, pointsUsed: 0, items: [], hasRecyclingPickup: true, gomdonOrderId: '77' },
      q,
    );
    await proc.onCancelled({ id: 'p1' });
    expect(q.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, { jobId: 'cancel-o1' });
  });

  it('đơn đã có vận đơn Gomdon → onShippingUpdated KHÔNG ghi đè shippingCode/Partner/Status (Gomdon là nguồn duy nhất)', async () => {
    const { proc, orderUpdate } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING', hasRecyclingPickup: true,
      gomdonOrderId: '77', gomdonPartnerCode: 'BE77', shippingCode: 'BE77', shippingPartner: 'BestExpress', shippingStatus: 'Đang đi giao hàng', shippingHistory: [],
    });
    await proc.onShippingUpdated({ id: 'p1', partner: { partner_name: 'GHN', extend_code: 'GHN999', partner_status: 'picking' } });
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  const liveGomdon = {
    id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING', hasRecyclingPickup: true,
    gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '5', gomdonCancelStatus: null,
    shippingCode: 'BE77', shippingPartner: 'BestExpress', shippingStatus: 'Đang đi giao hàng', shippingHistory: [],
  };

  it('vận đơn Gomdon đang sống + Pancake báo MÃ VẬN ĐƠN KHÁC → báo động vận hành thật (OPS alert), không ghi đè; báo 1 lần cho cùng mã', async () => {
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const { proc, orderUpdate } = setup(liveGomdon, undefined, alerts);
    const payload = { id: 'p1', partner: { partner_name: 'GHN', extend_code: 'GHN999', partner_status: 'picking' } };
    await proc.onShippingUpdated(payload);
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(alerts.alert).toHaveBeenCalledTimes(1);
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1', expect.stringContaining('GHN999'));
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1', expect.stringContaining('BE77'));
    // Pancake gửi lại (mỗi lần đơn đổi) — không spam cùng một cảnh báo.
    await proc.onShippingUpdated(payload);
    expect(alerts.alert).toHaveBeenCalledTimes(1);
  });

  it('Pancake báo đúng mã Gomdon (hoặc id số) → không báo động', async () => {
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const { proc } = setup(liveGomdon, undefined, alerts);
    await proc.onShippingUpdated({ id: 'p1', partner: { partner_name: 'BEST', extend_code: 'BE77' } });
    await proc.onShippingUpdated({ id: 'p1', partner: { partner_name: 'BEST', extend_code: '77' } });
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('vận đơn Gomdon đã huỷ (status 2 / gomdonCancelStatus CANCELLED / đã xử lý tay) → Gomdon hết sở hữu field vận chuyển, ghi cập nhật Pancake bình thường', async () => {
    for (const over of [{ gomdonStatus: '2' }, { gomdonCancelStatus: 'CANCELLED' }, { gomdonStatus: 'MANUAL_HANDLED' }]) {
      const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
      const { proc, orderUpdate } = setup({ ...liveGomdon, status: 'CONFIRMED', ...over }, undefined, alerts);
      await proc.onShippingUpdated({ id: 'p1', partner: { partner_name: 'GHN', extend_code: 'GHN999', partner_status: 'picking' } });
      expect(orderUpdate).toHaveBeenCalledTimes(1);
      expect((orderUpdate as jest.Mock).mock.calls[0][0].data).toMatchObject({ shippingPartner: 'GHN', shippingCode: 'GHN999', shippingStatus: 'picking' });
      expect(alerts.alert).not.toHaveBeenCalled();
    }
  });
});
