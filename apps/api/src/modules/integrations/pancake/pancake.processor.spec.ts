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
  const historyCreate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      order: { updateMany: txUpdateMany },
      orderStatusHistory: { create: historyCreate },
      user: { update: txUserUpdate },
      coinTransaction: { create: txCoinCreate },
      returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
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
    pancakeWebhookEvent: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null) },
    orderCustomerRefund: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin1' }]) },
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
  // record() mock — Task 5 review finding: không test nào từng truyền analytics nên
  // if(this.analytics) luôn no-op; giờ wiring thật để có assert flip⇒event có xảy ra.
  const analytics = { record: jest.fn().mockResolvedValue(undefined) };
  const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, gomdonQueue as never, analytics as never);
  const proc = new PancakeProcessor(prisma, notifications, orderStatus, alerts as never) as unknown as {
    onStatusUpdated(d: Record<string, unknown>): Promise<void>;
    onCancelled(d: Record<string, unknown>): Promise<void>;
    onPaymentReconcile(d: Record<string, unknown>): Promise<unknown>;
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
    orderFindFirst,
    historyCreate,
    analytics,
  };
}

type UpdateManyArgs = { where: Record<string, unknown>; data: Record<string, unknown> };
/** Lần lật trạng thái/thanh toán đơn (khác lần ghi hàng đợi "Cần xử lý Pancake" dùng chung mock updateMany). */
const statusFlips = (m: jest.Mock) =>
  m.mock.calls.map(([a]) => a as UpdateManyArgs).filter((a) => a?.data && ('status' in a.data || 'paymentStatus' in a.data));
