import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeWasteEvent } from '../core/waste-events';
import { expiryCloseReason, WasteExpiryCron } from './waste-expiry.cron';

jest.mock('../core/waste-events', () => ({ writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev1' }) }));

const NOW = new Date('2026-11-04T20:30:00.000Z');
type Row = { id: string; code: string; userId: string; method: 'DROP_OFF' | 'MAIL_IN' | 'PICKUP'; status: 'OPEN' | 'IN_TRANSIT'; orderId: string | null };
const openRow = (id: string, method: Row['method'] = 'MAIL_IN', userId = 'u1'): Row => ({ id, code: `TR-${id.toUpperCase().padEnd(5, '2')}`, userId, method, status: 'OPEN', orderId: null });
const transitRow = (id: string, userId = 'u1'): Row => ({ id, code: `TR-${id.toUpperCase().padEnd(5, '3')}`, userId, method: 'PICKUP', status: 'IN_TRANSIT', orderId: `o-${id}` });

function setup(rows: Row[], o: { locked?: boolean; counts?: Record<string, number>; gomdon?: Record<string, string | null>; failIds?: string[] } = {}) {
  const findMany = jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
  const updateMany = jest.fn(async ({ where }: { where: { id: string }; data: { closeReason?: string } }) => {
    if (o.failIds?.includes(where.id)) throw new Error('db');
    return { count: o.counts?.[where.id] ?? 1 };
  });
  const orderFind = jest.fn(async ({ where }: { where: { id: string } }) => ({ gomdonStatus: o.gomdon?.[where.id] ?? null }));
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: o.locked ?? true }]), wasteRequest: { updateMany }, order: { findUnique: orderFind } };
  // The outer try-lock transaction ends after the per-row ones, so the first 'tx end' belongs to the first row transaction.
  const order: string[] = [];
  const prisma = {
    wasteRequest: { findMany },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
      const r = await cb(tx);
      order.push('tx end');
      return r;
    }),
  };
  const config = { snapshot: jest.fn().mockResolvedValue({ shortfallLockPct: 50, shortfallLockStreak: 3 }) };
  const notifier = { requestExpired: jest.fn(async () => { order.push('requestExpired'); }) };
  const shipLock = {
    evaluateAndLock: jest.fn(async () => {
      order.push('evaluateAndLock');
      return { locked: false, shipLockedAt: null, cancelledRequestIds: [] };
    }),
  };
  const cron = new WasteExpiryCron(prisma as never, config as never, notifier as never, shipLock as never);
  return { cron, tx, findMany, updateMany, orderFind, notifier, shipLock, config, order };
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
    expect(notifier.requestExpired).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-R1222' }, 'HOLD_EXPIRED', NOW);
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

  it('lịch: 03:30 giờ VN, tên waste.expiry, timeZone CRON_TZ; không có updateMany chung cho hai nhánh', () => {
    const src = readFileSync(join(__dirname, 'waste-expiry.cron.ts'), 'utf-8');
    expect(src).toContain(`@Cron('0 30 3 * * *', { name: 'waste.expiry', timeZone: CRON_TZ })`);
    expect(src).not.toMatch(/updateMany\(\{\s*where:\s*\{\s*expiresAt/);
  });
});
