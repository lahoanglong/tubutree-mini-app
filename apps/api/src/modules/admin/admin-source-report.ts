import { Prisma } from '@prisma/client';

/**
 * Báo cáo nguồn chạm đầu × tuần (D2-02): phần thuần (nhãn, gộp, cờ kỳ đã đóng). Truy vấn nằm ở AdminReportsService.
 */

/**
 * Thế nào là "khách mới" (bí danh bảng `u`), dùng chung cho bảng nguồn × tuần và thẻ "Khách mới" của KPI doanh thu để hai nơi khớp nhau:
 * không tính tài khoản nội bộ, dòng khách vãng lai đã gộp vào tài khoản khác (mergedIntoId), và khách cũ được gắn nguồn lúc gộp
 * (chạm đầu muộn hơn ngày tạo hơn một ngày; xem impl/source.md mục 3).
 */
export const NEW_CUSTOMER_SQL = Prisma.sql`u.role NOT IN ('ADMIN', 'STAFF')
  AND u."mergedIntoId" IS NULL
  AND (u."firstTouchAt" IS NULL OR u."firstTouchAt" <= u."createdAt" + interval '1 day')`;

/** Khoảng theo dõi sau khi tạo tài khoản (đơn đầu, doanh thu) và sau đơn đầu (đơn hai). Là định nghĩa của báo cáo, không phải tham số kinh doanh. */
export const SOURCE_REPORT_WINDOW_DAYS = 30;
/** Số nguồn tối đa hiện riêng; phần đuôi gộp vào "Nguồn khác". Mã nguồn do máy khách khai nên số nguồn không có trần. */
export const SOURCE_REPORT_MAX_SOURCES = 40;
export const OTHER_SOURCE = '__other';
/** Chiều chiến dịch: khoá có tiền tố để tên chiến dịch do máy khách khai (vd "shopee", "unknown") không đụng nhãn nguồn hay dòng "không có chiến dịch". */
export const NO_CAMPAIGN = '__nocampaign';
export const CAMPAIGN_PREFIX = 'c:';

const SOURCE_LABEL: Record<string, string> = {
  shopee: 'Shopee',
  lazada: 'Lazada',
  tiktok: 'TikTok Shop',
  fb: 'Facebook',
  oa: 'Zalo OA',
  linkbio: 'Link bio',
  ctv: 'CTV',
  ref: 'Giới thiệu (mã ref)',
  organic: 'Tự nhiên (không có link)',
  unknown: 'Không rõ',
  [NO_CAMPAIGN]: 'Không thuộc chiến dịch nào',
  [OTHER_SOURCE]: 'Nguồn khác',
};

export function sourceLabel(source: string): string {
  if (source.startsWith(CAMPAIGN_PREFIX)) {
    const campaign = source.slice(CAMPAIGN_PREFIX.length);
    const card = /^card-(.+)$/.exec(campaign);
    return card ? `Thẻ hộp hàng ${card[1]}` : campaign;
  }
  const known = SOURCE_LABEL[source];
  if (known) return known;
  const card = /^card-(.+)$/.exec(source);
  return card ? `Thẻ hộp hàng ${card[1]}` : source;
}

/** Một nhóm (tuần bắt đầu thứ Hai giờ VN, nguồn) do truy vấn trả về; nguồn trống đã đổi thành 'unknown'. */
export interface SourceRow {
  week: string;
  source: string;
  newUsers: number;
  firstOrderUsers: number;
  secondOrderUsers: number;
  revenue: number;
}

export interface SourceTotals {
  newUsers: number;
  firstOrderUsers: number;
  secondOrderUsers: number;
  revenue: number;
}

const DAY_MS = 86_400_000;
const keyMs = (key: string) => Date.parse(`${key}T00:00:00.000Z`);

/**
 * Đơn đầu và doanh thu chỉ đủ số sau 7 + 30 ngày kể từ đầu tuần (người cuối tuần tạo tài khoản vẫn đang trong 30 ngày),
 * đơn hai sau 7 + 60 ngày. Trước đó con số còn tăng thêm, nên bảng đánh dấu để không đọc nhầm là tuần kém.
 */
export function weekWindowsClosed(weekStart: string, today: string) {
  const age = (keyMs(today) - keyMs(weekStart)) / DAY_MS;
  return {
    firstWindowClosed: age >= 7 + SOURCE_REPORT_WINDOW_DAYS,
    secondWindowClosed: age >= 7 + 2 * SOURCE_REPORT_WINDOW_DAYS,
  };
}

const zero = (): SourceTotals => ({ newUsers: 0, firstOrderUsers: 0, secondOrderUsers: 0, revenue: 0 });
function add(acc: SourceTotals, r: SourceTotals) {
  acc.newUsers += r.newUsers;
  acc.firstOrderUsers += r.firstOrderUsers;
  acc.secondOrderUsers += r.secondOrderUsers;
  acc.revenue += r.revenue;
}

export function foldSourceRows(rows: readonly SourceRow[], opts: { maxSources: number; today: string }) {
  const perSource = new Map<string, SourceTotals>();
  for (const r of rows) {
    const acc = perSource.get(r.source) ?? zero();
    add(acc, r);
    perSource.set(r.source, acc);
  }
  const ranked = [...perSource.entries()].sort(([ka, a], [kb, b]) => b.newUsers - a.newUsers || b.revenue - a.revenue || ka.localeCompare(kb));
  const kept = new Set(ranked.slice(0, opts.maxSources).map(([k]) => k));
  const keyOf = (source: string) => (kept.has(source) ? source : OTHER_SOURCE);

  const cells = new Map<string, SourceRow>();
  const bySource = new Map<string, SourceTotals>();
  const totals = zero();
  for (const r of rows) {
    const source = keyOf(r.source);
    const k = `${r.week}|${source}`;
    const cell = cells.get(k) ?? { week: r.week, source, ...zero() };
    add(cell, r);
    cells.set(k, cell);
    const s = bySource.get(source) ?? zero();
    add(s, r);
    bySource.set(source, s);
    add(totals, r);
  }
  const bySourceRanked = (m: Map<string, SourceTotals>) =>
    [...m.entries()]
      .map(([source, v]) => ({ source, label: sourceLabel(source), ...v }))
      .sort((a, b) => (a.source === OTHER_SOURCE ? 1 : b.source === OTHER_SOURCE ? -1 : b.newUsers - a.newUsers || b.revenue - a.revenue || a.source.localeCompare(b.source)));
  const weeklyRows = [...cells.values()]
    .sort((a, b) => (a.week === b.week ? (a.source === OTHER_SOURCE ? 1 : b.source === OTHER_SOURCE ? -1 : b.newUsers - a.newUsers || a.source.localeCompare(b.source)) : b.week.localeCompare(a.week)))
    .map((c) => ({ ...c, label: sourceLabel(c.source), ...weekWindowsClosed(c.week, opts.today) }));
  return { rows: weeklyRows, bySource: bySourceRanked(bySource), totals };
}
