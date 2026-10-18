import { ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertActiveAdmin } from '../../../common/staff-access';
import { applyPointsDelta } from '../../loyalty/points-ledger';
import { loadPointExpiryTxns, lotRecoverable } from '../../loyalty/loyalty-expiry.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteReverseService } from './waste-reverse.service';

jest.mock('../../../common/staff-access');
jest.mock('../../loyalty/points-ledger');
jest.mock('../../loyalty/loyalty-expiry.service', () => ({
  ...jest.requireActual('../../loyalty/loyalty-expiry.service'),
  lotRecoverable: jest.fn(),
  loadPointExpiryTxns: jest.fn().mockResolvedValue([]),
}));
jest.mock('../core/waste-events');

const CFG = { shortfallLockPct: 50, shortfallLockStreak: 3 };
const BODY = { reason: 'gian lận' };

const row = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'TR-ABCDE',
  userId: 'u1',
  method: 'MAIL_IN',
  status: 'COMPLETED',
  pointId: 'p1',
  orderId: null,
  pointsAwarded: 20_000,
  reversalShortfallPoints: null,
  ...o,
});

interface Setup {
  row?: Record<string, unknown> | null;
  balance?: number;
  recoverable?: number | null;
  updateCount?: number;
  applied?: boolean;
  txError?: unknown;
  assertError?: unknown;
}

function setup(o: Setup = {}) {
  const order: string[] = [];
  let inTx = false;
  const data = o.row === undefined ? row() : o.row;
  (assertActiveAdmin as jest.Mock).mockReset();
  if (o.assertError) (assertActiveAdmin as jest.Mock).mockRejectedValue(o.assertError);
  else (assertActiveAdmin as jest.Mock).mockResolvedValue({ id: 'a1', role: 'ADMIN', phone: null });
  (applyPointsDelta as jest.Mock).mockReset().mockImplementation(async () => (order.push('applyPointsDelta'), { applied: o.applied ?? true, entryId: 'e1' }));
  (lotRecoverable as jest.Mock).mockReset().mockReturnValue(o.recoverable === undefined ? 20_000 : o.recoverable);
  (loadPointExpiryTxns as jest.Mock).mockReset().mockResolvedValue([]);
  (writeWasteEvent as jest.Mock).mockReset().mockImplementation(async () => (order.push('writeWasteEvent'), { id: 'ev1' }));

  const tx = {
    $queryRaw: jest.fn(async (...args: unknown[]) => {
      if (!inTx) throw new Error('raw SQL outside $transaction');
      const [strings] = args as [TemplateStringsArray, ...unknown[]];
      const sql = strings.join('?');
      if (sql.includes('FROM "users"')) {
        order.push('users FOR UPDATE');
        return [{ pointsBalance: o.balance ?? 50_000 }];
      }
      order.push('request FOR UPDATE');
      return [];
    }),
    $executeRaw: jest.fn(),
    wasteRequest: {
      findUnique: jest.fn(async () => data),
      updateMany: jest.fn(async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => (order.push('request updateMany'), { count: o.updateCount ?? 1 })),
    },
    gameProfile: { update: jest.fn(), updateMany: jest.fn() },
    wastePointUsage: { update: jest.fn(), updateMany: jest.fn(), upsert: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      inTx = true;
      try {
        if (o.txError) throw o.txError;
        const r = await fn(tx);
        order.push('tx end');
        return r;
      } finally {
        inTx = false;
      }
    }),
  };
  const config = { snapshot: jest.fn().mockResolvedValue(CFG) };
  const notifier = { pointsReversed: jest.fn(async () => void order.push('notify')) };
  const shipLock = { evaluateAndLock: jest.fn(async () => (order.push('shipLock'), { locked: false, shipLockedAt: null, cancelledRequestIds: [] })) };
  const svc = new WasteReverseService(prisma as never, config as never, notifier as never, shipLock as never);
  return { svc, tx, prisma, notifier, shipLock, order };
}

const rawSql = (tx: ReturnType<typeof setup>['tx'], i: number) => {
  const [strings] = tx.$queryRaw.mock.calls[i] as unknown as [TemplateStringsArray, ...unknown[]];
  return strings.join('?');
};

