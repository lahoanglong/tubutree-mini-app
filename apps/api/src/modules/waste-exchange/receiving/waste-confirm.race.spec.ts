import { HttpException, Logger } from '@nestjs/common';
import type { RaceDb } from '../../../../test/fakes/race-db.fake';
import { tick } from '../../../../test/fakes/race-db.fake';
import { cartonLine, createWasteRaceDb, request, user, warehouse, type WasteRaceOptions } from '../../../../test/fakes/waste-race.harness';
import { RewardPointsService } from '../../wallet/reward-points.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteRequestsService } from '../customer/waste-requests.service';
import { WasteExpiryCron } from '../pickup/waste-expiry.cron';
import { WasteConfirmService, type WasteStaffCall } from './waste-confirm.service';
import { WasteReverseService } from './waste-reverse.service';

jest.mock('./waste-admin-detail.mapper', () => ({ loadAdminRequestDetail: jest.fn(async (_p: unknown, _a: unknown, id: string) => ({ id })) }));

/**
 * Xác nhận / từ chối / thu hồi / đóng thất lạc / huỷ / hết hạn của một yêu cầu đổi rác chạy đồng thời (Postgres READ COMMITTED, test/fakes/race-db.fake.ts).
 * Điểm Xanh chỉ được cộng đúng MỘT lần cho một yêu cầu, trạng thái cuối (COMPLETED, REJECTED, CANCELLED, EXPIRED, REVERSED) không bị ghi đè,
 * và sổ điểm luôn khớp số dư. Dùng WasteConfirmService, WasteReverseService, WasteRequestsService.cancel, WasteExpiryCron, RewardPointsService THẬT;
 * chỉ thông báo, khoá gửi và bản chi tiết admin là giả.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);
const message = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as Error).message : null);

const POINTS = 10_000;
const FULL = { lines: [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 }] };
const CFG = { enabled: true, staffDailyCapPoints: 1_000_000, shortfallLockPct: 50, shortfallLockStreak: 3 };
const SWEEP = Array.from({ length: 121 }, (_, i) => i - 60);

function addRequest(db: RaceDb, id: string, over: Record<string, unknown> = {}) {
  db.seed('wasteRequest', [request({ id, code: `TR-${id.toUpperCase()}`, ...over })]);
  db.seed('wasteRequestLine', [cartonLine(id)]);
}

function setup(opts: WasteRaceOptions & { cfg?: Partial<typeof CFG>; request?: Record<string, unknown> | null } = {}) {
  const { db, prisma } = createWasteRaceDb(opts);
  db.seed('user', [
    user('u1', '0900000001'),
    user('s1', '0900000002', { role: 'STAFF' }),
    user('s2', '0900000003', { role: 'STAFF' }),
    user('a1', '0900000004', { role: 'ADMIN' }),
    user('a2', '0900000005', { role: 'ADMIN' }),
  ]);
  db.seed('wastePoint', [warehouse]);
  if (opts.request !== null) addRequest(db, 'r1', opts.request);

  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const cfg = { ...CFG, ...opts.cfg };
  const notifier = {
    pointsCredited: jest.fn().mockResolvedValue(undefined),
    requestRejected: jest.fn().mockResolvedValue(undefined),
    requestExpired: jest.fn().mockResolvedValue(undefined),
    pointsReversed: jest.fn().mockResolvedValue(undefined),
  };
  const shipLock = { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) };
  const access = new WasteAccessService(prisma);
  const rewards = new RewardPointsService(prisma, config as never);
  const confirmSvc = new WasteConfirmService(prisma, { snapshot: async () => cfg } as never, access, rewards, config as never, notifier as never, shipLock as never);
  const reverseSvc = new WasteReverseService(prisma, { snapshot: async () => cfg } as never, notifier as never, shipLock as never);
  const requestsSvc = new WasteRequestsService(prisma, access, {} as never, {} as never, config as never);
  jest.spyOn(requestsSvc, 'loadDetail').mockResolvedValue({} as never);
  const cron = new WasteExpiryCron(prisma, { snapshot: async () => cfg } as never, notifier as never, shipLock as never, access);

  const call = (staff = 's1', route: 'DESK' | 'ADMIN' = 'DESK', requestId = 'r1'): WasteStaffCall => ({ callerUserId: staff, requestId, route, device: { ip: null, userAgent: null } });
  const confirm = (staff = 's1', requestId = 'r1') => confirmSvc.confirm(call(staff, 'DESK', requestId), FULL);
  const reject = (staff = 's1') => confirmSvc.reject(call(staff), { rejectionReason: 'WET' });
  const reverse = (admin = 'a1') => reverseSvc.reverse(admin, 'r1', { reason: 'Nhập nhầm số lượng' });
  const cancel = () => requestsSvc.cancel('u1', 'r1');
  const closeLost = (admin = 'a2') => confirmSvc.closeLost(admin, 'r1', { reason: 'Kiểm kho không thấy' });
  const expire = (now = new Date('2026-11-10T03:30:00Z')) =>
    (cron as unknown as { closeRow(row: Record<string, unknown>, now: Date): Promise<string | null> }).closeRow(
      { id: 'r1', code: 'TR-R1', userId: 'u1', method: 'DROP_OFF', status: 'OPEN', orderId: null },
      now,
    );

  const balance = (id = 'u1') => db.row('user', id)!.pointsBalance as number;
  const ledger = (refType?: string) => db.rows('pointsTransaction').filter((t) => !refType || t.refType === refType);
  const req = (id = 'r1') => db.row('wasteRequest', id)!;
  const events = (kind: string) => db.rows('wasteEvent').filter((e) => e.kind === kind);
  return { db, confirm, reject, reverse, cancel, closeLost, expire, balance, ledger, req, events, notifier, confirmSvc, call };
}

/** Điểm khớp sổ: số dư của khách bằng tổng delta các dòng sổ của khách. */
const ledgerMatchesBalance = (h: ReturnType<typeof setup>) => h.ledger().reduce((s, t) => s + (t.delta as number), 0) === h.balance();

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Đổi rác lấy quà — xác nhận đua với mọi đường chuyển trạng thái', () => {
  it('bấm đúp cùng một nhân viên: cộng Điểm Xanh đúng MỘT lần, lần hai nhận lại đúng kết quả cũ, chỉ một tin cộng điểm', async () => {
    const h = setup();
    const settled = await Promise.allSettled([h.confirm('s1'), h.confirm('s1'), h.confirm('s1')]);
    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    const [a, b, c] = settled.map((s) => (s as PromiseFulfilledResult<unknown>).value);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a).toMatchObject({ requestId: 'r1', status: 'COMPLETED', pointsAwarded: POINTS });
    expect(h.req()).toMatchObject({ status: 'COMPLETED', pointsAwarded: POINTS, confirmedByUserId: 's1' });
    expect(h.balance()).toBe(POINTS);
    expect(h.ledger('RECYCLE')).toHaveLength(1);
    expect(h.ledger('RECYCLE')[0]).toMatchObject({ userId: 'u1', delta: POINTS, refId: 'r1', reason: 'RECYCLE:TR-R1' });
    expect(h.events('REQUEST_CONFIRMED')).toHaveLength(1);
    expect(h.notifier.pointsCredited).toHaveBeenCalledTimes(1);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('hai nhân viên khác nhau xác nhận cùng một yêu cầu (quét thời điểm): đúng một người thắng và cộng điểm một lần, người kia nhận 409', async () => {
    const winners = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const first = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.confirm('s2'));
      const [a, b] = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      const lost = a.status === 'fulfilled' ? b : a;
      is(label, httpStatus(lost), 409);
      is(label, message(lost), 'Yêu cầu đã được xác nhận với số liệu khác');
      is(label, h.req().confirmedByUserId, a.status === 'fulfilled' ? 's1' : 's2');
      is(label, h.req().status, 'COMPLETED');
      is(label, h.balance(), POINTS);
      is(label, h.ledger('RECYCLE').length, 1);
      is(label, h.notifier.pointsCredited.mock.calls.length, 1);
      winners.add(h.req().confirmedByUserId as string);
      waits += h.db.stats.lockWaits;
    }
    expect(winners).toEqual(new Set(['s1', 's2']));
    expect(waits).toBeGreaterThan(0);
  });

  it('xác nhận chen với từ chối (quét thời điểm): hoặc COMPLETED cộng điểm một lần, hoặc REJECTED không cộng; bên thua nhận 409, trạng thái cuối không bị ghi đè', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const confirming = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
      const rejecting = async () => (await delay(Math.max(-skew, 0)), h.reject('s2'));
      const [c, r] = await Promise.allSettled([confirming(), rejecting()]);
      const label = `skew ${skew}`;
      is(label, [c.status, r.status].filter((s) => s === 'fulfilled').length, 1);
      if (c.status === 'fulfilled') {
        is(label, h.req().status, 'COMPLETED');
        is(label, h.req().rejectionReason, null);
        is(label, h.balance(), POINTS);
        is(label, h.ledger('RECYCLE').length, 1);
        is(label, httpStatus(r), 409);
        is(label, h.events('REQUEST_REJECTED').length, 0);
        is(label, h.notifier.requestRejected.mock.calls.length, 0);
      } else {
        is(label, h.req().status, 'REJECTED');
        is(label, h.req().pointsAwarded, null);
        is(label, h.balance(), 0);
        is(label, h.ledger().length, 0);
        is(label, httpStatus(c), 409);
        is(label, h.events('REQUEST_CONFIRMED').length, 0);
        is(label, h.notifier.pointsCredited.mock.calls.length, 0);
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['COMPLETED', 'REJECTED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('xác nhận chen với khách huỷ (quét thời điểm): hoặc COMPLETED cộng điểm một lần, hoặc CANCELLED không cộng; yêu cầu đã huỷ không bao giờ có điểm', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const confirming = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
      const cancelling = async () => (await delay(Math.max(-skew, 0)), h.cancel());
      const [c, x] = await Promise.allSettled([confirming(), cancelling()]);
      const label = `skew ${skew}`;
      is(label, [c.status, x.status].filter((s) => s === 'fulfilled').length, 1);
      if (c.status === 'fulfilled') {
        is(label, h.req().status, 'COMPLETED');
        is(label, h.balance(), POINTS);
        is(label, h.ledger('RECYCLE').length, 1);
        is(label, httpStatus(x), 409);
        is(label, h.events('REQUEST_CANCELLED').length, 0);
      } else {
        is(label, h.req().status, 'CANCELLED');
        is(label, h.req().pointsAwarded, null);
        is(label, h.balance(), 0);
        is(label, h.ledger().length, 0);
        is(label, httpStatus(c), 409);
        is(label, h.events('REQUEST_CONFIRMED').length, 0);
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['COMPLETED', 'CANCELLED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('xác nhận chen với cron hết hạn giữ chỗ (quét thời điểm): hoặc COMPLETED cộng điểm một lần, hoặc EXPIRED không cộng, không ghi đè nhau', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ request: { expiresAt: new Date('2026-11-09T00:00:00Z') } });
      const confirming = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
      const expiring = async () => (await delay(Math.max(-skew, 0)), h.expire());
      const [c, e] = await Promise.allSettled([confirming(), expiring()]);
      const label = `skew ${skew}`;
      is(label, e.status, 'fulfilled');
      if (c.status === 'fulfilled') {
        is(label, h.req().status, 'COMPLETED');
        is(label, h.req().closeReason, null);
        is(label, h.balance(), POINTS);
        is(label, h.ledger('RECYCLE').length, 1);
        is(label, (e as PromiseFulfilledResult<unknown>).value, null);
        is(label, h.events('REQUEST_EXPIRED').length, 0);
      } else {
        is(label, h.req().status, 'EXPIRED');
        is(label, h.req().closeReason, 'HOLD_EXPIRED');
        is(label, h.req().pointsAwarded, null);
        is(label, h.balance(), 0);
        is(label, h.ledger().length, 0);
        is(label, httpStatus(c), 409);
        is(label, h.events('REQUEST_CONFIRMED').length, 0);
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['COMPLETED', 'EXPIRED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('đóng thất lạc chen với xác nhận kiện đã nhận ở kho (quét thời điểm): hoặc COMPLETED cộng điểm một lần, hoặc EXPIRED LOST_AT_WAREHOUSE không cộng', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ request: { method: 'MAIL_IN', status: 'RECEIVED', trackingCode: 'VN123', trackingNorm: 'VN123' } });
      const { confirmSvc, call } = h;
      const confirming = async () => (await delay(Math.max(skew, 0)), confirmSvc.confirm(call('a1', 'ADMIN'), FULL));
      const closing = async () => (await delay(Math.max(-skew, 0)), h.closeLost());
      const [c, l] = await Promise.allSettled([confirming(), closing()]);
      const label = `skew ${skew}`;
      is(label, [c.status, l.status].filter((s) => s === 'fulfilled').length, 1);
      if (c.status === 'fulfilled') {
        is(label, h.req().status, 'COMPLETED');
        is(label, h.req().closeReason, null);
        is(label, h.balance(), POINTS);
        is(label, h.ledger('RECYCLE').length, 1);
        is(label, httpStatus(l), 409);
      } else {
        is(label, h.req().status, 'EXPIRED');
        is(label, h.req().closeReason, 'LOST_AT_WAREHOUSE');
        is(label, h.balance(), 0);
        is(label, h.ledger().length, 0);
        is(label, httpStatus(c), 409);
        is(label, h.events('REQUEST_CONFIRMED').length, 0);
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['COMPLETED', 'EXPIRED']));
    expect(waits).toBeGreaterThan(0);
  });

  describe('thu hồi điểm', () => {
    const completed = () => ({
      request: { status: 'COMPLETED', confirmedByUserId: 's1', pointsAwarded: POINTS, dropsAwarded: 0, completedAt: new Date('2026-11-10T02:00:00Z') },
    });
    const withCredit = () => {
      const h = setup(completed());
      h.db.seed('user', [user('u1', '0900000001', { pointsBalance: POINTS })]);
      h.db.seed('pointsTransaction', [
        { userId: 'u1', delta: POINTS, reason: 'RECYCLE:TR-R1', refType: 'RECYCLE', refId: 'r1', expiresAt: new Date('2027-11-10T00:00:00Z') },
      ]);
      return h;
    };

    it('hai admin thu hồi cùng một yêu cầu (quét thời điểm): trừ điểm đúng MỘT lần, lần hai nhận lại kết quả cũ', async () => {
      let waits = 0;
      for (const skew of SWEEP) {
        const h = withCredit();
        const first = async () => (await delay(Math.max(skew, 0)), h.reverse('a1'));
        const second = async () => (await delay(Math.max(-skew, 0)), h.reverse('a2'));
        const [a, b] = await Promise.allSettled([first(), second()]);
        const label = `skew ${skew}`;
        is(label, [a.status, b.status], ['fulfilled', 'fulfilled']);
        is(label, (a as PromiseFulfilledResult<unknown>).value, (b as PromiseFulfilledResult<unknown>).value);
        is(label, (a as PromiseFulfilledResult<unknown>).value, { requestId: 'r1', status: 'REVERSED', pointsTaken: POINTS, shortfallPoints: 0 });
        is(label, h.req().status, 'REVERSED');
        is(label, h.balance(), 0);
        is(label, h.ledger('RECYCLE_REVERSED').length, 1);
        is(label, h.ledger('RECYCLE_REVERSED')[0]!.delta, -POINTS);
        is(label, h.events('POINTS_REVERSED').length, 1);
        is(label, h.notifier.pointsReversed.mock.calls.length, 1);
        is(label, ledgerMatchesBalance(h), true);
        waits += h.db.stats.lockWaits;
      }
      expect(waits).toBeGreaterThan(0);
    });

    it('thu hồi chen với xác nhận (quét thời điểm): hoặc COMPLETED còn điểm, hoặc REVERSED về 0; sổ điểm luôn khớp số dư, không thu hồi điểm chưa cộng', async () => {
      const seen = new Set<string>();
      let waits = 0;
      for (const skew of SWEEP) {
        const h = setup();
        const confirming = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
        const reversing = async () => (await delay(Math.max(-skew, 0)), h.reverse('a1'));
        const [c, r] = await Promise.allSettled([confirming(), reversing()]);
        const label = `skew ${skew}`;
        is(label, c.status, 'fulfilled');
        is(label, h.ledger('RECYCLE').length, 1);
        is(label, ledgerMatchesBalance(h), true);
        if (r.status === 'fulfilled') {
          is(label, h.req().status, 'REVERSED');
          is(label, h.balance(), 0);
          is(label, h.ledger('RECYCLE_REVERSED').length, 1);
        } else {
          is(label, httpStatus(r), 409);
          is(label, h.req().status, 'COMPLETED');
          is(label, h.balance(), POINTS);
          is(label, h.ledger('RECYCLE_REVERSED').length, 0);
        }
        seen.add(h.req().status as string);
        waits += h.db.stats.lockWaits;
      }
      expect(seen).toEqual(new Set(['COMPLETED', 'REVERSED']));
      expect(waits).toBeGreaterThan(0);
    });
  });

  it('hai yêu cầu của cùng nhân viên chạm trần điểm xác nhận trong ngày (quét thời điểm): chỉ một yêu cầu qua trần, yêu cầu kia nhận 409 và không cộng điểm', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ cfg: { staffDailyCapPoints: 15_000 } });
      addRequest(h.db, 'r2');
      const a = async () => (await delay(Math.max(skew, 0)), h.confirm('s1', 'r1'));
      const b = async () => (await delay(Math.max(-skew, 0)), h.confirm('s1', 'r2'));
      const [x, y] = await Promise.allSettled([a(), b()]);
      const label = `skew ${skew}`;
      is(label, [x.status, y.status].filter((s) => s === 'fulfilled').length, 1);
      const lost = x.status === 'fulfilled' ? y : x;
      is(label, httpStatus(lost), 409);
      is(label, message(lost), 'Bạn đã chạm trần điểm xác nhận hôm nay');
      is(label, h.balance(), POINTS);
      is(label, h.ledger('RECYCLE').length, 1);
      is(label, [h.req('r1').status, h.req('r2').status].sort(), ['COMPLETED', 'OPEN']);
      seen.add(x.status === 'fulfilled' ? 'r1 qua trần' : 'r2 qua trần');
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['r1 qua trần', 'r2 qua trần']));
    expect(waits).toBeGreaterThan(0);
  });

  it.each(['REJECTED', 'CANCELLED', 'EXPIRED', 'REVERSED'])('trạng thái cuối %s không bị xác nhận ghi đè: 409, không cộng điểm, không đổi trạng thái', async (status) => {
    const h = setup({ request: { status, closeReason: status === 'EXPIRED' ? 'HOLD_EXPIRED' : null, pointsAwarded: status === 'REVERSED' ? POINTS : null } });
    const settled = await Promise.allSettled([h.confirm('s1'), h.confirm('s2'), h.reject('s1')]);
    expect(settled.every((s) => s.status === 'rejected' && httpStatus(s) === 409)).toBe(true);
    expect(settled.slice(0, 2).map(message)).toEqual(['Yêu cầu không ở trạng thái xác nhận được', 'Yêu cầu không ở trạng thái xác nhận được']);
    expect(h.req().status).toBe(status);
    expect(h.req().confirmedByUserId).toBeNull();
    expect(h.balance()).toBe(0);
    expect(h.ledger()).toHaveLength(0);
    expect(h.notifier.pointsCredited).not.toHaveBeenCalled();
  });
});

