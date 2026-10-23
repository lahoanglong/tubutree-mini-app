import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WasteConfirmRequest, WasteRejectRequest } from '@tubutree/shared-types';
import { assertActiveAdmin } from '../../../common/staff-access';
import { writeWasteEvent } from '../core/waste-events';
import { lockWasteStaffCap } from '../waste-locks';
import { WasteConfirmService, type WasteStaffCall } from './waste-confirm.service';
import { loadAdminRequestDetail } from './waste-admin-detail.mapper';
import * as matchModule from './waste-match';
import { incrementPointUsage, pointUsage, staffConfirmedToday } from './waste-quota';

jest.mock('../waste-locks');
jest.mock('./waste-quota');
jest.mock('../core/waste-events');
jest.mock('./waste-admin-detail.mapper');
jest.mock('../../../common/staff-access');

const EXPIRES_AT = new Date('2027-10-18T00:00:00.000Z');
const CFG = { enabled: true, staffDailyCapPoints: 1_000_000, shortfallLockPct: 50, shortfallLockStreak: 3 };
const noCustomerField = (r: unknown) => expect(JSON.stringify(r)).not.toMatch(/"(userId|customerName|customerPhone|phone|fullName)"/);

const carton = { id: 'l1', itemId: 'wi-carton', declaredQty: 10, receivedQty: null, shortfallReason: null, unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0, gramsPerUnit: null, item: { hazardous: false, warehouseOnly: false } };
const milk = { id: 'l2', itemId: 'wi-milk', declaredQty: 10, receivedQty: null, shortfallReason: null, unitsPerPoint: 5, pointsPerGroup: 1000, dropsPerUnit: 0, gramsPerUnit: null, item: { hazardous: false, warehouseOnly: false } };
const bottle = { id: 'l1', itemId: 'wi-bottle', declaredQty: 3, receivedQty: null, shortfallReason: null, unitsPerPoint: 1, pointsPerGroup: 2000, dropsPerUnit: 2, gramsPerUnit: null, item: { hazardous: false, warehouseOnly: false } };

const partnerAccess = { kind: 'PARTNER', actorRole: 'POINT_STAFF', monthlyQuotaPoints: 100_000, caller: { id: 's1', phone: '0900000002', role: 'USER' } };
const warehouseAccess = { kind: 'WAREHOUSE', actorRole: 'STAFF', monthlyQuotaPoints: null, caller: { id: 's1', phone: '0900000002', role: 'STAFF' } };
const warehouseStaff = { id: 's1', role: 'STAFF', phone: '0900000002' };

const row = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'TR-ABCDE',
  userId: 'u1',
  method: 'DROP_OFF',
  status: 'OPEN',
  pointId: 'p1',
  orderId: null,
  trackingNorm: null,
  estimatedPoints: 10_000,
  confirmedByUserId: null,
  pointsAwarded: null,
  dropsAwarded: null,
  lines: [carton],
  user: { id: 'u1', phone: '0900000001', isBlocked: false },
  order: null,
  ...o,
});
const completed = (o: Record<string, unknown> = {}) =>
  row({ status: 'COMPLETED', confirmedByUserId: 's1', pointsAwarded: 10_000, dropsAwarded: 0, lines: [{ ...carton, receivedQty: 10 }], ...o });
const full = [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 }];
const body = (lines: WasteConfirmRequest['lines'] = full, extra: Partial<WasteConfirmRequest> = {}): WasteConfirmRequest => ({ lines, ...extra });
const REPLAY_RESULT = {
  requestId: 'r1',
  code: 'TR-ABCDE',
  status: 'COMPLETED',
  pointsAwarded: 10_000,
  dropsAwarded: 0,
  quota: { limit: 100_000, used: 10_000, remaining: 90_000 },
  staffDailyCapRemaining: 990_000,
};

interface Setup {
  row?: Record<string, unknown>;
  cfg?: Partial<typeof CFG>;
  route?: 'DESK' | 'ADMIN';
  access?: unknown;
  staff?: unknown;
  seeds?: number;
  flags?: unknown;
  colleague?: number;
  updateCount?: number;
  incremented?: number | null;
  usage?: { pointsUsed: number; confirmations: number };
  staffToday?: number;
  grant?: boolean;
  tankCap?: number;
  pointRow?: unknown;
  txError?: unknown;
  again?: unknown;
  matchOutcome?: matchModule.WasteMatchOutcome;
}