describe('WasteReverseService.reverse', () => {
  it('takes the whole award when recoverable and balance cover it, touching neither drops nor quota', async () => {
    const { svc, tx, order } = setup();
    await expect(svc.reverse('a1', 'r1', BODY)).resolves.toEqual({ requestId: 'r1', status: 'REVERSED', pointsTaken: 20_000, shortfallPoints: 0 });
    expect(loadPointExpiryTxns).toHaveBeenCalledWith(tx, 'u1');
    expect(lotRecoverable).toHaveBeenCalledWith([], 'RECYCLE:r1');
    expect(applyPointsDelta).toHaveBeenCalledWith(tx, {
      userId: 'u1',
      delta: -20_000,
      lot: 'STANDARD',
      reason: 'RECYCLE_REVERSED:TR-ABCDE',
      refType: 'RECYCLE_REVERSED',
      refId: 'r1',
    });
    expect(tx.wasteRequest.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: 'r1', status: 'COMPLETED' },
      data: { status: 'REVERSED', reversedAt: expect.any(Date), reversedByUserId: 'a1', reversalReason: 'gian lận', reversalShortfallPoints: 0 },
    });
    expect(rawSql(tx, 1)).toContain('FROM "users" WHERE "id" = ? FOR UPDATE');
    expect(order.indexOf('users FOR UPDATE')).toBeLessThan(order.indexOf('request updateMany'));
    expect(order.indexOf('request updateMany')).toBeLessThan(order.indexOf('applyPointsDelta'));
    expect(tx.gameProfile.update).not.toHaveBeenCalled();
    expect(tx.gameProfile.updateMany).not.toHaveBeenCalled();
    expect(tx.wastePointUsage.update).not.toHaveBeenCalled();
    expect(tx.wastePointUsage.updateMany).not.toHaveBeenCalled();
    expect(tx.wastePointUsage.upsert).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(writeWasteEvent).toHaveBeenCalledWith(tx, {
      kind: 'POINTS_REVERSED',
      actorUserId: 'a1',
      actorRole: 'ADMIN',
      requestId: 'r1',
      pointId: 'p1',
      meta: {
        reason: 'gian lận',
        pointsAwarded: 20_000,
        pointsTaken: 20_000,
        shortfallPoints: 0,
        subjectUserId: 'u1',
        before: { status: 'COMPLETED' },
        after: { status: 'REVERSED' },
      },
    });
  });

  it('takes only the balance when it is lower and reports the points actually taken', async () => {
    const { svc, tx, notifier } = setup({ balance: 15_000 });
    await expect(svc.reverse('a1', 'r1', BODY)).resolves.toEqual({ requestId: 'r1', status: 'REVERSED', pointsTaken: 15_000, shortfallPoints: 5_000 });
    expect(tx.wasteRequest.updateMany.mock.calls[0]![0].data.reversalShortfallPoints).toBe(5_000);
    expect(applyPointsDelta).toHaveBeenCalledWith(tx, expect.objectContaining({ delta: -15_000 }));
    expect(notifier.pointsReversed).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABCDE' }, 15_000, 'gian lận');
  });

  it('writes no ledger row when nothing is recoverable but still marks the request REVERSED', async () => {
    const { svc, tx } = setup({ recoverable: 0 });
    await expect(svc.reverse('a1', 'r1', BODY)).resolves.toEqual({ requestId: 'r1', status: 'REVERSED', pointsTaken: 0, shortfallPoints: 20_000 });
    expect(applyPointsDelta).not.toHaveBeenCalled();
    expect(tx.wasteRequest.updateMany).toHaveBeenCalledTimes(1);
  });

  it('falls back to the awarded points when the lot is not found in the ledger', async () => {
    const { svc } = setup({ recoverable: null });
    await expect(svc.reverse('a1', 'r1', BODY)).resolves.toMatchObject({ pointsTaken: 20_000, shortfallPoints: 0 });
  });

  it('takes nothing from a negative balance', async () => {
    const { svc } = setup({ balance: -3_000 });
    await expect(svc.reverse('a1', 'r1', BODY)).resolves.toMatchObject({ pointsTaken: 0, shortfallPoints: 20_000 });
    expect(applyPointsDelta).not.toHaveBeenCalled();
  });

  it('skips the ledger and the lot lookup when no points were awarded', async () => {
    const { svc } = setup({ row: row({ pointsAwarded: 0 }) });
    await expect(svc.reverse('a1', 'r1', BODY)).resolves.toEqual({ requestId: 'r1', status: 'REVERSED', pointsTaken: 0, shortfallPoints: 0 });
    expect(applyPointsDelta).not.toHaveBeenCalled();
    expect(lotRecoverable).not.toHaveBeenCalled();
  });

  it('replays a REVERSED request without an event, a notification or a ship-lock evaluation', async () => {
    const { svc, tx, notifier, shipLock, order } = setup({ row: row({ status: 'REVERSED', pointsAwarded: 20_000, reversalShortfallPoints: 5_000 }) });
    await expect(svc.reverse('a1', 'r1', BODY)).resolves.toEqual({ requestId: 'r1', status: 'REVERSED', pointsTaken: 15_000, shortfallPoints: 5_000 });
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(applyPointsDelta).not.toHaveBeenCalled();
    expect(notifier.pointsReversed).not.toHaveBeenCalled();
    expect(shipLock.evaluateAndLock).not.toHaveBeenCalled();
    expect(order).not.toContain('notify');
    expect(order).not.toContain('shipLock');
  });

  it('answers 404 for an unknown request', async () => {
    const { svc } = setup({ row: null });
    await expect(svc.reverse('a1', 'r1', BODY)).rejects.toEqual(new NotFoundException('Không tìm thấy mã'));
  });

  it('answers 409 when the request is not COMPLETED', async () => {
    const { svc, notifier } = setup({ row: row({ status: 'OPEN' }) });
    await expect(svc.reverse('a1', 'r1', BODY)).rejects.toEqual(new ConflictException('Chỉ thu hồi được yêu cầu đã hoàn tất'));
    expect(notifier.pointsReversed).not.toHaveBeenCalled();
  });

  it('answers 409 when the conditional transition moves no row', async () => {
    const { svc } = setup({ updateCount: 0 });
    await expect(svc.reverse('a1', 'r1', BODY)).rejects.toEqual(new ConflictException('Vui lòng thử lại'));
    expect(applyPointsDelta).not.toHaveBeenCalled();
  });

  it('answers 500 when the ledger refuses the debit', async () => {
    const { svc, notifier } = setup({ applied: false });
    await expect(svc.reverse('a1', 'r1', BODY)).rejects.toEqual(new InternalServerErrorException('Không thu hồi được Điểm Xanh, đã báo quản trị viên.'));
    expect(notifier.pointsReversed).not.toHaveBeenCalled();
  });

  it.each([
    ['PrismaClientKnownRequestError', new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })],
    ['plain object', { code: 'P2002' }],
  ])('turns a unique violation (%s) into a 500, not a 409', async (_name, txError) => {
    const { svc } = setup({ txError });
    const err = await svc.reverse('a1', 'r1', BODY).catch((e: unknown) => e);
    expect(err).toEqual(new InternalServerErrorException('Trạng thái thu hồi không nhất quán, đã báo quản trị viên.'));
    expect(err).not.toBeInstanceOf(ConflictException);
  });

  it('notifies and evaluates the ship lock after the transaction, for MAIL_IN', async () => {
    const { svc, notifier, shipLock, order } = setup();
    await svc.reverse('a1', 'r1', BODY);
    expect(notifier.pointsReversed).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABCDE' }, 20_000, 'gian lận');
    expect(shipLock.evaluateAndLock).toHaveBeenCalledTimes(1);
    expect(shipLock.evaluateAndLock).toHaveBeenCalledWith('u1', CFG);
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('notify'));
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('shipLock'));
  });

  it('does not evaluate the ship lock for DROP_OFF', async () => {
    const { svc, notifier, shipLock } = setup({ row: row({ method: 'DROP_OFF' }) });
    await svc.reverse('a1', 'r1', BODY);
    expect(notifier.pointsReversed).toHaveBeenCalledTimes(1);
    expect(shipLock.evaluateAndLock).not.toHaveBeenCalled();
  });

  it('does not fail the write when the notifier or the ship lock throws', async () => {
    const { svc, notifier, shipLock } = setup();
    notifier.pointsReversed.mockRejectedValue(new Error('boom'));
    shipLock.evaluateAndLock.mockRejectedValue(new Error('boom'));
    await expect(svc.reverse('a1', 'r1', BODY)).resolves.toMatchObject({ status: 'REVERSED', pointsTaken: 20_000 });
  });

  it('rejects a STAFF caller before opening a transaction', async () => {
    const { svc, prisma } = setup({ assertError: new ForbiddenException('Chỉ quản trị viên') });
    await expect(svc.reverse('s1', 'r1', BODY)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('makes a PICKUP transition conditional on its orderId', async () => {
    const { svc, tx, shipLock } = setup({ row: row({ method: 'PICKUP', orderId: 'o1' }) });
    await svc.reverse('a1', 'r1', BODY);
    expect(tx.wasteRequest.updateMany.mock.calls[0]![0].where).toEqual({ id: 'r1', status: 'COMPLETED', orderId: 'o1' });
    expect(shipLock.evaluateAndLock).toHaveBeenCalledWith('u1', CFG);
  });
});
