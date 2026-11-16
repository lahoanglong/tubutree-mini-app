import { WasteHomePickupService, type HomePickupRow } from './waste-home-pickup.service';

const mockClose = jest.fn();
jest.mock('./waste-home-pickup-ledger', () => ({ closeHomePickupRequest: (...a: unknown[]) => mockClose(...a) }));
const mockCancel = jest.fn();
jest.mock('../../integrations/gomdon/gomdon-queue', () => ({ enqueueGomdonWasteCancel: (...a: unknown[]) => mockCancel(...a) }));

const EXPIRES = new Date('2027-11-15T00:00:00Z');
const AT = (s: number) => new Date(Date.UTC(2026, 10, 15, 1, 0, s));

const row = (over: Partial<HomePickupRow> = {}): HomePickupRow => ({
  id: 'r1',
  code: 'TR-AAAAA',
  userId: 'u1',
  pointId: 'wh',
  status: 'OPEN',
  gomdonOrderId: '555',
  gomdonPartnerCode: 'BE123',
  gomdonStatus: '1',
  gomdonStatusAt: AT(0),
  shipFeePointsUsed: 1500,
  shipFeeCashVnd: null,
  shipFeeCashPaidAt: null,
  shippingHistory: [{ at: AT(0).toISOString(), status: '1', carrier: 'BestExpress', code: 'BE123' }],
  ...over,
});
const ev = (status: number, s = 10, over: Record<string, unknown> = {}) => ({ status, eventTime: AT(s), gomdonOrderId: '555', partnerCode: 'BE123', ...over });

function setup() {
  const prisma = {
    wasteRequest: {
      findUnique: jest.fn().mockResolvedValue({ id: 'r1', code: 'TR-AAAAA', userId: 'u1', pointId: 'wh', method: 'HOME_PICKUP', shipFeePointsUsed: 1500 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })),
  };
  const config = {
    pointExpiresAt: jest.fn().mockResolvedValue(EXPIRES),
    snapshot: jest.fn().mockResolvedValue({ shortfallLockPct: 50, shortfallLockStreak: 2 }),
  };
  const notifier = { homePickupClosed: jest.fn().mockResolvedValue(undefined) };
  const shipLock = { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false }) };
  const queue = { name: 'q' };
  const svc = new WasteHomePickupService(prisma as never, config as never, notifier as never, shipLock as never, queue as never);
  return { prisma, config, notifier, shipLock, svc, queue };
}

beforeEach(() => {
  mockClose.mockReset().mockResolvedValue({ closed: true, refunded: 1500 });
  mockCancel.mockReset().mockResolvedValue(undefined);
});

