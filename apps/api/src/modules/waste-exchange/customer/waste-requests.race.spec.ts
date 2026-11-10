import { HttpException, Logger } from '@nestjs/common';
import type { RaceDb } from '../../../../test/fakes/race-db.fake';
import { tick } from '../../../../test/fakes/race-db.fake';
import { cartonLine, createWasteRaceDb, request, user, warehouse, type WasteRaceOptions } from '../../../../test/fakes/waste-race.harness';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteExpiryCron } from '../pickup/waste-expiry.cron';
import { WasteAdminRequestsService } from '../receiving/waste-admin-requests.service';
import { WasteReceiveService } from '../receiving/waste-receive.service';
import { WasteRequestsService } from './waste-requests.service';

jest.mock('../receiving/waste-admin-detail.mapper', () => ({ loadAdminRequestDetail: jest.fn(async (_p: unknown, _a: unknown, id: string) => ({ id })) }));

/**
 * Kiện gửi kho (MAIL_IN) còn OPEN bị nhiều bên giành cùng lúc: khách huỷ, khách nhập mã vận đơn, nhân viên kho nhận kiện, cron hết hạn giữ chỗ
 * (Postgres READ COMMITTED, test/fakes/race-db.fake.ts). Mỗi yêu cầu chỉ đi một nhánh; trạng thái cuối (CANCELLED, EXPIRED, RECEIVED) không bị ghi đè
 * hay lùi về IN_TRANSIT. Admin mở lại yêu cầu hết hạn và nhân viên ghép / đóng kiện không rõ chủ cũng đua nhau trên cùng yêu cầu và cùng kiện.
 * Dùng WasteRequestsService, WasteReceiveService, WasteAdminRequestsService.reopen, WasteExpiryCron và WasteAccessService THẬT; chỉ thông báo và bước giữ chỗ là giả.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);
const SWEEP = Array.from({ length: 101 }, (_, i) => i - 50);
const EXPIRED_AT = new Date('2026-11-09T00:00:00Z');
const TRACKING = { carrier: 'GHN', trackingCode: 'VN123456' };

function addRequest(db: RaceDb, over: Record<string, unknown> = {}, id = 'r1') {
  db.seed('wasteRequest', [request({ id, code: id === 'r1' ? 'TR-ABCDE' : `TR-${id.toUpperCase()}`, method: 'MAIL_IN', ...over })]);
  db.seed('wasteRequestLine', [cartonLine(id)]);
}

const parcel = (id = 'p1') => ({
  id,
  receivedAt: new Date('2026-11-10T01:00:00Z'),
  createdByUserId: 's1',
  carrier: null,
  trackingCode: null,
  trackingNorm: null,
  description: 'Kiện không ghi tên',
  reason: 'NO_MATCH',
  relatedRequestId: null,
  status: 'OPEN',
  matchedRequestId: null,
  resolvedByUserId: null,
  resolvedAt: null,
  resolveNote: null,
});

function setup(opts: WasteRaceOptions & { request?: Record<string, unknown> } = {}) {
  const { db, prisma } = createWasteRaceDb(opts);
  db.seed('user', [
    user('u1', '0900000001'),
    user('s1', '0900000002', { role: 'STAFF' }),
    user('s2', '0900000003', { role: 'STAFF' }),
    user('a1', '0900000004', { role: 'ADMIN' }),
    user('a2', '0900000005', { role: 'ADMIN' }),
  ]);
  db.seed('wastePoint', [warehouse]);
  addRequest(db, opts.request);

  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const notifier = {
    parcelReceived: jest.fn().mockResolvedValue(undefined),
    requestExpired: jest.fn().mockResolvedValue(undefined),
  };
  const shipLock = { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) };
  const access = new WasteAccessService(prisma);
  const requestsSvc = new WasteRequestsService(prisma, access, {} as never, {} as never, config as never);
  jest.spyOn(requestsSvc, 'loadDetail').mockResolvedValue({} as never);
  const receiveSvc = new WasteReceiveService(prisma, access, notifier as never);
  const cron = new WasteExpiryCron(prisma, { snapshot: async () => ({ enabled: true, shortfallLockPct: 50, shortfallLockStreak: 3 }) } as never, notifier as never, shipLock as never, access);

  const hold = { validateAndHold: jest.fn().mockResolvedValue({}) };
  const adminSvc = new WasteAdminRequestsService(prisma, { snapshot: async () => ({ enabled: true }) } as never, access, hold as never, notifier as never);

  const cancel = () => requestsSvc.cancel('u1', 'r1');
  const reopen = (admin = 'a1') => adminSvc.reopen(admin, 'r1', { reason: 'Kiện về muộn' });
  const match = (requestId: string, staff = 's1', parcelId = 'p1') => receiveSvc.resolveUnmatched(staff, parcelId, { action: 'MATCH', requestId, note: 'Khớp tay' });
  const closeParcel = (staff = 's2') => receiveSvc.resolveUnmatched(staff, 'p1', { action: 'CLOSE', note: 'Không tìm được chủ' });
  const track = () => requestsSvc.setTracking('u1', 'r1', TRACKING);
  const receive = (staff = 's1') => receiveSvc.receive(staff, 'r1', { match: { parcelCode: 'TR-ABCDE' } });
  const expire = () =>
    (cron as unknown as { closeRow(row: Record<string, unknown>, now: Date): Promise<string | null> }).closeRow(
      { id: 'r1', code: 'TR-ABCDE', userId: 'u1', method: 'MAIL_IN', status: 'OPEN', orderId: null },
      new Date('2026-11-10T03:30:00Z'),
    );
  const req = () => db.row('wasteRequest', 'r1')!;
  const events = (kind: string) => db.rows('wasteEvent').filter((e) => e.kind === kind);
  return { db, cancel, reopen, match, closeParcel, track, receive, expire, req, events, notifier };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Yêu cầu gửi kho — huỷ, nhập mã vận đơn, nhận kiện và hết hạn đua nhau', () => {
  it('khách bấm huỷ nhiều lần cùng lúc: huỷ đúng MỘT lần (một sự kiện), các lần sau nhận lại kết quả như cũ', async () => {
    const h = setup();
    const settled = await Promise.allSettled([h.cancel(), h.cancel(), h.cancel()]);
    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(h.req()).toMatchObject({ status: 'CANCELLED', closeReason: null });
    expect(h.events('REQUEST_CANCELLED')).toHaveLength(1);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('khách huỷ chen với nhập mã vận đơn (quét thời điểm): hoặc CANCELLED không có mã vận đơn, hoặc IN_TRANSIT có mã và lần huỷ nhận 409', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const cancelling = async () => (await delay(Math.max(skew, 0)), h.cancel());
      const tracking = async () => (await delay(Math.max(-skew, 0)), h.track());
      const [c, t] = await Promise.allSettled([cancelling(), tracking()]);
      const label = `skew ${skew}`;
      is(label, [c.status, t.status].filter((s) => s === 'fulfilled').length, 1);
      if (c.status === 'fulfilled') {
        is(label, h.req().status, 'CANCELLED');
        is(label, h.req().trackingCode, null);
        is(label, httpStatus(t), 409);
        is(label, h.events('TRACKING_SET').length, 0);
      } else {
        is(label, h.req().status, 'IN_TRANSIT');
        is(label, h.req().trackingCode, 'VN123456');
        is(label, httpStatus(c), 409);
        is(label, h.events('REQUEST_CANCELLED').length, 0);
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['CANCELLED', 'IN_TRANSIT']));
    expect(waits).toBeGreaterThan(0);
  });

  it('khách huỷ chen với nhân viên kho nhận kiện (quét thời điểm): hoặc CANCELLED không có sự kiện nhận, hoặc RECEIVED và lần huỷ nhận 409', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const cancelling = async () => (await delay(Math.max(skew, 0)), h.cancel());
      const receiving = async () => (await delay(Math.max(-skew, 0)), h.receive('s1'));
      const [c, r] = await Promise.allSettled([cancelling(), receiving()]);
      const label = `skew ${skew}`;
      is(label, r.status, 'fulfilled');
      if (c.status === 'fulfilled') {
        is(label, h.req().status, 'CANCELLED');
        is(label, h.req().receivedAt ?? null, null);
        is(label, h.events('PARCEL_RECEIVED').length, 0);
        is(label, (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome, 'UNMATCHED');
      } else {
        is(label, h.req().status, 'RECEIVED');
        is(label, httpStatus(c), 409);
        is(label, h.events('PARCEL_RECEIVED').length, 1);
        is(label, (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome, 'RECEIVED');
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['CANCELLED', 'RECEIVED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('hai nhân viên kho nhận cùng một kiện (quét thời điểm): đúng một lần RECEIVED, một sự kiện nhận và một tin cho khách; người kia bị đưa vào hàng không rõ chủ', async () => {
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const first = async () => (await delay(Math.max(skew, 0)), h.receive('s1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.receive('s2'));
      const [a, b] = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [a.status, b.status], ['fulfilled', 'fulfilled']);
      const outcomes = [a, b].map((s) => (s as PromiseFulfilledResult<{ outcome: string }>).value.outcome).sort();
      is(label, outcomes, ['RECEIVED', 'UNMATCHED']);
      is(label, h.req().status, 'RECEIVED');
      is(label, h.events('PARCEL_RECEIVED').length, 1);
      is(label, h.notifier.parcelReceived.mock.calls.length, 1);
      is(label, h.db.rows('wasteUnmatchedParcel').length, 1);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it('nhập mã vận đơn chen với nhân viên kho nhận kiện (quét thời điểm): RECEIVED không bao giờ lùi về IN_TRANSIT, chỉ một sự kiện nhận', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup();
      const tracking = async () => (await delay(Math.max(skew, 0)), h.track());
      const receiving = async () => (await delay(Math.max(-skew, 0)), h.receive('s1'));
      const [t, r] = await Promise.allSettled([tracking(), receiving()]);
      const label = `skew ${skew}`;
      is(label, r.status, 'fulfilled');
      is(label, (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome, 'RECEIVED');
      is(label, h.req().status, 'RECEIVED');
      is(label, h.events('PARCEL_RECEIVED').length, 1);
      if (t.status === 'rejected') {
        is(label, httpStatus(t), 409);
        is(label, h.req().trackingCode, null);
      } else is(label, h.req().trackingCode, 'VN123456');
      seen.add(t.status);
    }
    expect(seen).toEqual(new Set(['fulfilled', 'rejected']));
  });

  it('cron hết hạn giữ chỗ chen với nhập mã vận đơn (quét thời điểm): hoặc EXPIRED và lần nhập nhận 409, hoặc IN_TRANSIT không còn hạn và cron bỏ qua', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ request: { expiresAt: EXPIRED_AT } });
      const expiring = async () => (await delay(Math.max(skew, 0)), h.expire());
      const tracking = async () => (await delay(Math.max(-skew, 0)), h.track());
      const [e, t] = await Promise.allSettled([expiring(), tracking()]);
      const label = `skew ${skew}`;
      is(label, e.status, 'fulfilled');
      if (t.status === 'fulfilled') {
        is(label, h.req().status, 'IN_TRANSIT');
        is(label, h.req().expiresAt, null);
        is(label, (e as PromiseFulfilledResult<unknown>).value, null);
        is(label, h.events('REQUEST_EXPIRED').length, 0);
      } else {
        is(label, h.req().status, 'EXPIRED');
        is(label, h.req().closeReason, 'HOLD_EXPIRED');
        is(label, httpStatus(t), 409);
        is(label, h.req().trackingCode, null);
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['IN_TRANSIT', 'EXPIRED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('hai admin mở lại cùng một yêu cầu đã hết hạn (quét thời điểm): đúng một lần RECEIVED, một sự kiện, một tin; bên thua nhận 409', async () => {
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ request: { status: 'EXPIRED', closeReason: 'HOLD_EXPIRED', closedAt: new Date('2026-11-09T03:30:00Z') } });
      const first = async () => (await delay(Math.max(skew, 0)), h.reopen('a1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.reopen('a2'));
      const [a, b] = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      is(label, httpStatus(a.status === 'fulfilled' ? b : a), 409);
      is(label, h.req().status, 'RECEIVED');
      is(label, h.req().closeReason, null);
      is(label, h.events('REQUEST_REOPENED').length, 1);
      is(label, h.notifier.parcelReceived.mock.calls.length, 1);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it('hai nhân viên ghép cùng một kiện không rõ chủ vào hai yêu cầu khác nhau (quét thời điểm): kiện chỉ ghép một yêu cầu, yêu cầu còn lại giữ nguyên OPEN', async () => {
    const winners = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      addRequest(h.db, {}, 'r2');
      h.db.seed('wasteUnmatchedParcel', [parcel()]);
      const first = async () => (await delay(Math.max(skew, 0)), h.match('r1', 's1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.match('r2', 's2'));
      const [a, b] = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      is(label, httpStatus(a.status === 'fulfilled' ? b : a), 409);
      const winner = a.status === 'fulfilled' ? 'r1' : 'r2';
      const loser = winner === 'r1' ? 'r2' : 'r1';
      is(label, h.db.row('wasteUnmatchedParcel', 'p1')!.matchedRequestId, winner);
      is(label, h.db.row('wasteUnmatchedParcel', 'p1')!.status, 'RESOLVED');
      is(label, h.db.row('wasteRequest', winner)!.status, 'RECEIVED');
      is(label, h.db.row('wasteRequest', loser)!.status, 'OPEN');
      is(label, h.db.row('wasteRequest', loser)!.receivedAt ?? null, null);
      is(label, h.events('UNMATCHED_RESOLVED').length, 1);
      is(label, h.notifier.parcelReceived.mock.calls.length, 1);
      winners.add(winner);
      waits += h.db.stats.lockWaits;
    }
    expect(winners).toEqual(new Set(['r1', 'r2']));
    expect(waits).toBeGreaterThan(0);
  });

  it('hai nhân viên ghép hai kiện khác nhau vào cùng một yêu cầu (quét thời điểm): yêu cầu RECEIVED một lần, kiện thua giữ OPEN, một sự kiện và một tin', async () => {
    const winners = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup();
      h.db.seed('wasteUnmatchedParcel', [parcel('p1'), parcel('p2')]);
      const first = async () => (await delay(Math.max(skew, 0)), h.match('r1', 's1', 'p1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.match('r1', 's2', 'p2'));
      const [a, b] = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      is(label, httpStatus(a.status === 'fulfilled' ? b : a), 409);
      const winner = a.status === 'fulfilled' ? 'p1' : 'p2';
      const loser = winner === 'p1' ? 'p2' : 'p1';
      is(label, h.req().status, 'RECEIVED');
      is(label, h.db.row('wasteUnmatchedParcel', winner)!.matchedRequestId, 'r1');
      is(label, h.db.row('wasteUnmatchedParcel', loser)!.status, 'OPEN');
      is(label, h.events('UNMATCHED_RESOLVED').length, 1);
      is(label, h.notifier.parcelReceived.mock.calls.length, 1);
      winners.add(winner);
    }
    expect(winners).toEqual(new Set(['p1', 'p2']));
  });

  it('đóng kiện không rõ chủ chen với ghép vào yêu cầu (quét thời điểm): yêu cầu chỉ RECEIVED khi kiện được ghép vào nó, kiện đóng thì yêu cầu giữ nguyên OPEN', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      h.db.seed('wasteUnmatchedParcel', [parcel()]);
      const matching = async () => (await delay(Math.max(skew, 0)), h.match('r1', 's1'));
      const closing = async () => (await delay(Math.max(-skew, 0)), h.closeParcel('s2'));
      const [m, c] = await Promise.allSettled([matching(), closing()]);
      const label = `skew ${skew}`;
      is(label, [m.status, c.status].filter((s) => s === 'fulfilled').length, 1);
      const p = h.db.row('wasteUnmatchedParcel', 'p1')!;
      is(label, p.status, 'RESOLVED');
      if (m.status === 'fulfilled') {
        is(label, p.matchedRequestId, 'r1');
        is(label, h.req().status, 'RECEIVED');
        is(label, httpStatus(c), 409);
        is(label, h.events('UNMATCHED_CLOSED').length, 0);
      } else {
        is(label, p.matchedRequestId ?? null, null);
        is(label, h.req().status, 'OPEN');
        is(label, httpStatus(m), 409);
        is(label, h.events('UNMATCHED_RESOLVED').length, 0);
        is(label, h.notifier.parcelReceived.mock.calls.length, 0);
      }
      seen.add(p.matchedRequestId ? 'matched' : 'closed');
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['matched', 'closed']));
    expect(waits).toBeGreaterThan(0);
  });

  it('cron hết hạn không đóng yêu cầu chưa tới hạn dù ứng viên được chọn từ lượt quét cũ', async () => {
    const h = setup({ request: { expiresAt: new Date('2026-11-12T00:00:00Z') } });
    expect(await h.expire()).toBeNull();
    expect(h.req()).toMatchObject({ status: 'OPEN', closeReason: null });
    expect(h.events('REQUEST_EXPIRED')).toHaveLength(0);
  });

  it.each(['CANCELLED', 'EXPIRED', 'RECEIVED'])('yêu cầu đã %s không bị khách huỷ hay nhập mã vận đơn ghi đè: 409, không đổi trạng thái', async (status) => {
    const h = setup({ request: { status, closeReason: status === 'EXPIRED' ? 'HOLD_EXPIRED' : null } });
    const settled = await Promise.allSettled([status === 'CANCELLED' ? h.track() : h.cancel(), h.track()]);
    expect(settled.every((s) => s.status === 'rejected' && httpStatus(s) === 409)).toBe(true);
    expect(h.req().status).toBe(status);
    expect(h.req().trackingCode).toBeNull();
  });

  describe('chỉ CAS (bỏ khoá SELECT ... FOR UPDATE của dòng yêu cầu)', () => {
    const casOnly = { selectForUpdate: false } satisfies WasteRaceOptions;
    const noLocks = { selectForUpdate: false, advisoryLocks: false } satisfies WasteRaceOptions;

    it('huỷ chen với nhập mã vận đơn: một bên thắng, CANCELLED không có mã vận đơn, IN_TRANSIT không bị huỷ đè', async () => {
      const seen = new Set<string>();
      for (const skew of SWEEP) {
        const h = setup(casOnly);
        const cancelling = async () => (await delay(Math.max(skew, 0)), h.cancel());
        const tracking = async () => (await delay(Math.max(-skew, 0)), h.track());
        const [c, t] = await Promise.allSettled([cancelling(), tracking()]);
        const label = `skew ${skew}`;
        is(label, [c.status, t.status].filter((s) => s === 'fulfilled').length, 1);
        is(label, h.req().status, c.status === 'fulfilled' ? 'CANCELLED' : 'IN_TRANSIT');
        is(label, h.req().trackingCode, c.status === 'fulfilled' ? null : 'VN123456');
        seen.add(h.req().status as string);
      }
      expect(seen).toEqual(new Set(['CANCELLED', 'IN_TRANSIT']));
    });

    it('huỷ chen với nhân viên kho nhận kiện: CANCELLED không bị ghi đè thành RECEIVED và ngược lại', async () => {
      const seen = new Set<string>();
      for (const skew of SWEEP) {
        const h = setup(casOnly);
        const cancelling = async () => (await delay(Math.max(skew, 0)), h.cancel());
        const receiving = async () => (await delay(Math.max(-skew, 0)), h.receive('s1'));
        const [c] = await Promise.allSettled([cancelling(), receiving()]);
        const label = `skew ${skew}`;
        is(label, h.req().status, c.status === 'fulfilled' ? 'CANCELLED' : 'RECEIVED');
        is(label, h.events('PARCEL_RECEIVED').length, c.status === 'fulfilled' ? 0 : 1);
        seen.add(h.req().status as string);
      }
      expect(seen).toEqual(new Set(['CANCELLED', 'RECEIVED']));
    });

    it('hai nhân viên nhận cùng một kiện: chỉ một sự kiện nhận và một tin cho khách', async () => {
      for (const skew of SWEEP) {
        const h = setup(casOnly);
        const first = async () => (await delay(Math.max(skew, 0)), h.receive('s1'));
        const second = async () => (await delay(Math.max(-skew, 0)), h.receive('s2'));
        const settled = await Promise.allSettled([first(), second()]);
        const label = `skew ${skew}`;
        const received = settled.filter((s) => s.status === 'fulfilled' && (s.value as { outcome: string }).outcome === 'RECEIVED');
        is(label, received.length, 1);
        is(label, h.events('PARCEL_RECEIVED').length, 1);
        is(label, h.notifier.parcelReceived.mock.calls.length, 1);
      }
    });

    it('hai admin mở lại cùng một yêu cầu hết hạn: một lần RECEIVED, một sự kiện, không bị mở lại hai lần', async () => {
      for (const skew of SWEEP) {
        const h = setup({ ...noLocks, request: { status: 'EXPIRED', closeReason: 'HOLD_EXPIRED', closedAt: new Date('2026-11-09T03:30:00Z') } });
        const first = async () => (await delay(Math.max(skew, 0)), h.reopen('a1'));
        const second = async () => (await delay(Math.max(-skew, 0)), h.reopen('a2'));
        const [a, b] = await Promise.allSettled([first(), second()]);
        const label = `skew ${skew}`;
        is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
        is(label, h.req().status, 'RECEIVED');
        is(label, h.events('REQUEST_REOPENED').length, 1);
        is(label, h.notifier.parcelReceived.mock.calls.length, 1);
      }
    });

    it('hai nhân viên ghép hai kiện khác nhau vào cùng một yêu cầu: yêu cầu RECEIVED một lần, kiện thua giữ OPEN', async () => {
      for (const skew of SWEEP) {
        const h = setup(noLocks);
        h.db.seed('wasteUnmatchedParcel', [parcel('p1'), parcel('p2')]);
        const first = async () => (await delay(Math.max(skew, 0)), h.match('r1', 's1', 'p1'));
        const second = async () => (await delay(Math.max(-skew, 0)), h.match('r1', 's2', 'p2'));
        const [a, b] = await Promise.allSettled([first(), second()]);
        const label = `skew ${skew}`;
        is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
        is(label, h.req().status, 'RECEIVED');
        is(label, h.db.rows('wasteUnmatchedParcel').filter((p) => p.status === 'RESOLVED').length, 1);
        is(label, h.events('UNMATCHED_RESOLVED').length, 1);
        is(label, h.notifier.parcelReceived.mock.calls.length, 1);
      }
    });

    it('cron hết hạn chen với nhập mã vận đơn: EXPIRED không bị ghi đè thành IN_TRANSIT và ngược lại', async () => {
      const seen = new Set<string>();
      for (const skew of SWEEP) {
        const h = setup({ ...casOnly, request: { expiresAt: EXPIRED_AT } });
        const expiring = async () => (await delay(Math.max(skew, 0)), h.expire());
        const tracking = async () => (await delay(Math.max(-skew, 0)), h.track());
        const [, t] = await Promise.allSettled([expiring(), tracking()]);
        const label = `skew ${skew}`;
        is(label, h.req().status, t.status === 'fulfilled' ? 'IN_TRANSIT' : 'EXPIRED');
        is(label, h.req().trackingCode, t.status === 'fulfilled' ? 'VN123456' : null);
        seen.add(h.req().status as string);
      }
      expect(seen).toEqual(new Set(['IN_TRANSIT', 'EXPIRED']));
    });
  });
});
