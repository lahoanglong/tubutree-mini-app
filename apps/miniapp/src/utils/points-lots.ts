import { formatPoints } from './format';

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
