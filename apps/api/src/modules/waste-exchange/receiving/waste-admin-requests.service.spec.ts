import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertActiveAdmin } from '../../../common/staff-access';
import { writeWasteEvent } from '../core/waste-events';
import { lockWasteCustomer } from '../waste-locks';
import { loadAdminRequestDetail } from './waste-admin-detail.mapper';
import { WasteAdminRequestsService } from './waste-admin-requests.service';

jest.mock('../waste-locks');
jest.mock('../core/waste-events');
jest.mock('./waste-admin-detail.mapper');
jest.mock('../../../common/staff-access');

const NOT_REOPENABLE = 'Chỉ mở lại được yêu cầu gửi kho hoặc thu kèm đơn đã hết hạn';
const UNMATCHED_NOT_OPEN = 'Dòng hàng không rõ chủ không còn mở';
const CFG = { customerMonthlyCapPoints: 60_000 };

const request = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'TR-ABCDE',
  userId: 'u1',
  method: 'MAIL_IN',
  status: 'EXPIRED',
  pointId: 'wh',
  orderId: null,
  capDayKey: '2026-10-01',
  capMonthKey: '2026-10',
  closeReason: 'HOLD_EXPIRED',
  lines: [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: null }],
  ...o,
});

interface Setup {
  row?: Record<string, unknown> | null;
  lockedUserId?: string;
  unmatchedCount?: number;
  requestCount?: number;
  holdError?: Error;
}

function setup(o: Setup = {}) {
  const order: string[] = [];
  let inTx = false;
  const data = o.row === undefined ? request() : o.row;
  (lockWasteCustomer as jest.Mock).mockImplementation(async () => void order.push('lockWasteCustomer'));
  (writeWasteEvent as jest.Mock).mockImplementation(async () => (order.push('writeWasteEvent'), { id: 'ev-reopen' }));
  (assertActiveAdmin as jest.Mock).mockResolvedValue({ id: 'a1', role: 'ADMIN', phone: null });
  (loadAdminRequestDetail as jest.Mock).mockResolvedValue({ id: 'r1' });

  const tx = {
    $queryRaw: jest.fn(async (...args: unknown[]) => {
      if (!inTx) throw new Error('raw SQL outside $transaction');
      const [strings] = args as [TemplateStringsArray, ...unknown[]];
      if (strings.join('?').includes('"waste_requests"')) order.push('request FOR UPDATE');
      return [];
    }),
    wasteRequest: {
      findUnique: jest.fn(async () => (data === null ? null : { ...data, userId: o.lockedUserId ?? (data as { userId: string }).userId })),
      updateMany: jest.fn(async () => (order.push('request updateMany'), { count: o.requestCount ?? 1 })),
    },
    wasteUnmatchedParcel: {
      updateMany: jest.fn(async () => (order.push('unmatched updateMany'), { count: o.unmatchedCount ?? 1 })),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      inTx = true;
      try {
        const r = await fn(tx);
        order.push('tx end');
        return r;
      } finally {
        inTx = false;
      }
    }),
    wasteRequest: { findUnique: jest.fn(async () => (data === null ? null : { userId: (data as { userId: string }).userId })) },
  };
  const config = { snapshot: jest.fn().mockResolvedValue(CFG) };
  const access = {};
  const hold = {
    validateAndHold: jest.fn(async () => {
      order.push('validateAndHold');
      if (o.holdError) throw o.holdError;
      return { expiresAt: null };
    }),
  };
  const notifier = { parcelReceived: jest.fn(async () => void order.push('notify')) };
  const service = new WasteAdminRequestsService(prisma as never, config as never, access as never, hold as never, notifier as never);
  return { service, prisma, tx, hold, notifier, order };
}

