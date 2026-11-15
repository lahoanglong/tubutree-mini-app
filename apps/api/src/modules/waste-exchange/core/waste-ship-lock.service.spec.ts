import type { PrismaService } from '../../../prisma/prisma.service';
import type { WasteNotifierService } from './waste-notifier.service';
import { isShipLockStrike, shipLockStreakReached, WasteShipLockService, type ShipLockRow } from './waste-ship-lock.service';

const mockClose = jest.fn();
jest.mock('../home-pickup/waste-home-pickup-ledger', () => ({ closeHomePickupRequest: (...a: unknown[]) => mockClose(...a) }));
const mockEnqueueCancel = jest.fn();
jest.mock('../../integrations/gomdon/gomdon-queue', () => ({ enqueueGomdonWasteCancel: (...a: unknown[]) => mockEnqueueCancel(...a) }));

type Method = 'MAIL_IN' | 'PICKUP' | 'HOME_PICKUP' | 'DROP_OFF';
type Row = ShipLockRow & { id: string; userId: string; method: Method; closedAt: Date | null };

const NO_SHOW = (id: string, at: number, method: Method = 'PICKUP', userId = 'u1'): Row => ({
  id, userId, method, status: 'EXPIRED', closeReason: 'PICKUP_NO_SHOW', pointsAwarded: null, estimatedPoints: 1000, closedAt: new Date(at),
});
const SUCCESS = (id: string, at: number, method: Method = 'PICKUP', userId = 'u1'): Row => ({
  id, userId, method, status: 'COMPLETED', closeReason: null, pointsAwarded: 1000, estimatedPoints: 1000, closedAt: new Date(at),
});

/** Chạy lại điều kiện `where` của shouldLock trên danh sách phiếu trong bộ nhớ, đủ để kiểm đúng logic chuỗi hụt. */
function fakeDb(rows: Row[], shipUnlockedAt: Date | null = null) {
  const findMany = jest.fn(async (args: { where: Record<string, any>; orderBy: unknown; take: number }) => {
    const w = args.where;
    const methods: Method[] = w.method.in;
    const closedAtOk = (r: Row) => (w.closedAt.gt ? r.closedAt !== null && r.closedAt > w.closedAt.gt : r.closedAt !== null);
    const statusOk = (r: Row) =>
      w.OR.some((c: Record<string, any>) => (c.status.in ? c.status.in.includes(r.status) : c.status === r.status && c.closeReason === r.closeReason));
    return rows
      .filter((r) => r.userId === w.userId && methods.includes(r.method) && statusOk(r) && closedAtOk(r))
      .sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, args.take);
  });
  return { wasteUserFlags: { findUnique: jest.fn(async () => (shipUnlockedAt ? { shipUnlockedAt } : null)) }, wasteRequest: { findMany } };
}

const svc = () => new WasteShipLockService({} as PrismaService, {} as WasteNotifierService);

describe('isShipLockStrike', () => {
  const base = { closeReason: null, estimatedPoints: 1000 } as const;
  it.each(['REJECTED', 'REVERSED', 'EXPIRED'] as const)('%s luôn là một lần hụt', (status) => {
    expect(isShipLockStrike({ ...base, status, pointsAwarded: 1000 }, 50)).toBe(true);
  });
  it('COMPLETED: điểm cộng thấp hơn ngưỡng so với ước tính là hụt', () => {
    expect(isShipLockStrike({ ...base, status: 'COMPLETED', pointsAwarded: 499 }, 50)).toBe(true);
    expect(isShipLockStrike({ ...base, status: 'COMPLETED', pointsAwarded: 500 }, 50)).toBe(false);
    expect(isShipLockStrike({ ...base, status: 'COMPLETED', pointsAwarded: null }, 50)).toBe(true);
  });
});

describe('shipLockStreakReached', () => {
  const strike = NO_SHOW('a', 1);
  const ok = SUCCESS('b', 2);
  it('streak 0 hoặc ít phiếu hơn streak thì không khoá', () => {
    expect(shipLockStreakReached([], 50, 0)).toBe(false);
    expect(shipLockStreakReached([strike], 50, 2)).toBe(false);
  });
  it('đủ streak phiếu và đều hụt thì khoá; có một phiếu thành công thì không', () => {
    expect(shipLockStreakReached([strike, strike], 50, 2)).toBe(true);
    expect(shipLockStreakReached([strike, ok], 50, 2)).toBe(false);
  });
});

