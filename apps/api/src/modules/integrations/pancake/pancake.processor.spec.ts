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
function setup(order: Record<string, unknown> | null) {
  const orderFindFirst = jest.fn().mockResolvedValue(order);
  const orderFindUniqueOrThrow = jest.fn().mockResolvedValue(order);
  const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const txUserUpdate = jest.fn().mockResolvedValue({});
  const txCoinCreate = jest.fn().mockResolvedValue({});
  const txVariationUpdate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      order: { updateMany: txUpdateMany },
      user: { update: txUserUpdate },
      coinTransaction: { create: txCoinCreate },
      variation: { update: txVariationUpdate },
    }),
  );
  const prisma = {
    order: { findFirst: orderFindFirst, findUniqueOrThrow: orderFindUniqueOrThrow },
    pancakeWebhookEvent: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    variation: { updateMany: jest.fn().mockResolvedValue({}) },
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
  const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal);
  const proc = new PancakeProcessor(prisma, notifications, orderStatus) as unknown as {
    onStatusUpdated(d: Record<string, unknown>): Promise<void>;
    onCancelled(d: Record<string, unknown>): Promise<void>;
    extractOrderCode(d: Record<string, unknown>): string | null;
    process(job: { data: { eventId: string } }): Promise<void>;
  };
  return { proc, prisma, notifications, loyalty, affiliate, txUpdateMany, txUserUpdate, txVariationUpdate };
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
      items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null }],
    });
    await proc.onCancelled({ id: 'p1' });
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
  });

  it('đơn CONFIRMED (chưa giao) → hủy được qua webhook cancelled → hoàn tiền/restock/reverse', async () => {
    const { proc, txUpdateMany, txVariationUpdate, loyalty, affiliate } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'CONFIRMED',
      note: null,
      total: 100000,
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null }],
    });
    await proc.onCancelled({ id: 'p1' });
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', status: 'CONFIRMED' }, data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    expect(txVariationUpdate).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { stock: { increment: 1 } } });
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
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