function setup(o: Setup = {}) {
  const order: string[] = [];
  let inTx = false;
  const data = o.row ?? row();
  const cfg = { ...CFG, ...o.cfg };
  (lockWasteStaffCap as jest.Mock).mockImplementation(async () => void order.push('lockWasteStaffCap'));
  (staffConfirmedToday as jest.Mock).mockImplementation(async () => (order.push('staffConfirmedToday'), o.staffToday ?? 0));
  (incrementPointUsage as jest.Mock).mockImplementation(async () => (order.push('incrementPointUsage'), o.incremented === undefined ? 10_000 : o.incremented));
  (pointUsage as jest.Mock).mockImplementation(async () => (order.push('pointUsage'), o.usage ?? { pointsUsed: 10_000, confirmations: 1 }));
  (writeWasteEvent as jest.Mock).mockImplementation(async () => (order.push('writeWasteEvent'), { id: 'e1' }));
  (assertActiveAdmin as jest.Mock).mockImplementation(async () => (order.push('assertActiveAdmin'), { id: 'a1', role: 'ADMIN', phone: null }));
  (loadAdminRequestDetail as jest.Mock).mockResolvedValue({ id: 'r1' });
  const evaluate = jest.spyOn(matchModule, 'evaluateMatch').mockResolvedValue(o.matchOutcome ?? { ok: true, basis: 'TR_CODE' });

  const tx = {
    $queryRaw: jest.fn(async (...args: unknown[]) => {
      if (!inTx) throw new Error('raw SQL outside $transaction');
      const [strings] = args as [TemplateStringsArray, ...unknown[]];
      const sql = strings.join('?');
      if (sql.includes('"waste_requests"')) order.push('request FOR UPDATE');
      if (sql.includes('"game_profiles"')) {
        order.push('game FOR UPDATE');
        return [{ totalSeeds: o.seeds ?? 0 }];
      }
      return [];
    }),
    wasteRequest: {
      findUnique: jest.fn(async () => data),
      updateMany: jest.fn(async () => (order.push('request updateMany'), { count: o.updateCount ?? 1 })),
      update: jest.fn(async () => ({})),
    },
    wasteRequestLine: { update: jest.fn(async () => ({})) },
    wasteUserFlags: { findUnique: jest.fn(async () => o.flags ?? null) },
    wastePointStaff: { count: jest.fn(async () => o.colleague ?? 0) },
    gameProfile: { upsert: jest.fn(async () => (order.push('game upsert'), {})), update: jest.fn(async () => ({})) },
    wastePoint: {
      update: jest.fn(async () => (order.push('point lastConfirmedAt'), {})),
      findUnique: jest.fn(async () => o.pointRow ?? { kind: 'PARTNER', monthlyQuotaPoints: 100_000 }),
    },
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
    wastePoint: tx.wastePoint,
    wasteRequest: { findUnique: jest.fn(async (a: { include?: unknown }) => (a.include ? (o.again ?? data) : { pointId: (data as { pointId: string }).pointId })) },
  };
  const config = { snapshot: jest.fn().mockResolvedValue(cfg) };
  const access = {
    assertPointAccess: jest.fn().mockResolvedValue(o.access ?? partnerAccess),
    assertWarehouseActor: jest.fn().mockResolvedValue(o.staff ?? warehouseStaff),
    warehousePoint: jest.fn().mockResolvedValue({ id: 'wh' }),
  };
  const rewards = { grant: jest.fn(async () => (order.push('grant'), o.grant ?? true)), expiresAt: jest.fn().mockResolvedValue(EXPIRES_AT) };
  const systemConfig = { get: jest.fn().mockResolvedValue(o.tankCap ?? 500) };
  const notifier = {
    pointsCredited: jest.fn(async () => void order.push('notify')),
    requestRejected: jest.fn(async () => void order.push('notify')),
    requestExpired: jest.fn(async () => void order.push('notify')),
  };
  const shipLock = { evaluateAndLock: jest.fn(async () => (order.push('shipLock'), { locked: false, shipLockedAt: null, cancelledRequestIds: [] })) };
  const svc = new WasteConfirmService(prisma as never, config as never, access as never, rewards as never, systemConfig as never, notifier as never, shipLock as never);
  const call: WasteStaffCall = { callerUserId: 's1', requestId: 'r1', route: o.route ?? 'DESK', device: { ip: '10.0.0.0', userAgent: 'jest' } };
  return { svc, tx, prisma, config, access, rewards, systemConfig, notifier, shipLock, order, call, evaluate };
}

const warehouseCase = (o: Setup = {}) => setup({ route: 'ADMIN', ...o });
const whRow = (o: Record<string, unknown> = {}) => row({ method: 'MAIL_IN', status: 'RECEIVED', pointId: 'wh', ...o });

