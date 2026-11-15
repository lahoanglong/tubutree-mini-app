import { BadRequestException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { GomdonWebhookService, gomdonDedupeKey, parseGomdonPayload } from './gomdon-webhook.service';
import { InvalidOrderTransitionError, type OrderStatusService } from '../../orders/order-status.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeOrderService } from '../pancake/pancake-order.service';
import type { GomdonAlertService } from './gomdon-alert.service';
import type { GomdonWebhookPayload } from './gomdon.types';
import type { WasteHomePickupService } from '../../waste-exchange/home-pickup/waste-home-pickup.service';

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
    wasteRequest: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const wasteHomePickup = { applyWebhook: jest.fn().mockResolvedValue({ outcome: 'PROCESSED' }) };
  const orderStatus = { setStatus: jest.fn().mockResolvedValue({}) };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined), resolveKinds: jest.fn().mockResolvedValue(0) };
  const eventsQueue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) };
  const pushQueue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) };
  const pancakeOrder = { syncWaybillNote: jest.fn().mockResolvedValue(undefined) };
  const svc = new GomdonWebhookService(
    prisma as unknown as PrismaService,
    orderStatus as unknown as OrderStatusService,
    alerts as unknown as GomdonAlertService,
    eventsQueue as unknown as Queue,
    pushQueue as unknown as Queue,
    pancakeOrder as unknown as PancakeOrderService,
    wasteHomePickup as unknown as WasteHomePickupService,
  );
  return { svc, prisma, orderStatus, alerts, eventsQueue, pushQueue, pancakeOrder, wasteHomePickup };
}

/**
 * Payload đúng mẫu tài liệu Gomdon (mục Webhook): order_id = mã số đơn Gomdon, order_code = mã vận đơn
 * (SỐ trong JSON mẫu), order_customer_id = mã đơn của ta, created_time = unix GIÂY, cân nặng gram, kích
 * thước mm, phí VND. KHÔNG có tracking_link. Giá trị giả.
 */
