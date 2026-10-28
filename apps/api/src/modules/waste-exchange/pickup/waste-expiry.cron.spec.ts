import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { expiryCloseReason, WasteExpiryCron } from './waste-expiry.cron';

jest.mock('../core/waste-events', () => ({ writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev1' }) }));

const NOW = new Date('2026-11-04T20:30:00.000Z');
type Row = { id: string; code: string; userId: string; method: 'DROP_OFF' | 'MAIL_IN' | 'PICKUP'; status: 'OPEN' | 'IN_TRANSIT'; orderId: string | null };
const openRow = (id: string, method: Row['method'] = 'MAIL_IN', userId = 'u1'): Row => ({ id, code: `TR-${id.toUpperCase().padEnd(5, '2')}`, userId, method, status: 'OPEN', orderId: null });
const transitRow = (id: string, userId = 'u1'): Row => ({ id, code: `TR-${id.toUpperCase().padEnd(5, '3')}`, userId, method: 'PICKUP', status: 'IN_TRANSIT', orderId: `o-${id}` });

type RemindUser = { isBlocked: boolean; mergedIntoId: string | null; wasteFlags: { blockedAt: Date | null } | null };
type RemindRow = {
  id: string; code: string; userId: string; method: 'DROP_OFF' | 'MAIL_IN' | 'PICKUP'; status: string; orderId: string | null; trackingCode: string | null; expiresAt: Date | null;
  user: RemindUser;
};
const HOUR = 3_600_000;
const remindRow = (id: string, hoursLeft: number | null, o: Partial<RemindRow> = {}): RemindRow => ({
  id, code: `TR-${id.toUpperCase().padEnd(5, '4')}`, userId: 'u1', method: 'DROP_OFF', status: 'OPEN', orderId: null, trackingCode: null,
  expiresAt: hoursLeft === null ? null : new Date(NOW.getTime() + hoursLeft * HOUR), user: { isBlocked: false, mergedIntoId: null, wasteFlags: null }, ...o,
});
const USER_OK = { isBlocked: false, mergedIntoId: null, OR: [{ wasteFlags: null }, { wasteFlags: { blockedAt: null } }] };
type UserWhere = { isBlocked?: boolean; mergedIntoId?: null; OR?: ({ wasteFlags: null } | { wasteFlags: { blockedAt: null } })[] };
type Where = { status?: string; orderId?: null; trackingCode?: null; method?: { in: string[] }; user?: UserWhere; expiresAt?: { gte?: Date; lt?: Date }; id?: { gt: string }; AND?: Where[] };
/** Chạy lại điều kiện where của bước nhắc trên dữ liệu trong bộ nhớ, để ca kiểm chứng đúng điều kiện chứ không chỉ cú gọi. */
function matches(r: RemindRow, w: Where): boolean {
  if (w.AND) return w.AND.every((x) => matches(r, x));
  if (w.status !== undefined && r.status !== w.status) return false;
  if (w.orderId === null && r.orderId !== null) return false;
  if (w.trackingCode === null && r.trackingCode !== null) return false;
  if (w.method && !w.method.in.includes(r.method)) return false;
  if (w.user) {
    const u = r.user;
    if (w.user.isBlocked !== undefined && u.isBlocked !== w.user.isBlocked) return false;
    if (w.user.mergedIntoId === null && u.mergedIntoId !== null) return false;
    if (w.user.OR && !w.user.OR.some((c) => (c.wasteFlags === null ? u.wasteFlags === null : u.wasteFlags !== null && u.wasteFlags.blockedAt === null))) return false;
  }
  if (w.expiresAt) {
    if (!r.expiresAt) return false;
    if (w.expiresAt.gte && r.expiresAt < w.expiresAt.gte) return false;
    if (w.expiresAt.lt && r.expiresAt >= w.expiresAt.lt) return false;
  }
  if (w.id && !(r.id > w.id.gt)) return false;
  return true;
}

function setup(
  rows: Row[],
  o: { locked?: boolean; counts?: Record<string, number>; gomdon?: Record<string, string | null>; failIds?: string[]; remind?: RemindRow[]; notifier?: unknown; enabled?: boolean } = {},
) {
  const findMany = jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
  // Bước nhắc dùng cùng wasteRequest.findMany nhưng lọc theo cửa sổ expiresAt [gte, lt); bước đóng hạn giữ mock riêng ở trên.
  const remindFindMany = jest.fn(async ({ where, take }: { where: Where; take: number }) =>
    (o.remind ?? []).filter((r) => matches(r, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take),
  );
  const isRemind = (w: Where): boolean => (w.AND ? w.AND.some(isRemind) : !!w.expiresAt && 'gte' in w.expiresAt);
  const dispatch = jest.fn((args: { where: Where }) => (isRemind(args.where) ? remindFindMany(args as never) : findMany(args)));
  const updateMany = jest.fn(async ({ where }: { where: { id: string }; data: { closeReason?: string } }) => {
    if (o.failIds?.includes(where.id)) throw new Error('db');
    return { count: o.counts?.[where.id] ?? 1 };
  });
  const orderFind = jest.fn(async ({ where }: { where: { id: string } }) => ({ gomdonStatus: o.gomdon?.[where.id] ?? null }));
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: o.locked ?? true }]), wasteRequest: { updateMany }, order: { findUnique: orderFind } };
  // The outer try-lock transaction ends after the per-row ones, so the first 'tx end' belongs to the first row transaction.
  const order: string[] = [];
  const prisma = {
    wasteRequest: { findMany: dispatch },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
      const r = await cb(tx);
      order.push('tx end');
      return r;
    }),
  };
  const config = { snapshot: jest.fn().mockResolvedValue({ enabled: o.enabled ?? true, shortfallLockPct: 50, shortfallLockStreak: 3 }) };
  const notifier = o.notifier ?? { requestExpired: jest.fn(async () => { order.push('requestExpired'); }), requestExpiring: jest.fn(async () => undefined) };
  const shipLock = {
    evaluateAndLock: jest.fn(async () => {
      order.push('evaluateAndLock');
      return { locked: false, shipLockedAt: null, cancelledRequestIds: [] };
    }),
  };
  const cron = new WasteExpiryCron(prisma as never, config as never, notifier as never, shipLock as never);
  return { cron, tx, findMany, remindFindMany, updateMany, orderFind, notifier: notifier as { requestExpired: jest.Mock; requestExpiring: jest.Mock }, shipLock, config, order };
}