describe.each<Method>(['PICKUP', 'HOME_PICKUP'])('WasteShipLockService.shouldLock, phương thức %s (streak = 2)', (method) => {
  it('2 lần bưu tá không lấy được liên tiếp thì khoá', async () => {
    const db = fakeDb([NO_SHOW('r1', 1000, method), NO_SHOW('r2', 2000, method)]);
    await expect(svc().shouldLock(db as never, 'u1', 50, 2)).resolves.toBe(true);
  });
  it('mới 1 lần không lấy được thì chưa khoá', async () => {
    const db = fakeDb([NO_SHOW('r1', 1000, method)]);
    await expect(svc().shouldLock(db as never, 'u1', 50, 2)).resolves.toBe(false);
  });
  it('một lần giao đủ chen giữa hai lần hụt thì chuỗi đứt, không khoá', async () => {
    const db = fakeDb([NO_SHOW('r1', 1000, method), SUCCESS('r2', 2000, method), NO_SHOW('r3', 3000, method)]);
    await expect(svc().shouldLock(db as never, 'u1', 50, 2)).resolves.toBe(false);
  });
  it('lần giao đủ nằm trước hai lần hụt gần nhất thì vẫn khoá', async () => {
    const db = fakeDb([SUCCESS('r0', 500, method), NO_SHOW('r1', 1000, method), NO_SHOW('r2', 2000, method)]);
    await expect(svc().shouldLock(db as never, 'u1', 50, 2)).resolves.toBe(true);
  });
  it('phiếu đóng trước mốc mở khoá của admin không được tính lại', async () => {
    const db = fakeDb([NO_SHOW('r1', 1000, method), NO_SHOW('r2', 2000, method)], new Date(3000));
    await expect(svc().shouldLock(db as never, 'u1', 50, 2)).resolves.toBe(false);
  });
  it('hết hạn do giữ chỗ (HOLD_EXPIRED) không phải lần hụt', async () => {
    const hold: Row = { ...NO_SHOW('r2', 2000, method), closeReason: 'HOLD_EXPIRED' };
    const db = fakeDb([NO_SHOW('r1', 1000, method), hold]);
    await expect(svc().shouldLock(db as never, 'u1', 50, 2)).resolves.toBe(false);
  });
});

describe('WasteShipLockService.shouldLock, chéo phương thức và người dùng', () => {
  it('PICKUP và HOME_PICKUP cộng dồn vào cùng một chuỗi', async () => {
    const db = fakeDb([NO_SHOW('r1', 1000, 'PICKUP'), NO_SHOW('r2', 2000, 'HOME_PICKUP')]);
    await expect(svc().shouldLock(db as never, 'u1', 50, 2)).resolves.toBe(true);
  });
  it('phiếu của người khác và phương thức DROP_OFF không tính', async () => {
    const db = fakeDb([NO_SHOW('r1', 1000, 'HOME_PICKUP', 'u2'), NO_SHOW('r2', 2000, 'DROP_OFF')]);
    await expect(svc().shouldLock(db as never, 'u1', 50, 2)).resolves.toBe(false);
  });
  it('streak 0 thì không hỏi DB và không khoá', async () => {
    const db = fakeDb([NO_SHOW('r1', 1000)]);
    await expect(svc().shouldLock(db as never, 'u1', 50, 0)).resolves.toBe(false);
    expect(db.wasteRequest.findMany).not.toHaveBeenCalled();
  });
});