const DOC_PAYLOAD = {
  status: 7,
  product_price: 250000,
  collect_amount: 250000,
  weight: 2400,
  height: 0,
  width: 0,
  length: 0,
  order_id: 55,
  order_code: 84850000000055,
  order_customer_id: 'TUBU1001',
  customer_total_fee: 23000,
  customer_delivery_fee: 23000,
  customer_cod_fee: 0,
  customer_insurance_fee: 0,
  created_time: 1758330000,
};

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

  it('payload đúng mẫu tài liệu (order_code dạng SỐ) → lưu event, dedupeKey order_id|status|created_time', async () => {
    const ctx = build();
    await expect(ctx.svc.receive(DOC_PAYLOAD)).resolves.toEqual({ result: true });
    const data = ctx.prisma.gomdonWebhookEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ dedupeKey: '55|7|1758330000', gomdonOrderId: '55', orderCode: 'TUBU1001', gomdonStatus: 7 });
    expect(data.eventTime).toEqual(new Date(1758330000 * 1000));
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

  it('payload đúng mẫu tài liệu: order_code SỐ khớp mã vận đơn đã lưu dạng chuỗi, created_time unix giây → DELIVERED', async () => {
    const ctx = build({ orders: [{ gomdonPartnerCode: '84850000000055', shippingCode: '84850000000055' }] });
    const data = await process(ctx, DOC_PAYLOAD);
    expect(ctx.prisma.order.findFirst.mock.calls[0][0].where).toEqual({
      hasRecyclingPickup: true,
      OR: [{ gomdonOrderId: '55' }, { gomdonPartnerCode: '84850000000055' }],
    });
    const upd = ctx.prisma.order.updateMany.mock.calls[0][0].data;
    expect(upd.gomdonStatus).toBe('7');
    expect(upd.gomdonStatusAt).toEqual(new Date(1758330000 * 1000));
    expect(ctx.orderStatus.setStatus).toHaveBeenCalledWith('o1', 'DELIVERED', expect.objectContaining({ actorType: 'SYSTEM' }));
    expect(data.status).toBe('PROCESSED');
  });

  it('status 3 cho đơn CONFIRMED → SHIPPING; tracking_link/tracking_url KHÔNG có trong tài liệu → không lưu link tuỳ ý', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonStatus: '1' }] });
    await process(ctx, { order_id: 55, status: 3, tracking_link: 'https://evil.example/BE55', tracking_url: 'https://evil.example/x' });
    expect(ctx.orderStatus.setStatus).toHaveBeenCalledWith('o1', 'SHIPPING', expect.anything());
    expect(ctx.prisma.order.updateMany.mock.calls[0][0].data).not.toHaveProperty('trackingLink');
  });

  it('mã vận đơn đang là id tạm (Gomdon không trả partner_code lúc tạo) → webhook mang order_code thay bằng mã vận đơn thật', async () => {
    const ctx = build({
      orders: [{ status: 'CONFIRMED', gomdonOrderId: '55', gomdonPartnerCode: '55', shippingCode: '55', gomdonStatus: '1' }],
    });
    await process(ctx, { order_id: 55, order_code: 84850000000055, status: 3, created_time: 1758330000 });
    const upd = ctx.prisma.order.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'o1', gomdonStatus: '1' });
    expect(upd.data).toMatchObject({ gomdonPartnerCode: '84850000000055', shippingCode: '84850000000055', gomdonStatus: '3' });
    expect(upd.data.shippingHistory.at(-1)).toMatchObject({ code: '84850000000055' });
  });

  it('đã có mã vận đơn thật → webhook KHÔNG đổi gomdonPartnerCode dù order_code khác', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonStatus: '1' }] });
    await process(ctx, { order_id: 55, order_code: 84850000000099, status: 3 });
    const upd = ctx.prisma.order.updateMany.mock.calls[0][0].data;
    expect(upd.gomdonPartnerCode).toBeUndefined();
    expect(upd.shippingCode).toBeUndefined();
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

  it.each([6, 8])('hàng đang/đã hoàn về kho (%s) → báo động nhóm GOODS_RETURNED (tự đóng khi đơn được huỷ/trả) (R3-CANCEL-3)', async (status) => {
    const ctx = build({ orders: [{ status: 'SHIPPING', gomdonStatus: '3' }] });
    await process(ctx, { order_id: 55, status });
    expect(ctx.alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('xử lý đơn với khách'), 'OPS_GOMDON_ALERT', 'GOODS_RETURNED');
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
    expect(second).toEqual({ code: 'TUBU1001', gomdonAttempt: 0, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null });
    const upd = ctx.prisma.order.updateMany.mock.calls[0][0].data;
    expect(upd).toMatchObject({ gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1', shippingCode: 'BE77' });
    // Tự khớp xong: đóng việc "kiểm tra/tạo vận đơn tay" cũ thay vì thêm một báo động nữa (R2-GOMDON-3).
    expect(ctx.alerts.resolveKinds).toHaveBeenCalledWith('o1', ['WAYBILL_NEEDED']);
    expect(ctx.alerts.alert).not.toHaveBeenCalled();
  });

  it('tự lành cho đơn đã lên Pancake → ghi mã vận đơn vào ghi chú Pancake; Pancake lỗi thì báo ghi tay (R2-GOMDON-1)', async () => {
    const order = { status: 'CONFIRMED', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK', shippingCode: null, pancakeOrderId: 'pk9' };
    const ok = build({ orders: [null, order] });
    await process(ok, { order_id: 77, order_code: 'BE77', order_customer_id: 'TUBU1001', status: 1 });
    expect(ok.pancakeOrder.syncWaybillNote).toHaveBeenCalled();
    expect(ok.alerts.alert).not.toHaveBeenCalled();

    const failing = build({ orders: [null, order] });
    failing.pancakeOrder.syncWaybillNote.mockRejectedValueOnce(new Error('Pancake 503'));
    await process(failing, { order_id: 77, order_code: 'BE77', order_customer_id: 'TUBU1001', status: 1 });
    expect(failing.alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('ghi mã vào ghi chú Pancake'), 'OPS_GOMDON_ALERT', 'WAYBILL_NOTE');
  });

  it('Gomdon xác nhận huỷ (2) cho đơn đã huỷ → đóng các việc huỷ tay/tạo tay còn mở (R2-GOMDON-3)', async () => {
    const ctx = build({ orders: [{ status: 'CANCELLED', gomdonStatus: '1' }] });
    await process(ctx, { order_id: 55, status: 2 });
    expect(ctx.alerts.resolveKinds).toHaveBeenCalledWith('o1', ['CANCEL_NEEDED', 'WAYBILL_NEEDED', 'WAYBILL_NOTE']);
  });

  it('tự lành cho đơn đã CANCELLED → enqueue huỷ vận đơn vừa phát hiện', async () => {
    const ctx = build({
      orders: [null, { status: 'CANCELLED', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK' }],
    });
    await process(ctx, { order_id: 77, order_code: 'BE77', order_customer_id: 'TUBU1001', status: 1 });
    expect(ctx.pushQueue.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, expect.objectContaining({ jobId: 'cancel-o1' }));
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

  it('đơn khớp theo mã BestExpress nhưng CHƯA có id số Gomdon → điền gomdonOrderId từ payload (không chỉ lúc tự lành)', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonOrderId: null, gomdonPartnerCode: 'BE55', gomdonStatus: '1' }] });
    await process(ctx, { order_id: 55, order_code: 'BE55', status: 3 });
    const upd = ctx.prisma.order.updateMany.mock.calls[0][0];
    expect(upd.data).toMatchObject({ gomdonOrderId: '55', gomdonStatus: '3' });
    // Không đổi mã BestExpress đang có.
    expect(upd.data.gomdonPartnerCode).toBeUndefined();
  });

  it('event cũ (bị chặn lùi trạng thái) vẫn điền gomdonOrderId còn thiếu — có guard id đang null', async () => {
    const ctx = build({ orders: [{ status: 'SHIPPING', gomdonOrderId: null, gomdonPartnerCode: 'BE55', gomdonStatus: '5' }] });
    const data = await process(ctx, { order_id: 55, order_code: 'BE55', status: 1 });
    expect(data.status).toBe('IGNORED');
    expect(ctx.prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonOrderId: null },
      data: { gomdonOrderId: '55' },
    });
  });

  it('đơn CANCELLED mà lần huỷ trước FAILED vì thiếu id → điền id rồi xếp lại job huỷ vận đơn', async () => {
    const ctx = build({
      orders: [{ status: 'CANCELLED', gomdonOrderId: null, gomdonPartnerCode: 'BE55', gomdonStatus: '1', gomdonCancelStatus: 'FAILED' }],
    });
    await process(ctx, { order_id: 55, order_code: 'BE55', status: 1, created_time: 1758330000 });
    expect(ctx.prisma.order.updateMany.mock.calls[0][0].data).toMatchObject({ gomdonOrderId: '55' });
    expect(ctx.pushQueue.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, expect.objectContaining({ jobId: 'cancel-o1' }));
  });

  it('đã có id số → không ghi đè id, không xếp job huỷ thừa', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonStatus: '1' }] });
    await process(ctx, { order_id: 55, order_code: 'BE55', status: 3 });
    expect(ctx.prisma.order.updateMany.mock.calls[0][0].data.gomdonOrderId).toBeUndefined();
    expect(ctx.pushQueue.add).not.toHaveBeenCalled();
  });

  it('tự lành cho đơn đã đánh dấu "Đã xử lý tay" → báo kiểm tra trùng vận đơn', async () => {
    const ctx = build({
      orders: [null, { status: 'CONFIRMED', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'MANUAL_HANDLED', shippingCode: null }],
    });
    await process(ctx, { order_id: 77, order_code: 'BE77', order_customer_id: 'TUBU1001', status: 1 });
    expect(ctx.alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('tránh giao trùng'));
  });

  it('2 webhook song song: updateMany guard theo gomdonStatus thua (count=0) → ném để xử lý lại', async () => {
    const ctx = build();
    ctx.prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });
    ctx.prisma.gomdonWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'ev1', status: 'RECEIVED', rawPayload: { order_id: 55, status: 7 } });
    await expect(ctx.svc.processEvent('ev1')).rejects.toThrow('vừa đổi');
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
  });
});

