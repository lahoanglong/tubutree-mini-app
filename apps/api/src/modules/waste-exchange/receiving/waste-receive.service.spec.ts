import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { WasteReceiveRequest } from '@tubutree/shared-types';
import { writeWasteEvent } from '../core/waste-events';
import * as matchModule from './waste-match';
import { WasteReceiveService } from './waste-receive.service';

jest.mock('../core/waste-events');
jest.mock('./waste-match');

const noCustomerField = (r: unknown) => expect(JSON.stringify(r)).not.toMatch(/"(userId|customerName|customerPhone|phone|fullName)"/);
const MIN = 60_000;

const row = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'TR-ABCDE',
  userId: 'u1',
  method: 'MAIL_IN',
  status: 'IN_TRANSIT',
  pointId: 'wh',
  orderId: null,
  trackingNorm: 'SPX123',
  trackingCode: 'SPX123',
  carrier: 'SPX',
  receivedAt: null,
  order: null,
  ...o,
});
const received = (o: Record<string, unknown> = {}) => row({ status: 'RECEIVED', receivedAt: new Date('2026-10-18T01:00:00.000Z'), ...o });
const body = (match: WasteReceiveRequest['match'] = { parcelCode: 'TR-ABCDE' }, extra: Partial<WasteReceiveRequest> = {}): WasteReceiveRequest => ({ match, ...extra });
const lastEvent = (o: Record<string, unknown> = {}) => ({
  id: 'ev0',
  actorUserId: 's1',
  createdAt: new Date(Date.now() - 3 * MIN),
  meta: { matchBasis: 'TR_CODE' },
  ...o,
});

interface Setup {
  row?: Record<string, unknown> | null;
  match?: matchModule.WasteMatchOutcome;
  updateCount?: number;
  lastReceived?: unknown;
  prevUnmatched?: unknown;
  prevRow?: unknown;
  actorError?: unknown;
}

function setup(o: Setup = {}) {
  const order: string[] = [];
  let inTx = false;
  let txIndex = 0;
  (writeWasteEvent as jest.Mock).mockImplementation(async () => (order.push('writeWasteEvent'), { id: 'ev1' }));
  (matchModule.evaluateMatch as jest.Mock).mockResolvedValue(o.match ?? { ok: true, basis: 'TR_CODE' });

  const tx = {
    $queryRaw: jest.fn(async (...args: unknown[]) => {
      if (!inTx) throw new Error('raw SQL outside $transaction');
      const [strings] = args as [TemplateStringsArray, ...unknown[]];
      if (strings.join('?').includes('"waste_requests"')) order.push('request FOR UPDATE');
      return [];
    }),
    wasteRequest: {
      findUnique: jest.fn(async () => (o.row === undefined ? row() : o.row)),
      updateMany: jest.fn(async () => (order.push('request updateMany'), { count: o.updateCount ?? 1 })),
    },
    wasteEvent: {
      findFirst: jest.fn(async (a: { where: { kind: string } }) => {
        if (a.where.kind === 'PARCEL_RECEIVED') return o.lastReceived ?? null;
        return o.prevUnmatched ?? null;
      }),
    },
    wasteUnmatchedParcel: {
      findUnique: jest.fn(async () => o.prevRow ?? null),
      create: jest.fn(async () => (order.push(`unmatched create tx${txIndex}`), { id: 'um-new' })),
    },
    wasteUserFlags: { findUnique: jest.fn(async () => ({ blockedAt: null, shipLockedAt: new Date('2026-10-01T00:00:00Z') })) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      inTx = true;
      txIndex += 1;
      try {
        const r = await fn(tx);
        order.push('tx end');
        return r;
      } finally {
        inTx = false;
      }
    }),
  };
  const access = {
    assertWarehouseActor: jest.fn(async () => {
      if (o.actorError) throw o.actorError;
      return { id: 's1', role: 'STAFF', phone: '0900000002' };
    }),
  };
  const notifier = { parcelReceived: jest.fn(async () => void order.push('notify')) };
  const svc = new WasteReceiveService(prisma as never, access as never, notifier as never);
  return { svc, tx, prisma, access, notifier, order };
}

