import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertActiveAdmin, assertActiveStaff } from '../../../common/staff-access';
import {
  WASTE_EXPIRED_WHERE,
  WASTE_TO_COUNT_WHERE,
  wasteCustomerBlockedWhere,
  wasteOrderMismatchWhere,
  wasteOrderNotDeliveredWhere,
  wasteTransitOverdueWhere,
} from '../core/waste-queue-filters';
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
  (assertActiveStaff as jest.Mock).mockResolvedValue({ id: 'staff1', role: 'STAFF', phone: null });
  (loadAdminRequestDetail as jest.Mock).mockResolvedValue({ id: 'r1' });

  const tx = {
    $queryRaw: jest.fn(async (...args: unknown[]) => {
      if (!inTx) throw new Error('raw SQL outside $transaction');
      const [strings] = args as [TemplateStringsArray, ...unknown[]];
      if (strings.join('?').includes('"waste_requests"')) order.push('request FOR UPDATE');
      return [];
    }),
    wasteRequest: {
      findUnique: jest.fn(async () => (order.push('request findUnique'), data === null ? null : { ...data, userId: o.lockedUserId ?? (data as { userId: string }).userId })),
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
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toBe('SELECT "id" FROM "waste_requests" WHERE "id" = ? FOR UPDATE');
    expect(values).toEqual(['r1']);
    expect(order.indexOf('request FOR UPDATE')).toBeLessThan(order.indexOf('request findUnique'));
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

const NOW = new Date('2026-10-18T03:00:00.000Z');
const CREATED = new Date('2026-10-01T00:00:00.000Z');

const listRow = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'TR-ABCDE',
  userId: 'u1',
  method: 'MAIL_IN',
  status: 'RECEIVED',
  closeReason: null,
  createdAt: CREATED,
  expiresAt: null,
  inTransitAt: null,
  receivedAt: null,
  estimatedPoints: 10_000,
  pointsAwarded: null,
  pointId: 'wh',
  carrier: null,
  trackingCode: null,
  trackingConflict: false,
  orderId: null,
  user: { id: 'u1', fullName: 'Nguyễn Văn An', phone: '0901234567', isBlocked: false, wasteFlags: null },
  point: { name: 'Kho Tubu' },
  order: null,
  ...o,
});

interface AdminSetup {
  rows?: Record<string, unknown>[];
  costRow?: Record<string, unknown> | null;
  flags?: Record<string, unknown> | null;
  userExists?: boolean;
  warehouse?: { id: string } | null;
}

function adminSetup(o: AdminSetup = {}) {
  let inTx = false;
  (writeWasteEvent as jest.Mock).mockResolvedValue({ id: 'ev1' });
  (assertActiveAdmin as jest.Mock).mockResolvedValue({ id: 'a1', role: 'ADMIN', phone: null });
  (assertActiveStaff as jest.Mock).mockResolvedValue({ id: 'staff1', role: 'STAFF', phone: null });
  (loadAdminRequestDetail as jest.Mock).mockResolvedValue({ id: 'r1' });

  const costRow = o.costRow === undefined ? { id: 'r1', method: 'MAIL_IN', userId: 'u1', pointId: 'wh', carrierCostVnd: null, receivedWeightGrams: null } : o.costRow;
  let flagRow = o.flags === undefined ? null : o.flags;
  const tx = {
    $queryRaw: jest.fn(async () => {
      if (!inTx) throw new Error('raw SQL outside $transaction');
      return [];
    }),
    wasteRequest: {
      findUnique: jest.fn(async () => costRow),
      update: jest.fn(async (a: { data: object }) => ({ ...costRow, ...a.data })),
      updateMany: jest.fn(),
    },
    wasteUserFlags: {
      createMany: jest.fn(async () => {
        if (flagRow === null) flagRow = { userId: 'u1', shipLockedAt: null, shipUnlockedAt: null, blockedAt: null, reason: null, setByUserId: null, updatedAt: new Date() };
        return { count: 1 };
      }),
      findUnique: jest.fn(async () => flagRow),
      update: jest.fn(async (a: { data: object }) => ({ ...flagRow, ...a.data, updatedAt: new Date() })),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      inTx = true;
      try {
        return await fn(tx);
      } finally {
        inTx = false;
      }
    }),
    wasteRequest: { findMany: jest.fn(async () => o.rows ?? []), updateMany: jest.fn() },
    wasteUserFlags: { findUnique: jest.fn(async () => o.flags ?? null) },
    user: { findUnique: jest.fn(async () => (o.userExists === false ? null : { id: 'u1' })) },
  };
  const config = { snapshot: jest.fn().mockResolvedValue({ ...CFG, inTransitReviewDays: 30 }) };
  const access = { warehousePoint: jest.fn(async () => (o.warehouse === undefined ? { id: 'wh' } : o.warehouse)) };
  const service = new WasteAdminRequestsService(prisma as never, config as never, access as never, {} as never, {} as never);
  return { service, prisma, tx, access, config };
}

