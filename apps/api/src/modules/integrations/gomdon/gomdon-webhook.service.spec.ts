import type { Queue } from 'bullmq';
import { GomdonWebhookService, gomdonDedupeKey, parseGomdonPayload } from './gomdon-webhook.service';
import { InvalidOrderTransitionError, type OrderStatusService } from '../../orders/order-status.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { GomdonAlertService } from './gomdon-alert.service';
import type { GomdonWebhookPayload } from './gomdon.types';

const recyclingOrder = {
  id: 'o1',
  code: 'TUBU1001',
  status: 'SHIPPING',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  hasRecyclingPickup: true,
  gomdonOrderId: '55',
  gomdonPartnerCode: 'BE55',
  gomdonStatus: '5',
  gomdonStatusAt: new Date('2026-09-20T01:00:00Z'),
  gomdonCancelStatus: null as string | null,
  shippingCode: 'BE55',
  shippingPartner: 'BestExpress',
  shippingHistory: [{ at: '2026-09-20T01:00:00.000Z', status: 'Đang đi giao hàng' }],
  trackingLink: null as string | null,
};

function build(opts: { orders?: (Record<string, unknown> | null)[] } = {}) {
  const orders = opts.orders ?? [recyclingOrder];
  const findFirst = jest.fn();
  for (const o of orders) findFirst.mockResolvedValueOnce(o ? { ...recyclingOrder, ...o } : null);
  findFirst.mockResolvedValue(null);
  const prisma = {
    gomdonWebhookEvent: {
      create: jest.fn().mockResolvedValue({ id: 'ev1' }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      findFirst,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const orderStatus = { setStatus: jest.fn().mockResolvedValue({}) };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
  const eventsQueue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) };
  const pushQueue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) };
  const svc = new GomdonWebhookService(
    prisma as unknown as PrismaService,
    orderStatus as unknown as OrderStatusService,
    alerts as unknown as GomdonAlertService,
    eventsQueue as unknown as Queue,
    pushQueue as unknown as Queue,
  );
  return { svc, prisma, orderStatus, alerts, eventsQueue, pushQueue };
}

/** Chạy processEvent với payload như thể event vừa được lưu. */
async function process(ctx: ReturnType<typeof build>, payload: GomdonWebhookPayload) {
  ctx.prisma.gomdonWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'ev1', status: 'RECEIVED', rawPayload: payload });
  await ctx.svc.processEvent('ev1');
  return ctx.prisma.gomdonWebhookEvent.update.mock.calls.at(-1)?.[0]?.data;
}

describe('GomdonWebhookService.receive — lưu event + dedupe', () => {
  const payload = { order_id: 55, order_code: 'BE55', order_customer_id: 'TUBU1001', status: 7, created_time: 1758330000 };

  it('lưu event với dedupeKey order_id|status|created_time rồi enqueue theo eventId', async () => {
    const ctx = build();
    await expect(ctx.svc.receive(payload)).resolves.toEqual({ result: true });
    const data = ctx.prisma.gomdonWebhookEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ dedupeKey: '55|7|1758330000', gomdonOrderId: '55', orderCode: 'TUBU1001', gomdonStatus: 7, status: 'RECEIVED' });
    expect(ctx.eventsQueue.add).toHaveBeenCalledWith('process', { eventId: 'ev1' }, { jobId: 'ev1' });
  });

  it('Gomdon gửi lại event đã PROCESSED (P2002) → duplicate, KHÔNG xử lý lại', async () => {
    const ctx = build();
    ctx.prisma.gomdonWebhookEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    ctx.prisma.gomdonWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'ev0', status: 'PROCESSED' });
    await expect(ctx.svc.receive(payload)).resolves.toEqual({ result: true, duplicate: true });
    expect(ctx.eventsQueue.add).not.toHaveBeenCalled();
  });

  it('gửi lại event lần trước FAILED → enqueue lại event cũ', async () => {
    const ctx = build();
    ctx.prisma.gomdonWebhookEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    ctx.prisma.gomdonWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'ev0', status: 'FAILED' });
    await ctx.svc.receive(payload);
    expect(ctx.eventsQueue.add).toHaveBeenCalledWith('process', { eventId: 'ev0' }, { jobId: 'ev0' });
  });

  it('không lưu được event (DB lỗi) → ném (non-2xx để Gomdon gửi lại)', async () => {
    const ctx = build();
    ctx.prisma.gomdonWebhookEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(ctx.svc.receive(payload)).rejects.toThrow('db down');
  });

  it('enqueue lỗi (Redis) → vẫn 200: event đã lưu RECEIVED, cron cứu hộ chạy lại', async () => {
    const ctx = build();
    ctx.eventsQueue.add.mockRejectedValueOnce(new Error('redis'));
    await expect(ctx.svc.receive(payload)).resolves.toEqual({ result: true });
  });

  it('dedupeKey: cùng payload → cùng key; khác created_time → khác key; thiếu created_time → băm payload', () => {
    const k1 = gomdonDedupeKey(parseGomdonPayload(payload), payload);
    expect(gomdonDedupeKey(parseGomdonPayload({ ...payload }), { ...payload })).toBe(k1);
    const later = { ...payload, created_time: 1758330999 };
    expect(gomdonDedupeKey(parseGomdonPayload(later), later)).not.toBe(k1);
    const noTime = { order_id: 55, status: 3 };
    const k3 = gomdonDedupeKey(parseGomdonPayload(noTime), noTime);
    expect(k3).toMatch(/^55\|3\|h[0-9a-f]{24}$/);
    const noTime2 = { order_id: 55, status: 3, weight: 900 };
    expect(gomdonDedupeKey(parseGomdonPayload(noTime2), noTime2)).not.toBe(k3);
  });
});