const eventsOf = (kind: string) => (writeWasteEvent as jest.Mock).mock.calls.map((c) => c[1]).filter((e: { kind: string }) => e.kind === kind);

describe('WasteReceiveService.receive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('1. MAIL_IN IN_TRANSIT with a TR code is received, notified after the commit and writes no customer field', async () => {
    const h = setup();
    const result = await h.svc.receive('s1', 'r1', body());
    expect(result).toEqual({ outcome: 'RECEIVED', requestId: 'r1', receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(eventsOf('PARCEL_RECEIVED')).toHaveLength(1);
    expect(eventsOf('PARCEL_RECEIVED')[0].meta.matchBasis).toBe('TR_CODE');
    expect(h.notifier.parcelReceived).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABCDE' }, 'ev1');
    expect(h.order.indexOf('tx end')).toBeLessThan(h.order.indexOf('notify'));
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    noCustomerField(result);
  });

  it('1b. a differing tracking code is only logged', async () => {
    const mismatch = setup();
    expect(await mismatch.svc.receive('s1', 'r1', body({ parcelCode: 'TR-ABCDE', parcelTracking: 'ghn 999' }))).toMatchObject({ outcome: 'RECEIVED' });
    expect(eventsOf('PARCEL_RECEIVED')[0].meta).toMatchObject({ parcelTrackingNorm: 'GHN999', trackingMismatch: true });

    jest.clearAllMocks();
    const same = setup();
    await same.svc.receive('s1', 'r1', body({ parcelCode: 'TR-ABCDE', parcelTracking: ' spx 123 ' }));
    expect(eventsOf('PARCEL_RECEIVED')[0].meta).toMatchObject({ parcelTrackingNorm: 'SPX123', trackingMismatch: false });

    jest.clearAllMocks();
    const none = setup();
    await none.svc.receive('s1', 'r1', body());
    expect(eventsOf('PARCEL_RECEIVED')[0].meta).toMatchObject({ parcelTrackingNorm: null, trackingMismatch: null });
  });

  it('1c. the weight is written with the status change', async () => {
    const h = setup();
    await h.svc.receive('s1', 'r1', body({ parcelCode: 'TR-ABCDE' }, { receivedWeightGrams: 1200 }));
    expect((h.tx.wasteRequest.updateMany.mock.calls[0] as unknown as [{ data: unknown }])[0].data).toEqual({
      status: 'RECEIVED',
      receivedAt: expect.any(Date),
      receivedWeightGrams: 1200,
    });
  });

  it('2. DROP_OFF is a 409 and writes nothing', async () => {
    const h = setup({ row: row({ method: 'DROP_OFF' }) });
    await expect(h.svc.receive('s1', 'r1', body())).rejects.toThrow(ConflictException);
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(h.tx.wasteUnmatchedParcel.create).not.toHaveBeenCalled();
  });

  it('3. PICKUP unattached or with an undelivered order is a 409 and writes nothing', async () => {
    for (const r of [row({ method: 'PICKUP', orderId: null }), row({ method: 'PICKUP', orderId: 'o1', order: { status: 'SHIPPING' } })]) {
      const h = setup({ row: r });
      await expect(h.svc.receive('s1', 'r1', body(undefined))).rejects.toThrow(ConflictException);
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
      expect(h.tx.wasteUnmatchedParcel.create).not.toHaveBeenCalled();
      expect(writeWasteEvent).not.toHaveBeenCalled();
    }
  });

  it('4. PICKUP with a delivered order is received on the ORDER basis and the update is pinned to that order', async () => {
    const h = setup({ row: row({ method: 'PICKUP', orderId: 'o1', order: { status: 'DELIVERED' }, trackingNorm: null }), match: { ok: true, basis: 'ORDER' } });
    expect(await h.svc.receive('s1', 'r1', body(undefined))).toMatchObject({ outcome: 'RECEIVED' });
    expect(eventsOf('PARCEL_RECEIVED')[0].meta.matchBasis).toBe('ORDER');
    expect((h.tx.wasteRequest.updateMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({ orderId: 'o1' });
  });

  it('5. a repeat by the same staff within 10 minutes on the same basis is ALREADY_RECEIVED without a write', async () => {
    const h = setup({ row: received(), lastReceived: lastEvent() });
    const result = await h.svc.receive('s1', 'r1', body());
    expect(result).toEqual({ outcome: 'ALREADY_RECEIVED', receivedAt: '2026-10-18T01:00:00.000Z' });
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(h.tx.wasteUnmatchedParcel.create).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.order).not.toContain('notify');
  });

  it('6. a second parcel for a RECEIVED request is NOT_RECEIVABLE (other staff, too old, other basis)', async () => {
    const cases = [
      lastEvent({ actorUserId: 's2' }),
      lastEvent({ createdAt: new Date(Date.now() - 11 * MIN) }),
      lastEvent({ meta: { matchBasis: 'TRACKING_PHONE' } }),
    ];
    for (const last of cases) {
      jest.clearAllMocks();
      const h = setup({ row: received(), lastReceived: last });
      expect(await h.svc.receive('s1', 'r1', body())).toEqual({ outcome: 'UNMATCHED', unmatchedId: 'um-new', reason: 'NOT_RECEIVABLE' });
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    }
  });

  it('7. EXPIRED is EXPIRED_REQUEST and the row is written in a second transaction', async () => {
    const h = setup({ row: row({ status: 'EXPIRED' }) });
    const result = await h.svc.receive('s1', 'r1', body());
    expect(result).toEqual({ outcome: 'UNMATCHED', unmatchedId: 'um-new', reason: 'EXPIRED_REQUEST' });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(h.order.indexOf('unmatched create tx2')).toBeGreaterThan(h.order.indexOf('tx end'));
    expect(h.tx.wasteUnmatchedParcel.create).toHaveBeenCalledWith({
      data: {
        createdByUserId: 's1',
        carrier: 'SPX',
        trackingCode: 'SPX123',
        trackingNorm: 'SPX123',
        description: 'Kiện của yêu cầu TR-ABCDE',
        reason: 'EXPIRED_REQUEST',
        relatedRequestId: 'r1',
      },
    });
    noCustomerField(result);
  });

  it('8. COMPLETED, REJECTED, REVERSED and CANCELLED are NOT_RECEIVABLE', async () => {
    for (const status of ['COMPLETED', 'REJECTED', 'REVERSED', 'CANCELLED']) {
      jest.clearAllMocks();
      const h = setup({ row: row({ status }) });
      expect(await h.svc.receive('s1', 'r1', body())).toMatchObject({ outcome: 'UNMATCHED', reason: 'NOT_RECEIVABLE' });
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    }
  });

  it('9. an unmatched evaluation keeps its reason and the related request', async () => {
    const conflict = setup({ row: row({ status: 'OPEN' }), match: { ok: false, reason: 'TR_TRACKING_CONFLICT', relatedRequestId: 'r2' } });
    expect(await conflict.svc.receive('s1', 'r1', body({ parcelCode: 'TR-ZZZZZ' }))).toMatchObject({ outcome: 'UNMATCHED', reason: 'TR_TRACKING_CONFLICT' });
    expect((conflict.tx.wasteUnmatchedParcel.create.mock.calls[0] as unknown as [{ data: unknown }])[0].data).toMatchObject({ relatedRequestId: 'r1', reason: 'TR_TRACKING_CONFLICT' });
    expect(eventsOf('PARCEL_UNMATCHED')[0].meta.parcelRequestId).toBe('r2');

    for (const reason of ['TRACKING_MULTI', 'NO_MATCH'] as const) {
      jest.clearAllMocks();
      const h = setup({ row: row({ status: 'OPEN' }), match: { ok: false, reason } });
      expect(await h.svc.receive('s1', 'r1', body({ phoneMatchConfirmed: true }))).toMatchObject({ outcome: 'UNMATCHED', reason });
      expect(eventsOf('PARCEL_UNMATCHED')[0].meta.parcelRequestId).toBeNull();
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    }
  });

  it('9b. the tracking conflict wins over the status', async () => {
    const conflict: matchModule.WasteMatchOutcome = { ok: false, reason: 'TR_TRACKING_CONFLICT', relatedRequestId: 'r2' };
    for (const h of [
      setup({ row: row({ status: 'EXPIRED' }), match: conflict }),
      setup({ row: received(), lastReceived: lastEvent({ createdAt: new Date(Date.now() - MIN) }), match: conflict }),
    ]) {
      expect(await h.svc.receive('s1', 'r1', body({ parcelCode: 'TR-ZZZZZ' }))).toMatchObject({ outcome: 'UNMATCHED', reason: 'TR_TRACKING_CONFLICT' });
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    }
    const metas = eventsOf('PARCEL_UNMATCHED').map((e) => e.meta);
    expect(metas).toHaveLength(2);
    for (const m of metas) expect(m).toMatchObject({ reason: 'TR_TRACKING_CONFLICT', parcelRequestId: 'r2' });
  });

  it('10. an unmatched replay within 10 minutes returns the open row without a write', async () => {
    const h = setup({
      row: row({ status: 'EXPIRED' }),
      prevUnmatched: { id: 'ev9', meta: { unmatchedId: 'um1' } },
      prevRow: { id: 'um1', status: 'OPEN', reason: 'EXPIRED_REQUEST' },
    });
    expect(await h.svc.receive('s1', 'r1', body())).toEqual({ outcome: 'UNMATCHED', unmatchedId: 'um1', reason: 'EXPIRED_REQUEST' });
    expect(h.tx.wasteUnmatchedParcel.create).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
    const where = (h.tx.wasteEvent.findFirst.mock.calls.at(-1) as unknown as [{ where: { createdAt: { gt: Date } } }])[0].where;
    expect(where.createdAt.gt).toBeInstanceOf(Date);
  });

  it('10b. a resolved earlier row is not a replay', async () => {
    const h = setup({
      row: row({ status: 'EXPIRED' }),
      prevUnmatched: { id: 'ev9', meta: { unmatchedId: 'um1' } },
      prevRow: { id: 'um1', status: 'RESOLVED', reason: 'EXPIRED_REQUEST' },
    });
    expect(await h.svc.receive('s1', 'r1', body())).toEqual({ outcome: 'UNMATCHED', unmatchedId: 'um-new', reason: 'EXPIRED_REQUEST' });
    expect(h.tx.wasteUnmatchedParcel.create).toHaveBeenCalledTimes(1);
    expect(eventsOf('PARCEL_UNMATCHED')).toHaveLength(1);
  });

  it('11. a demoted staff member is refused before any transaction', async () => {
    const h = setup({ actorError: new ForbiddenException('no') });
    await expect(h.svc.receive('s1', 'r1', body())).rejects.toThrow(ForbiddenException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('12. a ship lock does not stop the warehouse receiving a parcel', async () => {
    const h = setup();
    expect(await h.svc.receive('s1', 'r1', body())).toMatchObject({ outcome: 'RECEIVED' });
    expect(h.tx.wasteUserFlags.findUnique).not.toHaveBeenCalled();
    expect(h.tx.wasteUnmatchedParcel.create).not.toHaveBeenCalled();
  });

  it('13. an unknown request is a 404, and a lost update race is a retry 409', async () => {
    const missing = setup({ row: null });
    await expect(missing.svc.receive('s1', 'r1', body())).rejects.toThrow(NotFoundException);

    const raced = setup({ updateCount: 0 });
    await expect(raced.svc.receive('s1', 'r1', body())).rejects.toThrow('Vui lòng thử lại');
    expect(raced.notifier.parcelReceived).not.toHaveBeenCalled();
  });

  it('14. a failing notifier never fails the receive', async () => {
    const h = setup();
    h.notifier.parcelReceived.mockRejectedValueOnce(new Error('down'));
    expect(await h.svc.receive('s1', 'r1', body())).toMatchObject({ outcome: 'RECEIVED' });
  });

  it('15. the actor is re-read inside the transaction after the row lock', async () => {
    const h = setup();
    await h.svc.receive('s1', 'r1', body());
    expect(h.access.assertWarehouseActor).toHaveBeenNthCalledWith(1, 's1');
    expect(h.access.assertWarehouseActor).toHaveBeenNthCalledWith(2, 's1', h.tx);
  });
});
