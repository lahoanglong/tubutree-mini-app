import { UnrecoverableError, type Queue } from 'bullmq';
import { GomdonWastePickupService } from './gomdon-waste-pickup.service';
import { GomdonAmbiguousError, GomdonDuplicateOrderError, GomdonRejectedError } from './gomdon.errors';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { GomdonClient } from './gomdon.client';
import type { GomdonAlertService } from './gomdon-alert.service';
import type { WasteHomePickupService } from '../../waste-exchange/home-pickup/waste-home-pickup.service';

const mockEnqueueCancel = jest.fn();
jest.mock('./gomdon-queue', () => ({ ...jest.requireActual('./gomdon-queue'), enqueueGomdonWasteCancel: (...a: unknown[]) => mockEnqueueCancel(...a) }));

const baseReq = {
  id: 'r1',
  code: 'TR-AAAAA',
  userId: 'u1',
  method: 'HOME_PICKUP',
  status: 'OPEN',
  gomdonOrderId: null as string | null,
  gomdonPartnerCode: null as string | null,
  gomdonStatus: null as string | null,
  declaredWeightGrams: 2500,
  shipFeeCashVnd: null as number | null,
  shipFeeCashPaidAt: null as Date | null,
  shipFeeCodVnd: 15000,
  pickupAddress: { addressId: 'a1', recipient: 'Lan', phone: '0901234567', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'Thành phố Hồ Chí Minh' },
  shippingHistory: null as unknown,
  updatedAt: new Date(),
};

function build(req: Record<string, unknown> | null = {}, opts: { claim?: number; fresh?: { status: string } | null } = {}) {
  const row = req === null ? null : { ...baseReq, ...req };
  const updateMany = jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    count: args.data.gomdonStatus === 'CREATING' ? (opts.claim ?? 1) : 1,
  }));
  const findUnique = jest.fn().mockImplementation(async (args: { select: Record<string, boolean> }) => {
    if (Object.keys(args.select).length === 1 && args.select.status) return opts.fresh === undefined ? { status: 'OPEN' } : opts.fresh;
    return row;
  });
  const prisma = { wasteRequest: { findUnique, updateMany } };
  const client = {
    getConfig: jest.fn().mockResolvedValue({
      defaultWarehouse: { name: 'Kho Tubu', phone: '0900000000', address: '99 Kho', ward: 'Phường Tân Định', district: 'Quận 1', province: 'Thành phố Hồ Chí Minh' },
    }),
    createOrder: jest.fn().mockResolvedValue({ result: true, data: { id: 77, partner_code: 'BE77', status: 1 } }),
    cancelOrder: jest.fn().mockResolvedValue({ ok: true }),
  };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
  const lifecycle = { failAfterRejected: jest.fn().mockResolvedValue({ closed: true, refunded: 15000 }) };
  const queue = { name: 'q' };
  const svc = new GomdonWastePickupService(
    prisma as unknown as PrismaService,
    client as unknown as GomdonClient,
    alerts as unknown as GomdonAlertService,
    lifecycle as unknown as WasteHomePickupService,
    queue as unknown as Queue,
  );
  (svc as unknown as { persistRetryDelayMs: number }).persistRetryDelayMs = 0;
  return { svc, prisma, client, alerts, lifecycle, queue, updateMany, findUnique };
}

beforeEach(() => mockEnqueueCancel.mockReset().mockResolvedValue(undefined));