describe('Đổi rác lấy quà — từng tầng bảo vệ đứng một mình', () => {
  // Bỏ khoá SELECT ... FOR UPDATE và unique của sổ điểm: chỉ còn UPDATE có điều kiện trạng thái (count) ngăn ghi đè trạng thái cuối và cộng điểm hai lần.
  const casOnly = { selectForUpdate: false, ledgerUnique: false } satisfies WasteRaceOptions;

  it('chỉ CAS: hai nhân viên xác nhận cùng lúc, bên thua nhận 409 "thử lại", điểm cộng đúng một lần dù không còn khoá dòng và unique sổ', async () => {
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup(casOnly);
      const first = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.confirm('s2'));
      const [a, b] = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      const lost = a.status === 'fulfilled' ? b : a;
      is(label, httpStatus(lost), 409);
      is(label, h.req().status, 'COMPLETED');
      is(label, h.balance(), POINTS);
      is(label, h.ledger('RECYCLE').length, 1);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it('chỉ CAS: từ chối chen với xác nhận không ghi đè COMPLETED thành REJECTED (và ngược lại), không cộng điểm khi REJECTED', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup(casOnly);
      const confirming = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
      const rejecting = async () => (await delay(Math.max(-skew, 0)), h.reject('s2'));
      const [c, r] = await Promise.allSettled([confirming(), rejecting()]);
      const label = `skew ${skew}`;
      is(label, [c.status, r.status].filter((s) => s === 'fulfilled').length, 1);
      const status = h.req().status;
      is(label, status, c.status === 'fulfilled' ? 'COMPLETED' : 'REJECTED');
      is(label, h.balance(), status === 'COMPLETED' ? POINTS : 0);
      is(label, h.ledger().length, status === 'COMPLETED' ? 1 : 0);
      is(label, h.req().rejectionReason, status === 'REJECTED' ? 'WET' : null);
      seen.add(status as string);
    }
    expect(seen).toEqual(new Set(['COMPLETED', 'REJECTED']));
  });

  it('chỉ CAS: khách huỷ chen với xác nhận không ghi đè trạng thái cuối của nhau', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup(casOnly);
      const confirming = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
      const cancelling = async () => (await delay(Math.max(-skew, 0)), h.cancel());
      const [c, x] = await Promise.allSettled([confirming(), cancelling()]);
      const label = `skew ${skew}`;
      is(label, [c.status, x.status].filter((s) => s === 'fulfilled').length, 1);
      const status = h.req().status;
      is(label, status, c.status === 'fulfilled' ? 'COMPLETED' : 'CANCELLED');
      is(label, h.balance(), status === 'COMPLETED' ? POINTS : 0);
      is(label, h.ledger().length, status === 'COMPLETED' ? 1 : 0);
      seen.add(status as string);
    }
    expect(seen).toEqual(new Set(['COMPLETED', 'CANCELLED']));
  });

  it('chỉ CAS: cron hết hạn chen với xác nhận không ghi đè trạng thái cuối của nhau', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup({ ...casOnly, request: { expiresAt: new Date('2026-11-09T00:00:00Z') } });
      const confirming = async () => (await delay(Math.max(skew, 0)), h.confirm('s1'));
      const expiring = async () => (await delay(Math.max(-skew, 0)), h.expire());
      const [c, e] = await Promise.allSettled([confirming(), expiring()]);
      const label = `skew ${skew}`;
      is(label, e.status, 'fulfilled');
      const status = h.req().status;
      is(label, status, c.status === 'fulfilled' ? 'COMPLETED' : 'EXPIRED');
      is(label, h.balance(), status === 'COMPLETED' ? POINTS : 0);
      is(label, h.ledger().length, status === 'COMPLETED' ? 1 : 0);
      seen.add(status as string);
    }
    expect(seen).toEqual(new Set(['COMPLETED', 'EXPIRED']));
  });

  it('chỉ CAS: đóng thất lạc chen với xác nhận kiện đã nhận không ghi đè trạng thái cuối của nhau', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup({ ...casOnly, request: { method: 'MAIL_IN', status: 'RECEIVED', trackingCode: 'VN123', trackingNorm: 'VN123' } });
      const confirming = async () => (await delay(Math.max(skew, 0)), h.confirmSvc.confirm(h.call('a1', 'ADMIN'), FULL));
      const closing = async () => (await delay(Math.max(-skew, 0)), h.closeLost());
      const [c, l] = await Promise.allSettled([confirming(), closing()]);
      const label = `skew ${skew}`;
      is(label, [c.status, l.status].filter((s) => s === 'fulfilled').length, 1);
      const status = h.req().status;
      is(label, status, c.status === 'fulfilled' ? 'COMPLETED' : 'EXPIRED');
      is(label, h.balance(), status === 'COMPLETED' ? POINTS : 0);
      is(label, h.ledger().length, status === 'COMPLETED' ? 1 : 0);
      is(label, h.req().closeReason, status === 'EXPIRED' ? 'LOST_AT_WAREHOUSE' : null);
      seen.add(status as string);
    }
    expect(seen).toEqual(new Set(['COMPLETED', 'EXPIRED']));
  });

  it('chỉ CAS: hai admin thu hồi cùng lúc vẫn trừ điểm đúng một lần dù không còn khoá dòng và unique RECYCLE_REVERSED', async () => {
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ ...casOnly, request: { status: 'COMPLETED', confirmedByUserId: 's1', pointsAwarded: POINTS, dropsAwarded: 0 } });
      h.db.seed('user', [user('u1', '0900000001', { pointsBalance: 2 * POINTS })]);
      h.db.seed('pointsTransaction', [
        { userId: 'u1', delta: POINTS, reason: 'RECYCLE:TR-R1', refType: 'RECYCLE', refId: 'r1', expiresAt: new Date('2027-11-10T00:00:00Z') },
        { userId: 'u1', delta: POINTS, reason: 'ORDER:o9', refType: 'ORDER', refId: 'o9', expiresAt: new Date('2027-11-10T00:00:00Z') },
      ]);
      const first = async () => (await delay(Math.max(skew, 0)), h.reverse('a1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.reverse('a2'));
      const settled = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, settled.filter((s) => s.status === 'fulfilled').length >= 1, true);
      is(label, h.req().status, 'REVERSED');
      is(label, h.ledger('RECYCLE_REVERSED').length, 1);
      is(label, h.balance(), POINTS);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });
});