const findManyArg = (prisma: { wasteRequest: { findMany: jest.Mock } }) => prisma.wasteRequest.findMany.mock.calls[0]![0] as { where: { AND: unknown[] }; take: number; orderBy: unknown };

describe('WasteAdminRequestsService.queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it.each([
    ['TO_COUNT', () => WASTE_TO_COUNT_WHERE],
    ['EXPIRED', () => WASTE_EXPIRED_WHERE],
    ['CUSTOMER_BLOCKED', () => wasteCustomerBlockedWhere()],
    ['ORDER_NOT_DELIVERED', () => wasteOrderNotDeliveredWhere()],
    ['TRANSIT_OVERDUE', () => wasteTransitOverdueWhere(NOW, 30)],
    ['ORDER_MISMATCH', () => wasteOrderMismatchWhere()],
  ] as const)('maps filter %s to its shared where', async (filter, expected) => {
    const { service, prisma } = adminSetup();
    await service.queue('a1', { filter });
    expect(findManyArg(prisma).where.AND).toContainEqual(expected());
  });

  it('adds method, status and point filters and orders by createdAt then id', async () => {
    const { service, prisma } = adminSetup();
    await service.queue('s1', { method: 'MAIL_IN', status: 'RECEIVED', pointId: 'wh' });
    const arg = findManyArg(prisma);
    expect(arg.where.AND).toEqual(expect.arrayContaining([{ method: 'MAIL_IN' }, { status: 'RECEIVED' }, { pointId: 'wh' }]));
    expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(arg.take).toBe(51);
  });

  it('masks name and phone and omits userId for STAFF', async () => {
    const { service } = adminSetup({ rows: [listRow()] });
    (assertActiveStaff as jest.Mock).mockResolvedValueOnce({ id: 's1', role: 'STAFF', phone: null });
    const out = await service.queue('s1', { filter: 'TO_COUNT' });
    expect(out.rows[0]).toMatchObject({ customerName: 'An***', customerPhone: '090****567', pointName: 'Kho Tubu', createdAt: CREATED.toISOString() });
    expect(out.rows[0]).not.toHaveProperty('userId');
    expect(out.nextCursor).toBeNull();
  });

  it('returns the raw name, phone and userId for ADMIN', async () => {
    const { service } = adminSetup({ rows: [listRow()] });
    const out = await service.queue('a1', { userId: 'u1' });
    expect(out.rows[0]).toMatchObject({ customerName: 'Nguyễn Văn An', customerPhone: '0901234567', userId: 'u1' });
  });

  it.each([[{ filter: 'TRANSIT_OVERDUE' }], [{ filter: 'ORDER_MISMATCH' }], [{ userId: 'u1' }]] as const)('403s STAFF for %j before any read', async (q) => {
    const { service, prisma } = adminSetup();
    (assertActiveAdmin as jest.Mock).mockRejectedValueOnce(new ForbiddenException());
    await expect(service.queue('s1', { ...q })).rejects.toThrow(ForbiddenException);
    expect(prisma.wasteRequest.findMany).not.toHaveBeenCalled();
    expect(assertActiveStaff).not.toHaveBeenCalled();
  });

  it('pages: limit 2 with three rows returns two and a cursor of the second', async () => {
    const rows = [listRow({ id: 'r1' }), listRow({ id: 'r2', createdAt: new Date('2026-10-02T00:00:00.000Z') }), listRow({ id: 'r3' })];
    const { service, prisma } = adminSetup({ rows });
    const out = await service.queue('a1', { limit: 2 });
    expect(findManyArg(prisma).take).toBe(3);
    expect(out.rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(out.nextCursor).toBe('2026-10-02T00:00:00.000Z|r2');
  });

  it('caps the page size at 100', async () => {
    const { service, prisma } = adminSetup();
    await service.queue('a1', { limit: 5000 });
    expect(findManyArg(prisma).take).toBe(101);
  });

  it('turns a valid cursor into a createdAt then id keyset condition', async () => {
    const { service, prisma } = adminSetup();
    await service.queue('a1', { cursor: '2026-10-02T00:00:00.000Z|r2' });
    const d = new Date('2026-10-02T00:00:00.000Z');
    expect(findManyArg(prisma).where.AND).toContainEqual({ OR: [{ createdAt: { gt: d } }, { createdAt: d, id: { gt: 'r2' } }] });
  });

  it.each(['abc', 'not-a-date|r1', '2026-01-01T00:00:00.000Z|', '|r1', '2026-01-01|r1'])('cursor %s → 400', async (cursor) => {
    const { service, prisma } = adminSetup();
    await expect(service.queue('a1', { cursor })).rejects.toThrow(BadRequestException);
    expect(prisma.wasteRequest.findMany).not.toHaveBeenCalled();
  });

  it('waitingReason: blocked flag, blocked user, closed row, order not delivered', async () => {
    const blockedUser = { id: 'u1', fullName: null, phone: null, isBlocked: true, wasteFlags: null };
    const flagged = { id: 'u1', fullName: null, phone: null, isBlocked: false, wasteFlags: { blockedAt: new Date() } };
    const rows = [
      listRow({ id: 'a', status: 'OPEN', user: blockedUser }),
      listRow({ id: 'b', status: 'OPEN', user: flagged }),
      listRow({ id: 'c', status: 'COMPLETED', user: blockedUser }),
      listRow({ id: 'd', method: 'PICKUP', status: 'OPEN', orderId: 'o1', order: { code: 'DH1', status: 'SHIPPING' } }),
      listRow({ id: 'e', method: 'PICKUP', status: 'OPEN', orderId: 'o1', order: { code: 'DH1', status: 'DELIVERED' } }),
    ];
    const { service } = adminSetup({ rows });
    const out = await service.queue('a1', {});
    expect(out.rows.map((r) => r.waitingReason)).toEqual(['CUSTOMER_BLOCKED', 'CUSTOMER_BLOCKED', null, 'ORDER_NOT_DELIVERED', null]);
    expect(out.rows[3]!.orderCode).toBe('DH1');
  });
});

