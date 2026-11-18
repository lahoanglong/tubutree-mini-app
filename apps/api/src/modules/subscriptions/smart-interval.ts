/** Gợi ý giao định kỳ theo nhịp mua thật (cờ `subscriptions.smart_interval_enabled`, mặc định tắt). Không đổi giá, không phát điểm. */
export const SMART_INTERVAL_ENABLED_KEY = 'subscriptions.smart_interval_enabled';
export const SMART_INTERVAL_MAX = 3;
/** Chỉ xét lần nhận trong một năm gần nhất: thói quen hai năm trước không nói gì về tuần sau. */
export const SMART_INTERVAL_LOOKBACK_DAYS = 365;
/**
 * Nhịp ngoài khoảng này không làm tròn về chu kỳ có sẵn: dưới 3 tuần thì chu kỳ 4 tuần làm khách thiếu hàng, trên 12 tuần thì chu kỳ 10 tuần
 * giao dồn. Không gợi ý còn hơn gợi ý sai.
 */
export const SMART_INTERVAL_MIN_DAYS = 21;
export const SMART_INTERVAL_MAX_DAYS = 84;

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

/** Số thứ tự ngày theo giờ Việt Nam: hai lần nhận trong cùng một ngày VN là một lần. */
const vnDayIndex = (d: Date) => Math.floor((d.getTime() + VN_OFFSET_MS) / DAY_MS);

/** Trung vị số ngày giữa các lần nhận (THUẦN); dưới 2 ngày nhận khác nhau thì null. Số chẵn khoảng: trung bình hai khoảng giữa. */
export function medianGapDays(deliveredAt: readonly Date[]): number | null {
  const days = [...new Set(deliveredAt.map(vnDayIndex))].sort((a, b) => a - b);
  if (days.length < 2) return null;
  const gaps = days
    .slice(1)
    .map((d, i) => d - days[i]!)
    .sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

/**
 * Chu kỳ có sẵn (`intervals`, tuần) gần nhất với `days` (THUẦN); cách đều hai chu kỳ thì lấy chu kỳ ngắn hơn (khách không hết hàng giữa hai lần giao).
 * Ngoài [`SMART_INTERVAL_MIN_DAYS`, `SMART_INTERVAL_MAX_DAYS`] thì null.
 */
export function nearestIntervalWeeks(days: number, intervals: readonly number[]): number | null {
  if (!Number.isFinite(days) || days < SMART_INTERVAL_MIN_DAYS || days > SMART_INTERVAL_MAX_DAYS) return null;
  let best: number | null = null;
  for (const w of [...intervals].sort((a, b) => a - b)) {
    if (best === null || Math.abs(w * 7 - days) < Math.abs(best * 7 - days)) best = w;
  }
  return best;
}

export interface DeliveredPurchase {
  variationId: string;
  deliveredAt: Date;
}

export interface IntervalCandidate {
  variationId: string;
  intervalWeeks: number;
  lastDeliveredAt: Date;
}

/**
 * Phân loại khách đã nhận ở ít nhất 2 ngày khác nhau, kèm chu kỳ làm tròn từ trung vị khoảng cách (THUẦN). Xếp theo lần nhận gần nhất,
 * mới trước; bằng nhau thì theo `variationId` để thứ tự ổn định. Chưa lọc món đã có gói hay hết hàng: nơi gọi lọc rồi mới cắt `SMART_INTERVAL_MAX`.
 */
export function intervalCandidates(purchases: readonly DeliveredPurchase[], intervals: readonly number[]): IntervalCandidate[] {
  const byVariation = new Map<string, Date[]>();
  for (const p of purchases) {
    const list = byVariation.get(p.variationId) ?? [];
    list.push(p.deliveredAt);
    byVariation.set(p.variationId, list);
  }
  const out: IntervalCandidate[] = [];
  for (const [variationId, dates] of byVariation) {
    const median = medianGapDays(dates);
    const weeks = median === null ? null : nearestIntervalWeeks(median, intervals);
    if (weeks === null) continue;
    const last = dates.reduce((a, b) => (b > a ? b : a));
    out.push({ variationId, intervalWeeks: weeks, lastDeliveredAt: last });
  }
  return out.sort(
    (a, b) => b.lastDeliveredAt.getTime() - a.lastDeliveredAt.getTime() || (a.variationId < b.variationId ? -1 : a.variationId > b.variationId ? 1 : 0),
  );
}