describe('WasteConfirmService.confirm', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('1. happy DROP_OFF at a PARTNER point', async () => {
    const h = setup();
    const result = await h.svc.confirm(h.call, body());
    expect(result).toEqual(REPLAY_RESULT);
    expect(h.order).toEqual([
      'request FOR UPDATE', 'lockWasteStaffCap', 'staffConfirmedToday', 'incrementPointUsage', 'request updateMany', 'grant',
      'point lastConfirmedAt', 'writeWasteEvent', 'tx end', 'notify', 'shipLock',
    ]);
    expect(h.rewards.grant).toHaveBeenCalledWith('u1', 10_000, 'RECYCLE:TR-ABCDE', 'RECYCLE', 'r1', h.tx, EXPIRES_AT);
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    const ev = (writeWasteEvent as jest.Mock).mock.calls[0][1];
    expect(ev).toEqual(expect.objectContaining({ kind: 'REQUEST_CONFIRMED', actorRole: 'POINT_STAFF' }));
    expect(ev.meta.matchBasis).toBeNull();
    expect(Object.keys(ev.meta).filter((k) => /phone/i.test(k))).toEqual([]);
    expect(h.notifier.pointsCredited).toHaveBeenCalledTimes(1);
    expect(h.shipLock.evaluateAndLock).toHaveBeenCalledTimes(1);
    expect(h.shipLock.evaluateAndLock).toHaveBeenCalledWith('u1', { shortfallLockPct: 50, shortfallLockStreak: 3 });
    expect(pointUsage).not.toHaveBeenCalled();
    noCustomerField(result);

    const txStart = h.prisma.$transaction.mock.invocationCallOrder[0] as number;
    for (const f of [h.config.snapshot, h.rewards.expiresAt, h.systemConfig.get]) expect(f.mock.invocationCallOrder[0] as number).toBeLessThan(txStart);
    expect(h.access.assertPointAccess.mock.invocationCallOrder[0] as number).toBeLessThan(txStart);
    expect(h.systemConfig.get).toHaveBeenCalledWith('game.tank_capacity', 500);
    expect(h.access.assertPointAccess).toHaveBeenNthCalledWith(1, 's1', 'p1', { programmeEnabled: true });
    expect(h.access.assertPointAccess).toHaveBeenNthCalledWith(2, 's1', 'p1', { programmeEnabled: true, db: h.tx });

    const d = (h.tx.wasteRequest.updateMany.mock.calls[0] as unknown as [{ data: { closedAt: Date; completedAt: Date } }])[0].data;
    expect(d).toEqual({ status: 'COMPLETED', completedAt: expect.any(Date), closedAt: expect.any(Date), confirmedByUserId: 's1', pointsAwarded: 10_000, dropsAwarded: 0 });
    expect(d.closedAt).toEqual(d.completedAt);
    expect(h.tx.wasteRequestLine.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { receivedQty: 10, shortfallReason: null, pointsAwarded: 10_000 } });
    expect(writeWasteEvent).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        actorUserId: 's1',
        requestId: 'r1',
        pointId: 'p1',
        meta: expect.objectContaining({
          device: h.call.device,
          lines: [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10, shortfallReason: null }],
          after: { status: 'COMPLETED', pointsAwarded: 10_000, dropsAwarded: 0 },
        }),
      }),
    );
  });

  describe('2. Tubu bottles with drops', () => {
    const lines = [{ itemId: 'wi-bottle', declaredQty: 3, receivedQty: 3 }];
    it('clamps the drops by the room left in the tank', async () => {
      const h = setup({ row: row({ lines: [bottle] }), seeds: 497, incremented: 6000 });
      const r = await h.svc.confirm(h.call, body(lines));
      expect(r).toEqual(expect.objectContaining({ pointsAwarded: 6000, dropsAwarded: 3 }));
      expect(h.tx.gameProfile.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { totalSeeds: { increment: 3 } } });
      const i = (k: string) => h.order.indexOf(k);
      expect(i('grant')).toBeLessThan(i('game upsert'));
      expect(i('game upsert')).toBeLessThan(i('game FOR UPDATE'));
      expect(i('game FOR UPDATE')).toBeLessThan(i('point lastConfirmedAt'));
    });
    it('a full tank awards 0 drops and still stores the figure', async () => {
      const h = setup({ row: row({ lines: [bottle] }), seeds: 500, incremented: 6000 });
      const r = await h.svc.confirm(h.call, body(lines));
      expect(r.dropsAwarded).toBe(0);
      expect(h.tx.gameProfile.update).not.toHaveBeenCalled();
      expect(h.tx.wasteRequest.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { dropsAwarded: 0 } });
    });
  });

  describe('3. replay', () => {
    const replayHarness = (o: Setup = {}) => setup({ row: completed(), staffToday: 10_000, ...o });
    it('same figures return the stored result and write nothing', async () => {
      const h = replayHarness();
      await expect(h.svc.confirm(h.call, body())).resolves.toEqual(REPLAY_RESULT);
      for (const f of [writeWasteEvent, incrementPointUsage]) expect(f).not.toHaveBeenCalled();
      expect(h.rewards.grant).not.toHaveBeenCalled();
      expect(h.notifier.pointsCredited).not.toHaveBeenCalled();
      expect(h.shipLock.evaluateAndLock).not.toHaveBeenCalled();
      expect(h.order).not.toContain('notify');
    });
    it('ignores declaredQty (R15.5.40)', async () => {
      const h = replayHarness();
      await expect(h.svc.confirm(h.call, body([{ itemId: 'wi-carton', declaredQty: 9, receivedQty: 10 }]))).resolves.toEqual(REPLAY_RESULT);
      expect(writeWasteEvent).not.toHaveBeenCalled();
    });
    it('a reason on a full line counts as null', async () => {
      const h = replayHarness();
      await expect(h.svc.confirm(h.call, body([{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10, shortfallReason: 'DAMAGED' }]))).resolves.toEqual(REPLAY_RESULT);
      expect(writeWasteEvent).not.toHaveBeenCalled();
    });
    it('a different receivedQty is a 409', async () => {
      const h = replayHarness();
      await expect(h.svc.confirm(h.call, body([{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 9, shortfallReason: 'DAMAGED' }]))).rejects.toThrow(
        new ConflictException('Yêu cầu đã được xác nhận với số liệu khác'),
      );
    });
    it('another staff member is a 409', async () => {
      const h = replayHarness({ row: completed({ confirmedByUserId: 's2' }) });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Yêu cầu đã được xác nhận với số liệu khác'));
    });
  });

  it('4. programme off blocks a DROP_OFF at the warehouse on route ADMIN', async () => {
    const h = warehouseCase({ row: row({ pointId: 'wh' }), cfg: { enabled: false } });
    await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ForbiddenException('Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.'));
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
  });

  describe('5. PICKUP at the warehouse', () => {
    const pickup = (o: Record<string, unknown> = {}) => row({ method: 'PICKUP', pointId: 'wh', status: 'IN_TRANSIT', orderId: 'o1', order: { status: 'DELIVERED' }, ...o });
    const match = { parcelCode: 'TR-ABCDE' };
    const orderNeverLocked = (h: { tx: { $queryRaw: jest.Mock } }) => {
      const sqls = h.tx.$queryRaw.mock.calls.map((c) => (c[0] as unknown as TemplateStringsArray).join('?'));
      expect(sqls.some((s2) => s2.includes('"orders"'))).toBe(false);
    };
    it.each([
      ['order not delivered', { order: { status: 'CONFIRMED' } }],
      ['no attached order', { status: 'OPEN', orderId: null, order: null }],
    ])('%s is a 409', async (_n, over) => {
      const h = warehouseCase({ row: pickup(over) });
      await expect(h.svc.confirm(h.call, body(full, { match }))).rejects.toThrow(new ConflictException('Đơn gắn kèm chưa giao xong, chưa xác nhận được'));
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
      orderNeverLocked(h);
    });
    it.each(['DELIVERED', 'RETURNED'])('order %s completes', async (s) => {
      const h = warehouseCase({ row: pickup({ order: { status: s } }) });
      await expect(h.svc.confirm(h.call, body(full, { match }))).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED' }));
      orderNeverLocked(h);
    });
    it('status OPEN with a delivered order completes (R15.5.20)', async () => {
      const h = warehouseCase({ row: pickup({ status: 'OPEN' }) });
      await expect(h.svc.confirm(h.call, body(full, { match }))).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED' }));
      orderNeverLocked(h);
    });
  });

  it('6. a failed match basis is a 409 and writes nothing', async () => {
    const h = warehouseCase({ row: whRow({ status: 'IN_TRANSIT' }), matchOutcome: { ok: false, reason: 'NO_MATCH' } });
    const err = await h.svc.confirm(h.call, body()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toMatch(/^Căn cứ đối chiếu không hợp lệ:/);
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  describe('7. bans', () => {
    it('the customer cannot confirm their own request', async () => {
      const h = setup({ row: row({ userId: 's1', user: { id: 's1', phone: '0900000001', isBlocked: false } }) });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ForbiddenException('Bạn không thể xác nhận yêu cầu này'));
    });
    it('same phone', async () => {
      const h = setup({ access: { ...partnerAccess, caller: { id: 's1', phone: '0900000001', role: 'USER' } } });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ForbiddenException('Bạn không thể xác nhận yêu cầu này'));
    });
    it('colleague at the same point', async () => {
      const h = setup({ colleague: 1 });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ForbiddenException('Bạn không thể xác nhận yêu cầu này'));
    });
    it('the colleague rule is not applied at the warehouse', async () => {
      const h = warehouseCase({ row: whRow(), colleague: 1 });
      await expect(h.svc.confirm(h.call, body())).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED' }));
      expect(h.tx.wastePointStaff.count).not.toHaveBeenCalled();
    });
  });

  describe('8. blocked customer', () => {
    it('POINT_STAFF gets the wait-for-Tubu text', async () => {
      const h = setup({ row: row({ user: { id: 'u1', phone: '0900000001', isBlocked: true } }) });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Yêu cầu này đang chờ Tubu xử lý, chưa xác nhận được tại điểm'));
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    });
    it('a waste flag at the warehouse gets the locked text', async () => {
      const h = warehouseCase({ row: whRow(), flags: { blockedAt: new Date() } });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Khách đang bị khoá, không cộng điểm được'));
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  it('9. staff daily cap', async () => {
    const h = setup({ staffToday: 995_000 });
    await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Bạn đã chạm trần điểm xác nhận hôm nay'));
    expect(incrementPointUsage).not.toHaveBeenCalled();
  });

  it('10. monthly quota of the point', async () => {
    const h = setup({ incremented: null, usage: { pointsUsed: 95_000, confirmations: 4 } });
    await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Điểm đã hết hạn mức tháng, còn 5.000 điểm'));
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
  });

  it('11. zero points at a PARTNER point still completes', async () => {
    const h = setup({ row: row({ lines: [{ ...milk, declaredQty: 4 }] }), usage: { pointsUsed: 7_000, confirmations: 2 } });
    const r = await h.svc.confirm(h.call, body([{ itemId: 'wi-milk', declaredQty: 4, receivedQty: 4 }]));
    expect(r.pointsAwarded).toBe(0);
    expect(r.quota).toEqual({ limit: 100_000, used: 7_000, remaining: 93_000 });
    expect(incrementPointUsage).not.toHaveBeenCalled();
    expect(h.rewards.grant).not.toHaveBeenCalled();
    expect(h.notifier.pointsCredited).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABCDE' }, 0, 0);
  });

  it('12. grant returning false is a 500 and sends no message', async () => {
    const h = setup({ grant: false });
    await expect(h.svc.confirm(h.call, body())).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(errorSpy).toHaveBeenCalled();
    expect(h.notifier.pointsCredited).not.toHaveBeenCalled();
  });

  describe('13. point ceilings', () => {
    it('above estimatedPoints is a 500 and nothing else runs', async () => {
      const h = setup({ row: row({ estimatedPoints: 5000 }) });
      await expect(h.svc.confirm(h.call, body())).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      for (const f of [lockWasteStaffCap, incrementPointUsage]) expect(f).not.toHaveBeenCalled();
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
      expect(h.rewards.grant).not.toHaveBeenCalled();
      expect(h.notifier.pointsCredited).not.toHaveBeenCalled();
    });
    it('above 2000000 is a 400', async () => {
      const big = { ...carton, declaredQty: 3, pointsPerGroup: 666_667 };
      const h = setup({ row: row({ lines: [big], estimatedPoints: 2_000_001 }) });
      await expect(h.svc.confirm(h.call, body([{ itemId: 'wi-carton', declaredQty: 3, receivedQty: 3 }]))).rejects.toThrow(
        new BadRequestException('Số điểm của một yêu cầu không được vượt 2.000.000'),
      );
    });
  });

  it('14. updateMany count 0 is a 409', async () => {
    const h = setup({ updateCount: 0 });
    await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Vui lòng thử lại'));
  });

  describe('15. P2002', () => {
    const errors = [new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }), { code: 'P2002' }];
    it.each(errors)('a stored result is returned without a message (%#)', async (e) => {
      const h = setup({ txError: e, again: completed(), staffToday: 10_000 });
      await expect(h.svc.confirm(h.call, body())).resolves.toEqual(REPLAY_RESULT);
      expect(h.notifier.pointsCredited).not.toHaveBeenCalled();
    });
    it.each(errors)('an OPEN row is a 409 (%#)', async (e) => {
      const h = setup({ txError: e, again: row() });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Vui lòng thử lại'));
    });
  });

  describe('16. MAIL_IN RECEIVED at the warehouse via ADMIN', () => {
    it('completes without the quota counter and evaluates the ship lock after commit', async () => {
      const h = warehouseCase({ row: whRow() });
      const r = await h.svc.confirm(h.call, body());
      expect(r.quota).toBeNull();
      expect(incrementPointUsage).not.toHaveBeenCalled();
      expect((writeWasteEvent as jest.Mock).mock.calls[0][1].meta.matchBasis).toBeNull();
      noCustomerField(r);
      expect(h.shipLock.evaluateAndLock).toHaveBeenCalledTimes(1);
      expect(h.shipLock.evaluateAndLock).toHaveBeenCalledWith('u1', { shortfallLockPct: 50, shortfallLockStreak: 3 });
      expect(h.order.indexOf('tx end')).toBeLessThan(h.order.indexOf('shipLock'));
      expect(h.evaluate).not.toHaveBeenCalled();
      expect(h.access.assertWarehouseActor).toHaveBeenNthCalledWith(1, 's1');
      expect(h.access.assertWarehouseActor).toHaveBeenNthCalledWith(2, 's1', h.tx);
    });
    it('a failed ship-lock evaluation or message does not fail the call', async () => {
      const h = warehouseCase({ row: whRow() });
      h.shipLock.evaluateAndLock.mockRejectedValueOnce(new Error('boom'));
      h.notifier.pointsCredited.mockRejectedValueOnce(new Error('boom'));
      await expect(h.svc.confirm(h.call, body())).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED' }));
    });
  });

  it('17. receivedWeightGrams at the warehouse is stored and ignored by a replay', async () => {
    const h = warehouseCase({ row: whRow() });
    await h.svc.confirm(h.call, body(full, { receivedWeightGrams: 1200 }));
    expect((h.tx.wasteRequest.updateMany.mock.calls[0] as unknown as [{ data: unknown }])[0].data).toEqual(expect.objectContaining({ receivedWeightGrams: 1200 }));

    const r = warehouseCase({ row: completed({ method: 'MAIL_IN', pointId: 'wh' }), pointRow: { kind: 'WAREHOUSE', monthlyQuotaPoints: null }, staffToday: 10_000 });
    await expect(r.svc.confirm(r.call, body(full, { receivedWeightGrams: 900 }))).resolves.toEqual({
      requestId: 'r1',
      code: 'TR-ABCDE',
      status: 'COMPLETED',
      pointsAwarded: 10_000,
      dropsAwarded: 0,
      quota: null,
      staffDailyCapRemaining: 990_000,
    });
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
  });

  it('18. route ADMIN on a PARTNER request is a 409', async () => {
    const h = warehouseCase();
    await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Yêu cầu này không xác nhận ở kho'));
    for (const f of [incrementPointUsage, writeWasteEvent]) expect(f).not.toHaveBeenCalled();
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(h.rewards.grant).not.toHaveBeenCalled();
  });

  describe('19. statuses that cannot be confirmed', () => {
    it.each(['EXPIRED', 'CANCELLED', 'REJECTED', 'REVERSED'])('MAIL_IN %s at the warehouse', async (s) => {
      const h = warehouseCase({ row: whRow({ status: s }) });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Yêu cầu không ở trạng thái xác nhận được'));
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
      expect(h.rewards.grant).not.toHaveBeenCalled();
      expect(writeWasteEvent).not.toHaveBeenCalled();
    });
    it('a DROP_OFF at p1 that is IN_TRANSIT via DESK', async () => {
      const h = setup({ row: row({ status: 'IN_TRANSIT' }) });
      await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ConflictException('Yêu cầu không ở trạng thái xác nhận được'));
    });
  });

  it('20. programme off blocks a DROP_OFF at the warehouse from the desk route too', async () => {
    const h = setup({ row: row({ pointId: 'wh' }), cfg: { enabled: false }, access: warehouseAccess });
    await expect(h.svc.confirm(h.call, body())).rejects.toThrow(new ForbiddenException('Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.'));
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
  });

  describe('21. the warehouse keeps counting while the programme is off', () => {
    const rowFor = (method: string) => whRow(method === 'PICKUP' ? { method, orderId: 'o1', order: { status: 'DELIVERED' } } : { method });
    it.each(['MAIL_IN', 'PICKUP'])('%s via ADMIN', async (method) => {
      const h = warehouseCase({ row: rowFor(method), cfg: { enabled: false } });
      await expect(h.svc.confirm(h.call, body())).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED', pointsAwarded: 10_000, quota: null }));
      expect(h.tx.wasteRequest.updateMany).toHaveBeenCalledTimes(1);
      expect(h.rewards.grant).toHaveBeenCalledTimes(1);
      expect(incrementPointUsage).not.toHaveBeenCalled();
    });
    it.each(['MAIL_IN', 'PICKUP'])('%s via DESK', async (method) => {
      const h = setup({ row: rowFor(method), cfg: { enabled: false }, access: warehouseAccess });
      await expect(h.svc.confirm(h.call, body())).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED' }));
    });
  });

  it('22. a PICKUP transition is conditional on orderId (spec 7.4)', async () => {
    const h = warehouseCase({ row: row({ method: 'PICKUP', pointId: 'wh', status: 'IN_TRANSIT', orderId: 'o1', order: { status: 'DELIVERED' } }) });
    await h.svc.confirm(h.call, body(full, { match: { parcelCode: 'TR-ABCDE' } }));
    expect((h.tx.wasteRequest.updateMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({
      id: 'r1',
      status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] },
      orderId: 'o1',
    });
    expect((writeWasteEvent as jest.Mock).mock.calls[0][1].meta.matchBasis).toBe('TR_CODE');
  });

  it('23. only the warehouse may send receivedWeightGrams', async () => {
    const h = setup();
    await expect(h.svc.confirm(h.call, body(full, { receivedWeightGrams: 500 }))).rejects.toThrow(new BadRequestException('Chỉ kho Tubu mới ghi khối lượng cân'));
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
  });

  it('24. a HIDDEN item is still counted at the snapshotted rate', async () => {
    const h = setup({ row: row({ lines: [{ ...carton, item: { hazardous: false, status: 'HIDDEN' } }] }) });
    await expect(h.svc.confirm(h.call, body())).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED', pointsAwarded: 10_000 }));
  });

  it('25. two items produce one credit row', async () => {
    const h = setup({ row: row({ lines: [carton, milk], estimatedPoints: 12_000 }), incremented: 12_000 });
    const r = await h.svc.confirm(
      h.call,
      body([
        { itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 },
        { itemId: 'wi-milk', declaredQty: 10, receivedQty: 10 },
      ]),
    );
    expect(h.rewards.grant).toHaveBeenCalledTimes(1);
    expect(h.rewards.grant).toHaveBeenCalledWith('u1', 12_000, 'RECYCLE:TR-ABCDE', 'RECYCLE', 'r1', h.tx, EXPIRES_AT);
    expect(incrementPointUsage).toHaveBeenCalledTimes(1);
    expect((incrementPointUsage as jest.Mock).mock.calls[0][3]).toBe(12_000);
    expect(h.tx.wasteRequestLine.update).toHaveBeenCalledTimes(2);
    expect(r.pointsAwarded).toBe(12_000);
  });

  it('26. a ship-locked customer is still counted (spec 15.6)', async () => {
    const h = warehouseCase({ row: whRow(), flags: { blockedAt: null, shipLockedAt: new Date('2026-10-01T00:00:00Z') } });
    await expect(h.svc.confirm(h.call, body())).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED' }));
    expect(h.rewards.grant).toHaveBeenCalledTimes(1);
  });
});