describe('UAT GOMDON-6: payload webhook không đọc được không được trả 200 rồi mất', () => {
  it('token hợp lệ mà body rỗng / thiếu status → 400 (Gomdon gửi lại) + báo động kèm Content-Type, KHÔNG lưu event', async () => {
    const ctx = build();
    await expect(ctx.svc.receive({}, { contentType: 'multipart/form-data; boundary=x' })).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.gomdonWebhookEvent.create).not.toHaveBeenCalled();
    expect(ctx.alerts.alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('multipart/form-data'));

    await expect(
      ctx.svc.receive({ order_id: 9029, order_customer_id: 'TUBU1' } as GomdonWebhookPayload, { contentType: 'text/plain' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.alerts.alert).toHaveBeenLastCalledWith('TUBU1', expect.stringContaining('order_customer_id'));
  });

  it('báo động payload hỏng không dội liên tục (cùng Content-Type trong 10 phút chỉ báo 1 lần)', async () => {
    const ctx = build();
    for (let i = 0; i < 3; i++) await ctx.svc.receive({}, { contentType: 'text/xml' }).catch(() => undefined);
    expect(ctx.alerts.alert).toHaveBeenCalledTimes(1);
  });
});

describe('UAT GOMDON-8: webhook của vận đơn tạo lại mang order_customer_id `${code}-R${n}`', () => {
  it('đối chiếu chéo nhận mã có hậu tố lần tạo lại', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonStatus: '1', gomdonAttempt: 1 }] });
    const data = await process(ctx, { order_id: 55, order_code: 'BE55', order_customer_id: 'TUBU1001-R1', status: 3 });
    expect(data.status).toBe('PROCESSED');
  });

  it('tự lành theo mã có hậu tố → khớp đơn gốc ĐÚNG lần tạo hiện tại', async () => {
    const ctx = build({
      orders: [null, { status: 'CONFIRMED', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK', gomdonAttempt: 2, shippingCode: null }],
    });
    await process(ctx, { order_id: 78, order_code: 'BE78', order_customer_id: 'TUBU1001-R2', status: 1 });
    expect(ctx.prisma.order.findFirst.mock.calls[1][0].where).toEqual({
      code: 'TUBU1001',
      gomdonAttempt: 2,
      hasRecyclingPickup: true,
      gomdonOrderId: null,
      gomdonPartnerCode: null,
    });
    expect(ctx.prisma.order.updateMany.mock.calls[0][0].data).toMatchObject({ gomdonOrderId: '78', gomdonPartnerCode: 'BE78' });
  });

  it('mã đơn khác hẳn (không phải mã gốc + hậu tố) → vẫn bỏ qua', async () => {
    const ctx = build();
    const data = await process(ctx, { order_id: 55, order_customer_id: 'TUBU10011-R1', status: 7 });
    expect(data.status).toBe('IGNORED');
  });
});