describe('WasteShipLockService.evaluateAndLock (spec 15.6, 10.2)', () => {
  beforeEach(() => {
    mockClose.mockReset();
    mockEnqueueCancel.mockReset();
  });

  function setup(pending: Array<Record<string, unknown>>) {
    const order: string[] = [];
    const strikes = [NO_SHOW('r1', 1000, 'HOME_PICKUP'), NO_SHOW('r2', 2000, 'HOME_PICKUP')];
    const tx = {
      wasteUserFlags: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(async () => { order.push('flags update'); return { count: 1 }; }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      wasteEvent: { create: jest.fn(async () => { order.push('event'); return { id: 'e1' }; }) },
      wasteRequest: {
        findMany: jest.fn().mockResolvedValue(strikes),
        updateMany: jest.fn(async () => { order.push('cancel'); return { count: 1 }; }),
      },
    };
    const prisma = {
      wasteUserFlags: tx.wasteUserFlags,
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => { const r = await fn(tx); order.push('tx end'); return r; }),
      wasteRequest: {
        findMany: jest.fn(async (args: { where: Record<string, any> }) => (args.where.status === 'OPEN' ? pending : strikes)),
      },
    };
    const notifier = { shipLocked: jest.fn(async () => { order.push('notify'); }) };
    const config = { pointExpiresAt: jest.fn().mockResolvedValue(new Date('2027-11-15T00:00:00Z')) };
    const queue = {};
    const service = new WasteShipLockService(prisma as never, notifier as never, config as never, queue as never);
    return { order, tx, prisma, notifier, config, queue, service };
  }

  it('ghi khoá và sự kiện trong bước 1, báo sau commit, rồi mới huỷ phiếu OPEN ở bước 2', async () => {
    const { order, service } = setup([{ id: 'p1', code: 'TR-AAAAA', method: 'PICKUP', pointId: 'pt', shipFeePointsUsed: null, gomdonOrderId: null }]);
    await expect(service.evaluateAndLock('u1', { shortfallLockPct: 50, shortfallLockStreak: 2 })).resolves.toMatchObject({ locked: true, cancelledRequestIds: ['p1'] });
    expect(order.indexOf('event')).toBeLessThan(order.indexOf('tx end'));
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('notify'));
    expect(order.indexOf('notify')).toBeLessThan(order.indexOf('cancel'));
  });

  it('phiếu HOME_PICKUP còn OPEN bị huỷ qua closeHomePickupRequest (hoàn điểm) rồi xếp lệnh huỷ vận đơn nếu đã có', async () => {
    mockClose.mockResolvedValue({ closed: true, refunded: 1500 });
    const { service, queue, config } = setup([
      { id: 'h1', code: 'TR-BBBBB', method: 'HOME_PICKUP', pointId: 'pt', shipFeePointsUsed: 1500, gomdonOrderId: 'G1' },
      { id: 'h2', code: 'TR-CCCCC', method: 'HOME_PICKUP', pointId: 'pt', shipFeePointsUsed: 0, gomdonOrderId: null },
    ]);
    const res = await service.evaluateAndLock('u1', { shortfallLockPct: 50, shortfallLockStreak: 2 });
    expect(res.cancelledRequestIds).toEqual(['h1', 'h2']);
    expect(config.pointExpiresAt).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(2);
    expect(mockClose.mock.calls[0]![1]).toMatchObject({
      req: { id: 'h1', userId: 'u1', code: 'TR-BBBBB', shipFeePointsUsed: 1500 },
      from: ['OPEN'],
      to: 'CANCELLED',
      closeReason: 'SHIP_LOCKED',
    });
    expect(mockEnqueueCancel).toHaveBeenCalledTimes(1);
    expect(mockEnqueueCancel).toHaveBeenCalledWith(queue, 'h1', 'TR-BBBBB');
  });

  it('phiếu HOME_PICKUP đã đổi trạng thái (closed:false) thì không tính là đã huỷ và không huỷ vận đơn', async () => {
    mockClose.mockResolvedValue({ closed: false, refunded: 0 });
    const { service } = setup([{ id: 'h1', code: 'TR-BBBBB', method: 'HOME_PICKUP', pointId: 'pt', shipFeePointsUsed: 1500, gomdonOrderId: 'G1' }]);
    const res = await service.evaluateAndLock('u1', { shortfallLockPct: 50, shortfallLockStreak: 2 });
    expect(res.cancelledRequestIds).toEqual([]);
    expect(mockEnqueueCancel).not.toHaveBeenCalled();
  });

  it('chưa đủ chuỗi hụt thì không khoá và không đụng phiếu nào', async () => {
    const notifier = { shipLocked: jest.fn() };
    const prisma = { wasteUserFlags: { findUnique: jest.fn().mockResolvedValue(null) }, wasteRequest: { findMany: jest.fn().mockResolvedValue([NO_SHOW('r1', 1)]) } };
    const service = new WasteShipLockService(prisma as never, notifier as never);
    await expect(service.evaluateAndLock('u1', { shortfallLockPct: 50, shortfallLockStreak: 2 })).resolves.toEqual({ locked: false, shipLockedAt: null, cancelledRequestIds: [] });
    expect(notifier.shipLocked).not.toHaveBeenCalled();
  });
});