describe('WasteAdminRequestsService.lookup', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the code, tracking and order OR for a typed code', async () => {
    const { service, prisma } = adminSetup({ rows: [listRow()] });
    const out = await service.lookup('s1', ' tr-abcde ');
    expect(prisma.wasteRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { code: 'TR-ABCDE' },
            {
              AND: [
                { status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] } },
                {
                  OR: [
                    { trackingNorm: 'TR-ABCDE' },
                    { order: { code: 'tr-abcde' } },
                    { order: { code: 'TR-ABCDE' } },
                    { order: { gomdonOrderId: 'tr-abcde' } },
                    { order: { gomdonPartnerCode: 'tr-abcde' } },
                  ],
                },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 20,
      }),
    );
    expect(out).toHaveLength(1);
  });

  it('masks the customer for STAFF', async () => {
    const { service } = adminSetup({ rows: [listRow()] });
    const out = await service.lookup('s1', 'TR-ABCDE');
    expect(out[0]).toMatchObject({ customerName: 'An***', customerPhone: '090****567' });
    expect(out[0]).not.toHaveProperty('userId');
  });

  it('records LOOKUP_MISS with the warehouse point and 404s when nothing matches', async () => {
    const { service, prisma } = adminSetup({ rows: [] });
    await expect(service.lookup('s1', 'TR-ZZZZZ')).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
    expect(writeWasteEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ kind: 'LOOKUP_MISS', actorUserId: 's1', actorRole: 'STAFF', pointId: 'wh', meta: expect.objectContaining({ route: 'ADMIN' }) }),
    );
  });
});

describe('WasteAdminRequestsService.detail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes viewerIsAdmin from the re-read role', async () => {
    const { service, prisma, access } = adminSetup();
    await service.detail('a1', 'r1');
    expect(loadAdminRequestDetail).toHaveBeenLastCalledWith(prisma, access, 'r1', false);
    (assertActiveStaff as jest.Mock).mockResolvedValueOnce({ id: 'a1', role: 'ADMIN', phone: null });
    await service.detail('a1', 'r1');
    expect(loadAdminRequestDetail).toHaveBeenLastCalledWith(prisma, access, 'r1', true);
  });
});

