import { HttpException, Logger } from '@nestjs/common';
import { tick } from '../../../../test/fakes/race-db.fake';
import { cartonLine, createWasteRaceDb, request, user, warehouse, type WasteRaceOptions } from '../../../../test/fakes/waste-race.harness';
import { RewardPointsService } from '../../wallet/reward-points.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteRequestsService } from '../customer/waste-requests.service';
import { WasteConfirmService } from '../receiving/waste-confirm.service';
import { WasteExpiryCron } from './waste-expiry.cron';
import { attachPickupRequest, lockPickupRequestForCheckout } from './waste-pickup-attach';
import { WastePickupHooks } from './waste-pickup-hooks.service';

jest.mock('../receiving/waste-admin-detail.mapper', () => ({ loadAdminRequestDetail: jest.fn(async (_p: unknown, _a: unknown, id: string) => ({ id })) }));

/**
 * Thu kèm rác (PICKUP) bị nhiều bên giành cùng lúc: khách đặt đơn kèm yêu cầu (gắn orderId) với khách huỷ hay cron hết hạn; hook "đơn đã giao"
 * và "đơn bị huỷ" chạy chồng nhau (hook sau đổi trạng thái đơn và cron quét bù) hoặc chen với xác nhận của kho (Postgres READ COMMITTED,
 * test/fakes/race-db.fake.ts). Đơn đã gắn thì yêu cầu không bao giờ CANCELLED/EXPIRED; trạng thái cuối không bị hook ghi đè; Điểm Xanh cộng một lần.
 * Dùng WastePickupHooks, lockPickupRequestForCheckout/attachPickupRequest, WasteRequestsService.cancel, WasteExpiryCron, WasteConfirmService THẬT.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);
const SWEEP = Array.from({ length: 121 }, (_, i) => i - 60);
const EXPIRED_AT = new Date('2026-11-09T00:00:00Z');
const DELIVERED_AT = new Date('2026-11-09T10:00:00Z');
const POINTS = 10_000;

function setup(opts: WasteRaceOptions & { request?: Record<string, unknown>; orderStatus?: string | null } = {}) {
  const { db, prisma } = createWasteRaceDb(opts);
  db.seed('user', [user('u1', '0900000001'), user('s1', '0900000002', { role: 'STAFF' }), user('a1', '0900000004', { role: 'ADMIN' })]);
  db.seed('wastePoint', [warehouse]);
  if (opts.orderStatus) db.seed('order', [{ id: 'o1', code: 'TUBU1', userId: 'u1', status: opts.orderStatus, deliveredAt: opts.orderStatus === 'DELIVERED' ? DELIVERED_AT : null }]);
  db.seed('wasteRequest', [request({ method: 'PICKUP', expiresAt: null, ...opts.request })]);
  db.seed('wasteRequestLine', [cartonLine('r1')]);

  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const wasteConfig = { snapshot: async () => ({ enabled: true, pickupWaitDays: 7, staffDailyCapPoints: 1_000_000, shortfallLockPct: 50, shortfallLockStreak: 3 }) };
  const notifier = {
    pickupStarted: jest.fn().mockResolvedValue(undefined),
    pickupCancelled: jest.fn().mockResolvedValue(undefined),
    pointsCredited: jest.fn().mockResolvedValue(undefined),
    requestExpired: jest.fn().mockResolvedValue(undefined),
  };
  const shipLock = { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) };
  const access = new WasteAccessService(prisma);
  const hooks = new WastePickupHooks(prisma, wasteConfig as never, notifier as never);
  const requestsSvc = new WasteRequestsService(prisma, access, {} as never, {} as never, config as never);
  jest.spyOn(requestsSvc, 'loadDetail').mockResolvedValue({} as never);
  // Sửa yêu cầu: WasteHoldService chỉ là bước tính điểm (đọc cấu hình, hạn mức), thay bằng bản giữ nguyên dòng khách gửi và chờ vài nhịp để cửa sổ đua đủ rộng.
  const hold = {
    validateAndHold: async (_tx: unknown, args: { lines: { itemId: string; declaredQty: number }[]; pointId: string | null }) => {
      await delay(4);
      return {
        lines: args.lines.map((l) => ({ itemId: l.itemId, itemCode: 'CARTON', itemName: 'Thùng carton', unitLabel: 'kg', unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0, gramsPerUnit: null, declaredQty: l.declaredQty })),
        pointId: args.pointId,
        estimatedPoints: 50_000,
        estimatedDrops: 0,
      };
    },
  };
  const editSvc = new WasteRequestsService(prisma, access, hold as never, wasteConfig as never, config as never);
  jest.spyOn(editSvc, 'loadDetail').mockResolvedValue({} as never);
  const confirmSvc = new WasteConfirmService(prisma, wasteConfig as never, access, new RewardPointsService(prisma, config as never), config as never, notifier as never, shipLock as never);
  const cron = new WasteExpiryCron(prisma, wasteConfig as never, notifier as never, shipLock as never, access);

  // Giao dịch đặt hàng: khoá yêu cầu, tạo đơn rồi gắn orderId (đúng thứ tự checkout.service.ts); gắn thất bại thì cả đơn rollback.
  // Trả số lượng khai báo mà ghi chú thu rác của đơn được dựng từ đó (checkout.service.ts đọc dòng yêu cầu ngay sau khi khoá).
  const checkout = (orderId = 'o1', holdTicks = 6) =>
    prisma.$transaction(async (tx: any) => {
      const locked = await lockPickupRequestForCheckout(tx, 'u1', 'r1');
      await delay(holdTicks);
      await tx.order.create({ data: { id: orderId, code: `TUBU-${orderId}`, userId: 'u1', status: 'PENDING', deliveredAt: null } });
      await attachPickupRequest(tx, 'u1', 'r1', orderId);
      return locked.lines[0]?.declaredQty ?? null;
    });
  const edit = (qty: number) => editSvc.edit('u1', 'r1', { lines: [{ itemId: 'wi-carton', declaredQty: qty }] } as never);
  const lineQty = () => db.rows('wasteRequestLine').filter((l) => l.requestId === 'r1').map((l) => l.declaredQty);
  const cancel = () => requestsSvc.cancel('u1', 'r1');
  const expire = () =>
    (cron as unknown as { closeRow(row: Record<string, unknown>, now: Date): Promise<string | null> }).closeRow(
      { id: 'r1', code: 'TR-ABCDE', userId: 'u1', method: 'PICKUP', status: 'OPEN', orderId: null },
      new Date('2026-11-10T03:30:00Z'),
    );
  const confirm = () =>
    confirmSvc.confirm({ callerUserId: 'a1', requestId: 'r1', route: 'ADMIN', device: { ip: null, userAgent: null } }, { lines: [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 }] });
  const req = () => db.row('wasteRequest', 'r1')!;
  const events = (kind: string) => db.rows('wasteEvent').filter((e) => e.kind === kind);
  const balance = () => db.row('user', 'u1')!.pointsBalance as number;
  const ledger = () => db.rows('pointsTransaction');
  return { db, hooks, checkout, edit, lineQty, cancel, expire, confirm, req, events, balance, ledger, notifier };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Thu kèm rác — gắn đơn, hook đơn hàng và xác nhận đua nhau', () => {
  it('hook "đơn bị huỷ" chạy hai lần cùng lúc (hook + cron quét bù): huỷ đúng MỘT lần, một tin, một sự kiện, bên kia SKIPPED', async () => {
    for (const skew of SWEEP.filter((s) => Math.abs(s) <= 20)) {
      const h = setup({ orderStatus: 'CANCELLED', request: { orderId: 'o1' } });
      const first = async () => (await delay(Math.max(skew, 0)), h.hooks.applyOrderCancelled('o1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.hooks.applyOrderCancelled('o1'));
      const settled = await Promise.all([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [...settled].sort(), ['APPLIED', 'SKIPPED']);
      is(label, h.req().status, 'CANCELLED');
      is(label, h.req().closeReason, 'ORDER_CANCELLED');
      is(label, h.events('PICKUP_ORDER_CANCELLED').length, 1);
      is(label, h.notifier.pickupCancelled.mock.calls.length, 1);
    }
  });

  it('hook "đơn đã giao" chạy hai lần cùng lúc: chuyển IN_TRANSIT đúng MỘT lần, một tin, một sự kiện, bên kia SKIPPED', async () => {
    for (const skew of SWEEP.filter((s) => Math.abs(s) <= 20)) {
      const h = setup({ orderStatus: 'DELIVERED', request: { orderId: 'o1' } });
      const first = async () => (await delay(Math.max(skew, 0)), h.hooks.applyOrderDelivered('o1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.hooks.applyOrderDelivered('o1'));
      const settled = await Promise.all([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [...settled].sort(), ['APPLIED', 'SKIPPED']);
      is(label, h.req().status, 'IN_TRANSIT');
      is(label, h.events('PICKUP_STARTED').length, 1);
      is(label, h.notifier.pickupStarted.mock.calls.length, 1);
    }
  });

  it('hook "đơn đã giao" chen với xác nhận của kho (quét thời điểm): COMPLETED không bị hook đưa lùi về IN_TRANSIT, Điểm Xanh cộng đúng một lần', async () => {
    const outcomes = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ orderStatus: 'DELIVERED', request: { orderId: 'o1' } });
      const delivered = async () => (await delay(Math.max(skew, 0)), h.hooks.applyOrderDelivered('o1'));
      const confirming = async () => (await delay(Math.max(-skew, 0)), h.confirm());
      const [d, c] = await Promise.allSettled([delivered(), confirming()]);
      const label = `skew ${skew}`;
      is(label, c.status, 'fulfilled');
      is(label, d.status, 'fulfilled');
      is(label, h.req().status, 'COMPLETED');
      is(label, h.req().pointsAwarded, POINTS);
      is(label, h.balance(), POINTS);
      is(label, h.ledger().length, 1);
      is(label, h.events('PICKUP_STARTED').length <= 1, true);
      outcomes.add(String((d as PromiseFulfilledResult<unknown>).value));
      waits += h.db.stats.lockWaits;
    }
    expect(outcomes).toEqual(new Set(['APPLIED', 'SKIPPED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('đặt đơn kèm yêu cầu chen với khách huỷ (quét thời điểm): yêu cầu đã gắn đơn không bao giờ CANCELLED, yêu cầu đã huỷ không bao giờ có đơn', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const ordering = async () => (await delay(Math.max(skew, 0)), h.checkout());
      const cancelling = async () => (await delay(Math.max(-skew, 0)), h.cancel());
      const [o, c] = await Promise.allSettled([ordering(), cancelling()]);
      const label = `skew ${skew}`;
      is(label, [o.status, c.status].filter((s) => s === 'fulfilled').length, 1);
      if (o.status === 'fulfilled') {
        is(label, h.req().status, 'OPEN');
        is(label, h.req().orderId, 'o1');
        is(label, h.db.rows('order').length, 1);
        is(label, httpStatus(c), 409);
        is(label, h.events('REQUEST_CANCELLED').length, 0);
      } else {
        is(label, h.req().status, 'CANCELLED');
        is(label, h.req().orderId, null);
        is(label, h.db.rows('order').length, 0);
        is(label, httpStatus(o), 409);
        is(label, h.events('REQUEST_ATTACHED').length, 0);
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['OPEN', 'CANCELLED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('đặt đơn kèm yêu cầu chen với khách sửa số lượng (quét thời điểm): ghi chú thu rác của đơn luôn khớp số lượng cuối cùng của yêu cầu; sửa sau khi đã gắn đơn bị từ chối', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const ordering = async () => (await delay(Math.max(skew, 0)), h.checkout());
      const editing = async () => (await delay(Math.max(-skew, 0)), h.edit(50));
      const [o, e] = await Promise.allSettled([ordering(), editing()]);
      const label = `skew ${skew}`;
      is(label, o.status, 'fulfilled');
      is(label, h.req().orderId, 'o1');
      is(label, h.db.rows('order').length, 1);
      is(label, h.lineQty(), [e.status === 'fulfilled' ? 50 : 10]);
      is(label, (o as PromiseFulfilledResult<number | null>).value, h.lineQty()[0]);
      if (e.status === 'rejected') {
        is(label, httpStatus(e), 409);
        is(label, h.events('REQUEST_EDITED').length, 0);
      } else {
        is(label, h.events('REQUEST_EDITED').length, 1);
      }
      seen.add(e.status);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['fulfilled', 'rejected']));
    expect(waits).toBeGreaterThan(0);
  });

  it('đặt đơn kèm yêu cầu chen với cron hết hạn giữ chỗ (quét thời điểm): yêu cầu đã gắn đơn không bao giờ EXPIRED, yêu cầu EXPIRED không bao giờ có đơn', async () => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup({ request: { expiresAt: EXPIRED_AT } });
      const ordering = async () => (await delay(Math.max(skew, 0)), h.checkout());
      const expiring = async () => (await delay(Math.max(-skew, 0)), h.expire());
      const [o, e] = await Promise.allSettled([ordering(), expiring()]);
      const label = `skew ${skew}`;
      is(label, e.status, 'fulfilled');
      if (o.status === 'fulfilled') {
        is(label, h.req().status, 'OPEN');
        is(label, h.req().orderId, 'o1');
        is(label, h.req().expiresAt, null);
        is(label, (e as PromiseFulfilledResult<unknown>).value, null);
      } else {
        is(label, h.req().status, 'EXPIRED');
        is(label, h.req().orderId, null);
        is(label, h.db.rows('order').length, 0);
        is(label, httpStatus(o), 409);
      }
      seen.add(h.req().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['OPEN', 'EXPIRED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('hai đơn đặt cùng lúc cùng gắn một yêu cầu (quét thời điểm): đúng một đơn được tạo và gắn, đơn kia rollback 409 và không để lại đơn', async () => {
    const winners = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const first = async () => (await delay(Math.max(skew, 0)), h.checkout('o1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.checkout('o2'));
      const [a, b] = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      const winner = a.status === 'fulfilled' ? 'o1' : 'o2';
      is(label, httpStatus(a.status === 'fulfilled' ? b : a), 409);
      is(label, h.req().orderId, winner);
      is(label, h.db.rows('order').map((o) => o.id), [winner]);
      is(label, h.events('REQUEST_ATTACHED').length, 1);
      winners.add(winner);
      waits += h.db.stats.lockWaits;
    }
    expect(winners).toEqual(new Set(['o1', 'o2']));
    expect(waits).toBeGreaterThan(0);
  });

  it('cron hết hạn không đóng yêu cầu đã gắn đơn dù còn lưu hạn giữ chỗ cũ', async () => {
    const h = setup({ orderStatus: 'PENDING', request: { orderId: 'o1', expiresAt: EXPIRED_AT } });
    expect(await h.expire()).toBeNull();
    expect(h.req()).toMatchObject({ status: 'OPEN', orderId: 'o1', closeReason: null });
    expect(h.events('REQUEST_EXPIRED')).toHaveLength(0);
  });

  describe('chỉ CAS (bỏ khoá SELECT ... FOR UPDATE và unique sổ điểm)', () => {
    const casOnly = { selectForUpdate: false, ledgerUnique: false } satisfies WasteRaceOptions;

    it('đặt đơn kèm yêu cầu chen với khách huỷ: không bao giờ có yêu cầu CANCELLED mang đơn', async () => {
      const seen = new Set<string>();
      for (const skew of SWEEP) {
        const h = setup(casOnly);
        const ordering = async () => (await delay(Math.max(skew, 0)), h.checkout());
        const cancelling = async () => (await delay(Math.max(-skew, 0)), h.cancel());
        const [o, c] = await Promise.allSettled([ordering(), cancelling()]);
        const label = `skew ${skew}`;
        is(label, [o.status, c.status].filter((s) => s === 'fulfilled').length, 1);
        is(label, h.req().status, o.status === 'fulfilled' ? 'OPEN' : 'CANCELLED');
        is(label, h.req().orderId, o.status === 'fulfilled' ? 'o1' : null);
        seen.add(h.req().status as string);
      }
      expect(seen).toEqual(new Set(['OPEN', 'CANCELLED']));
    });

    it('đặt đơn kèm yêu cầu chen với cron hết hạn: không bao giờ có yêu cầu EXPIRED mang đơn', async () => {
      const seen = new Set<string>();
      for (const skew of SWEEP) {
        const h = setup({ ...casOnly, request: { expiresAt: EXPIRED_AT } });
        const ordering = async () => (await delay(Math.max(skew, 0)), h.checkout());
        const expiring = async () => (await delay(Math.max(-skew, 0)), h.expire());
        const [o] = await Promise.allSettled([ordering(), expiring()]);
        const label = `skew ${skew}`;
        is(label, h.req().status, o.status === 'fulfilled' ? 'OPEN' : 'EXPIRED');
        is(label, h.req().orderId, o.status === 'fulfilled' ? 'o1' : null);
        seen.add(h.req().status as string);
      }
      expect(seen).toEqual(new Set(['OPEN', 'EXPIRED']));
    });

    it('hai đơn đặt cùng lúc cùng gắn một yêu cầu: yêu cầu chỉ mang một đơn, đơn thua rollback', async () => {
      for (const skew of SWEEP) {
        const h = setup(casOnly);
        const first = async () => (await delay(Math.max(skew, 0)), h.checkout('o1'));
        const second = async () => (await delay(Math.max(-skew, 0)), h.checkout('o2'));
        const [a, b] = await Promise.allSettled([first(), second()]);
        const label = `skew ${skew}`;
        is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
        const winner = a.status === 'fulfilled' ? 'o1' : 'o2';
        is(label, h.req().orderId, winner);
        is(label, h.db.rows('order').map((o) => o.id), [winner]);
      }
    });

    it('hook "đơn đã giao" chen với xác nhận: COMPLETED không bị đưa lùi về IN_TRANSIT, điểm cộng một lần', async () => {
      for (const skew of SWEEP) {
        const h = setup({ ...casOnly, orderStatus: 'DELIVERED', request: { orderId: 'o1' } });
        const delivered = async () => (await delay(Math.max(skew, 0)), h.hooks.applyOrderDelivered('o1'));
        const confirming = async () => (await delay(Math.max(-skew, 0)), h.confirm());
        await Promise.allSettled([delivered(), confirming()]);
        const label = `skew ${skew}`;
        is(label, h.req().status, 'COMPLETED');
        is(label, h.balance(), POINTS);
        is(label, h.ledger().length, 1);
      }
    });
  });
});