describe('W168: chống trùng theo event_id (tài liệu: event_id giữ nguyên qua các lần gửi lại)', () => {
  const withEvent = { order_id: 55, order_code: 'BE55', order_customer_id: 'TUBU1001', status: 7, created_time: 1758330000, event_id: '6f1c2a9e-0001' };

  it('payload có event_id → dedupeKey = event:<event_id>, rawPayload giữ nguyên event_id', async () => {
    const ctx = build();
    await ctx.svc.receive(withEvent);
    const data = ctx.prisma.gomdonWebhookEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ dedupeKey: 'event:6f1c2a9e-0001', gomdonOrderId: '55', gomdonStatus: 7 });
    expect(data.rawPayload).toMatchObject({ event_id: '6f1c2a9e-0001' });
  });

  it('cùng event_id gửi lại dù created_time/trường khác đổi → cùng khoá; event_id khác → khoá khác', () => {
    const key = (p: GomdonWebhookPayload) => gomdonDedupeKey(parseGomdonPayload(p), p);
    expect(key({ ...withEvent, created_time: 1758339999, reason: 'gửi lại' })).toBe(key(withEvent));
    expect(key({ ...withEvent, event_id: '6f1c2a9e-0002' })).not.toBe(key(withEvent));
    expect(key(withEvent)).toBe('event:6f1c2a9e-0001');
  });

  it('không có event_id (hoặc rỗng) → vẫn khoá cũ order_id|status|created_time', () => {
    for (const event_id of [undefined, '', '  ']) {
      const p = { ...withEvent, event_id } as GomdonWebhookPayload;
      expect(gomdonDedupeKey(parseGomdonPayload(p), p)).toBe('55|7|1758330000');
    }
  });

  it('Gomdon gửi lại event_id đã PROCESSED (P2002) → duplicate, KHÔNG enqueue lại', async () => {
    const ctx = build();
    ctx.prisma.gomdonWebhookEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    ctx.prisma.gomdonWebhookEvent.findUnique.mockResolvedValueOnce({ id: 'ev0', status: 'PROCESSED' });
    await expect(ctx.svc.receive({ ...withEvent, created_time: 1758339999 })).resolves.toEqual({ result: true, duplicate: true });
    expect(ctx.prisma.gomdonWebhookEvent.findUnique).toHaveBeenCalledWith({ where: { dedupeKey: 'event:6f1c2a9e-0001' } });
    expect(ctx.eventsQueue.add).not.toHaveBeenCalled();
  });

  it('khoá event_id dài bất thường vẫn được cắt ≤ 255 ký tự', () => {
    const p = { ...withEvent, event_id: 'x'.repeat(400) };
    expect(gomdonDedupeKey(parseGomdonPayload(p), p).length).toBe(255);
  });
});

