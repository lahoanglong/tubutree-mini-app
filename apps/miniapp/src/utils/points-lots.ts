import { formatDate, formatPoints } from './format';

/**
 * Điểm Xanh khách thấy: MỘT con số = lô thường + lô quy đổi. Hai lô chỉ tách ra khi cần nói rõ phần nào
 * không hết hạn / dùng được ở đâu. Số âm hoặc rác → 0 để không bao giờ hiện "NaN điểm".
 */
export function pointsSummary(ov: {
  /** Lô thường (có hạn). */
  pointsBalance: number;
  /** Lô quy đổi từ xu cũ (không hết hạn). API cũ chưa trả → 0. */
  pointsConvertedBalance?: number;
}): { standard: number; converted: number; total: number } {
  const clamp = (n: number | undefined) => (Number.isFinite(n) ? Math.max(0, n as number) : 0);
  const standard = clamp(ov.pointsBalance);
  const converted = clamp(ov.pointsConvertedBalance);
  return { standard, converted, total: standard + converted };
}

/** "trong đó 1.250 điểm không hết hạn" — null khi khách không có điểm quy đổi. */
export function convertedPointsNote(converted: number | null | undefined): string | null {
  const n = Number(converted ?? 0);
  return n > 0 ? `trong đó ${formatPoints(n)} không hết hạn` : null;
}

const DAY_MS = 864e5;
const URGENT_WITHIN_DAYS = 30;

/**
 * "70 điểm Xanh sẽ hết hạn ngày 20/10/2026": lô điểm thường hết hạn gần nhất để khách dùng trước. Trong 30 ngày
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
  const base = `${formatPoints(expiring.amount)} Xanh sẽ hết hạn ngày ${formatDate(at)}`;
  return { text: urgent ? `${base} (còn ${daysLeft} ngày)` : base, urgent };
}

/** Chính sách hạn điểm thường theo cấu hình; API cũ chưa trả số tháng → null (không tự bịa con số). */
export function pointExpiryPolicyNote(months: number | null | undefined): string | null {
  const n = Number(months ?? 0);
  return Number.isFinite(n) && n >= 1 ? `Điểm Xanh thường có hạn ${Math.floor(n)} tháng kể từ ngày nhận, điểm cũ được dùng trước.` : null;
}