describe('WasteHomePickupService.applyWebhook', () => {
  it('3 (bưu tá đã lấy): OPEN sang IN_TRANSIT, ghi inTransitAt, bỏ hạn giữ chỗ và nối lịch sử', async () => {
    const { svc, prisma } = setup();
    await expect(svc.applyWebhook(row(), ev(3))).resolves.toEqual({ outcome: 'PROCESSED', alert: undefined });
    const call = prisma.wasteRequest.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: 'r1', status: 'OPEN', gomdonStatus: '1' });
    expect(call.data).toMatchObject({ status: 'IN_TRANSIT', inTransitAt: AT(10), expiresAt: null, gomdonStatus: '3', gomdonStatusAt: AT(10) });
    expect(call.data.shippingHistory).toHaveLength(2);
    expect(call.data.shippingHistory[1]).toMatchObject({ status: '3', carrier: 'BestExpress', code: 'BE123' });
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('1 (tạo đơn): giữ OPEN, chỉ ghi trạng thái', async () => {
    const { svc, prisma } = setup();
    await svc.applyWebhook(row({ gomdonStatus: null, gomdonStatusAt: null, shippingHistory: null }), ev(1));
    const data = prisma.wasteRequest.updateMany.mock.calls[0]![0].data;
    expect(data.status).toBeUndefined();
    expect(data).toMatchObject({ gomdonStatus: '1' });
  });

  it.each([4, 5])('%i (đang về kho): phiếu IN_TRANSIT giữ nguyên trạng thái, chỉ ghi mã', async (status) => {
    const { svc, prisma } = setup();
    await svc.applyWebhook(row({ status: 'IN_TRANSIT', gomdonStatus: '3' }), ev(status));
    const data = prisma.wasteRequest.updateMany.mock.calls[0]![0].data;
    expect(data.status).toBeUndefined();
    expect(data.gomdonStatus).toBe(String(status));
  });

  it('4 tới khi phiếu còn OPEN (mất webhook 3): vẫn sang IN_TRANSIT', async () => {
    const { svc, prisma } = setup();
    await svc.applyWebhook(row({ gomdonStatus: '1' }), ev(4));
    expect(prisma.wasteRequest.updateMany.mock.calls[0]![0].data).toMatchObject({ status: 'IN_TRANSIT', gomdonStatus: '4' });
  });

  it('7 (giao tới kho): chỉ ghi nhận, phiếu vẫn IN_TRANSIT để kho nhận theo mã vận đơn, không tự nhận hàng', async () => {
    const { svc, prisma } = setup();
    const res = await svc.applyWebhook(row({ status: 'IN_TRANSIT', gomdonStatus: '5' }), ev(7));
    expect(res).toEqual({ outcome: 'PROCESSED', alert: undefined });
    const data = prisma.wasteRequest.updateMany.mock.calls[0]![0].data;
    expect(data.status).toBeUndefined();
    expect(data).toMatchObject({ gomdonStatus: '7' });
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('2 (đơn huỷ) khi bưu tá chưa lấy: huỷ phiếu và hoàn điểm, báo khách', async () => {
    const { svc, notifier, shipLock } = setup();
    await expect(svc.applyWebhook(row(), ev(2))).resolves.toEqual({ outcome: 'PROCESSED' });
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockClose.mock.calls[0]![1]).toMatchObject({
      from: ['OPEN'],
      to: 'CANCELLED',
      closeReason: null,
      refundExpiresAt: EXPIRES,
      where: { gomdonStatus: '1' },
      data: expect.objectContaining({ gomdonStatus: '2' }),
      event: expect.objectContaining({ kind: 'REQUEST_CANCELLED', actorRole: 'SYSTEM' }),
    });
    expect(notifier.homePickupClosed).toHaveBeenCalledTimes(1);
    expect(shipLock.evaluateAndLock).not.toHaveBeenCalled();
  });

  it('10 (lấy không thành công) khi bưu tá chưa lấy: EXPIRED + PICKUP_NO_SHOW, hoàn điểm, tính một lần hụt cho khoá đường thu gom', async () => {
    const { svc, notifier, shipLock } = setup();
    await expect(svc.applyWebhook(row(), ev(10))).resolves.toEqual({ outcome: 'PROCESSED' });
    expect(mockClose.mock.calls[0]![1]).toMatchObject({ to: 'EXPIRED', closeReason: 'PICKUP_NO_SHOW', event: expect.objectContaining({ kind: 'REQUEST_EXPIRED' }) });
    expect(notifier.homePickupClosed).not.toHaveBeenCalled();
    expect(shipLock.evaluateAndLock).toHaveBeenCalledWith('u1', { shortfallLockPct: 50, shortfallLockStreak: 2 });
  });

  it('10 đóng phiếu: xếp lệnh huỷ vận đơn vì bưu tá có thể quay lại lấy sau mã 10; lỗi xếp hàng không làm hỏng xử lý event', async () => {
    const { svc, queue } = setup();
    await svc.applyWebhook(row(), ev(10));
    expect(mockCancel).toHaveBeenCalledWith(queue, 'r1', 'TR-AAAAA');
    mockCancel.mockRejectedValueOnce(new Error('redis down'));
    await expect(setup().svc.applyWebhook(row(), ev(10))).resolves.toEqual({ outcome: 'PROCESSED' });
  });

  it('2 (đơn huỷ) đóng phiếu: không xếp lệnh huỷ lại vận đơn đã huỷ', async () => {
    const { svc } = setup();
    await svc.applyWebhook(row(), ev(2));
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('phiếu đã đóng nhưng webhook 1 báo vận đơn vừa hiện ra còn sống: xếp lệnh huỷ để bưu tá không tới lấy', async () => {
    const { svc, queue } = setup();
    await svc.applyWebhook(row({ status: 'EXPIRED', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK', gomdonStatusAt: null }), ev(1, 5));
    expect(mockCancel).toHaveBeenCalledWith(queue, 'r1', 'TR-AAAAA');
  });

  it('phiếu OPEN nhận webhook 1: không xếp lệnh huỷ', async () => {
    const { svc } = setup();
    await svc.applyWebhook(row({ gomdonStatus: null, gomdonStatusAt: null, shippingHistory: null }), ev(1));
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('mã tạm (id nội bộ Gomdon) được nâng lên mã BestExpress thật từ webhook, giữ tracking đồng bộ', async () => {
    const { svc, prisma } = setup();
    await svc.applyWebhook(row({ gomdonOrderId: '1517251', gomdonPartnerCode: '1517251' }), ev(3, 10, { gomdonOrderId: '1517251', partnerCode: '84856413835159' }));
    const call = prisma.wasteRequest.updateMany.mock.calls[0]![0];
    expect(call.data).toMatchObject({ gomdonPartnerCode: '84856413835159', trackingCode: '84856413835159', trackingNorm: '84856413835159', status: 'IN_TRANSIT' });
    expect(call.data.shippingHistory.at(-1)).toMatchObject({ status: '3', code: '84856413835159' });
  });

  it('mã đã là mã thật: webhook mang mã khác không ghi đè', async () => {
    const { svc, prisma } = setup();
    await svc.applyWebhook(row(), ev(3, 10, { partnerCode: 'BE999' }));
    const data = prisma.wasteRequest.updateMany.mock.calls[0]![0].data;
    expect(data.gomdonPartnerCode).toBeUndefined();
    expect(data.trackingCode).toBeUndefined();
  });

  it('mã tạm nhưng webhook không mang mã nào: giữ nguyên mã tạm', async () => {
    const { svc, prisma } = setup();
    await svc.applyWebhook(row({ gomdonOrderId: '1517251', gomdonPartnerCode: '1517251' }), ev(3, 10, { gomdonOrderId: '1517251', partnerCode: null }));
    expect(prisma.wasteRequest.updateMany.mock.calls[0]![0].data.gomdonPartnerCode).toBeUndefined();
  });

  it('2 sau khi bưu tá đã lấy (3): không tự huỷ, không hoàn điểm, báo người xử lý', async () => {
    const { svc, prisma } = setup();
    const res = await svc.applyWebhook(row({ status: 'IN_TRANSIT', gomdonStatus: '3' }), ev(2));
    expect(mockClose).not.toHaveBeenCalled();
    expect(res.outcome).toBe('PROCESSED');
    expect(res.alert).toMatch(/KHÔNG tự hoàn/);
    expect(prisma.wasteRequest.updateMany.mock.calls[0]![0].data).toMatchObject({ gomdonStatus: '2' });
  });

  it('10 tới sau 3 là sự kiện cũ (10 đứng trước 3): bỏ qua, không đụng gì', async () => {
    const { svc, prisma } = setup();
    const res = await svc.applyWebhook(row({ status: 'IN_TRANSIT', gomdonStatus: '3' }), ev(10));
    expect(res.outcome).toBe('IGNORED');
    expect(prisma.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('sự kiện trùng (cùng trạng thái đã ghi): bỏ qua, không ghi lịch sử hai lần, không hoàn điểm hai lần', async () => {
    const { svc, prisma } = setup();
    const res = await svc.applyWebhook(row({ status: 'IN_TRANSIT', gomdonStatus: '3' }), ev(3, 20));
    expect(res.outcome).toBe('IGNORED');
    expect(prisma.wasteRequest.updateMany).not.toHaveBeenCalled();
    const dup2 = await svc.applyWebhook(row({ status: 'CANCELLED', gomdonStatus: '2' }), ev(2, 20));
    expect(dup2.outcome).toBe('IGNORED');
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('sự kiện cũ hơn trạng thái hiện tại (1 sau 3; cùng bậc nhưng created_time cũ hơn) bị bỏ qua', async () => {
    const { svc, prisma } = setup();
    expect((await svc.applyWebhook(row({ status: 'IN_TRANSIT', gomdonStatus: '3' }), ev(1, 30))).outcome).toBe('IGNORED');
    expect((await svc.applyWebhook(row({ status: 'IN_TRANSIT', gomdonStatus: '4', gomdonStatusAt: AT(50) }), ev(5, 20))).outcome).toBe('PROCESSED');
    prisma.wasteRequest.updateMany.mockClear();
    expect((await svc.applyWebhook(row({ status: 'IN_TRANSIT', gomdonStatus: '5', gomdonStatusAt: AT(50) }), ev(11, 20))).outcome).toBe('IGNORED');
    expect(prisma.wasteRequest.updateMany).not.toHaveBeenCalled();
  });

  it.each([6, 8, 9, 11, 12])('%i: chỉ ghi và báo người xử lý kèm tiền phí đã thu (I7), không đổi trạng thái phiếu, không tự hoàn', async (status) => {
    const { svc, prisma } = setup();
    const res = await svc.applyWebhook(
      row({ status: 'IN_TRANSIT', gomdonStatus: '5', shipFeeCashVnd: 17000, shipFeeCashPaidAt: AT(0) }),
      ev(status),
    );
    expect(res.outcome).toBe('PROCESSED');
    expect(res.alert).toMatch(/KHÔNG tự hoàn/);
    expect(res.alert).toContain('17.000đ phí đã thu');
    expect(prisma.wasteRequest.updateMany.mock.calls[0]![0].data.status).toBeUndefined();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('webhook huỷ tới sau khi chính ta đã đóng phiếu (hết hạn rồi huỷ vận đơn): ghi nhận, không báo động', async () => {
    const { svc } = setup();
    const res = await svc.applyWebhook(row({ status: 'EXPIRED' }), ev(2));
    expect(res).toEqual({ outcome: 'PROCESSED', alert: undefined });
  });

  it('bưu tá báo đã lấy rác của phiếu đã đóng: báo người xử lý (điểm phí ship đã hoàn)', async () => {
    const { svc } = setup();
    const res = await svc.applyWebhook(row({ status: 'CANCELLED' }), ev(3));
    expect(res.alert).toMatch(/đã đóng/);
  });

  it('vận đơn khác vận đơn đang gắn: bỏ qua', async () => {
    const { svc, prisma } = setup();
    const res = await svc.applyWebhook(row(), ev(3, 10, { gomdonOrderId: '999' }));
    expect(res.outcome).toBe('IGNORED');
    expect(prisma.wasteRequest.updateMany).not.toHaveBeenCalled();
  });

  it('phiếu chưa có mã vận đơn nào (lần tạo mất phản hồi): điền mã, mã vận đơn thành mã tra cứu của kho', async () => {
    const { svc, prisma } = setup();
    await svc.applyWebhook(row({ gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NEEDS_MANUAL_CHECK', gomdonStatusAt: null }), ev(1, 5, { partnerCode: 'be 123' }));
    const data = prisma.wasteRequest.updateMany.mock.calls[0]![0].data;
    expect(data).toMatchObject({ gomdonOrderId: '555', gomdonPartnerCode: 'be 123', trackingCode: 'be 123', trackingNorm: 'BE123', carrier: 'BestExpress', gomdonStatus: '1' });
  });

  it('trạng thái phiếu vừa đổi (CAS thua): ném lỗi để event được xử lý lại', async () => {
    const { svc, prisma } = setup();
    prisma.wasteRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.applyWebhook(row(), ev(3))).rejects.toThrow(/xử lý lại event/);
  });

  it('đóng phiếu thua một bên khác: ném lỗi để event được xử lý lại, không tính lần hụt', async () => {
    const { svc, shipLock } = setup();
    mockClose.mockResolvedValue({ closed: false, refunded: 0 });
    await expect(svc.applyWebhook(row(), ev(10))).rejects.toThrow(/xử lý lại event/);
    expect(shipLock.evaluateAndLock).not.toHaveBeenCalled();
  });

  it('khoá đường thu gom lỗi sau lần hụt thì không làm hỏng việc xử lý event', async () => {
    const { svc, shipLock } = setup();
    shipLock.evaluateAndLock.mockRejectedValue(new Error('db'));
    await expect(svc.applyWebhook(row(), ev(10))).resolves.toEqual({ outcome: 'PROCESSED' });
  });
});

describe('WasteHomePickupService.failAfterRejected / closeOpen', () => {
  it('Gomdon từ chối: huỷ phiếu chưa có vận đơn, hoàn điểm và báo khách', async () => {
    const { svc, notifier } = setup();
    await expect(svc.failAfterRejected('r1', 'Gomdon từ chối')).resolves.toEqual({ closed: true, refunded: 1500 });
    expect(mockClose.mock.calls[0]![1]).toMatchObject({
      from: ['OPEN'],
      to: 'CANCELLED',
      where: { gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      data: { gomdonStatus: 'FAILED' },
    });
    expect(notifier.homePickupClosed).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-AAAAA' }, expect.stringContaining('hoàn lại'), expect.any(Date));
  });

  it('phiếu đã sang trạng thái khác (closed:false): không báo khách', async () => {
    const { svc, notifier } = setup();
    mockClose.mockResolvedValue({ closed: false, refunded: 0 });
    await expect(svc.failAfterRejected('r1', 'x')).resolves.toEqual({ closed: false, refunded: 0 });
    expect(notifier.homePickupClosed).not.toHaveBeenCalled();
  });

  it('không phải phiếu HOME_PICKUP hoặc không tồn tại: không đóng gì', async () => {
    const { svc, prisma } = setup();
    prisma.wasteRequest.findUnique.mockResolvedValue({ method: 'MAIL_IN' });
    await expect(svc.failAfterRejected('r1', 'x')).resolves.toEqual({ closed: false, refunded: 0 });
    prisma.wasteRequest.findUnique.mockResolvedValue(null);
    await expect(svc.failAfterRejected('r1', 'x')).resolves.toEqual({ closed: false, refunded: 0 });
    expect(mockClose).not.toHaveBeenCalled();
  });
});