describe('W168: sự kiện created_time cũ hơn không ghi đè trạng thái mới hơn', () => {
  const T = Date.parse('2026-09-20T01:00:00Z') / 1000; // = gomdonStatusAt của recyclingOrder (đang '5')

  it('đang 5 lúc T, webhook 3 (bậc thấp hơn) tới trễ dù created_time MỚI hơn → bỏ qua, không ghi gì', async () => {
    const ctx = build();
    const data = await process(ctx, { order_id: 55, status: 3, created_time: T + 600 });
    expect(ctx.prisma.order.updateMany).not.toHaveBeenCalled();
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
    expect(data.status).toBe('IGNORED');
  });

  it('cùng bậc 5 ↔ 11: created_time cũ hơn mốc lưu → bỏ qua; mới hơn → ghi đè', async () => {
    const older = build();
    expect((await process(older, { order_id: 55, status: 11, created_time: T - 1 })).status).toBe('IGNORED');
    expect(older.prisma.order.updateMany).not.toHaveBeenCalled();

    const newer = build();
    expect((await process(newer, { order_id: 55, status: 11, created_time: T + 1 })).status).toBe('PROCESSED');
    expect(newer.prisma.order.updateMany.mock.calls[0][0].data).toMatchObject({
      gomdonStatus: '11',
      gomdonStatusAt: new Date((T + 1) * 1000),
    });
  });

  it('mốc cuối (7) không bị ghi đè bởi sự kiện nào về sau, dù created_time mới hơn', async () => {
    for (const status of [3, 5, 6, 11]) {
      const ctx = build({ orders: [{ status: 'DELIVERED', gomdonStatus: '7' }] });
      expect((await process(ctx, { order_id: 55, status, created_time: T + 10_000 })).status).toBe('IGNORED');
      expect(ctx.prisma.order.updateMany).not.toHaveBeenCalled();
    }
  });

  it('gửi lại cùng trạng thái với created_time cũ → không ghi lại lịch sử hành trình / mốc thời gian', async () => {
    const ctx = build();
    await process(ctx, { order_id: 55, status: 5, created_time: T - 3600 });
    expect(ctx.prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('chuỗi sai thứ tự: 7 tới TRƯỚC 5 → đơn giao xong, sự kiện 5 tới sau bị bỏ, không về lại SHIPPING', async () => {
    const delivered = build({ orders: [{ status: 'SHIPPING', gomdonStatus: '5' }] });
    await process(delivered, { order_id: 55, status: 7, created_time: T + 500, event_id: 'e7' });
    expect(delivered.orderStatus.setStatus).toHaveBeenCalledWith('o1', 'DELIVERED', expect.anything());

    const late = build({ orders: [{ status: 'DELIVERED', gomdonStatus: '7' }] });
    expect((await process(late, { order_id: 55, status: 5, created_time: T + 100, event_id: 'e5' })).status).toBe('IGNORED');
    expect(late.orderStatus.setStatus).not.toHaveBeenCalled();
  });
});

describe('W168: khớp đơn khi Gomdon create chưa trả partner_code (đơn chỉ có id số)', () => {
  // Trạng thái sau pushOrder: partner_code vắng (hoặc đơn được nhận lại qua duplicate:true) → mã tạm = id số.
  const tempCodeOrder = {
    status: 'CONFIRMED',
    gomdonOrderId: '1517251',
    gomdonPartnerCode: '1517251',
    shippingCode: '1517251',
    gomdonStatus: '1',
    gomdonStatusAt: new Date('2026-11-15T01:00:00Z'),
  };

  it('webhook mang order_id + order_code + order_customer_id → khớp theo order_id, nâng mã tạm lên mã hãng (order_code)', async () => {
    const ctx = build({ orders: [tempCodeOrder] });
    const data = await process(ctx, {
      event_id: 'ev-a',
      status: 3,
      order_id: 1517251,
      order_code: '84856413835159',
      order_customer_id: 'TUBU1001',
      created_time: Date.parse('2026-11-15T02:00:00Z') / 1000,
    });
    expect(data.status).toBe('PROCESSED');
    expect(ctx.prisma.order.findFirst.mock.calls[0][0].where).toEqual({
      hasRecyclingPickup: true,
      OR: [{ gomdonOrderId: '1517251' }, { gomdonPartnerCode: '84856413835159' }],
    });
    const upd = ctx.prisma.order.updateMany.mock.calls[0][0].data;
    expect(upd).toMatchObject({ gomdonPartnerCode: '84856413835159', shippingCode: '84856413835159', gomdonStatus: '3' });
    expect(upd.gomdonOrderId).toBeUndefined(); // id số đã có, không ghi đè
  });

  it('sự kiện đầu (status 1) chưa có order_code → giữ mã tạm; sự kiện sau mang order_code mới nâng mã', async () => {
    const first = build({ orders: [tempCodeOrder] });
    await process(first, { event_id: 'ev-1', status: 1, order_id: 1517251, order_customer_id: 'TUBU1001', created_time: 1763168400 });
    const firstData = first.prisma.order.updateMany.mock.calls[0]?.[0]?.data ?? {};
    expect(firstData.gomdonPartnerCode).toBeUndefined();

    const second = build({ orders: [tempCodeOrder] });
    await process(second, { event_id: 'ev-2', status: 3, order_id: 1517251, order_code: '84856413835159', order_customer_id: 'TUBU1001', created_time: 1763172000 });
    expect(second.prisma.order.updateMany.mock.calls[0][0].data.gomdonPartnerCode).toBe('84856413835159');
  });

  it('chỉ có order_code (không order_id) khớp đơn đã lưu mã hãng thật', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonStatus: '1' }] });
    await process(ctx, { event_id: 'ev-c', status: 3, order_code: 'BE55', order_customer_id: 'TUBU1001', created_time: 1763172000 });
    expect(ctx.prisma.order.findFirst.mock.calls[0][0].where).toEqual({ hasRecyclingPickup: true, OR: [{ gomdonPartnerCode: 'BE55' }] });
    expect(ctx.prisma.order.updateMany.mock.calls[0][0].data).toMatchObject({ gomdonStatus: '3' });
  });

  it('order_customer_id vẫn khớp đơn chưa có mã nào (create mất response) và điền cả id lẫn mã hãng', async () => {
    const ctx = build({
      orders: [null, { status: 'CONFIRMED', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK', shippingCode: null, gomdonAttempt: 0 }],
    });
    const data = await process(ctx, { event_id: 'ev-d', status: 3, order_id: 1517251, order_code: '84856413835159', order_customer_id: 'TUBU1001', created_time: 1763172000 });
    expect(data.status).toBe('PROCESSED');
    expect(ctx.prisma.order.updateMany.mock.calls[0][0].data).toMatchObject({ gomdonOrderId: '1517251', gomdonPartnerCode: '84856413835159' });
  });
describe('GomdonWebhookService — phiếu shipper lấy rác tận nhà (WR-)', () => {
  const wasteRow = { id: 'r1', code: 'TR-AAAAA', gomdonOrderId: '900', gomdonPartnerCode: 'BE900', gomdonStatus: '1', status: 'OPEN' };

  it('order_customer_id WR-<mã> khớp phiếu: đi đường phiếu thu gom, KHÔNG chạm bảng đơn mua hàng', async () => {
    const ctx = build();
    ctx.prisma.wasteRequest.findFirst.mockResolvedValueOnce(wasteRow);
    const data = await process(ctx, { event_id: 'w1', status: 3, order_id: 900, order_code: 'BE900', order_customer_id: 'WR-TR-AAAAA', created_time: 1763172000 });
    expect(data.status).toBe('PROCESSED');
    expect(ctx.wasteHomePickup.applyWebhook).toHaveBeenCalledWith(wasteRow, expect.objectContaining({ status: 3, gomdonOrderId: '900', partnerCode: 'BE900', eventTime: new Date(1763172000 * 1000) }));
    expect(ctx.prisma.order.findFirst).not.toHaveBeenCalled();
    expect(ctx.prisma.order.updateMany).not.toHaveBeenCalled();
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
  });

  it('khớp theo id/mã vận đơn đã lưu trước, rồi mới theo mã WR- (create mất phản hồi); chỉ nhận HOME_PICKUP', async () => {
    const ctx = build();
    ctx.prisma.wasteRequest.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...wasteRow, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    await process(ctx, { event_id: 'w2', status: 3, order_id: 900, order_code: 'BE900', order_customer_id: 'WR-TR-AAAAA', created_time: 1763172000 });
    const [first, second] = ctx.prisma.wasteRequest.findFirst.mock.calls.map((c) => c[0].where);
    expect(first).toEqual({ method: 'HOME_PICKUP', OR: [{ gomdonOrderId: '900' }, { gomdonPartnerCode: 'BE900' }] });
    expect(second).toEqual({ method: 'HOME_PICKUP', code: 'TR-AAAAA' });
    expect(ctx.wasteHomePickup.applyWebhook).toHaveBeenCalledTimes(1);
  });

  it('order_customer_id lệch mã phiếu đã khớp theo id: bỏ qua, không áp trạng thái', async () => {
    const ctx = build();
    ctx.prisma.wasteRequest.findFirst.mockResolvedValueOnce(wasteRow);
    const data = await process(ctx, { event_id: 'w3', status: 3, order_id: 900, order_code: 'BE900', order_customer_id: 'WR-TR-ZZZZZ', created_time: 1763172000 });
    expect(data.status).toBe('IGNORED');
    expect(ctx.wasteHomePickup.applyWebhook).not.toHaveBeenCalled();
  });

  it('service báo IGNORED (trùng/stale/đã đóng): event ghi IGNORED kèm lý do', async () => {
    const ctx = build();
    ctx.prisma.wasteRequest.findFirst.mockResolvedValueOnce(wasteRow);
    ctx.wasteHomePickup.applyWebhook.mockResolvedValueOnce({ outcome: 'IGNORED', reason: 'trùng trạng thái 3' });
    const data = await process(ctx, { event_id: 'w4', status: 3, order_id: 900, order_code: 'BE900', order_customer_id: 'WR-TR-AAAAA', created_time: 1763172000 });
    expect(data.status).toBe('IGNORED');
    expect(ctx.alerts.alert).not.toHaveBeenCalled();
  });

  it('trạng thái cần người xem (vd 8/9/11) kèm alert: báo CSKH theo mã WR-', async () => {
    const ctx = build();
    ctx.prisma.wasteRequest.findFirst.mockResolvedValueOnce(wasteRow);
    ctx.wasteHomePickup.applyWebhook.mockResolvedValueOnce({ outcome: 'PROCESSED', alert: 'Phiếu TR-AAAAA bị hoàn hàng' });
    await process(ctx, { event_id: 'w5', status: 8, order_id: 900, order_code: 'BE900', order_customer_id: 'WR-TR-AAAAA', created_time: 1763172000 });
    expect(ctx.alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', 'Phiếu TR-AAAAA bị hoàn hàng');
  });

  it('mã WR- không có phiếu nào: không rơi nhầm xuống đơn mua hàng, ghi IGNORED', async () => {
    const ctx = build({ orders: [null] });
    const data = await process(ctx, { event_id: 'w6', status: 3, order_id: 901, order_code: 'BE901', order_customer_id: 'WR-TR-NONE1', created_time: 1763172000 });
    expect(data.status).toBe('IGNORED');
    expect(ctx.wasteHomePickup.applyWebhook).not.toHaveBeenCalled();
    expect(ctx.orderStatus.setStatus).not.toHaveBeenCalled();
  });

  it('webhook của đơn mua hàng thường (TUBU...) vẫn đi đường cũ khi không khớp phiếu thu gom', async () => {
    const ctx = build({ orders: [{ status: 'CONFIRMED', gomdonStatus: '1' }] });
    await process(ctx, { event_id: 'w7', status: 3, order_id: 55, order_code: 'BE55', order_customer_id: 'TUBU1001', created_time: 1763172000 });
    expect(ctx.wasteHomePickup.applyWebhook).not.toHaveBeenCalled();
    expect(ctx.prisma.order.updateMany).toHaveBeenCalled();
  });
});
});
