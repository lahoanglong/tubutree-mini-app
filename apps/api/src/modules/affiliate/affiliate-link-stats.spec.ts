import { Logger } from '@nestjs/common';
import { adjustLinkStats, LINK_STATS_INT4_MAX } from './affiliate-link-stats';

const dbReturning = (rows: unknown[]) => ({ $queryRaw: jest.fn().mockResolvedValue(rows) });
const input = { orderId: 'o1', affiliateUserId: 'ctv', orders: 1 as const, revenue: 50_000 };

describe('adjustLinkStats: kẹp int4 và cảnh báo ops', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('một câu SQL: khoá dòng link (FOR UPDATE), cộng trên bigint, kẹp sàn 0 và trần int4; trả số dòng link đã đổi', async () => {
    const db = dbReturning([{ shortCode: 'abcDEF1', rawConversions: 3n, rawRevenue: 150_000n }]);
    expect(await adjustLinkStats(db, input)).toBe(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (db.$queryRaw.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toContain('FOR UPDATE OF l');
    expect(sql).toContain('LEAST(GREATEST(cur."rawRevenue", 0)');
    expect(sql).toContain('RETURNING');
    expect(db.$queryRaw.mock.calls[0]!.slice(1)).toEqual([1, 50_000, 'o1', 'ctv', LINK_STATS_INT4_MAX, LINK_STATS_INT4_MAX]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('vượt trần int4: cảnh báo ops kèm mã link và lệnh tính lại (không ném lỗi, không làm hỏng tx)', async () => {
    const db = dbReturning([{ shortCode: 'abcDEF1', rawConversions: 3n, rawRevenue: BigInt(LINK_STATS_INT4_MAX) + 10n }]);
    await expect(adjustLinkStats(db, input)).resolves.toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain('abcDEF1');
    expect(line).toContain('vượt trần int4');
    expect(line).toContain('POST /admin/affiliate-links/recompute');
  });

  it('bị trừ xuống dưới 0: cảnh báo số link đã lệch sổ hoa hồng', async () => {
    const db = dbReturning([{ shortCode: 'abcDEF1', rawConversions: -1n, rawRevenue: -20_000n }]);
    await adjustLinkStats(db, { ...input, orders: -1, revenue: -70_000 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('dưới 0');
  });

  it('không có link khớp (đơn không mã link, link của CTV khác): 0 dòng, không cảnh báo', async () => {
    const db = dbReturning([]);
    expect(await adjustLinkStats(db, input)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('doanh số NaN/Infinity không tới câu ::bigint (lỗi ép kiểu sẽ làm hỏng tx đặt đơn): coi là 0', async () => {
    const db = dbReturning([]);
    expect(await adjustLinkStats(db, { ...input, orders: 0, revenue: Number.NaN })).toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    await adjustLinkStats(db, { ...input, orders: 1, revenue: Number.POSITIVE_INFINITY });
    expect(db.$queryRaw.mock.calls[0]!.slice(1, 3)).toEqual([1, 0]);
  });
});
