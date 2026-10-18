import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { writeWasteEvent } from '../core/waste-events';
import {
  attachPickupRequest,
  buildPickupRecyclingNote,
  lockPickupRequestForCheckout,
  PICKUP_NOTE_MAX,
  PICKUP_PAUSED_MESSAGE,
  PICKUP_REQUEST_GONE_MESSAGE,
  readPickupGate,
} from './waste-pickup-attach';

jest.mock('../core/waste-events', () => ({ writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev1' }) }));

const LINES = [
  { itemName: 'Vỏ hộp sữa', unitLabel: 'vỏ', declaredQty: 12 },
  { itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 2 },
];

function fakeTx(o: { locked?: { id: string; code: string }[]; flags?: { blockedAt: Date | null; shipLockedAt: Date | null } | null; attachCount?: number } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(o.locked ?? [{ id: 'r1', code: 'TR-ABC23' }]),
    wasteRequestLine: { findMany: jest.fn().mockResolvedValue(LINES) },
    wasteUserFlags: { findUnique: jest.fn().mockResolvedValue(o.flags ?? null) },
    wasteRequest: { updateMany: jest.fn().mockResolvedValue({ count: o.attachCount ?? 1 }) },
  };
  return tx as typeof tx & Prisma.TransactionClient;
}
const sqlOf = (m: jest.Mock) => (m.mock.calls[0]![0] as TemplateStringsArray).join('?');

beforeEach(() => (writeWasteEvent as jest.Mock).mockClear());

describe('readPickupGate (pre-tx, §12.2 step 2)', () => {
  // SystemConfigService.get is generic (get<T>(key, fallback?: T): Promise<T>), so a jest.fn is not assignable without the cast.
  const cfg = (v: Record<string, unknown>) =>
    ({ get: jest.fn(async (k: string, fb?: unknown) => (k in v ? v[k] : fb)) }) as unknown as Pick<SystemConfigService, 'get'> & { get: jest.Mock };

  it('no SystemConfigService (hand-built service) → false, Gomdon not asked', async () => {
    const gomdon = jest.fn().mockResolvedValue(true);
    await expect(readPickupGate(undefined, gomdon)).resolves.toBe(false);
    expect(gomdon).not.toHaveBeenCalled();
  });

  it('true only when waste.enabled, waste.lane_pickup_enabled and Gomdon are all true', async () => {
    const on = { 'waste.enabled': true, 'waste.lane_pickup_enabled': true };
    await expect(readPickupGate(cfg(on), async () => true)).resolves.toBe(true);
    await expect(readPickupGate(cfg(on), async () => false)).resolves.toBe(false);
    await expect(readPickupGate(cfg({ ...on, 'waste.enabled': false }), async () => true)).resolves.toBe(false);
    await expect(readPickupGate(cfg({ ...on, 'waste.lane_pickup_enabled': false }), async () => true)).resolves.toBe(false);
    await expect(readPickupGate(cfg({ ...on, 'waste.enabled': 'true' }), async () => true)).resolves.toBe(false);
  });

  it('reads both keys with default false and skips the Gomdon check when a waste flag is off', async () => {
    const c = cfg({ 'waste.enabled': false });
    const gomdon = jest.fn().mockResolvedValue(true);
    await readPickupGate(c, gomdon);
    expect(c.get).toHaveBeenCalledWith('waste.enabled', false);
    expect(gomdon).not.toHaveBeenCalled();
  });
});

describe('lockPickupRequestForCheckout (§12.2 step 2 (a) and (b))', () => {
  it('locks the row FOR UPDATE with the five conditions, never by expiresAt, binding only id and userId', async () => {
    const tx = fakeTx();
    await lockPickupRequestForCheckout(tx, 'u1', 'r1');
    const sql = sqlOf(tx.$queryRaw);
    for (const part of ['FROM "waste_requests"', '"id" = ?', '"userId" = ?', `"method" = 'PICKUP'`, `"status" = 'OPEN'`, '"orderId" IS NULL', 'FOR UPDATE']) {
      expect(sql).toContain(part);
    }
    expect(sql).not.toContain('expiresAt');
    expect(tx.$queryRaw.mock.calls[0]!.slice(1)).toEqual(['r1', 'u1']);
  });

  it('reads lines after the lock, then the flags with tx, and returns id, code and lines', async () => {
    const tx = fakeTx();
    const res = await lockPickupRequestForCheckout(tx, 'u1', 'r1');
    expect(res).toEqual({ id: 'r1', code: 'TR-ABC23', lines: LINES });
    expect(tx.wasteRequestLine.findMany).toHaveBeenCalledWith({
      where: { requestId: 'r1' },
      orderBy: { id: 'asc' },
      select: { itemName: true, unitLabel: true, declaredQty: true },
    });
    expect(tx.wasteUserFlags.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { blockedAt: true, shipLockedAt: true } });
    const order = (m: jest.Mock) => m.mock.invocationCallOrder[0]!;
    expect(order(tx.$queryRaw)).toBeLessThan(order(tx.wasteRequestLine.findMany));
    expect(order(tx.$queryRaw)).toBeLessThan(order(tx.wasteUserFlags.findUnique));
  });

  it('no matching row → 409 "Yêu cầu thu rác đã hết hạn hoặc đã huỷ", flags not read', async () => {
    const tx = fakeTx({ locked: [] });
    const err = await lockPickupRequestForCheckout(tx, 'u1', 'r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('Yêu cầu thu rác đã hết hạn hoặc đã huỷ');
    expect(PICKUP_REQUEST_GONE_MESSAGE).toBe('Yêu cầu thu rác đã hết hạn hoặc đã huỷ');
    expect(tx.wasteUserFlags.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['blockedAt', { blockedAt: new Date('2026-10-01T00:00:00Z'), shipLockedAt: null }],
    ['shipLockedAt', { blockedAt: null, shipLockedAt: new Date('2026-10-01T00:00:00Z') }],
  ])('%s set → 409 with the paused message', async (_k, flags) => {
    const err = await lockPickupRequestForCheckout(fakeTx({ flags }), 'u1', 'r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('Thu kèm rác đang tạm dừng với tài khoản của bạn, hãy tắt công tắc để đặt đơn');
    expect(PICKUP_PAUSED_MESSAGE).toBe((err as ConflictException).message);
  });

  it('flags row with both null, or no flags row → passes', async () => {
    await expect(lockPickupRequestForCheckout(fakeTx({ flags: { blockedAt: null, shipLockedAt: null } }), 'u1', 'r1')).resolves.toMatchObject({ id: 'r1' });
    await expect(lockPickupRequestForCheckout(fakeTx({ flags: null }), 'u1', 'r1')).resolves.toMatchObject({ id: 'r1' });
  });
});

describe('buildPickupRecyclingNote (§12.2 step 2 (c))', () => {
  it('server-built: TR code then "<item>: N <unit>" lines, no customer text', () => {
    expect(buildPickupRecyclingNote({ id: 'r1', code: 'TR-ABC23', lines: LINES })).toBe('Thu kèm rác TR-ABC23: Vỏ hộp sữa: 12 vỏ, Thùng carton: 2 thùng');
  });

  it('never longer than PICKUP_NOTE_MAX (500) and always keeps the code', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ itemName: `Món rất dài số ${i} `.repeat(3), unitLabel: 'cái', declaredQty: 99 }));
    const note = buildPickupRecyclingNote({ id: 'r1', code: 'TR-ABC23', lines: many });
    expect(PICKUP_NOTE_MAX).toBe(500);
    expect(note.length).toBeLessThanOrEqual(500);
    expect(note.startsWith('Thu kèm rác TR-ABC23: ')).toBe(true);
  });
});

describe('attachPickupRequest (§12.2 step 2 (d))', () => {
  it('one conditional updateMany setting orderId and expiresAt NULL, then one REQUEST_ATTACHED event by the customer', async () => {
    const tx = fakeTx();
    await attachPickupRequest(tx, 'u1', 'r1', 'o1');
    expect(tx.wasteRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', userId: 'u1', method: 'PICKUP', status: 'OPEN', orderId: null },
      data: { orderId: 'o1', expiresAt: null },
    });
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect(writeWasteEvent).toHaveBeenCalledWith(tx, {
      kind: 'REQUEST_ATTACHED',
      actorUserId: 'u1',
      actorRole: 'CUSTOMER',
      requestId: 'r1',
      meta: { orderId: 'o1', before: { status: 'OPEN', orderId: null }, after: { status: 'OPEN', orderId: 'o1' } },
    });
  });

  it('count 0 → 409 with the same "hết hạn hoặc đã huỷ" text and no event', async () => {
    const err = await attachPickupRequest(fakeTx({ attachCount: 0 }), 'u1', 'r1', 'o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('Yêu cầu thu rác đã hết hạn hoặc đã huỷ');
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });
});