describe('WasteConfirmService, warehouse-only items at a PARTNER point', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const milkOnly = { ...milk, declaredQty: 50, item: { hazardous: false, warehouseOnly: true } };
  const bottleOnly = { ...bottle, item: { hazardous: false, warehouseOnly: true } };
  const milkBody = [{ itemId: 'wi-milk', declaredQty: 50, receivedQty: 50 }];
  const NOT_AT_PARTNER = 'Điểm đại lý không xác nhận được món chỉ kho Tubu HCMC nhận. Từ chối yêu cầu hoặc chuyển khách tới kho.';

  it.each([
    ['milk carton', [milkOnly], milkBody],
    ['Tubu bottle', [bottleOnly], [{ itemId: 'wi-bottle', declaredQty: 3, receivedQty: 3 }]],
    ['carton mixed with milk', [carton, milkOnly], [...full, ...milkBody]],
  ])('refuses %s: 409, no points, no counter, no state change, no event, no message', async (_n, lines, lineBody) => {
    const h = setup({ row: row({ lines, estimatedPoints: 20_000 }) });
    const call = h.svc.confirm(h.call, body(lineBody));
    await expect(call).rejects.toThrow(new ConflictException(NOT_AT_PARTNER));
    await expect(call).rejects.toBeInstanceOf(ConflictException);
    expect(h.rewards.grant).not.toHaveBeenCalled();
    expect(incrementPointUsage).not.toHaveBeenCalled();
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(h.tx.wasteRequestLine.update).not.toHaveBeenCalled();
    expect(h.tx.gameProfile.upsert).not.toHaveBeenCalled();
    expect(h.tx.wastePoint.update).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(h.notifier.pointsCredited).not.toHaveBeenCalled();
  });

  it('lets a legacy request through when every warehouse-only line is counted 0 with a reason, and credits only the other lines', async () => {
    const h = setup({ row: row({ lines: [carton, milkOnly], estimatedPoints: 20_000 }) });
    const lines = [...full, { itemId: 'wi-milk', declaredQty: 50, receivedQty: 0, shortfallReason: 'WRONG_TYPE' as const }];
    await expect(h.svc.confirm(h.call, body(lines))).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED', pointsAwarded: 10_000 }));
    expect(h.rewards.grant).toHaveBeenCalledTimes(1);
  });

  it('still refuses when the warehouse-only line is counted above 0, even if another line is 0', async () => {
    const h = setup({ row: row({ lines: [carton, milkOnly], estimatedPoints: 20_000 }) });
    const lines = [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 0, shortfallReason: 'WRONG_TYPE' as const }, { itemId: 'wi-milk', declaredQty: 50, receivedQty: 5, shortfallReason: 'OTHER' as const }];
    await expect(h.svc.confirm(h.call, body(lines))).rejects.toThrow(new ConflictException(NOT_AT_PARTNER));
    expect(h.rewards.grant).not.toHaveBeenCalled();
  });

  it('the warehouse confirms the same lines (DESK at the WAREHOUSE point, and the admin route)', async () => {
    const desk = setup({ row: row({ pointId: 'wh', lines: [milkOnly], estimatedPoints: 10_000 }), access: warehouseAccess });
    await expect(desk.svc.confirm(desk.call, body(milkBody))).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED', pointsAwarded: 10_000 }));
    expect(desk.rewards.grant).toHaveBeenCalledTimes(1);

    const admin = warehouseCase({ row: whRow({ lines: [milkOnly], estimatedPoints: 10_000 }) });
    await expect(admin.svc.confirm(admin.call, body(milkBody))).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED' }));
    expect(admin.rewards.grant).toHaveBeenCalledTimes(1);
  });

  it('a retry of a request already COMPLETED stays a replay, not an error', async () => {
    const h = setup({ row: completed({ lines: [{ ...milkOnly, receivedQty: 50 }], pointsAwarded: 10_000 }) });
    await expect(h.svc.confirm(h.call, body(milkBody))).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED', pointsAwarded: 10_000 }));
    expect(h.rewards.grant).not.toHaveBeenCalled();
  });

  it('the point staff can still reject such a request', async () => {
    const h = setup({ row: row({ lines: [milkOnly], estimatedPoints: 10_000 }) });
    await expect(h.svc.reject(h.call, { rejectionReason: 'WET' })).resolves.toEqual({ requestId: 'r1', code: 'TR-ABCDE', status: 'REJECTED' });
    expect(h.rewards.grant).not.toHaveBeenCalled();
  });
});

