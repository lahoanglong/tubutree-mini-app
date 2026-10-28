import { TierDropNoticeService } from './tier-drop-notice.service';
import { startOfVnDay } from '../../common/vn-time';

const DAY = 864e5;
// 10:00 giờ VN ngày 28/10/2026
const NOW = new Date('2026-10-28T03:00:00Z');
const TIER = { id: 't2', name: 'Lộc Biếc', minSpending: 1_000_000, minPoints: 0 };

type U = { id: string; tierGraceUntil: Date | null; tierDropNoticeFor: Date | null; tier: typeof TIER | null };

function build(users: U[], opts: { gap?: { spendingToKeep: number | null; pointsToKeep: number }; cfg?: Record<string, unknown>; notifyThrows?: boolean } = {}) {
  const rows = new Map(users.map((u) => [u.id, { ...u }]));
  const findMany = jest.fn(async ({ where }: any) => {
    const lt: Date = where.tierGraceUntil.lt;
    const gt: Date = where.tierGraceUntil.gt;
    return [...rows.values()].filter((u) => u.tierGraceUntil && u.tierGraceUntil > gt && u.tierGraceUntil < lt && u.tier).map((u) => ({ ...u }));
  });
  const updateMany = jest.fn(async ({ where, data }: any) => {
    const u = rows.get(where.id);
    if (!u) return { count: 0 };
    if (where.tierGraceUntil && u.tierGraceUntil?.getTime() !== where.tierGraceUntil.getTime()) return { count: 0 };
    if ('tierDropNoticeFor' in where && (u.tierDropNoticeFor?.getTime() ?? null) !== (where.tierDropNoticeFor?.getTime() ?? null)) return { count: 0 };
    u.tierDropNoticeFor = data.tierDropNoticeFor;
    return { count: 1 };
  });
  const prisma = { user: { findMany, updateMany } };
  const cfg: Record<string, unknown> = opts.cfg ?? {};
  const config = { get: jest.fn(async (k: string, def: unknown) => (k in cfg ? cfg[k] : def)) };
  const loyalty = { tierKeepGap: jest.fn(async () => opts.gap ?? { spendingToKeep: 400_000, pointsToKeep: 0 }) };
  const notify = jest.fn(async (..._args: unknown[]) => {
    if (opts.notifyThrows) throw new Error('db down');
  });
  const svc = new TierDropNoticeService(prisma as never, config as never, loyalty as never, { notify } as never);
  return { svc, rows, notify, loyalty, findMany };
}

const inDays = (d: number, extraMs = 0) => new Date(startOfVnDay(NOW).getTime() + d * DAY + extraMs);

