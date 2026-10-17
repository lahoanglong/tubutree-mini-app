/**
 * Khoảng ngày và bảng ngày × kênh của tab "Báo cáo" admin. Ngày là 'YYYY-MM-DD' theo giờ Việt Nam (UTC+7 cố định, không
 * giờ mùa hè), cùng quy ước với API (apps/api/src/modules/admin/report-range.ts).
 */
const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

const keyMs = (key: string) => Date.parse(`${key}T00:00:00.000Z`);
const msKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Hôm nay theo giờ VN, không phụ thuộc múi giờ máy khách. */
export const vnTodayKey = (now: Date = new Date()) => msKey(now.getTime() + VN_OFFSET_MS);

export const addDaysKey = (key: string, days: number) => msKey(keyMs(key) + days * DAY_MS);

/** N ngày kết thúc hôm nay (cả hai đầu tính). */
export function lastDaysRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = vnTodayKey(now);
  return { from: addDaysKey(to, -(days - 1)), to };
}

export const REVENUE_MAX_DAYS = 366;
export const SOURCES_MAX_DAYS = 180;

export const rangeDays = (from: string, to: string) => Math.round((keyMs(to) - keyMs(from)) / DAY_MS) + 1;

/** Thông báo lỗi tiếng Việt cho khoảng ngày không dùng được, hoặc null nếu hợp lệ. */
export function rangeError(from: string, to: string, maxDays: number): string | null {
  const ok = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(keyMs(k));
  if (!ok(from) || !ok(to)) return 'Chọn đủ ngày bắt đầu và ngày kết thúc.';
  const days = rangeDays(from, to);
  if (days < 1) return 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.';
  if (days > maxDays) return `Khoảng ngày tối đa ${maxDays} ngày.`;
  return null;
}

export interface PivotInput {
  byDay: { day: string; channel: string; revenue: number; orders: number }[];
  byChannel: { key: string; label: string }[];
}

export interface RevenuePivot {
  columns: { key: string; label: string }[];
  rows: { day: string; cells: Record<string, number>; total: number; orders: number }[];
  columnTotals: Record<string, number>;
  grandTotal: number;
}

/** Bảng ngày (mới nhất trước) × kênh (kênh nhiều tiền nhất trước), kèm tổng hàng và tổng cột. */
export function pivotRevenue(report: PivotInput): RevenuePivot {
  const columns = report.byChannel.map((c) => ({ key: c.key, label: c.label }));
  const byDay = new Map<string, { cells: Record<string, number>; total: number; orders: number }>();
  const columnTotals: Record<string, number> = Object.fromEntries(columns.map((c) => [c.key, 0]));
  let grandTotal = 0;
  for (const d of report.byDay) {
    const row = byDay.get(d.day) ?? { cells: {}, total: 0, orders: 0 };
    row.cells[d.channel] = (row.cells[d.channel] ?? 0) + d.revenue;
    row.total += d.revenue;
    row.orders += d.orders;
    byDay.set(d.day, row);
    columnTotals[d.channel] = (columnTotals[d.channel] ?? 0) + d.revenue;
    grandTotal += d.revenue;
  }
  const rows = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, r]) => ({ day, ...r }));
  return { columns, rows, columnTotals, grandTotal };
}