beforeEach(() => (writeWasteEvent as jest.Mock).mockClear());

describe('expiryCloseReason (§12.2 bước 4)', () => {
  it('OPEN → HOLD_EXPIRED', () => expect(expiryCloseReason({ status: 'OPEN', gomdonStatus: '7' })).toBe('HOLD_EXPIRED'));
  it.each(['3', '4', '5', '7'])('IN_TRANSIT, gomdonStatus %s → PICKUP_NO_SHOW', (s) => expect(expiryCloseReason({ status: 'IN_TRANSIT', gomdonStatus: s })).toBe('PICKUP_NO_SHOW'));
  it.each(['NOT_CONFIGURED', 'FAILED', 'NEEDS_MANUAL_CHECK', 'MANUAL_HANDLED', '1', '2', '10', '6', '8', '9', '11', '12', null])(
    'IN_TRANSIT, gomdonStatus %s → PICKUP_NOT_DISPATCHED',
    (s) => expect(expiryCloseReason({ status: 'IN_TRANSIT', gomdonStatus: s })).toBe('PICKUP_NOT_DISPATCHED'),
  );
});

describe('WasteExpiryCron.run (§12.3)', () => {
  it('chọn ứng viên đúng điều kiện 12.3, theo id tăng dần, trang 200', async () => {
    const { cron, findMany } = setup([]);
    await cron.run(NOW);
    expect(findMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW }, OR: [{ status: 'OPEN', orderId: null }, { status: 'IN_TRANSIT', method: 'PICKUP' }] },
      select: { id: true, code: true, userId: true, method: true, status: true, orderId: true },
      orderBy: { id: 'asc' },
      take: 200,
    });
  });

  it('OPEN chưa gắn đơn → một câu cập nhật đủ điều kiện, HOLD_EXPIRED, event SYSTEM, WASTE_REQUEST_EXPIRED sau commit, không xét khoá', async () => {
    const { cron, updateMany, notifier, shipLock, order } = setup([openRow('r1')]);
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'OPEN', orderId: null, expiresAt: { lt: NOW } },
      data: { status: 'EXPIRED', closedAt: NOW, closeReason: 'HOLD_EXPIRED' },
    });
    expect(writeWasteEvent).toHaveBeenCalledWith(expect.anything(), {
      kind: 'REQUEST_EXPIRED', actorUserId: null, actorRole: 'SYSTEM', requestId: 'r1',
      meta: { closeReason: 'HOLD_EXPIRED', method: 'MAIL_IN', before: { status: 'OPEN' }, after: { status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' } },
    });
    expect(notifier.requestExpired).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-R1222', method: 'MAIL_IN' }, 'HOLD_EXPIRED', NOW);
    expect(order.indexOf('tx end')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('requestExpired'));
    expect(shipLock.evaluateAndLock).not.toHaveBeenCalled();
  });

  it('IN_TRANSIT PICKUP giao rồi bưu tá đã cầm đơn (7) → PICKUP_NO_SHOW, đọc gomdonStatus trong tx lúc đóng, rồi evaluateAndLock', async () => {
    const { cron, updateMany, orderFind, shipLock, order } = setup([transitRow('r2')], { gomdon: { 'o-r2': '7' } });
    await cron.run(NOW);
    expect(orderFind).toHaveBeenCalledWith({ where: { id: 'o-r2' }, select: { gomdonStatus: true } });
    expect(orderFind.mock.invocationCallOrder[0]!).toBeLessThan(updateMany.mock.invocationCallOrder[0]!);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r2', status: 'IN_TRANSIT', method: 'PICKUP', orderId: 'o-r2', expiresAt: { lt: NOW } },
      data: { status: 'EXPIRED', closedAt: NOW, closeReason: 'PICKUP_NO_SHOW' },
    });
    expect(writeWasteEvent).toHaveBeenCalledWith(expect.anything(), {
      kind: 'REQUEST_EXPIRED', actorUserId: null, actorRole: 'SYSTEM', requestId: 'r2',
      meta: { closeReason: 'PICKUP_NO_SHOW', method: 'PICKUP', before: { status: 'IN_TRANSIT' }, after: { status: 'EXPIRED', closeReason: 'PICKUP_NO_SHOW' } },
    });
    expect(shipLock.evaluateAndLock).toHaveBeenCalledWith('u1', { shortfallLockPct: 50, shortfallLockStreak: 3 });
    expect(order.indexOf('tx end')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('requestExpired'));
    expect(order.indexOf('requestExpired')).toBeLessThan(order.indexOf('evaluateAndLock'));
  });

  it("vận đơn đã huỷ ('2') dù còn gomdonOrderId → PICKUP_NOT_DISPATCHED, không xét khoá (§17.3)", async () => {
    const { cron, updateMany, shipLock } = setup([transitRow('r3')], { gomdon: { 'o-r3': '2' } });
    await cron.run(NOW);
    expect(updateMany.mock.calls[0]![0].data.closeReason).toBe('PICKUP_NOT_DISPATCHED');
    expect(shipLock.evaluateAndLock).not.toHaveBeenCalled();
  });

  it('dòng không trúng (vừa gắn đơn / nhận / đóng) → không event, không báo, không xét khoá, không đếm', async () => {
    const { cron, notifier, shipLock } = setup([openRow('r4'), transitRow('r5')], { counts: { r4: 0, r5: 0 }, gomdon: { 'o-r5': '3' } });
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 0 });
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(notifier.requestExpired).not.toHaveBeenCalled();
    expect(shipLock.evaluateAndLock).not.toHaveBeenCalled();
  });

  it('hai dòng NO_SHOW cùng khách → evaluateAndLock đúng một lần cho khách đó', async () => {
    const { cron, shipLock } = setup([transitRow('r6'), transitRow('r7')], { gomdon: { 'o-r6': '4', 'o-r7': '5' } });
    await cron.run(NOW);
    expect(shipLock.evaluateAndLock).toHaveBeenCalledTimes(1);
  });

  it('một dòng lỗi không chặn dòng sau', async () => {
    const { cron, notifier } = setup([openRow('r8'), openRow('r9')], { failIds: ['r8'] });
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 1 });
    expect(notifier.requestExpired).toHaveBeenCalledTimes(1);
  });

  it('không lấy được try-lock (replica khác đang chạy) → { expired: 0 }, không quét', async () => {
    const { cron, findMany, tx } = setup([openRow('r1')], { locked: false });
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect((tx.$queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain(`pg_try_advisory_xact_lock(hashtext('cron:waste.expiry'))`);
  });

  it('đang chạy trong tiến trình → lần gọi chồng trả { expired: 0 }', async () => {
    const { cron, findMany } = setup([openRow('r1')]);
    const [a, b] = await Promise.all([cron.run(NOW), cron.run(NOW)]);
    expect([a, b]).toContainEqual({ expired: 0 });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('waste.enabled tắt vẫn quét hết hạn (§15.1 Cờ tổng: cron không phụ thuộc cờ)', async () => {
    const { cron, config, updateMany } = setup([openRow('r1')]);
    config.snapshot.mockResolvedValue({ enabled: false, shortfallLockPct: 50, shortfallLockStreak: 3 });
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('snapshot() lỗi → cờ running được trả, lần chạy sau vẫn quét', async () => {
    const { cron, findMany, config } = setup([]);
    config.snapshot.mockRejectedValueOnce(new Error('db'));
    await cron.run(NOW).catch(() => undefined);
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 0 });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('trang đủ 200 dòng → đọc tiếp trang sau với id > id cuối; trang thiếu thì dừng', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => openRow(`r${String(i).padStart(3, '0')}`));
    const { cron, findMany } = setup([]);
    findMany.mockReset().mockResolvedValueOnce(page1).mockResolvedValueOnce([openRow('r999')]).mockResolvedValue([]);
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 201 });
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]![0].where).toEqual({
      AND: [
        { expiresAt: { lt: NOW }, OR: [{ status: 'OPEN', orderId: null }, { status: 'IN_TRANSIT', method: 'PICKUP' }] },
        { id: { gt: 'r199' } },
      ],
    });
  });

  it('lỗi ở bước nhắc không làm mất kết quả đóng hạn', async () => {
    const { cron, remindFindMany } = setup([openRow('r1')]);
    remindFindMany.mockRejectedValueOnce(new Error('db'));
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 1 });
  });

  it('lịch: 03:30 giờ VN, tên waste.expiry, timeZone CRON_TZ; không có updateMany chung cho hai nhánh', () => {
    const src = readFileSync(join(__dirname, 'waste-expiry.cron.ts'), 'utf-8');
    expect(src).toContain(`@Cron('0 30 3 * * *', { name: 'waste.expiry', timeZone: CRON_TZ })`);
    expect(src).not.toMatch(/updateMany\(\{\s*where:\s*\{\s*expiresAt/);
  });
});

describe('WasteExpiryCron: nhắc trước hạn', () => {
  const day = (n: number) => new Date(NOW.getTime() + n * 24 * HOUR);

  it('chọn yêu cầu OPEN chưa gắn đơn, chưa có mã vận đơn, DROP_OFF hoặc MAIL_IN, hạn trong 24 đến 48 giờ tới, theo id tăng dần', async () => {
    const { cron, remindFindMany } = setup([]);
    await cron.run(NOW);
    expect(remindFindMany).toHaveBeenCalledWith({
      where: { status: 'OPEN', orderId: null, trackingCode: null, method: { in: ['DROP_OFF', 'MAIL_IN'] }, user: USER_OK, expiresAt: { gte: day(1), lt: day(2) } },
      select: { id: true, code: true, userId: true, method: true, expiresAt: true },
      orderBy: { id: 'asc' },
      take: 200,
    });
  });

  it('yêu cầu hết hạn sau 30 giờ nhận đúng một tin; chạy lần hai (cùng khoá dedupe) không gửi lại', async () => {
    const seen = new Set<string>();
    const sent: { code: string; data: Record<string, string> }[] = [];
    const notifications = {
      notify: jest.fn(async (userId: string, code: string, data: Record<string, string>, opts: { dedupeKey: string }) => {
        const key = `${userId}:${opts.dedupeKey}`;
        if (seen.has(key)) return;
        seen.add(key);
        sent.push({ code, data });
      }),
    };
    const notifier = new WasteNotifierService(notifications as never);
    const remind = [remindRow('a', 30)];
    const { cron } = setup([], { remind, notifier });
    await cron.run(NOW);
    await cron.run(new Date(NOW.getTime() + 2 * HOUR));
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenNthCalledWith(1, 'u1', 'WASTE_REQUEST_EXPIRING', expect.objectContaining({ code: 'TR-A4444', request_id: 'a' }), { dedupeKey: 'waste:a:EXPIRING' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.code).toBe('WASTE_REQUEST_EXPIRING');
  });

  it('bỏ qua yêu cầu ngoài cửa sổ, đã có mã vận đơn, đã gắn đơn, hoặc là PICKUP; nhắc MAIL_IN chưa có vận đơn', async () => {
    const remind = [
      remindRow('a', 30),
      remindRow('b', 40, { method: 'MAIL_IN' }),
      remindRow('c', 10),
      remindRow('d', 60),
      remindRow('e', 30, { method: 'MAIL_IN', trackingCode: 'SPX123' }),
      remindRow('f', 30, { orderId: 'o1' }),
      remindRow('g', 30, { method: 'PICKUP' }),
      remindRow('h', 30, { status: 'IN_TRANSIT' }),
      remindRow('i', null),
    ];
    const { cron, notifier } = setup([], { remind });
    await cron.run(NOW);
    expect(notifier.requestExpiring.mock.calls.map((c) => [c[1].id, c[2]])).toEqual([['a', 'DROP_OFF'], ['b', 'MAIL_IN']]);
    expect(notifier.requestExpiring).toHaveBeenCalledWith('u1', { id: 'a', code: 'TR-A4444' }, 'DROP_OFF', remind[0]!.expiresAt);
  });

  it('một tin nhắc lỗi không chặn tin sau; trang đủ 200 dòng thì đọc tiếp với id > id cuối', async () => {
    const remind = Array.from({ length: 201 }, (_, i) => remindRow(`r${String(i).padStart(3, '0')}`, 30));
    const { cron, notifier, remindFindMany } = setup([], { remind });
    notifier.requestExpiring.mockRejectedValueOnce(new Error('down'));
    await cron.run(NOW);
    expect(notifier.requestExpiring).toHaveBeenCalledTimes(201);
    expect(remindFindMany).toHaveBeenCalledTimes(2);
    expect(remindFindMany.mock.calls[1]![0].where).toEqual({
      AND: [{ status: 'OPEN', orderId: null, trackingCode: null, method: { in: ['DROP_OFF', 'MAIL_IN'] }, user: USER_OK, expiresAt: { gte: day(1), lt: day(2) } }, { id: { gt: 'r199' } }],
    });
  });

  it('chương trình đang tắt thì không nhắc, nhưng vẫn đóng yêu cầu quá hạn', async () => {
    const { cron, notifier, remindFindMany, updateMany } = setup([openRow('r1')], { enabled: false, remind: [remindRow('a', 30), remindRow('b', 40, { method: 'MAIL_IN' })] });
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(remindFindMany).not.toHaveBeenCalled();
    expect(notifier.requestExpiring).not.toHaveBeenCalled();
  });

  it('khách bị khoá (tài khoản, cờ đổi rác) hoặc đã gộp sang tài khoản khác thì không nhắc; khách có dòng cờ nhưng chưa khoá vẫn được nhắc', async () => {
    const remind = [
      remindRow('a', 30),
      remindRow('b', 30, { user: { isBlocked: true, mergedIntoId: null, wasteFlags: null } }),
      remindRow('c', 30, { user: { isBlocked: false, mergedIntoId: null, wasteFlags: { blockedAt: new Date('2026-11-01T00:00:00Z') } } }),
      remindRow('d', 30, { user: { isBlocked: false, mergedIntoId: 'u9', wasteFlags: null } }),
      remindRow('e', 30, { user: { isBlocked: false, mergedIntoId: null, wasteFlags: { blockedAt: null } } }),
    ];
    const { cron, notifier } = setup([], { remind });
    await cron.run(NOW);
    expect(notifier.requestExpiring.mock.calls.map((c) => c[1].id)).toEqual(['a', 'e']);
  });

  it('không lấy được try-lock thì không nhắc', async () => {
    const { cron, remindFindMany } = setup([], { locked: false, remind: [remindRow('a', 30)] });
    await cron.run(NOW);
    expect(remindFindMany).not.toHaveBeenCalled();
  });
});