describe('GomdonWastePickupService.pushRequest', () => {
  it('body Gomdon: giao hàng 12491, bưu tá lấy tận nhà, nguồn là nhà khách, đích là kho, collect_amount luôn 0 (I1: cấm COD cả khi dữ liệu cũ còn shipFeeCodVnd)', async () => {
    const { svc, client } = build();
    await expect(svc.pushRequest('r1')).resolves.toBe('BE77');
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(client.createOrder.mock.calls[0]![0]).toEqual({
      type: 1,
      pickup_type: 2,
      service_id: 12491,
      order_customer_id: 'WR-TR-AAAAA',
      product_name: 'Rác tái chế TR-AAAAA',
      product_price: 0,
      product_number: 1,
      collect_amount: 0,
      weight: 2500,
      width: 0,
      height: 0,
      length: 0,
      note: 'Thu gom rác tái chế TR-AAAAA (~2.5kg) giao về kho Tubu Tree',
      source_name: 'Lan',
      source_phone: '0901234567',
      source_address: '1 Lê Lợi',
      source_ward: 'Phường Bến Nghé',
      source_province: 'Thành phố Hồ Chí Minh',
      dest_name: 'Kho Tubu',
      dest_phone: '0900000000',
      dest_address: '99 Kho',
      dest_ward: 'Phường Tân Định',
      dest_province: 'Thành phố Hồ Chí Minh',
    });
    expect(client.createOrder.mock.calls[0]![0]).not.toHaveProperty('source_district');
  });

  it('phí trả hết bằng điểm hoặc tiền trả trước: collect_amount 0; cân nặng vượt trần Gomdon thì cắt về trần', async () => {
    const { svc, client } = build({ shipFeeCodVnd: 0, shipFeeCashVnd: 17000, shipFeeCashPaidAt: new Date(), declaredWeightGrams: 9_999_999 });
    await svc.pushRequest('r1');
    const body = client.createOrder.mock.calls[0]![0];
    expect(body.collect_amount).toBe(0);
    expect(body.weight).toBeLessThanOrEqual(10_000);
  });

  it('phiếu AWAITING chuyển khoản (shipFeeCashVnd > 0, shipFeeCashPaidAt = null): KHÔNG tạo vận đơn, KHÔNG claim CREATING', async () => {
    const { svc, client, updateMany } = build({ shipFeeCashVnd: 17000, shipFeeCashPaidAt: null });
    await expect(svc.pushRequest('r1')).resolves.toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('thành công: claim CREATING (chặn AWAITING trong mệnh đề OR) rồi ghi id, mã vận đơn, trạng thái 1, hãng BestExpress, tracking = mã vận đơn, lịch sử', async () => {
    const { svc, updateMany } = build();
    await svc.pushRequest('r1');
    expect(updateMany.mock.calls[0]![0]).toEqual({
      where: {
        id: 'r1',
        method: 'HOME_PICKUP',
        status: 'OPEN',
        gomdonOrderId: null,
        gomdonPartnerCode: null,
        gomdonStatus: null,
        OR: [{ shipFeeCashVnd: null }, { shipFeeCashVnd: 0 }, { shipFeeCashPaidAt: { not: null } }],
      },
      data: { gomdonStatus: 'CREATING' },
    });
    const save = updateMany.mock.calls[1]![0];
    expect(save.where).toEqual({ id: 'r1', gomdonStatus: 'CREATING' });
    expect(save.data).toMatchObject({ gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1', carrier: 'BestExpress', trackingCode: 'BE77', trackingNorm: 'BE77' });
    expect(save.data.shippingHistory).toEqual([expect.objectContaining({ status: '1', carrier: 'BestExpress', code: 'BE77' })]);
    expect(mockEnqueueCancel).not.toHaveBeenCalled();
  });

  it('chạy lại khi đã có vận đơn: không gọi Gomdon lần hai', async () => {
    const { svc, client } = build({ gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1' });
    await expect(svc.pushRequest('r1')).resolves.toBe('BE77');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('không phải HOME_PICKUP hoặc không còn: bỏ qua', async () => {
    const a = build({ method: 'MAIL_IN' });
    await expect(a.svc.pushRequest('r1')).resolves.toBeNull();
    const b = build(null);
    await expect(b.svc.pushRequest('r1')).resolves.toBeNull();
    expect(a.client.createOrder).not.toHaveBeenCalled();
    expect(b.client.createOrder).not.toHaveBeenCalled();
  });

  it('phiếu đã huỷ/hết hạn trước khi job chạy: không tạo vận đơn (không có vận đơn mồ côi)', async () => {
    for (const status of ['CANCELLED', 'EXPIRED']) {
      const { svc, client, updateMany } = build({ status });
      await expect(svc.pushRequest('r1')).resolves.toBeNull();
      expect(client.createOrder).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('claim thua (phiếu vừa bị huỷ giữa chừng): không gọi Gomdon', async () => {
    const { svc, client } = build({}, { claim: 0 });
    await expect(svc.pushRequest('r1')).resolves.toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('đang CREATING còn trong thời hạn: tiến trình khác đang gọi, bỏ qua', async () => {
    const { svc, client, alerts } = build({ gomdonStatus: 'CREATING' });
    await expect(svc.pushRequest('r1')).resolves.toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('CREATING quá hạn: KHÔNG tạo lại, chuyển NEEDS_MANUAL_CHECK và báo CSKH, không hoàn điểm', async () => {
    const { svc, client, alerts, updateMany, lifecycle } = build({ gomdonStatus: 'CREATING', updatedAt: new Date(Date.now() - 3 * 60_000) });
    await expect(svc.pushRequest('r1')).resolves.toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0]![0].data).toEqual({ gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('KIỂM TRA GOMDON'), 'OPS_GOMDON_ALERT');
    expect(lifecycle.failAfterRejected).not.toHaveBeenCalled();
  });

  it('NEEDS_MANUAL_CHECK hoặc trạng thái khác: không tạo lại', async () => {
    for (const gomdonStatus of ['NEEDS_MANUAL_CHECK', 'FAILED']) {
      const { svc, client } = build({ gomdonStatus });
      await expect(svc.pushRequest('r1')).resolves.toBeNull();
      expect(client.createOrder).not.toHaveBeenCalled();
    }
  });

  it('Gomdon từ chối rõ ràng: nhả claim để BullMQ thử lại, ném lại lỗi, chưa huỷ phiếu', async () => {
    const { svc, client, updateMany, lifecycle } = build();
    const err = new GomdonRejectedError('HTTP 503', { transient: true });
    client.createOrder.mockRejectedValue(err);
    await expect(svc.pushRequest('r1')).rejects.toBe(err);
    expect(updateMany.mock.calls[1]![0]).toEqual({ where: { id: 'r1', gomdonStatus: 'CREATING' }, data: { gomdonStatus: null } });
    expect(lifecycle.failAfterRejected).not.toHaveBeenCalled();
  });

  it('lỗi KHÔNG RÕ (timeout sau khi gửi): NEEDS_MANUAL_CHECK, báo CSKH, không ném (không retry), không hoàn điểm', async () => {
    const { svc, client, alerts, updateMany, lifecycle } = build();
    client.createOrder.mockRejectedValue(new GomdonAmbiguousError('timeout of 15000ms exceeded'));
    await expect(svc.pushRequest('r1')).resolves.toBeNull();
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[1]![0]).toEqual({
      where: { id: 'r1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'CREATING' },
      data: { gomdonStatus: 'NEEDS_MANUAL_CHECK' },
    });
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('timeout of 15000ms exceeded'), 'OPS_GOMDON_ALERT');
    expect(lifecycle.failAfterRejected).not.toHaveBeenCalled();
  });

  it('Gomdon báo đã có đơn cùng order_customer_id: NEEDS_MANUAL_CHECK kèm hướng dẫn tra mã WR-, không tạo lại', async () => {
    const { svc, client, alerts } = build();
    client.createOrder.mockRejectedValue(new GomdonDuplicateOrderError('order_customer_id đã tồn tại'));
    await expect(svc.pushRequest('r1')).resolves.toBeNull();
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('Tra Gomdon theo mã WR-TR-AAAAA'), 'OPS_GOMDON_ALERT');
  });

  it('result:true nhưng không có id lẫn mã vận đơn: NEEDS_MANUAL_CHECK', async () => {
    const { svc, client, updateMany } = build();
    client.createOrder.mockResolvedValue({ result: true, data: {} });
    await expect(svc.pushRequest('r1')).resolves.toBeNull();
    expect(updateMany.mock.calls[1]![0].data).toEqual({ gomdonStatus: 'NEEDS_MANUAL_CHECK' });
  });

  it('thiếu địa chỉ hoặc cân nặng: Rejected dứt khoát TRƯỚC khi claim (không bị hiểu nhầm là "không rõ đã tạo")', async () => {
    const { svc, client, updateMany } = build({ pickupAddress: { addressId: 'a1' } });
    await expect(svc.pushRequest('r1')).rejects.toBeInstanceOf(GomdonRejectedError);
    await expect(svc.pushRequest('r1')).rejects.toMatchObject({ transient: false });
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('ghi DB lỗi chập chờn: thử lại tại chỗ rồi thành công, mã vận đơn không mất', async () => {
    const { svc, updateMany } = build();
    updateMany.mockImplementationOnce(async () => ({ count: 1 })).mockRejectedValueOnce(new Error('db blip'));
    await expect(svc.pushRequest('r1')).resolves.toBe('BE77');
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it('ghi DB lỗi cả 3 lần sau khi ĐÃ tạo vận đơn: UnrecoverableError, không retry tạo lại', async () => {
    const { svc, client, updateMany } = build();
    updateMany.mockImplementationOnce(async () => ({ count: 1 })).mockRejectedValue(new Error('db down'));
    await expect(svc.pushRequest('r1')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('claim đổi sang NEEDS_MANUAL_CHECK trong lúc Gomdon trả về: vẫn ghi mã vận đơn (hồi phục)', async () => {
    const { svc, updateMany } = build();
    updateMany.mockImplementationOnce(async () => ({ count: 1 })).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await svc.pushRequest('r1');
    expect(updateMany.mock.calls[2]![0].where).toEqual({ id: 'r1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK' });
  });

  it('webhook tới trước làm claim đổi hẳn: vẫn giữ mã vận đơn vừa tạo, không làm mất', async () => {
    const { svc, updateMany } = build();
    updateMany.mockImplementationOnce(async () => ({ count: 1 })).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await svc.pushRequest('r1');
    expect(updateMany.mock.calls[3]![0]).toMatchObject({
      where: { id: 'r1', gomdonOrderId: null, gomdonPartnerCode: null },
      data: { gomdonOrderId: '77', gomdonPartnerCode: 'BE77', trackingCode: 'BE77' },
    });
  });

  it('phiếu đóng TRONG LÚC đang tạo vận đơn: xếp lệnh huỷ vận đơn vừa tạo', async () => {
    const { svc, queue } = build({}, { fresh: { status: 'EXPIRED' } });
    await expect(svc.pushRequest('r1')).resolves.toBe('BE77');
    expect(mockEnqueueCancel).toHaveBeenCalledWith(queue, 'r1', 'TR-AAAAA');
  });
});

describe('GomdonWastePickupService.markFinalPushFailure', () => {
  it('chưa có vận đơn, hết lượt: huỷ phiếu + hoàn điểm qua lifecycle rồi báo CSKH số điểm đã hoàn', async () => {
    const { svc, lifecycle, alerts } = build();
    await svc.markFinalPushFailure('r1', new GomdonRejectedError('HTTP 503', { transient: true }));
    expect(lifecycle.failAfterRejected).toHaveBeenCalledWith('r1', 'Gomdon từ chối tạo vận đơn: HTTP 503');
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('hoàn 15000 Điểm Xanh'), 'OPS_GOMDON_ALERT');
  });

  it('CREATING lúc hết lượt = không rõ đã tạo chưa: NEEDS_MANUAL_CHECK, KHÔNG hoàn điểm, KHÔNG huỷ phiếu', async () => {
    const { svc, lifecycle, updateMany } = build({ gomdonStatus: 'CREATING' });
    await svc.markFinalPushFailure('r1', new Error('x'));
    expect(lifecycle.failAfterRejected).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0]![0].data).toEqual({ gomdonStatus: 'NEEDS_MANUAL_CHECK' });
  });

  it('đã có vận đơn / không còn OPEN / đã NEEDS_MANUAL_CHECK / đang AWAITING chuyển khoản: không làm gì', async () => {
    for (const over of [
      { gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1' },
      { status: 'CANCELLED' },
      { gomdonStatus: 'NEEDS_MANUAL_CHECK' },
      { shipFeeCashVnd: 17000, shipFeeCashPaidAt: null },
    ]) {
      const { svc, lifecycle, alerts } = build(over);
      await svc.markFinalPushFailure('r1', new Error('x'));
      expect(lifecycle.failAfterRejected).not.toHaveBeenCalled();
      expect(alerts.alert).not.toHaveBeenCalled();
    }
  });

  it('phiếu đã bị đóng bởi bên khác (closed:false): không báo CSKH thừa', async () => {
    const { svc, lifecycle, alerts } = build();
    lifecycle.failAfterRejected.mockResolvedValue({ closed: false, refunded: 0 });
    await svc.markFinalPushFailure('r1', new Error('x'));
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('lifecycle lỗi (DB down): ném để job failed và cron cứu hộ xếp lại, không nuốt', async () => {
    const { svc, lifecycle } = build();
    lifecycle.failAfterRejected.mockRejectedValue(new Error('db down'));
    await expect(svc.markFinalPushFailure('r1', new Error('x'))).rejects.toThrow('db down');
  });
});

describe('GomdonWastePickupService.cancelOnGomdon', () => {
  const closed = { status: 'CANCELLED', gomdonOrderId: '77', gomdonPartnerCode: 'BE77', gomdonStatus: '1' };

  it('phiếu đã đóng, có vận đơn: gọi cancelOrder, ghi gomdonStatus 2 và lịch sử, KHÔNG hoàn điểm (đã hoàn lúc đóng phiếu)', async () => {
    const { svc, client, updateMany, lifecycle } = build({ ...closed, shippingHistory: [{ status: '1' }] });
    await svc.cancelOnGomdon('r1', false);
    expect(client.cancelOrder).toHaveBeenCalledWith('77');
    const args = updateMany.mock.calls[0]![0];
    expect(args.where).toEqual({ id: 'r1', gomdonOrderId: '77' });
    expect(args.data.gomdonStatus).toBe('2');
    expect(args.data.shippingHistory).toHaveLength(2);
    expect(lifecycle.failAfterRejected).not.toHaveBeenCalled();
  });

  it('phiếu còn OPEN (chưa đóng): không huỷ vận đơn', async () => {
    const { svc, client } = build({ ...closed, status: 'OPEN' });
    await svc.cancelOnGomdon('r1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });

  it('Gomdon đã huỷ rồi (gomdonStatus 2): không gọi lần nữa', async () => {
    const { svc, client } = build({ ...closed, gomdonStatus: '2' });
    await svc.cancelOnGomdon('r1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });

  it('bưu tá đã lấy rác: không huỷ được, báo CSKH xử lý rác đang về kho', async () => {
    const { svc, client, alerts } = build({ ...closed, gomdonStatus: '4' });
    await svc.cancelOnGomdon('r1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('bưu tá đã lấy rác'));
  });

  it('Gomdon từ chối huỷ: ném để thử lại; lần cuối thì báo CSKH huỷ tay', async () => {
    const { svc, client, alerts } = build(closed);
    client.cancelOrder.mockResolvedValue({ ok: false, message: 'Đơn đang giao' });
    await expect(svc.cancelOnGomdon('r1', false)).rejects.toThrow('Đơn đang giao');
    expect(alerts.alert).not.toHaveBeenCalled();
    await expect(svc.cancelOnGomdon('r1', true)).resolves.toBeUndefined();
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('huỷ tay trên Gomdon'), 'OPS_GOMDON_ALERT');
  });

  it('Gomdon báo "không tìm thấy": không retry vô ích, báo CSKH tra cổng Gomdon', async () => {
    const { svc, client, alerts } = build(closed);
    client.cancelOrder.mockResolvedValue({ ok: false, message: 'Không tìm thấy đơn' });
    await expect(svc.cancelOnGomdon('r1', false)).resolves.toBeUndefined();
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('tra cổng Gomdon'));
  });

  it('chưa có vận đơn mà đang CREATING: ném để thử lại cho tới khi biết kết quả', async () => {
    const { svc } = build({ status: 'CANCELLED', gomdonStatus: 'CREATING' });
    await expect(svc.cancelOnGomdon('r1', false)).rejects.toThrow('đang được tạo');
  });

  it('chưa có vận đơn mà NEEDS_MANUAL_CHECK: báo CSKH tra theo mã WR-', async () => {
    const { svc, client, alerts } = build({ status: 'CANCELLED', gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    await svc.cancelOnGomdon('r1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('tra Gomdon theo mã WR-TR-AAAAA'));
  });

  it('có mã vận đơn nhưng thiếu id số Gomdon: không thể huỷ qua API, báo huỷ tay', async () => {
    const { svc, client, alerts } = build({ status: 'CANCELLED', gomdonOrderId: null, gomdonPartnerCode: 'BE77', gomdonStatus: '1' });
    await svc.cancelOnGomdon('r1', false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(alerts.alert).toHaveBeenCalledWith('WR-TR-AAAAA', expect.stringContaining('HUỶ TAY'));
  });
});
