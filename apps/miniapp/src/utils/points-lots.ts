import { formatDate, formatNumber, formatPoints } from './format';

export { convertedPointsNote, pointsSummary } from '@tubutree/app-core/points-lots';

const DAY_MS = 864e5;
const URGENT_WITHIN_DAYS = 30;

/**
 * "70 Điểm Xanh sẽ hết hạn ngày 20/10/2026": lô điểm thường hết hạn gần nhất để khách dùng trước. Trong 30 ngày
 * tới thêm "(còn N ngày)" và `urgent` để trang tô màu cảnh báo. Thiếu dữ liệu/ngày hỏng/0 điểm → null.
 */
export function expiringPointsNote(
  expiring: { amount: number; expiresAt: string } | null | undefined,
  now: Date = new Date(),
): { text: string; urgent: boolean } | null {
  if (!expiring || !(expiring.amount > 0)) return null;
  const at = new Date(expiring.expiresAt);
  if (Number.isNaN(at.getTime())) return null;
  const daysLeft = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / DAY_MS));
  const urgent = daysLeft <= URGENT_WITHIN_DAYS;
  const base = `${formatNumber(expiring.amount)} Điểm Xanh sẽ hết hạn ngày ${formatDate(at)}`;
  return { text: urgent ? `${base} (còn ${daysLeft} ngày)` : base, urgent };
}

/** Chính sách hạn điểm thường theo cấu hình; API cũ chưa trả số tháng → null (không tự bịa con số). */
export function pointExpiryPolicyNote(months: number | null | undefined): string | null {
  const n = Number(months ?? 0);
  return Number.isFinite(n) && n >= 1 ? `Điểm Xanh thường có hạn ${Math.floor(n)} tháng kể từ ngày nhận, điểm cũ được dùng trước.` : null;
}
