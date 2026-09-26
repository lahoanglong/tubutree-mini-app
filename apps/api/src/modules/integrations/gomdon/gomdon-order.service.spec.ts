import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UnrecoverableError, type Queue } from 'bullmq';
import { GomdonOrderService } from './gomdon-order.service';
import { GomdonAmbiguousError, GomdonRejectedError } from './gomdon.errors';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { GomdonClient } from './gomdon.client';
import type { PancakeOrderService } from '../pancake/pancake-order.service';
import type { GomdonAlertService } from './gomdon-alert.service';

const baseOrder = {
  id: 'o1',
  code: 'TUBU1001',
  status: 'CONFIRMED',
  total: 250000,
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  hasRecyclingPickup: true,
  recyclingNote: 'Túi nilong + pin',
  gomdonPartnerCode: null as string | null,
  gomdonOrderId: null as string | null,
  gomdonStatus: null as string | null,
  gomdonCancelStatus: null as string | null,
  pancakeOrderId: null as string | null,
  shippingHistory: null,
  shippingAddress: {
    recipient: 'Nguyễn Văn A',
    phone: '0912345678',
    street: '123 Nguyễn Huệ',
    ward: 'Phường Bến Nghé',
    district: '',
    province: 'Thành phố Hồ Chí Minh',
  },
  items: [{ id: 'i1', variationId: 'v1', productName: 'Nước giặt', variationName: 'Can 2L', quantity: 2 }],
};

function build(order: Record<string, unknown> = {}, opts: { configured?: boolean; updateMany?: jest.Mock } = {}) {
  const o = { ...baseOrder, ...order };
  const updateMany = opts.updateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    order: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(o),
      findUnique: jest.fn().mockResolvedValue(o),
      updateMany,
    },
    variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', weight: 1200 }]) },
  };
  const client = {
    isConfigured: jest.fn().mockResolvedValue(opts.configured ?? true),
    isRecyclingEnabled: jest.fn().mockResolvedValue(true),
    getConfig: jest.fn().mockResolvedValue({
      baseUrl: 'https://gomdon.test',
      phone: 'p',
      password: 'x',
      defaultWarehouse: { name: 'Kho', phone: '09', address: 'A', ward: 'W', district: 'D', province: 'P' },
      defaultWeightFallback: 500,
    }),
    createOrder: jest.fn().mockResolvedValue({ result: true, data: { id: 77, partner_code: 'BE77', status: 1 } }),
    cancelOrder: jest.fn().mockResolvedValue({ ok: true }),
  };
  const queue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) };
  const pancake = { enqueuePush: jest.fn().mockResolvedValue(undefined) };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
  const svc = new GomdonOrderService(
    prisma as unknown as PrismaService,
    client as unknown as GomdonClient,
    queue as unknown as Queue,
    pancake as unknown as PancakeOrderService,
    alerts as unknown as GomdonAlertService,
  );
  (svc as unknown as { persistRetryDelayMs: number }).persistRetryDelayMs = 0;
  return { svc, prisma, client, queue, pancake, alerts, updateMany };
}

/** Tìm lần updateMany ghi gomdonStatus = value. */
const wroteStatus = (updateMany: jest.Mock, value: string) =>
  updateMany.mock.calls.some(([args]) => args?.data?.gomdonStatus === value);