describe('GomdonWebhookService.processEvent — áp dụng trạng thái', () => {
  it('event đã PROCESSED → no-op', async () => {
    const ctx = build();
    ctx.prisma.gomdonWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'ev1', status: 'PROCESSED', rawPayload: {} });
    await ctx.svc.processEvent('ev1');
    expect(ctx.prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('chỉ khớp đơn CÓ thu gom theo mã vận đơn — không bao giờ khớp đơn bất kỳ theo mã TUBU', async () => {
    const ctx = build({ orders: [null, null] });
    const data = await process(ctx, { order_id: 99, order_code: 'X', order_customer_id: 'TUBU9999', status: 7 });
    for (const [args] of ctx.prisma.order.findFirst.mock.calls) {
      expect(args.where.hasRecyclingPickup).toBe(true);
    }
    expect(data.status).toBe('IGNORED');
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
  });

  it('chỉ có order_customer_id (không có order_id/order_code) → bỏ qua, không tra đơn theo mã đơn', async () => {
    const ctx = build();
    const data = await process(ctx, { order_customer_id: 'TUBU1001', status: 7 });
    expect(ctx.prisma.order.findFirst).not.toHaveBeenCalled();
    expect(data.status).toBe('IGNORED');
  });

  it('status 7 cho đơn COD đang SHIPPING → DELIVERED + ghi lịch sử hành trình', async () => {
    const ctx = build();
    const data = await process(ctx, { order_id: 55, order_code: 'BE55', status: 7, created_time: 1758330000 });
    expect(ctx.orderStatus.setStatus).toHaveBeenCalledWith('o1', 'DELIVERED', expect.objectContaining({ actorType: 'SYSTEM' }));
    const upd = ctx.prisma.order.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'o1', gomdonStatus: '5' });
    expect(upd.data.gomdonStatus).toBe('7');
    expect(upd.data.shippingStatus).toBe('Giao thành công');
    expect(upd.data.shippingHistory).toHaveLength(2);
    expect(data.status).toBe('PROCESSED');
  });

  it('status 7 cho đơn chuyển khoản CHƯA thanh toán (PENDING_PAYMENT) → KHÔNG DELIVERED, báo CSKH', async () => {
    const ctx = build({
      orders: [{ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', gomdonStatus: '5' }],
    });
    await process(ctx, { order_id: 55, status: 7 });
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
    expect(ctx.alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('không tự chuyển DELIVERED'));
  });

  it('status 3 cho đơn CONFIRMED → SHIPPING; trackingLink http(s) được lưu', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonStatus: '1' }] });
    await process(ctx, { order_id: 55, status: 3, tracking_link: 'https://track.best/BE55' });
    expect(ctx.orderStatus.setStatus).toHaveBeenCalledWith('o1', 'SHIPPING', expect.anything());
    expect(ctx.prisma.order.updateMany.mock.calls[0][0].data.trackingLink).toBe('https://track.best/BE55');
  });

  it('webhook tới trễ không lùi trạng thái: đang 7, nhận 5 → bỏ qua, không ghi gì', async () => {
    const ctx = build({ orders: [{ status: 'DELIVERED', gomdonStatus: '7' }] });
    const data = await process(ctx, { order_id: 55, status: 5 });
    expect(ctx.prisma.order.updateMany).not.toHaveBeenCalled();
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
    expect(data.status).toBe('IGNORED');
  });

  it('cùng bậc (5 ↔ 11) nhưng created_time cũ hơn mốc đang lưu → bỏ qua', async () => {
    const ctx = build();
    const data = await process(ctx, { order_id: 55, status: 11, created_time: Date.parse('2026-09-19T00:00:00Z') / 1000 });
    expect(ctx.prisma.order.updateMany).not.toHaveBeenCalled();
    expect(data.status).toBe('IGNORED');
  });

  it('trạng thái lỗi/hoàn (10) → ghi gomdonStatus + báo CSKH, KHÔNG đổi status đơn/hoàn tiền', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonStatus: '1' }] });
    await process(ctx, { order_id: 55, status: 10 });
    expect(ctx.prisma.order.updateMany.mock.calls[0][0].data.gomdonStatus).toBe('10');
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
    expect(ctx.alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('lấy hàng không thành công'));
  });

  it('status 2 cho đơn đã CANCELLED (xác nhận huỷ) → gomdonCancelStatus CANCELLED, không báo động', async () => {
    const ctx = build({ orders: [{ status: 'CANCELLED', gomdonStatus: '1' }] });
    await process(ctx, { order_id: 55, status: 2 });
    const last = ctx.prisma.order.updateMany.mock.calls.at(-1)[0];
    expect(last.data).toEqual({ gomdonCancelStatus: 'CANCELLED' });
    expect(ctx.alerts.alert).not.toHaveBeenCalled();
  });

  it('tự lành: tạo vận đơn bị timeout nhưng Gomdon đã tạo → khớp theo mã đơn, điền gomdonOrderId/partnerCode', async () => {
    const ctx = build({
      orders: [null, { status: 'CONFIRMED', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK', shippingCode: null }],
    });
    await process(ctx, { order_id: 77, order_code: 'BE77', order_customer_id: 'TUBU1001', status: 1 });
    const second = ctx.prisma.order.findFirst.mock.calls[1][0].where;
    expect(second).toEqual({ code: 'TUBU1001', hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null });
    const upd = ctx.prisma.order.updateMany.mock.calls[0][0].data;
    expect(upd).toMatchObject({ gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1', shippingCode: 'BE77' });
    expect(ctx.alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('KHÔNG tạo vận đơn tay'));
  });

  it('tự lành cho đơn đã CANCELLED → enqueue huỷ vận đơn vừa phát hiện', async () => {
    const ctx = build({
      orders: [null, { status: 'CANCELLED', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK' }],
    });
    await process(ctx, { order_id: 77, order_code: 'BE77', order_customer_id: 'TUBU1001', status: 1 });
    expect(ctx.pushQueue.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, { jobId: 'cancel-o1' });
  });

  it('order_customer_id lệch mã đơn đã khớp → bỏ qua', async () => {
    const ctx = build();
    const data = await process(ctx, { order_id: 55, order_customer_id: 'TUBU2222', status: 7 });
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
    expect(data.status).toBe('IGNORED');
  });

  it('setStatus lỗi thật (DB) → event FAILED + ném để BullMQ retry (không nuốt mất mốc DELIVERED)', async () => {
    const ctx = build();
    ctx.orderStatus.setStatus.mockRejectedValueOnce(new Error('pool timeout'));
    ctx.prisma.gomdonWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'ev1', status: 'RECEIVED', rawPayload: { order_id: 55, status: 7 } });
    await expect(ctx.svc.processEvent('ev1')).rejects.toThrow('pool timeout');
    expect(ctx.prisma.gomdonWebhookEvent.update.mock.calls.at(-1)[0].data).toMatchObject({ status: 'FAILED', error: 'pool timeout' });
  });

  it('retry sau khi đã ghi gomdonStatus=7 → vẫn chuyển DELIVERED (không cần statusChanged)', async () => {
    const ctx = build({ orders: [{ status: 'SHIPPING', gomdonStatus: '7' }] });
    await process(ctx, { order_id: 55, status: 7 });
    expect(ctx.orderStatus.setStatus).toHaveBeenCalledWith('o1', 'DELIVERED', expect.anything());
  });

  it('transition không hợp lệ (đơn đã CANCELLED) → nuốt êm, event PROCESSED', async () => {
    const ctx = build({ orders: [{ status: 'SHIPPING', gomdonStatus: '5' }] });
    ctx.orderStatus.setStatus.mockRejectedValueOnce(new InvalidOrderTransitionError('SHIPPING', 'DELIVERED'));
    const data = await process(ctx, { order_id: 55, status: 7 });
    expect(data.status).toBe('PROCESSED');
  });

  it('2 webhook song song: updateMany guard theo gomdonStatus thua (count=0) → ném để xử lý lại', async () => {
    const ctx = build();
    ctx.prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });
    ctx.prisma.gomdonWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'ev1', status: 'RECEIVED', rawPayload: { order_id: 55, status: 7 } });
    await expect(ctx.svc.processEvent('ev1')).rejects.toThrow('vừa đổi');
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
  });
});