describe('TierDropNoticeService.sendNotices', () => {
  it('báo khách còn ≤ 14 ngày, kèm hạng, ngày hết hạn và số tiền còn thiếu', async () => {
    const until = inDays(10, 12 * 3600_000); // 12:00 VN ngày 07/11
    const { svc, notify, rows } = build([{ id: 'u1', tierGraceUntil: until, tierDropNoticeFor: null, tier: TIER }]);
    expect(await svc.sendNotices(NOW)).toBe(1);
    expect(notify).toHaveBeenCalledWith('u1', 'TIER_DROP_NOTICE', { tier: 'Lộc Biếc', date: '07/11/2026', need: 'Mua thêm 400.000đ đơn giao thành công' }, {});
    expect(rows.get('u1')!.tierDropNoticeFor).toEqual(until);
  });

  it('chạy lại cùng kỳ: không gửi hai lần', async () => {
    const until = inDays(10, 12 * 3600_000);
    const { svc, notify } = build([{ id: 'u1', tierGraceUntil: until, tierDropNoticeFor: null, tier: TIER }]);
    await svc.sendNotices(NOW);
    await svc.sendNotices(NOW);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('kỳ giữ hạng mới (hạn khác) được báo lại', async () => {
    const { svc, notify } = build([{ id: 'u1', tierGraceUntil: inDays(10), tierDropNoticeFor: inDays(-300), tier: TIER }]);
    expect(await svc.sendNotices(NOW)).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('ngưỡng theo NGÀY VN: hạn rơi 23:59 ngày hôm nay + 14 vẫn báo, 00:00 ngày +15 chưa báo', async () => {
    const edgeIn = new Date(inDays(15).getTime() - 60_000); // 23:59 VN ngày +14
    const edgeOut = inDays(15); // 00:00 VN ngày +15
    const { svc, notify } = build([
      { id: 'in', tierGraceUntil: edgeIn, tierDropNoticeFor: null, tier: TIER },
      { id: 'out', tierGraceUntil: edgeOut, tierDropNoticeFor: null, tier: TIER },
    ]);
    await svc.sendNotices(NOW);
    expect(notify.mock.calls.map((c) => c[0])).toEqual(['in']);
  });

  it('hạn đã qua không báo (đêm đó hạ hạng rồi)', async () => {
    const { svc, notify } = build([{ id: 'u1', tierGraceUntil: new Date(NOW.getTime() - 1000), tierDropNoticeFor: null, tier: TIER }]);
    expect(await svc.sendNotices(NOW)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('đã đủ điều kiện giữ hạng (còn thiếu 0): không báo, không đánh dấu', async () => {
    const { svc, notify, rows } = build([{ id: 'u1', tierGraceUntil: inDays(5), tierDropNoticeFor: null, tier: TIER }], { gap: { spendingToKeep: 0, pointsToKeep: 0 } });
    expect(await svc.sendNotices(NOW)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(rows.get('u1')!.tierDropNoticeFor).toBeNull();
  });

  it('hạng xét theo điểm: nói số Điểm Xanh còn thiếu', async () => {
    const { svc, notify } = build([{ id: 'u1', tierGraceUntil: inDays(5), tierDropNoticeFor: null, tier: { ...TIER, minSpending: null as never, minPoints: 5000 } }], {
      gap: { spendingToKeep: null, pointsToKeep: 1500 },
    });
    await svc.sendNotices(NOW);
    expect((notify.mock.calls[0]![2] as { need: string }).need).toBe('Tích thêm 1.500 Điểm Xanh từ đơn giao thành công');
  });

  it('cấu hình ngày báo: 0 = tắt; số khác đổi ngưỡng; giá trị hỏng về 14', async () => {
    const u: U = { id: 'u1', tierGraceUntil: inDays(5), tierDropNoticeFor: null, tier: TIER };
    expect(await build([u], { cfg: { 'loyalty.tier_drop_notice_days': 0 } }).svc.sendNotices(NOW)).toBe(0);
    expect(await build([u], { cfg: { 'loyalty.tier_drop_notice_days': 3 } }).svc.sendNotices(NOW)).toBe(0);
    expect(await build([u], { cfg: { 'loyalty.tier_drop_notice_days': 7 } }).svc.sendNotices(NOW)).toBe(1);
    expect(await build([u], { cfg: { 'loyalty.tier_drop_notice_days': 'abc' } }).svc.sendNotices(NOW)).toBe(1);
  });

  it('có mã mẫu ZNS trong cấu hình thì truyền cho notify; trống hoặc không phải số thì bỏ ZNS', async () => {
    const u: U = { id: 'u1', tierGraceUntil: inDays(5), tierDropNoticeFor: null, tier: TIER };
    const withZns = build([u], { cfg: { 'loyalty.tier_drop_zns_template_id': '123456' } });
    await withZns.svc.sendNotices(NOW);
    expect(withZns.notify.mock.calls[0]![3]).toEqual({ znsTemplateId: '123456' });
    for (const bad of ['', '  ', 'abc']) {
      const b = build([{ ...u }], { cfg: { 'loyalty.tier_drop_zns_template_id': bad } });
      await b.svc.sendNotices(NOW);
      expect(b.notify.mock.calls[0]![3]).toEqual({});
    }
  });

  it('gửi lỗi: trả phần đã đánh dấu để lần sau thử lại; lỗi một khách không chặn khách khác', async () => {
    const { svc, rows, notify } = build(
      [
        { id: 'a', tierGraceUntil: inDays(5), tierDropNoticeFor: null, tier: TIER },
        { id: 'b', tierGraceUntil: inDays(6), tierDropNoticeFor: null, tier: TIER },
      ],
      { notifyThrows: true },
    );
    expect(await svc.sendNotices(NOW)).toBe(0);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(rows.get('a')!.tierDropNoticeFor).toBeNull();
    expect(rows.get('b')!.tierDropNoticeFor).toBeNull();
  });

  it('hai bản chạy song song: chỉ một bên gửi', async () => {
    const { svc, notify } = build([{ id: 'u1', tierGraceUntil: inDays(5), tierDropNoticeFor: null, tier: TIER }]);
    const [a, b] = await Promise.all([svc.sendNotices(NOW), svc.sendNotices(NOW)]);
    expect(a + b).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