describe('GomdonOrderService.pushOrder', () => {
  it('đơn không thu gom → chỉ đẩy Pancake', async () => {
    const { svc, client, pancake } = build({ hasRecyclingPickup: false });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(pancake.enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('đã có mã vận đơn → không tạo lại, đảm bảo Pancake', async () => {
    const { svc, client, pancake } = build({ gomdonPartnerCode: 'BE1', gomdonOrderId: '1', gomdonStatus: '1' });
    expect(await svc.pushOrder('o1')).toBe('BE1');
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(pancake.enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('đơn đã CANCELLED (khách huỷ trong lúc job đang backoff) → không đặt bưu tá, không đẩy Pancake', async () => {
    const { svc, client, pancake } = build({ status: 'CANCELLED' });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(pancake.enqueuePush).not.toHaveBeenCalled();
  });

  it('BANK_TRANSFER chưa thanh toán → AWAITING_PAYMENT, đẩy Pancake để đối soát, KHÔNG tạo vận đơn', async () => {
    const { svc, client, pancake, updateMany } = build({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonStatus: null },
      data: { gomdonStatus: 'AWAITING_PAYMENT' },
    });
    expect(pancake.enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('ZALOPAY chưa thanh toán cũng không tạo vận đơn', async () => {
    const { svc, client } = build({ paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' });
    await svc.pushOrder('o1');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('chưa cấu hình Gomdon → NOT_CONFIGURED + Pancake (tạo tay)', async () => {
    const { svc, client, pancake, updateMany } = build({}, { configured: false });
    await svc.pushOrder('o1');
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(wroteStatus(updateMany, 'NOT_CONFIGURED')).toBe(true);
    expect(pancake.enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('COD: claim CREATING nguyên tử → tạo vận đơn (collect = total) → ghi mã → đẩy Pancake', async () => {
    const { svc, client, pancake, updateMany } = build();
    expect(await svc.pushOrder('o1')).toBe('BE77');

    const claim = updateMany.mock.calls[0][0];
    expect(claim.data).toEqual({ gomdonStatus: 'CREATING' });
    expect(claim.where).toMatchObject({ id: 'o1', gomdonOrderId: null, gomdonPartnerCode: null });
    // Claim chạy TRƯỚC khi gọi API tạo đơn.
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(client.createOrder.mock.invocationCallOrder[0]!);

    const sent = client.createOrder.mock.calls[0][0];
    expect(sent).toMatchObject({ type: 3, pickup_type: 2, order_customer_id: 'TUBU1001', collect_amount: 250000, weight: 2400 });
    expect(sent.note).toContain('Tối đa 2.4kg');
    expect(sent.dest_district).toBe('Phường Bến Nghé'); // hệ 2 cấp: quận rỗng → dùng phường

    const persist = updateMany.mock.calls[1][0];
    expect(persist.where).toEqual({ id: 'o1', gomdonStatus: 'CREATING' });
    expect(persist.data).toMatchObject({
      gomdonOrderId: '77',
      gomdonPartnerCode: 'BE77',
      gomdonStatus: '1',
      shippingCode: 'BE77',
      shippingPartner: 'BestExpress',
    });
    expect(persist.data.shippingHistory).toHaveLength(1);
    expect(pancake.enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('WALLET đã thanh toán → collect_amount = 0', async () => {
    const { svc, client } = build({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
    await svc.pushOrder('o1');
    expect(client.createOrder.mock.calls[0][0].collect_amount).toBe(0);
  });

  it('chuyển khoản đã PAID (AWAITING_PAYMENT → tạo) và Pancake đã có đơn → tạo vận đơn + báo CSKH ghi mã vào Pancake', async () => {
    const { svc, client, pancake, alerts } = build({
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      gomdonStatus: 'AWAITING_PAYMENT',
      pancakeOrderId: 'pk1',
    });
    const findUnique = jest.fn().mockResolvedValue({ status: 'CONFIRMED', pancakeOrderId: 'pk1' });
    (svc as unknown as { prisma: { order: { findUnique: jest.Mock } } }).prisma.order.findUnique = findUnique;
    expect(await svc.pushOrder('o1')).toBe('BE77');
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(pancake.enqueuePush).not.toHaveBeenCalled();
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('BE77'));
  });

  it('claim thua (count=0, worker khác đang tạo) → KHÔNG gọi tạo đơn', async () => {
    const { svc, client } = build({}, { updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('CREATING vừa được claim (tiến trình khác đang gọi Gomdon) → bỏ qua, KHÔNG báo CSKH, KHÔNG đẩy Pancake sớm', async () => {
    const { svc, client, pancake, alerts, updateMany } = build({
      gomdonStatus: 'CREATING',
      updatedAt: new Date(Date.now() - 10_000),
    });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(wroteStatus(updateMany, 'NEEDS_MANUAL_CHECK')).toBe(false);
    expect(pancake.enqueuePush).not.toHaveBeenCalled();
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('retry thấy CREATING mà chưa có mã (lần trước crash/timeout) → NEEDS_MANUAL_CHECK, KHÔNG tạo lại', async () => {
    const { svc, client, pancake, alerts, updateMany } = build({
      gomdonStatus: 'CREATING',
      updatedAt: new Date(Date.now() - 10 * 60_000),
    });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'CREATING' },
      data: { gomdonStatus: 'NEEDS_MANUAL_CHECK' },
    });
    expect(pancake.enqueuePush).toHaveBeenCalledWith('o1');
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('KIỂM TRA GOMDON'));
  });

  it('tạo xong nhưng claim đã bị chuyển NEEDS_MANUAL_CHECK (lần chạy chồng) → vẫn ghi ĐỦ mã + trạng thái thật', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // claim CREATING
      .mockResolvedValueOnce({ count: 0 }) // persist: không còn CREATING
      .mockResolvedValueOnce({ count: 1 }); // phục hồi từ NEEDS_MANUAL_CHECK
    const { svc } = build({}, { updateMany });
    expect(await svc.pushOrder('o1')).toBe('BE77');
    const recover = updateMany.mock.calls[2][0];
    expect(recover.where).toEqual({
      id: 'o1',
      gomdonOrderId: null,
      gomdonPartnerCode: null,
      gomdonStatus: 'NEEDS_MANUAL_CHECK',
    });
    expect(recover.data).toMatchObject({ gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1', shippingCode: 'BE77' });
    // Đã phục hồi đủ → không cần nhánh chỉ-ghi-mã.
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it('trạng thái đã chốt FAILED/NEEDS_MANUAL_CHECK → không tự tạo thêm', async () => {
    for (const s of ['FAILED', 'NEEDS_MANUAL_CHECK', 'NOT_CONFIGURED']) {
      const { svc, client } = build({ gomdonStatus: s });
      await svc.pushOrder('o1');
      expect(client.createOrder).not.toHaveBeenCalled();
    }
  });

  it('Gomdon từ chối chắc chắn → nhả claim về null và ném để BullMQ retry', async () => {
    const { svc, client, updateMany } = build();
    client.createOrder.mockRejectedValueOnce(new GomdonRejectedError('Sai địa chỉ'));
    await expect(svc.pushOrder('o1')).rejects.toBeInstanceOf(GomdonRejectedError);
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 'o1', gomdonStatus: 'CREATING' }, data: { gomdonStatus: null } });
  });

  it('kết quả KHÔNG RÕ (timeout) → NEEDS_MANUAL_CHECK + Pancake + báo CSKH, KHÔNG ném (không retry tạo trùng)', async () => {
    const { svc, client, pancake, alerts, updateMany } = build();
    client.createOrder.mockRejectedValueOnce(new GomdonAmbiguousError('timeout'));
    await expect(svc.pushOrder('o1')).resolves.toBeNull();
    expect(wroteStatus(updateMany, 'NEEDS_MANUAL_CHECK')).toBe(true);
    expect(pancake.enqueuePush).toHaveBeenCalledWith('o1');
    expect(alerts.alert).toHaveBeenCalled();
  });

  it('tạo thành công nhưng thiếu mã vận đơn → NEEDS_MANUAL_CHECK (không ném → không retry tạo trùng)', async () => {
    const { svc, client, updateMany } = build();
    client.createOrder.mockResolvedValueOnce({ result: true, data: {} });
    await expect(svc.pushOrder('o1')).resolves.toBeNull();
    expect(wroteStatus(updateMany, 'NEEDS_MANUAL_CHECK')).toBe(true);
  });

  it('tạo xong mà KHÔNG ghi được DB (3 lần) → UnrecoverableError (BullMQ không retry tạo lại)', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockRejectedValue(new Error('db down'));
    const { svc, client } = build({}, { updateMany });
    await expect(svc.pushOrder('o1')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(4); // claim + 3 lần ghi
  });

  it('đơn bị huỷ TRONG LÚC tạo vận đơn → vẫn lưu mã + enqueue huỷ vận đơn, không đẩy Pancake', async () => {
    const { svc, prisma, queue, pancake } = build();
    prisma.order.findUnique.mockResolvedValueOnce({ status: 'CANCELLED', pancakeOrderId: null });
    expect(await svc.pushOrder('o1')).toBe('BE77');
    expect(queue.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, { jobId: 'cancel-o1' });
    expect(pancake.enqueuePush).not.toHaveBeenCalled();
  });
});

describe('GomdonOrderService.markFinalPushFailure (fail-safe hết lượt retry)', () => {
  it('chắc chắn chưa tạo → FAILED + Pancake + báo CSKH tạo tay', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const { svc, pancake, alerts } = build({}, { updateMany });
    await svc.markFinalPushFailure('o1', new Error('Sai địa chỉ'));
    expect(updateMany.mock.calls[1][0].data).toEqual({ gomdonStatus: 'FAILED' });
    expect(pancake.enqueuePush).toHaveBeenCalledWith('o1');
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('TẠO VẬN ĐƠN TAY'));
  });

  it('đơn đã huỷ → không đẩy Pancake', async () => {
    const { svc, pancake } = build({ status: 'CANCELLED' });
    await svc.markFinalPushFailure('o1', new Error('x'));
    expect(pancake.enqueuePush).not.toHaveBeenCalled();
  });

  it('DB lỗi → ném tiếp (job kết thúc failed, cron chạy lại được)', async () => {
    const { svc } = build({}, { updateMany: jest.fn().mockRejectedValue(new Error('db down')) });
    await expect(svc.markFinalPushFailure('o1', new Error('x'))).rejects.toThrow('db down');
  });
});

describe('GomdonOrderService.cancelOnGomdon', () => {
  const cancelled = { status: 'CANCELLED', gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1' };

  it('đơn CANCELLED có vận đơn chưa lấy hàng → gọi cancelOrder + ghi CANCELLED', async () => {
    const { svc, client, updateMany } = build(cancelled);
    await svc.cancelOnGomdon('o1', false);
    expect(client.cancelOrder).toHaveBeenCalledWith('77');
    expect(updateMany.mock.calls[0][0].data).toEqual({ gomdonCancelStatus: 'CANCELLED' });
  });

  it('bưu tá đã lấy hàng → TOO_LATE + báo CSKH, không gọi API', async () => {
    const { svc, client, alerts, updateMany } = build({ ...cancelled, gomdonStatus: '3' });
    await svc.cancelOnGomdon('o1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0][0].data).toEqual({ gomdonCancelStatus: 'TOO_LATE' });
    expect(alerts.alert).toHaveBeenCalled();
  });

  it('đã huỷ xong trước đó → no-op', async () => {
    const { svc, client } = build({ ...cancelled, gomdonCancelStatus: 'CANCELLED' });
    await svc.cancelOnGomdon('o1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });

  it('không có vận đơn → NOT_NEEDED', async () => {
    const { svc, client, updateMany } = build({ status: 'CANCELLED', gomdonStatus: 'FAILED' });
    await svc.cancelOnGomdon('o1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0][0].data).toEqual({ gomdonCancelStatus: 'NOT_NEEDED' });
  });

  it('vận đơn đang tạo (CREATING còn trong lease) → ném để retry sau', async () => {
    const { svc } = build({ status: 'CANCELLED', gomdonStatus: 'CREATING', updatedAt: new Date() });
    await expect(svc.cancelOnGomdon('o1', false)).rejects.toThrow('đang được tạo');
  });

  it('CREATING quá lease (tiến trình tạo đã chết) → NEEDS_MANUAL_CHECK + FAILED + báo huỷ tay, không ném', async () => {
    const { svc, client, alerts, updateMany } = build({
      status: 'CANCELLED',
      gomdonStatus: 'CREATING',
      updatedAt: new Date(Date.now() - 40 * 60_000),
    });
    await expect(svc.cancelOnGomdon('o1', false)).resolves.toBeUndefined();
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0][0].data).toEqual({ gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    expect(updateMany.mock.calls[1][0].data).toEqual({ gomdonCancelStatus: 'FAILED' });
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('kiểm tra & huỷ tay'));
  });

  it('đơn huỷ SAU khi đã "Đã xử lý tay" → mở lại NEEDS_MANUAL_CHECK + FAILED + báo kiểm tra vận đơn tay, không gọi API', async () => {
    const { svc, client, alerts, updateMany } = build({
      status: 'CANCELLED',
      gomdonStatus: 'MANUAL_HANDLED',
      gomdonOrderId: '77',
      gomdonPartnerCode: 'BE77',
    });
    await svc.cancelOnGomdon('o1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'o1', gomdonStatus: 'MANUAL_HANDLED' },
      data: { gomdonStatus: 'NEEDS_MANUAL_CHECK' },
    });
    expect(updateMany.mock.calls[1][0].data).toEqual({ gomdonCancelStatus: 'FAILED' });
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('BE77'));
  });

  it('Gomdon từ chối huỷ: lần giữa ném (retry); lần cuối → FAILED + báo CSKH', async () => {
    const a = build(cancelled);
    a.client.cancelOrder.mockResolvedValue({ ok: false, message: 'không huỷ được' });
    await expect(a.svc.cancelOnGomdon('o1', false)).rejects.toThrow('không huỷ được');

    const b = build(cancelled);
    b.client.cancelOrder.mockRejectedValue(new Error('timeout'));
    await b.svc.cancelOnGomdon('o1', true);
    expect(b.updateMany.mock.calls[0][0].data).toEqual({ gomdonCancelStatus: 'FAILED' });
    expect(b.alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('huỷ tay'));
  });

  it('đơn không còn CANCELLED → bỏ qua', async () => {
    const { svc, client } = build({ ...cancelled, status: 'CONFIRMED' });
    await svc.cancelOnGomdon('o1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });

  it('vận đơn CHỈ có mã BestExpress (thiếu id số Gomdon) → FAILED + báo huỷ tay kèm mã, KHÔNG BAO GIỜ NOT_NEEDED', async () => {
    const { svc, client, alerts, updateMany } = build({ status: 'CANCELLED', gomdonOrderId: null, gomdonPartnerCode: 'BE77', gomdonStatus: '1' });
    await svc.cancelOnGomdon('o1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
    const written = updateMany.mock.calls.map(([a]) => a.data.gomdonCancelStatus);
    expect(written).toEqual(['FAILED']);
    expect(written).not.toContain('NOT_NEEDED');
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('BE77'));
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringMatching(/huỷ tay/i));
  });

  it('chỉ có mã BestExpress nhưng Gomdon đã báo huỷ (2) / bưu tá đã lấy (3) → CANCELLED / TOO_LATE như vận đơn thường', async () => {
    const a = build({ status: 'CANCELLED', gomdonOrderId: null, gomdonPartnerCode: 'BE77', gomdonStatus: '2' });
    await a.svc.cancelOnGomdon('o1', false);
    expect(a.updateMany.mock.calls[0][0].data).toEqual({ gomdonCancelStatus: 'CANCELLED' });
    const b = build({ status: 'CANCELLED', gomdonOrderId: null, gomdonPartnerCode: 'BE77', gomdonStatus: '3' });
    await b.svc.cancelOnGomdon('o1', false);
    expect(b.updateMany.mock.calls[0][0].data).toEqual({ gomdonCancelStatus: 'TOO_LATE' });
    expect(b.client.cancelOrder).not.toHaveBeenCalled();
  });

  it('NEEDS_MANUAL_CHECK chưa có mã → FAILED + báo 1 lần (lần chạy lại khi đã FAILED không báo trùng)', async () => {
    const a = build({ status: 'CANCELLED', gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    await a.svc.cancelOnGomdon('o1', false);
    expect(a.updateMany.mock.calls[0][0].data).toEqual({ gomdonCancelStatus: 'FAILED' });
    expect(a.alerts.alert).toHaveBeenCalledTimes(1);
    const b = build({ status: 'CANCELLED', gomdonStatus: 'NEEDS_MANUAL_CHECK', gomdonCancelStatus: 'FAILED' });
    await b.svc.cancelOnGomdon('o1', false);
    expect(b.alerts.alert).not.toHaveBeenCalled();
  });
});

describe('GomdonOrderService.pushOrder — đơn đã huỷ còn kẹt CREATING', () => {
  it('CREATING quá hạn lease + đơn CANCELLED → NEEDS_MANUAL_CHECK + cancel FAILED + báo kiểm tra & huỷ tay (không còn khớp cron)', async () => {
    const { svc, client, pancake, alerts, updateMany } = build({
      status: 'CANCELLED',
      gomdonStatus: 'CREATING',
      updatedAt: new Date(Date.now() - 40 * 60_000),
    });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'CREATING' },
      data: { gomdonStatus: 'NEEDS_MANUAL_CHECK' },
    });
    expect(updateMany.mock.calls.some(([a]) => a.data.gomdonCancelStatus === 'FAILED')).toBe(true);
    expect(alerts.alert).toHaveBeenCalledWith('TUBU1001', expect.stringContaining('đơn đã huỷ nhưng có thể đã tạo vận đơn'));
    expect(pancake.enqueuePush).not.toHaveBeenCalled();
  });

  it('CREATING còn trong lease (tiến trình khác đang gọi Gomdon) + đơn đã huỷ → không đổi gì, không báo', async () => {
    const { svc, alerts, updateMany } = build({ status: 'CANCELLED', gomdonStatus: 'CREATING', updatedAt: new Date(Date.now() - 5_000) });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('claim CREATING vừa bị đổi (count=0) → không báo động', async () => {
    const { svc, alerts } = build(
      { status: 'CANCELLED', gomdonStatus: 'CREATING', updatedAt: new Date(Date.now() - 40 * 60_000) },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    );
    await svc.pushOrder('o1');
    expect(alerts.alert).not.toHaveBeenCalled();
  });
});

describe('GomdonOrderService.markHandled (admin "Đã xử lý tay")', () => {
  it('từ trạng thái cần xử lý → MANUAL_HANDLED bằng updateMany có guard theo danh sách trạng thái', async () => {
    const { svc, updateMany } = build({ gomdonStatus: 'FAILED' });
    const out = await svc.markHandled('o1');
    expect(out.result).toBe('MANUAL_HANDLED');
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'o1',
        hasRecyclingPickup: true,
        gomdonStatus: { in: ['FAILED', 'NOT_CONFIGURED', 'NEEDS_MANUAL_CHECK', '2', '6', '8', '9', '10', '11', '12'] },
      },
      data: { gomdonStatus: 'MANUAL_HANDLED' },
    });
  });

  it('trạng thái không cho phép (vận đơn đang sống / đang tạo / chưa có gì / đã xử lý) → BadRequest, không ghi', async () => {
    for (const s of ['1', '3', '5', '7', 'CREATING', 'AWAITING_PAYMENT', null, 'MANUAL_HANDLED']) {
      const { svc, updateMany } = build({ gomdonStatus: s, gomdonOrderId: '77', gomdonPartnerCode: 'BE77' });
      await expect(svc.markHandled('o1')).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('trạng thái vừa đổi bởi tiến trình khác (count=0) → Conflict', async () => {
    const { svc } = build({ gomdonStatus: 'NEEDS_MANUAL_CHECK' }, { updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    await expect(svc.markHandled('o1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('đơn không thu gom / không tồn tại → lỗi rõ ràng', async () => {
    await expect(build({ hasRecyclingPickup: false, gomdonStatus: 'FAILED' }).svc.markHandled('o1')).rejects.toBeInstanceOf(BadRequestException);
    const nf = build();
    nf.prisma.order.findUnique.mockResolvedValueOnce(null);
    await expect(nf.svc.markHandled('o1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pushOrder thấy MANUAL_HANDLED → KHÔNG tự tạo vận đơn', async () => {
    const { svc, client } = build({ gomdonStatus: 'MANUAL_HANDLED' });
    expect(await svc.pushOrder('o1')).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
  });
});

describe('GomdonOrderService.enqueuePush', () => {
  it('xoá job COMPLETED cùng jobId rồi add lại (an toàn nhờ claim)', async () => {
    const { svc, queue } = build();
    const remove = jest.fn().mockResolvedValue(undefined);
    queue.getJob.mockResolvedValueOnce({ getState: jest.fn().mockResolvedValue('completed'), remove });
    await svc.enqueuePush('o1');
    expect(remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('push', { orderId: 'o1' }, { jobId: 'o1' });
  });
});

describe('GomdonOrderService.retryPush (admin "Thử lại tạo vận đơn")', () => {
  it('FAILED → nhả về null (guard theo trạng thái cũ) rồi enqueue', async () => {
    const { svc, updateMany, queue } = build({ gomdonStatus: 'FAILED' });
    const out = await svc.retryPush('o1');
    expect(out.queued).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonStatus: 'FAILED', gomdonOrderId: null, gomdonPartnerCode: null },
      data: { gomdonStatus: null },
    });
    expect(queue.add).toHaveBeenCalledWith('push', { orderId: 'o1' }, { jobId: 'o1' });
  });

  it('NEEDS_MANUAL_CHECK mà chưa xác nhận không có vận đơn → từ chối (tránh vận đơn trùng)', async () => {
    const { svc, queue } = build({ gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    await expect(svc.retryPush('o1')).rejects.toThrow('xác nhận KHÔNG có vận đơn');
    expect(queue.add).not.toHaveBeenCalled();
    const ok = build({ gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    await ok.svc.retryPush('o1', { confirmedNoWaybill: true });
    expect(ok.queue.add).toHaveBeenCalled();
  });

  it('vận đơn đang sống / đang CREATING → từ chối, không enqueue', async () => {
    for (const o of [
      { gomdonStatus: '1', gomdonOrderId: '77', gomdonPartnerCode: 'BE77' },
      { gomdonStatus: '10', gomdonOrderId: '77', gomdonPartnerCode: 'BE77' },
      { gomdonStatus: 'CREATING' },
    ]) {
      const { svc, queue } = build(o);
      await expect(svc.retryPush('o1')).rejects.toThrow();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it('vận đơn đã huỷ phía Gomdon (2) khi đơn còn hiệu lực → gỡ mã cũ rồi tạo lại', async () => {
    const { svc, updateMany, queue } = build({ gomdonStatus: '2', gomdonOrderId: '77', gomdonPartnerCode: 'BE77' });
    await svc.retryPush('o1');
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ id: 'o1', gomdonStatus: '2', gomdonOrderId: '77' });
    expect(args.data).toMatchObject({ gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null, gomdonCancelStatus: null });
    expect(queue.add).toHaveBeenCalled();
  });

  it('đơn đã huỷ / chưa thanh toán / Gomdon chưa cấu hình → từ chối', async () => {
    await expect(build({ status: 'CANCELLED', gomdonStatus: 'FAILED' }).svc.retryPush('o1')).rejects.toThrow('CANCELLED');
    await expect(
      build({ gomdonStatus: 'AWAITING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }).svc.retryPush('o1'),
    ).rejects.toThrow('chưa thanh toán');
    await expect(build({ gomdonStatus: 'FAILED' }, { configured: false }).svc.retryPush('o1')).rejects.toThrow('chưa cấu hình');
  });

  it('trạng thái vừa bị tiến trình khác đổi (count=0) → Conflict, không enqueue', async () => {
    const { svc, queue } = build({ gomdonStatus: 'FAILED' }, { updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    await expect(svc.retryPush('o1')).rejects.toThrow('vừa thay đổi');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('đơn đang giao / đã giao (hàng đã rời kho) → từ chối tạo vận đơn mới, không ghi, không enqueue', async () => {
    for (const status of ['SHIPPING', 'DELIVERED']) {
      const { svc, queue, updateMany } = build({ status, gomdonStatus: 'FAILED' });
      const err = await svc.retryPush('o1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('đã rời kho');
      expect(updateMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it('đã đánh dấu xử lý tay (MANUAL_HANDLED) → từ chối tạo lại', async () => {
    const { svc, queue } = build({ gomdonStatus: 'MANUAL_HANDLED' });
    await expect(svc.retryPush('o1')).rejects.toThrow('xử lý tay');
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('GomdonOrderService.cancelWaybill (admin "Huỷ vận đơn")', () => {
  const live = { gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1' };

  it('đơn còn hiệu lực, chưa lấy hàng → huỷ ngay + ghi 2/CANCELLED', async () => {
    const { svc, client, updateMany } = build(live);
    const out = await svc.cancelWaybill('o1');
    expect(out.result).toBe('CANCELLED');
    expect(client.cancelOrder).toHaveBeenCalledWith('77');
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ gomdonStatus: '2', gomdonCancelStatus: 'CANCELLED' });
  });

  it('Gomdon từ chối huỷ → lỗi 400 kèm lý do, không ghi gì', async () => {
    const { svc, client, updateMany } = build(live);
    client.cancelOrder.mockResolvedValueOnce({ ok: false, message: 'Đơn đã lấy' });
    await expect(svc.cancelWaybill('o1')).rejects.toThrow('Đơn đã lấy');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('bưu tá đã lấy hàng → từ chối, không gọi API', async () => {
    const { svc, client } = build({ ...live, gomdonStatus: '3' });
    await expect(svc.cancelWaybill('o1')).rejects.toThrow('đã lấy hàng');
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });

  it('đơn đã CANCELLED, lần huỷ trước FAILED → mở lại + xếp job huỷ (retry)', async () => {
    const { svc, queue, updateMany } = build({ ...live, status: 'CANCELLED', gomdonCancelStatus: 'FAILED' });
    const out = await svc.cancelWaybill('o1');
    expect(out.result).toBe('QUEUED');
    expect(updateMany.mock.calls[0][0]).toEqual({ where: { id: 'o1', gomdonCancelStatus: 'FAILED' }, data: { gomdonCancelStatus: null } });
    expect(queue.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, { jobId: 'cancel-o1' });
  });

  it('chưa có mã vận đơn → từ chối', async () => {
    await expect(build({ gomdonStatus: 'FAILED' }).svc.cancelWaybill('o1')).rejects.toThrow('chưa có vận đơn');
  });

  it('đơn còn hiệu lực, vận đơn CHỈ có mã BestExpress (thiếu id số) → từ chối kèm mã để huỷ tay, không gọi API', async () => {
    const { svc, client, updateMany } = build({ gomdonOrderId: null, gomdonPartnerCode: 'BE77', gomdonStatus: '1' });
    const err = await svc.cancelWaybill('o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('BE77');
    expect((err as Error).message).toContain('huỷ tay');
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đơn đã CANCELLED, vận đơn chỉ có mã BestExpress → vẫn xếp job huỷ (job sẽ báo huỷ tay)', async () => {
    const { svc, queue } = build({ status: 'CANCELLED', gomdonOrderId: null, gomdonPartnerCode: 'BE77', gomdonStatus: '1' });
    await expect(svc.cancelWaybill('o1')).resolves.toEqual(expect.objectContaining({ result: 'QUEUED' }));
    expect(queue.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, { jobId: 'cancel-o1' });
  });
});