const attentionFlags = (m: jest.Mock) =>
  m.mock.calls.map(([a]) => a as UpdateManyArgs).filter((a) => a?.data && 'pancakeAttention' in a.data).map((a) => a.data.pancakeAttention as string);

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
  it('mọi tiền tố mã đơn (đơn đại lý DLR, đơn định kỳ TUBUSUB) trong "Order code: …"', () => {
    expect(proc.extractOrderCode({ note: 'Order code: DLR12345678901 | ghi chú' })).toBe('DLR12345678901');
    expect(proc.extractOrderCode({ note: 'Order code: TUBUSUB1234567001' })).toBe('TUBUSUB1234567001');
  });
  it('chữ TUBU lẫn trong ghi chú tự do (không phải "Order code:") → không coi là mã đơn', () => {
    expect(proc.extractOrderCode({ note: 'Khách quen, đơn trước TUBU20260613001 giao trễ' })).toBeNull();
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
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.lockCommissionsForOrder).not.toHaveBeenCalled();
    // Đơn đã huỷ (đã hoàn tiền) mà Pancake báo giao → hai nguồn mâu thuẫn, phải vào hàng đợi cho người xử lý.
    expect(attentionFlags(txUpdateMany)).toEqual([expect.stringContaining('Đã giao')]);
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
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
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
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
    // Không im lặng: Pancake huỷ đơn đã giao là việc người phải xem.
    expect(attentionFlags(txUpdateMany)).toHaveLength(1);
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

const lateRefunds = (prisma: PrismaService) =>
  (prisma.orderCustomerRefund.createMany as jest.Mock).mock.calls.flatMap(([a]) => (a as { data: unknown[] }).data);

describe('PancakeProcessor.onPaymentReconcile', () => {
  const paidPayload = { id: 'p1', is_paid: true };

  it('đơn BANK_TRANSFER UNPAID nhận xác nhận thanh toán → lật PAID + CONFIRMED + notify + ghi order_paid trong cùng tx', async () => {
    const { proc, orderUpdateMany, notifications, analytics } = setup({
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
    expect(analytics.record).toHaveBeenCalledTimes(1);
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'order_paid',
        userId: 'u1',
        props: expect.objectContaining({ orderId: 'o1', method: 'BANK_TRANSFER', amount: 100000 }),
      }),
    );
    const dataArg = (orderUpdateMany as jest.Mock).mock.calls[0][0].data;
    const eventArg = (analytics.record as jest.Mock).mock.calls[0][1];
    expect(eventArg.occurredAt).toEqual(dataArg.paidAt);
  });

  it('lật PAID ghi lịch sử trạng thái (actor PANCAKE, "Đã nhận tiền") cùng transaction — CSKH truy được ai/lúc nào xác nhận tiền', async () => {
    const { proc, historyCreate } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    await proc.onPaymentReconcile(paidPayload);
    expect(historyCreate).toHaveBeenCalledTimes(1);
    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'o1',
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CONFIRMED',
        actorType: 'PANCAKE',
        note: expect.stringContaining('Đã nhận tiền'),
      }),
    });
  });

  it('RACE: đọc thấy PENDING_PAYMENT nhưng khách vừa HUỶ trước khi lật → KHÔNG hồi sinh đơn, KHÔNG ghi order_paid, vào hàng đợi hoàn tiền tay', async () => {
    const order = {
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    };
    const { proc, prisma, orderUpdateMany, orderFindFirst, notifications, analytics } = setup(order);
    orderFindFirst.mockResolvedValueOnce(order).mockResolvedValueOnce(order).mockResolvedValue({ ...order, status: 'CANCELLED' });
    orderUpdateMany.mockResolvedValue({ count: 0 });
    await proc.onPaymentReconcile(paidPayload);
    expect(notifications.notify).not.toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', expect.anything());
    expect(analytics.record).not.toHaveBeenCalled();
    expect(lateRefunds(prisma)).toEqual([expect.objectContaining({ kind: 'LATE_PAYMENT', amount: 100000, userId: 'u1' })]);
  });

  it('đơn đã CONFIRMED (xác nhận trước khi tiền về) → chỉ lật PAID, KHÔNG đụng status, ghi order_paid ĐÚNG 1 LẦN', async () => {
    const { proc, orderUpdateMany, notifications, analytics } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    await proc.onPaymentReconcile(paidPayload);
    expect(statusFlips(orderUpdateMany)).toEqual([
      { where: { id: 'o1', paymentStatus: 'UNPAID', status: 'CONFIRMED' }, data: { paymentStatus: 'PAID', paidAt: expect.any(Date) } },
    ]);
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU1' });
    expect(analytics.record).toHaveBeenCalledTimes(1);
  });

  // P1-3 (docs/2026-09-08-review-progress.md): tiền chuyển khoản tới SAU khi đơn đã hủy/trả
  // trước đây vẫn bị lật PAID êm — đơn đứng CANCELLED/RETURNED + PAID, không ai tự hoàn tiền
  // thật cho khách.
  // BUYERMINI-7/MONEY-6 (D2): tiền về muộn tự tạo yêu cầu hoàn trong hàng đợi hoàn tiền, báo khách + admin.
  it.each(['CANCELLED', 'RETURNED'])('đơn %s nhận xác nhận thanh toán trễ → KHÔNG lật PAID; tạo yêu cầu hoàn tiền, báo khách và admin', async (status) => {
    const { proc, prisma, orderUpdateMany, notifications, analytics } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status,
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    await proc.onPaymentReconcile({ id: 'p1', prepaid: 0, bank_payment: 100000 });
    expect(statusFlips(orderUpdateMany)).toHaveLength(0);
    expect(analytics.record).not.toHaveBeenCalled();
    expect(lateRefunds(prisma)).toEqual([
      expect.objectContaining({
        orderId: 'o1', kind: 'LATE_PAYMENT', refKey: 'PANCAKE:p1:100000', amount: 100000,
        method: 'MANUAL_TRANSFER', status: 'PENDING', userId: 'u1',
      }),
    ]);
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFUND_LATE_PAYMENT', { order_code: 'TUBU1', amount: '100.000đ' });
    expect(notifications.notify).toHaveBeenCalledWith('admin1', 'OPS_REFUND_ALERT', expect.objectContaining({ order_code: 'TUBU1' }));
    expect(notifications.notify).not.toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', expect.anything());
    expect(attentionFlags(orderUpdateMany)).toEqual([]);
  });

  it('Pancake gửi lại cùng webhook tiền về muộn → không tạo khoản thứ hai, không báo lại', async () => {
    const { proc, prisma, notifications } = setup({
      id: 'o1', code: 'TUBU1', userId: 'u1', status: 'CANCELLED',
      paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100000,
    });
    (prisma.orderCustomerRefund.createMany as jest.Mock).mockResolvedValue({ count: 0 });
    await proc.onPaymentReconcile(paidPayload);
    expect(notifications.notify).not.toHaveBeenCalled();
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

  it('worker khác đang giữ claim (updateMany count=0) → không chạy handler, không ghi đè trạng thái', async () => {
    const { proc, prisma, txUpdateMany } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING', note: null, items: [] });
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e1',
      status: 'PROCESSING',
      eventType: 'order.status_updated',
      rawPayload: { event: 'order.status_updated', data: { id: 'p1', status: 'delivered' } },
    });
    (prisma.pancakeWebhookEvent.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await proc.process({ data: { eventId: 'e1' } });
    expect(txUpdateMany).not.toHaveBeenCalled();
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
    expect(q.add).toHaveBeenCalledWith('push', { orderId: 'o1' }, expect.objectContaining({ jobId: 'o1' }));
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
    await expect(b.proc.onPaymentReconcile({ id: 'p1', is_paid: true })).resolves.toMatchObject({ id: 'o1' });
    expect(b.notifications.notify).toHaveBeenCalled();
  });

  it('Pancake huỷ đơn thu gom (onCancelled → OrderStatusService) → enqueue huỷ vận đơn Gomdon', async () => {
    const q = gomdonQueue();
    const { proc } = setup(
      { id: 'o1', code: 'TUBU1', userId: 'u1', status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 100000, pointsUsed: 0, items: [], hasRecyclingPickup: true, gomdonOrderId: '77' },
      q,
    );
    await proc.onCancelled({ id: 'p1' });
    expect(q.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, expect.objectContaining({ jobId: 'cancel-o1' }));
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

describe('PancakeProcessor — mã trạng thái Pancake POS và hoàn hàng', () => {
  const base = { id: 'o1', code: 'TUBU1', userId: 'u1', note: null, total: 100000, paymentMethod: 'COD', paymentStatus: 'UNPAID', items: [] };

  it('"Đã nhận" (3) trên đơn đang giao → DELIVERED (cộng điểm), không còn kẹt "Đang giao"', async () => {
    const { proc, txUpdateMany, loyalty } = setup({ ...base, status: 'SHIPPING' });
    await proc.onStatusUpdated({ id: 'p1', status: 3 });
    expect(statusFlips(txUpdateMany)[0]!.data).toMatchObject({ status: 'DELIVERED' });
    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
  });

  it('"Đã gửi hàng" (2) trên đơn đã xác nhận → SHIPPING (không phải PACKED)', async () => {
    const { proc, txUpdateMany } = setup({ ...base, status: 'CONFIRMED' });
    await proc.onStatusUpdated({ id: 'p1', status: 2 });
    expect(statusFlips(txUpdateMany)[0]!.data).toMatchObject({ status: 'SHIPPING' });
  });

  it('"Đã hoàn" (5) khi đơn ĐANG GIAO (giao không thành) → huỷ đơn: hoàn kho, đảo điểm/hoa hồng, ghi chú lý do', async () => {
    const { proc, txUpdateMany, txExecuteRaw, loyalty, affiliate, historyCreate } = setup({
      ...base,
      status: 'SHIPPING',
      items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null, backorderedQty: 0 }],
    });
    await proc.onStatusUpdated({ id: 'p1', status: 5 });
    const flip = statusFlips(txUpdateMany)[0]!;
    expect(flip.where).toEqual({ id: 'o1', status: 'SHIPPING' });
    expect(flip.data).toMatchObject({ status: 'CANCELLED' });
    // Lý do đi vào lịch sử trạng thái, không nối vào Order.note là ghi chú khách tự viết (GOMDON-10).
    expect(flip.data).not.toHaveProperty('note');
    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ toStatus: 'CANCELLED', actorType: 'PANCAKE', note: expect.stringContaining('hoàn về kho') }),
    });
    expect(txExecuteRaw).toHaveBeenCalled();
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('"Đã huỷ" (6) / order.cancelled khi đơn ĐANG GIAO → không huỷ/hoàn tiền: vào "Cần xử lý Pancake" (D1)', async () => {
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const order = { ...base, paymentMethod: 'WALLET', paymentStatus: 'PAID', status: 'SHIPPING', shippingCode: 'BEX1', shippingPartner: 'BEX' };
    const { proc, txUpdateMany, loyalty } = setup(order, undefined, alerts);
    await proc.onStatusUpdated({ id: 'p1', status: 6 });
    await proc.onCancelled({ id: 'p1' });
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(attentionFlags(txUpdateMany)[0]).toContain('Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển (đơn đang giao)');
  });

  it('"Đã hoàn" (5) sau "Đang hoàn" (4) → huỷ xong thì tự gỡ việc "ĐANG HOÀN" khỏi hàng đợi (R2-PANCAKE-4)', async () => {
    const order = { ...base, status: 'SHIPPING', pancakeAttention: 'Pancake báo ĐANG HOÀN (giao không thành…' };
    const { proc, prisma, orderUpdateMany } = setup(order);
    (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...order, status: 'CANCELLED' });
    await proc.onStatusUpdated({ id: 'p1', status: 5 });
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'o1', pancakeAttention: { startsWith: 'Pancake báo ĐANG HOÀN' } },
      data: { pancakeAttention: null, pancakeAttentionAt: null },
    });
  });

  it('"Đã hoàn" (5) khi đơn ĐÃ GIAO → RETURNED', async () => {
    // total 0: phần hoàn tiền của RETURNED đã có spec riêng (order-reversal) — ở đây chỉ kiểm đích trạng thái.
    const { proc, txUpdateMany } = setup({ ...base, total: 0, status: 'DELIVERED' });
    await proc.onStatusUpdated({ id: 'p1', status: 'returned' });
    expect(statusFlips(txUpdateMany)[0]!.data).toMatchObject({ status: 'RETURNED' });
  });

  it('"Đang hoàn" (4) → KHÔNG hoàn tiền sớm, KHÔNG đổi trạng thái; vào hàng đợi "Cần xử lý Pancake" + báo admin (template Pancake)', async () => {
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const { proc, txUpdateMany } = setup({ ...base, status: 'SHIPPING' }, undefined, alerts);
    await proc.onStatusUpdated({ id: 'p1', status: 4 });
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
    expect(attentionFlags(txUpdateMany)).toEqual([expect.stringContaining('ĐANG HOÀN')]);
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1', expect.stringContaining('ĐANG HOÀN'), 'OPS_PANCAKE_ALERT');
  });

  it('cùng lý do đã chờ xử lý (Pancake gửi lại webhook) → không báo admin lần nữa', async () => {
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const { proc, orderUpdateMany } = setup({ ...base, status: 'SHIPPING' }, undefined, alerts);
    orderUpdateMany.mockResolvedValue({ count: 0 });
    await proc.onStatusUpdated({ id: 'p1', status: 15 });
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('"Hoàn một phần" (15) không bị tính là giao đủ; "Đã xóa" (7) không tự huỷ/hoàn tiền — cả hai vào hàng đợi', async () => {
    for (const code of [15, 7]) {
      const { proc, txUpdateMany, loyalty } = setup({ ...base, status: 'SHIPPING' });
      await proc.onStatusUpdated({ id: 'p1', status: code });
      expect(statusFlips(txUpdateMany)).toHaveLength(0);
      expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
      expect(attentionFlags(txUpdateMany)).toHaveLength(1);
    }
  });

  it('webhook tới trễ lùi trong chuỗi giao (đơn đã giao, Pancake báo "Đã gửi hàng") → bỏ qua êm, không vào hàng đợi', async () => {
    const { proc, txUpdateMany } = setup({ ...base, status: 'DELIVERED' });
    await proc.onStatusUpdated({ id: 'p1', status: 2 });
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it('đơn trả trước chưa nhận tiền mà Pancake báo đã gửi hàng → vào hàng đợi (hàng rời kho khi chưa có tiền)', async () => {
    const { proc, txUpdateMany } = setup({ ...base, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    await proc.onStatusUpdated({ id: 'p1', status: 2 });
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
    expect(attentionFlags(txUpdateMany)).toEqual([expect.stringContaining('chưa ghi nhận thanh toán')]);
  });
});

describe('PancakeProcessor — khớp đơn: đơn Pancake trùng/đơn bù mang cùng mã Tubu', () => {
  const real = {
    id: 'o1', code: 'TUBU2026101370032', userId: 'u1', status: 'CONFIRMED', note: null,
    total: 100000, paymentMethod: 'WALLET', paymentStatus: 'PAID', pancakeOrderId: '9006', items: [],
  };

  function routeFindFirst(m: jest.Mock, orders: Record<string, unknown>[]) {
    m.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if ('pancakeOrderId' in where) return orders.find((o) => o.pancakeOrderId === where.pancakeOrderId) ?? null;
      if ('code' in where) return orders.find((o) => o.code === where.code) ?? null;
      const or = (where.OR as Record<string, unknown>[] | undefined) ?? [];
      return orders.find((o) => or.some((c) => c.id === o.id || c.code === o.code)) ?? null;
    });
  }

  it('đơn Pancake KHÁC (#9004) mang external_order_id của đơn đã gắn #9006 → bỏ qua (không huỷ, không hoàn tiền), báo admin', async () => {
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const { proc, prisma, orderFindFirst, txUpdateMany, loyalty } = setup(real, undefined, alerts);
    routeFindFirst(orderFindFirst, [real]);
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e1', status: 'RECEIVED', eventType: 'orders',
      rawPayload: { id: 9004, status: 6, extension: { external_order_id: real.code } },
    });
    await proc.process({ data: { eventId: 'e1' } });
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(attentionFlags(txUpdateMany)).toEqual([expect.stringContaining('#9004')]);
    expect(alerts.alert).toHaveBeenCalledWith(real.code, expect.stringContaining('#9006'), 'OPS_PANCAKE_ALERT');
    expect((prisma.pancakeWebhookEvent.update as jest.Mock).mock.calls[0][0].data.status).toBe('PROCESSED');
  });

  it('đúng đơn Pancake đã gắn (#9006) → xử lý bình thường', async () => {
    const cod = { ...real, paymentMethod: 'COD', paymentStatus: 'UNPAID' };
    const { proc, orderFindFirst, txUpdateMany } = setup(cod);
    routeFindFirst(orderFindFirst, [cod]);
    await proc.onStatusUpdated({ id: 9006, status: 6, extension: { external_order_id: real.code } });
    expect(statusFlips(txUpdateMany)[0]!.data).toMatchObject({ status: 'CANCELLED' });
  });

  it('đơn Tubu chưa gắn đơn Pancake nào (push chưa lưu id) → khớp theo mã đơn', async () => {
    const unlinked = { ...real, pancakeOrderId: null };
    const { proc, orderFindFirst, txUpdateMany } = setup(unlinked);
    routeFindFirst(orderFindFirst, [unlinked]);
    await proc.onStatusUpdated({ id: 9006, status: 2, note: `Order code: ${real.code}` });
    expect(statusFlips(txUpdateMany)[0]!.data).toMatchObject({ status: 'SHIPPING' });
  });

  it('webhook tới trước khi lưu pancakeOrderId và không kèm mã đơn → UNMATCHED (cron đối chiếu lại), không mất sự kiện', async () => {
    const { proc, prisma, orderFindFirst, orderUpdate } = setup(null);
    routeFindFirst(orderFindFirst, []);
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e1', status: 'RECEIVED', eventType: 'orders',
      rawPayload: { id: 9008, status: 1, partner: { extend_code: 'GHN123' } },
    });
    await proc.process({ data: { eventId: 'e1' } });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect((prisma.pancakeWebhookEvent.update as jest.Mock).mock.calls[0][0].data).toMatchObject({
      status: 'UNMATCHED',
      processedAt: null,
    });
  });

  it('sự kiện tồn kho không gắn đơn → vẫn PROCESSED', async () => {
    const { proc, prisma } = setup(null);
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e1', status: 'RECEIVED', eventType: 'variation.stock_changed', rawPayload: { variation_id: 'pv1' },
    });
    await proc.process({ data: { eventId: 'e1' } });
    expect((prisma.pancakeWebhookEvent.update as jest.Mock).mock.calls[0][0].data.status).toBe('PROCESSED');
  });
});