describe('WasteAdminRequestsService.setCost', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes one REQUEST_COST_UPDATED event on a change, under the row lock', async () => {
    const { service, tx } = adminSetup();
    await expect(service.setCost('a1', 'r1', { carrierCostVnd: 30_000 })).resolves.toEqual({ id: 'r1' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.wasteRequest.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { carrierCostVnd: 30_000 } });
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect(writeWasteEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        kind: 'REQUEST_COST_UPDATED',
        actorUserId: 'a1',
        actorRole: 'ADMIN',
        requestId: 'r1',
        pointId: 'wh',
        meta: {
          subjectUserId: 'u1',
          before: { carrierCostVnd: null, receivedWeightGrams: null },
          after: { carrierCostVnd: 30_000, receivedWeightGrams: null },
        },
      }),
    );
    expect(loadAdminRequestDetail).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', true);
  });

  it('writes no event and no update when the values are equal', async () => {
    const { service, tx } = adminSetup({ costRow: { id: 'r1', method: 'MAIL_IN', userId: 'u1', pointId: 'wh', carrierCostVnd: 30_000, receivedWeightGrams: 900 } });
    await service.setCost('a1', 'r1', { carrierCostVnd: 30_000, receivedWeightGrams: 900 });
    expect(tx.wasteRequest.update).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('409s a carrier cost on a DROP_OFF request', async () => {
    const { service, tx } = adminSetup({ costRow: { id: 'r1', method: 'DROP_OFF', userId: 'u1', pointId: 'p1', carrierCostVnd: null, receivedWeightGrams: null } });
    await expect(service.setCost('a1', 'r1', { carrierCostVnd: 30_000 })).rejects.toThrow(new ConflictException('Yêu cầu mang tới điểm nhận không có phí vận chuyển'));
    expect(tx.wasteRequest.update).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('accepts a weight on a DROP_OFF request', async () => {
    const { service, tx } = adminSetup({ costRow: { id: 'r1', method: 'DROP_OFF', userId: 'u1', pointId: 'p1', carrierCostVnd: null, receivedWeightGrams: null } });
    await service.setCost('a1', 'r1', { receivedWeightGrams: 900 });
    expect(tx.wasteRequest.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { receivedWeightGrams: 900 } });
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect(writeWasteEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ kind: 'REQUEST_COST_UPDATED' }));
  });

  it('400s when neither field is given', async () => {
    const { service, prisma } = adminSetup();
    await expect(service.setCost('a1', 'r1', {})).rejects.toThrow(new BadRequestException('Cần nhập phí vận chuyển hoặc khối lượng'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('404s an unknown request', async () => {
    const { service } = adminSetup({ costRow: null });
    await expect(service.setCost('a1', 'nope', { carrierCostVnd: 1 })).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
  });

  it('403s STAFF before any read', async () => {
    const { service, prisma } = adminSetup();
    (assertActiveAdmin as jest.Mock).mockRejectedValueOnce(new ForbiddenException());
    await expect(service.setCost('s1', 'r1', { carrierCostVnd: 1 })).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('WasteAdminRequestsService user flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  const row = (o: Record<string, unknown> = {}) => ({
    userId: 'u1',
    shipLockedAt: null,
    shipUnlockedAt: null,
    blockedAt: null,
    reason: null,
    setByUserId: null,
    updatedAt: new Date('2026-10-10T00:00:00.000Z'),
    ...o,
  });

  it('getFlags of a user without a row returns all-null fields', async () => {
    const { service } = adminSetup();
    await expect(service.getFlags('a1', 'u1')).resolves.toEqual({
      userId: 'u1',
      shipLockedAt: null,
      shipUnlockedAt: null,
      blockedAt: null,
      reason: null,
      setByUserId: null,
      updatedAt: null,
    });
  });

  it('getFlags returns ISO dates of an existing row', async () => {
    const at = new Date('2026-10-05T00:00:00.000Z');
    const { service } = adminSetup({ flags: row({ shipLockedAt: at, reason: 'x', setByUserId: 'a0' }) });
    await expect(service.getFlags('a1', 'u1')).resolves.toMatchObject({ shipLockedAt: at.toISOString(), reason: 'x', setByUserId: 'a0', updatedAt: '2026-10-10T00:00:00.000Z' });
  });

  it('getFlags 404s a missing user', async () => {
    const { service } = adminSetup({ userExists: false });
    await expect(service.getFlags('a1', 'u1')).rejects.toThrow(new NotFoundException('Không tìm thấy người dùng'));
  });

  it('lock sets shipLockedAt, locks the flags row, writes one event and cancels no request', async () => {
    const { service, tx, prisma } = adminSetup();
    const out = await service.setFlags('a1', 'u1', { shipLocked: true, reason: 'nghi ngờ' });
    expect(tx.wasteUserFlags.createMany).toHaveBeenCalledWith({ data: [{ userId: 'u1' }], skipDuplicates: true });
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('"waste_user_flags"');
    expect(strings.join('?')).toContain('FOR UPDATE');
    expect(values).toEqual(['u1']);
    expect(tx.wasteUserFlags.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { shipLockedAt: NOW, reason: 'nghi ngờ', setByUserId: 'a1' } });
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect(writeWasteEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        kind: 'USER_FLAGS_UPDATED',
        actorUserId: 'a1',
        actorRole: 'ADMIN',
        meta: expect.objectContaining({ subjectUserId: 'u1', reason: 'nghi ngờ' }),
      }),
    );
    expect(out).toMatchObject({ userId: 'u1', shipLockedAt: NOW.toISOString(), setByUserId: 'a1', reason: 'nghi ngờ' });
    expect(tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.wasteRequest.updateMany).not.toHaveBeenCalled();
  });

  it('unlock clears shipLockedAt and stamps shipUnlockedAt', async () => {
    const { service, tx } = adminSetup({ flags: row({ shipLockedAt: new Date('2026-10-05T00:00:00.000Z') }) });
    const out = await service.setFlags('a1', 'u1', { shipLocked: false, reason: 'mở khoá' });
    expect(tx.wasteUserFlags.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { shipLockedAt: null, shipUnlockedAt: NOW, reason: 'mở khoá', setByUserId: 'a1' },
    });
    expect(out).toMatchObject({ shipLockedAt: null, shipUnlockedAt: NOW.toISOString() });
  });

  it('block sets blockedAt and unblock clears it', async () => {
    const a = adminSetup();
    await a.service.setFlags('a1', 'u1', { blocked: true, reason: 'gian lận' });
    expect(a.tx.wasteUserFlags.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { blockedAt: NOW, reason: 'gian lận', setByUserId: 'a1' } });
    const b = adminSetup({ flags: row({ blockedAt: new Date('2026-10-05T00:00:00.000Z') }) });
    await b.service.setFlags('a1', 'u1', { blocked: false, reason: 'xong' });
    expect(b.tx.wasteUserFlags.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { blockedAt: null, reason: 'xong', setByUserId: 'a1' } });
  });

  it('writes no update and no event when nothing changes', async () => {
    const { service, tx } = adminSetup({ flags: row({ shipLockedAt: new Date('2026-10-05T00:00:00.000Z') }) });
    const out = await service.setFlags('a1', 'u1', { shipLocked: true, blocked: false, reason: 'lại' });
    expect(tx.wasteUserFlags.update).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(out.shipLockedAt).toBe('2026-10-05T00:00:00.000Z');
  });

  it('400s when neither flag is given', async () => {
    const { service, prisma } = adminSetup();
    await expect(service.setFlags('a1', 'u1', { reason: 'x' })).rejects.toThrow(new BadRequestException('Cần chọn khoá hoặc mở khoá'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('404s a missing user', async () => {
    const { service, prisma } = adminSetup({ userExists: false });
    await expect(service.setFlags('a1', 'nope', { shipLocked: true, reason: 'x' })).rejects.toThrow(new NotFoundException('Không tìm thấy người dùng'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('403s STAFF on both routes', async () => {
    const { service } = adminSetup();
    (assertActiveAdmin as jest.Mock).mockRejectedValue(new ForbiddenException());
    await expect(service.getFlags('s1', 'u1')).rejects.toThrow(ForbiddenException);
    await expect(service.setFlags('s1', 'u1', { shipLocked: true, reason: 'x' })).rejects.toThrow(ForbiddenException);
    (assertActiveAdmin as jest.Mock).mockReset();
  });
});