describe('WasteAdminRequestsService.reopen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reopens an expired MAIL_IN request: locks first, checks caps, writes RECEIVED, one event, notifies after commit', async () => {
    const { service, tx, hold, notifier, order } = setup();
    await expect(service.reopen('a1', 'r1', { reason: 'kiện đến muộn' })).resolves.toEqual({ id: 'r1' });

    expect(order.indexOf('lockWasteCustomer')).toBeLessThan(order.indexOf('request FOR UPDATE'));
    expect(lockWasteCustomer).toHaveBeenCalledWith(tx, 'u1');
    expect(hold.validateAndHold).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        path: 'REOPEN',
        userId: 'u1',
        method: 'MAIL_IN',
        pointId: 'wh',
        lines: [{ itemId: 'wi-carton', declaredQty: 10 }],
        existing: { id: 'r1', pointId: 'wh', capDayKey: '2026-10-01', capMonthKey: '2026-10' },
      }),
      CFG,
    );
    const call = tx.wasteRequest.updateMany.mock.calls[0] as unknown as [{ where: object; data: object }];
    expect(call[0].where).toEqual({ id: 'r1', status: 'EXPIRED' });
    expect(call[0].data).toEqual({ status: 'RECEIVED', receivedAt: expect.any(Date), closedAt: null, closeReason: null });
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect(writeWasteEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        kind: 'REQUEST_REOPENED',
        actorUserId: 'a1',
        actorRole: 'ADMIN',
        requestId: 'r1',
        meta: {
          reason: 'kiện đến muộn',
          unmatchedId: null,
          subjectUserId: 'u1',
          before: { status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' },
          after: { status: 'RECEIVED' },
        },
      }),
    );
    expect(notifier.parcelReceived).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABCDE' }, 'ev-reopen');
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('notify'));
    expect(tx.wasteUnmatchedParcel.updateMany).not.toHaveBeenCalled();
  });

  it('pins a PICKUP request to its order in the status flip', async () => {
    const { service, tx } = setup({ row: request({ method: 'PICKUP', orderId: 'o1' }) });
    await service.reopen('a1', 'r1', { reason: 'kiện đến muộn' });
    expect((tx.wasteRequest.updateMany.mock.calls[0] as unknown as [{ where: object }])[0].where).toMatchObject({ orderId: 'o1' });
  });

  it('resolves the unmatched row inside the same transaction when unmatchedId is given', async () => {
    const { service, tx, order } = setup();
    await service.reopen('a1', 'r1', { reason: 'khớp kiện', unmatchedId: 'um1' });
    expect(tx.wasteUnmatchedParcel.updateMany).toHaveBeenCalledWith({
      where: { id: 'um1', status: 'OPEN' },
      data: { status: 'RESOLVED', matchedRequestId: 'r1', resolvedByUserId: 'a1', resolvedAt: expect.any(Date), resolveNote: 'khớp kiện' },
    });
    expect(order.indexOf('unmatched updateMany')).toBeLessThan(order.indexOf('tx end'));
    expect(writeWasteEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ meta: expect.objectContaining({ unmatchedId: 'um1' }) }));
  });

  it('409s and does not notify when the unmatched row is no longer open', async () => {
    const { service, notifier, order } = setup({ unmatchedCount: 0 });
    await expect(service.reopen('a1', 'r1', { reason: 'khớp kiện', unmatchedId: 'um1' })).rejects.toThrow(new ConflictException(UNMATCHED_NOT_OPEN));
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(notifier.parcelReceived).not.toHaveBeenCalled();
    expect(order).not.toContain('notify');
  });

  it('propagates the cap 409 from validateAndHold with no write, event or notify', async () => {
    const { service, tx, notifier } = setup({ holdError: new ConflictException('Vượt hạn mức tháng') });
    await expect(service.reopen('a1', 'r1', { reason: 'kiện đến muộn' })).rejects.toThrow(ConflictException);
    expect(tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(notifier.parcelReceived).not.toHaveBeenCalled();
  });

  it.each([
    ['an OPEN request', { status: 'OPEN' }],
    ['a DROP_OFF request', { method: 'DROP_OFF' }],
    ['an unattached PICKUP request', { method: 'PICKUP', orderId: null }],
  ])('rejects %s', async (_name, patch) => {
    const { service, hold, notifier } = setup({ row: request(patch) });
    await expect(service.reopen('a1', 'r1', { reason: 'kiện đến muộn' })).rejects.toThrow(NOT_REOPENABLE);
    expect(hold.validateAndHold).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(notifier.parcelReceived).not.toHaveBeenCalled();
  });

  it('409s when the status flip finds no EXPIRED row', async () => {
    const { service } = setup({ requestCount: 0 });
    await expect(service.reopen('a1', 'r1', { reason: 'kiện đến muộn' })).rejects.toThrow('Vui lòng thử lại');
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('409s when an account merge moved the request between the pre-read and the locked read', async () => {
    const { service, hold } = setup({ lockedUserId: 'u2' });
    await expect(service.reopen('a1', 'r1', { reason: 'kiện đến muộn' })).rejects.toThrow(new ConflictException('Vui lòng thử lại'));
    expect(hold.validateAndHold).not.toHaveBeenCalled();
  });

  it('404s on an unknown id without opening a transaction', async () => {
    const { service, prisma } = setup({ row: null });
    await expect(service.reopen('a1', 'nope', { reason: 'kiện đến muộn' })).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('403s a non-admin caller before any read or transaction', async () => {
    const { service, prisma } = setup();
    (assertActiveAdmin as jest.Mock).mockRejectedValueOnce(new ForbiddenException());
    await expect(service.reopen('s1', 'r1', { reason: 'kiện đến muộn' })).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not fail the write when the notification throws', async () => {
    const { service, notifier } = setup();
    notifier.parcelReceived.mockRejectedValueOnce(new Error('zns down'));
    await expect(service.reopen('a1', 'r1', { reason: 'kiện đến muộn' })).resolves.toEqual({ id: 'r1' });
  });
});