describe('PancakeProcessor — đơn có vận đơn Gomdon sống: Gomdon là nguồn duy nhất của đang giao/đã giao', () => {
  const liveGomdon = {
    id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING', note: null, total: 100000,
    paymentMethod: 'COD', paymentStatus: 'UNPAID', hasRecyclingPickup: true, items: [],
    gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '5', gomdonCancelStatus: null,
  };

  it('Pancake "completed" khi Gomdon chưa báo giao → KHÔNG DELIVERED, KHÔNG cộng điểm; vào hàng đợi', async () => {
    const { proc, txUpdateMany, loyalty } = setup(liveGomdon);
    await proc.onStatusUpdated({ id: 'p1', status: 'completed' });
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
    expect(attentionFlags(txUpdateMany)).toEqual([expect.stringContaining('Gomdon')]);
  });

  it('Pancake "Đã gửi hàng" → bỏ qua êm (Gomdon tự báo đang giao)', async () => {
    const { proc, txUpdateMany } = setup({ ...liveGomdon, status: 'CONFIRMED' });
    await proc.onStatusUpdated({ id: 'p1', status: 2 });
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it('huỷ từ Pancake vẫn nhận khi bưu tá Gomdon chưa lấy hàng', async () => {
    const { proc, txUpdateMany } = setup({ ...liveGomdon, status: 'CONFIRMED', gomdonStatus: '1' });
    await proc.onStatusUpdated({ id: 'p1', status: 6 });
    expect(statusFlips(txUpdateMany)[0]!.data).toMatchObject({ status: 'CANCELLED' });
  });

  it('Pancake huỷ đơn mà bưu tá Gomdon đã lấy hàng → KHÔNG huỷ, không hoàn tiền; vào hàng đợi + báo admin (R2-GOMDON-2)', async () => {
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const { proc, txUpdateMany, loyalty } = setup({ ...liveGomdon, status: 'SHIPPING', gomdonStatus: '4' }, undefined, alerts);
    await proc.onStatusUpdated({ id: 'p1', status: 6 });
    expect(statusFlips(txUpdateMany)).toHaveLength(0);
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(attentionFlags(txUpdateMany)).toEqual([expect.stringContaining('Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển')]);
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1', expect.stringContaining('KHÔNG tự huỷ/hoàn tiền'), 'OPS_PANCAKE_ALERT');
  });

  it('vận đơn Gomdon đã huỷ → Pancake lại được chốt đã giao', async () => {
    const { proc, txUpdateMany } = setup({ ...liveGomdon, gomdonStatus: '2' });
    await proc.onStatusUpdated({ id: 'p1', status: 3 });
    expect(statusFlips(txUpdateMany)[0]!.data).toMatchObject({ status: 'DELIVERED' });
  });
});