const rejectBody = (o: Partial<WasteRejectRequest> = {}): WasteRejectRequest => ({ rejectionReason: 'WET', ...o });
const rejected = (o: Record<string, unknown> = {}) => row({ status: 'REJECTED', confirmedByUserId: 's1', rejectionReason: 'WET', ...o });
const updateArg = (tx: { wasteRequest: { updateMany: jest.Mock } }) =>
  tx.wasteRequest.updateMany.mock.calls[0]?.[0] as { where: Record<string, unknown>; data: Record<string, unknown> & { closedAt: Date } };
const PROGRAMME_OFF = 'Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.';

describe('WasteConfirmService.reject', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('a. rejects a DROP_OFF at a PARTNER point with no points and no counter', async () => {
    const h = setup();
    const result = await h.svc.reject(h.call, rejectBody());
    expect(result).toEqual({ requestId: 'r1', code: 'TR-ABCDE', status: 'REJECTED' });
    expect(updateArg(h.tx)).toEqual(
      expect.objectContaining({ data: { status: 'REJECTED', closedAt: expect.any(Date), rejectionReason: 'WET', rejectionNote: null, confirmedByUserId: 's1' } }),
    );
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect((writeWasteEvent as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        kind: 'REQUEST_REJECTED',
        actorUserId: 's1',
        actorRole: 'POINT_STAFF',
        requestId: 'r1',
        pointId: 'p1',
        meta: expect.objectContaining({
          route: 'DESK',
          device: { ip: '10.0.0.0', userAgent: 'jest' },
          matchBasis: null,
          rejectionReason: 'WET',
          rejectionNote: null,
          subjectUserId: 'u1',
          staffUserId: 's1',
          before: { status: 'OPEN' },
          after: { status: 'REJECTED' },
        }),
      }),
    );
    expect(h.notifier.requestRejected).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABCDE' }, 'WET');
    expect(h.order.indexOf('tx end')).toBeLessThan(h.order.indexOf('notify'));
    expect(h.shipLock.evaluateAndLock).not.toHaveBeenCalled();
    expect(h.rewards.grant).not.toHaveBeenCalled();
    expect(incrementPointUsage).not.toHaveBeenCalled();
    expect(lockWasteStaffCap).not.toHaveBeenCalled();
    expect(staffConfirmedToday).not.toHaveBeenCalled();
    noCustomerField(result);
  });

  describe('b. the programme switch', () => {
    it('the warehouse still rejects a MAIL_IN and a DROP_OFF while the programme is off', async () => {
      const mail = warehouseCase({ row: whRow({ status: 'IN_TRANSIT' }), cfg: { enabled: false } });
      await expect(mail.svc.reject(mail.call, rejectBody({ match: { parcelCode: 'TR-ABCDE' } }))).resolves.toEqual(expect.objectContaining({ status: 'REJECTED' }));
      const drop = warehouseCase({ row: row({ pointId: 'wh' }), cfg: { enabled: false } });
      await expect(drop.svc.reject(drop.call, rejectBody())).resolves.toEqual(expect.objectContaining({ status: 'REJECTED' }));
    });
    it('a PARTNER desk is refused by the access check before any transaction', async () => {
      const h = setup({ cfg: { enabled: false } });
      h.access.assertPointAccess.mockRejectedValue(new ForbiddenException(PROGRAMME_OFF));
      await expect(h.svc.reject(h.call, rejectBody())).rejects.toThrow(new ForbiddenException(PROGRAMME_OFF));
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('c. a blocked customer is still rejected (R17.3.60)', async () => {
    const h = setup({ row: row({ user: { id: 'u1', phone: '0900000001', isBlocked: true } }), flags: { blockedAt: new Date('2026-10-01T00:00:00Z') } });
    await expect(h.svc.reject(h.call, rejectBody())).resolves.toEqual({ requestId: 'r1', code: 'TR-ABCDE', status: 'REJECTED' });
    expect(h.tx.wasteRequest.updateMany).toHaveBeenCalledTimes(1);
  });

  it('d. OTHER needs a note', async () => {
    const h = setup();
    await expect(h.svc.reject(h.call, rejectBody({ rejectionReason: 'OTHER', rejectionNote: '  ' }))).rejects.toThrow(new BadRequestException('Lý do Khác cần ghi chú'));
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    const ok = setup();
    await ok.svc.reject(ok.call, rejectBody({ rejectionReason: 'OTHER', rejectionNote: ' vỏ hộp rách ' }));
    expect(updateArg(ok.tx)).toEqual(expect.objectContaining({ data: expect.objectContaining({ rejectionReason: 'OTHER', rejectionNote: 'vỏ hộp rách' }) }));
  });

  it('e. a failed match basis is a 409 and writes nothing (R17.3.95)', async () => {
    const h = warehouseCase({ row: whRow({ status: 'IN_TRANSIT' }), matchOutcome: { ok: false, reason: 'NO_MATCH' } });
    const err = await h.svc.reject(h.call, rejectBody()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toMatch(/^Căn cứ đối chiếu không hợp lệ:/);
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(h.notifier.requestRejected).not.toHaveBeenCalled();
  });

  it('f. a MAIL_IN RECEIVED reject for unpaid postage evaluates the ship lock after commit', async () => {
    const h = warehouseCase({ row: whRow() });
    await expect(h.svc.reject(h.call, rejectBody({ rejectionReason: 'UNPAID_POSTAGE' }))).resolves.toEqual(expect.objectContaining({ status: 'REJECTED' }));
    expect(h.shipLock.evaluateAndLock).toHaveBeenCalledTimes(1);
    expect(h.shipLock.evaluateAndLock).toHaveBeenCalledWith('u1', { shortfallLockPct: 50, shortfallLockStreak: 3 });
    expect(h.order.indexOf('tx end')).toBeLessThan(h.order.indexOf('shipLock'));
  });

  describe('g. replay', () => {
    it('the same reject by the same caller returns the stored result and writes nothing', async () => {
      const h = setup({ row: rejected() });
      await expect(h.svc.reject(h.call, rejectBody())).resolves.toEqual({ requestId: 'r1', code: 'TR-ABCDE', status: 'REJECTED' });
      expect(writeWasteEvent).not.toHaveBeenCalled();
      expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
      expect(h.notifier.requestRejected).not.toHaveBeenCalled();
      expect(h.shipLock.evaluateAndLock).not.toHaveBeenCalled();
      expect(h.order).not.toContain('notify');
    });
    it.each([
      ['another reason', rejected(), rejectBody({ rejectionReason: 'DIRTY' })],
      ['another staff member', rejected({ confirmedByUserId: 's2' }), rejectBody()],
    ])('%s is a 409', async (_n, data, b) => {
      const h = setup({ row: data });
      await expect(h.svc.reject(h.call, b)).rejects.toThrow(new ConflictException('Yêu cầu đã bị từ chối'));
    });
  });

  it('a stale status (count 0) is a 409 retry', async () => {
    const h = setup({ updateCount: 0 });
    await expect(h.svc.reject(h.call, rejectBody())).rejects.toThrow(new ConflictException('Vui lòng thử lại'));
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('keeps the 4a bans', async () => {
    const h = setup({ row: row({ userId: 's1', user: { id: 's1', phone: '0900000001', isBlocked: false } }) });
    await expect(h.svc.reject(h.call, rejectBody())).rejects.toThrow(new ForbiddenException('Bạn không thể xác nhận yêu cầu này'));
  });

  it('a PICKUP transition is conditional on orderId', async () => {
    const h = warehouseCase({ row: row({ method: 'PICKUP', pointId: 'wh', status: 'RECEIVED', orderId: 'o1', order: { status: 'DELIVERED' } }) });
    await h.svc.reject(h.call, rejectBody());
    expect(updateArg(h.tx)).toEqual(
      expect.objectContaining({ where: { id: 'r1', status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] }, orderId: 'o1' } }),
    );
  });
});

describe('WasteConfirmService.closeLost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  const lost = { reason: 'Hãng vận chuyển báo mất' };

  it('h. a MAIL_IN IN_TRANSIT closes as LOST without a ship-lock evaluation', async () => {
    const h = warehouseCase({ row: row({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: 'wh' }) });
    await expect(h.svc.closeLost('a1', 'r1', lost)).resolves.toEqual({ id: 'r1' });
    expect(assertActiveAdmin).toHaveBeenCalledWith(h.prisma, 'a1');
    expect(updateArg(h.tx)).toEqual({
      where: { id: 'r1', status: 'IN_TRANSIT', method: 'MAIL_IN' },
      data: { status: 'EXPIRED', closedAt: expect.any(Date), closeReason: 'LOST' },
    });
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect((writeWasteEvent as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        kind: 'REQUEST_CLOSED_LOST',
        actorUserId: 'a1',
        actorRole: 'ADMIN',
        requestId: 'r1',
        pointId: 'wh',
        meta: { reason: lost.reason, closeReason: 'LOST', subjectUserId: 'u1', before: { status: 'IN_TRANSIT' }, after: { status: 'EXPIRED', closeReason: 'LOST' } },
      }),
    );
    const closedAt = updateArg(h.tx).data.closedAt;
    expect(h.notifier.requestExpired).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABCDE' }, 'LOST', closedAt);
    expect(h.order.indexOf('tx end')).toBeLessThan(h.order.indexOf('notify'));
    expect(h.shipLock.evaluateAndLock).not.toHaveBeenCalled();
    expect(loadAdminRequestDetail).toHaveBeenCalledWith(h.prisma, h.access, 'r1', true);
  });

  it('i. a PICKUP RECEIVED closes as LOST_AT_WAREHOUSE with the orderId condition', async () => {
    const h = warehouseCase({ row: row({ method: 'PICKUP', status: 'RECEIVED', pointId: 'wh', orderId: 'o1' }) });
    await h.svc.closeLost('a1', 'r1', lost);
    expect(updateArg(h.tx)).toEqual(
      expect.objectContaining({
        where: { id: 'r1', status: 'RECEIVED', method: 'PICKUP', orderId: 'o1' },
        data: expect.objectContaining({ closeReason: 'LOST_AT_WAREHOUSE' }),
      }),
    );
  });

  it('j. a DROP_OFF OPEN cannot be closed as lost', async () => {
    const h = setup();
    await expect(h.svc.closeLost('a1', 'r1', lost)).rejects.toThrow('Yêu cầu này không đóng vì thất lạc được');
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('k. a STAFF user is refused before any transaction', async () => {
    const h = setup();
    (assertActiveAdmin as jest.Mock).mockRejectedValue(new ForbiddenException('Chỉ quản trị viên mới làm được thao tác này.'));
    await expect(h.svc.closeLost('s1', 'r1', lost)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('l. a missing request is a 404 and writes nothing', async () => {
    const h = setup();
    h.tx.wasteRequest.findUnique.mockResolvedValue(null as never);
    await expect(h.svc.closeLost('a1', 'r1', lost)).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
    expect(h.tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(h.notifier.requestExpired).not.toHaveBeenCalled();
  });

  it('a stale status (count 0) is a 409 retry', async () => {
    const h = warehouseCase({ row: row({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: 'wh' }), updateCount: 0 });
    await expect(h.svc.closeLost('a1', 'r1', lost)).rejects.toThrow(new ConflictException('Vui lòng thử lại'));
    expect(h.notifier.requestExpired).not.toHaveBeenCalled();
  });

  it('a failed message does not fail the close', async () => {
    const h = warehouseCase({ row: row({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: 'wh' }) });
    h.notifier.requestExpired.mockRejectedValueOnce(new Error('boom'));
    await expect(h.svc.closeLost('a1', 'r1', lost)).resolves.toEqual({ id: 'r1' });
  });
});
