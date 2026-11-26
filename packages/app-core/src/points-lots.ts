import { formatVnNumber } from './number-format';

/**
 * Điểm Xanh khách thấy: MỘT con số = lô thường (có hạn) + lô quy đổi từ xu cũ (không hết hạn, tiền trả trước) + lô điểm tích từ đơn
 * sàn (có hạn, chỉ dùng khi mua hàng). Các lô chỉ tách ra khi cần nói rõ phần nào không hết hạn / dùng được ở đâu. Số âm hoặc rác → 0
 * để không bao giờ hiện "NaN điểm"; API cũ chưa trả lô quy đổi hoặc lô sàn → 0.
 */
export function pointsSummary(ov: {
  /** Lô thường (có hạn). */
  pointsBalance: number;
  /** Lô quy đổi từ xu cũ (không hết hạn). API cũ chưa trả → 0. */
  pointsConvertedBalance?: number;
  /** Lô điểm tích từ đơn sàn (W42). API cũ chưa trả → 0. */
  pointsMarketplaceBalance?: number;
}): { standard: number; converted: number; marketplace: number; total: number } {
  const clamp = (n: number | undefined) => (Number.isFinite(n) ? Math.max(0, n as number) : 0);
  const standard = clamp(ov.pointsBalance);
  const converted = clamp(ov.pointsConvertedBalance);
  const marketplace = clamp(ov.pointsMarketplaceBalance);
  return { standard, converted, marketplace, total: standard + converted + marketplace };
}

/** "trong đó 1.250 điểm từ đơn sàn chỉ dùng khi mua hàng" — null khi khách không có điểm sàn. */
export function marketplacePointsNote(marketplace: number | null | undefined): string | null {
  const n = Number(marketplace ?? 0);
  return n > 0 ? `trong đó ${formatVnNumber(n)} điểm từ đơn sàn chỉ dùng khi mua hàng` : null;
}

/** "trong đó 1.250 điểm không hết hạn" — null khi khách không có điểm quy đổi. */
export function convertedPointsNote(converted: number | null | undefined): string | null {
  const n = Number(converted ?? 0);
  return n > 0 ? `trong đó ${formatVnNumber(n)} điểm không hết hạn` : null;
}

/**
 * Nhãn ô Điểm Xanh khi ô bị khoá theo đơn (đơn không dùng được điểm): chỉ ghi tổng số dư, không hứa "dùng được" ngay cạnh câu
 * "chưa dùng được"; phần bị giữ để `lockNote` nói. Web và Mini cùng dùng.
 */
export function lockedPointsLabel(total: number): string {
  return `Bạn đang có ${formatVnNumber(total)} điểm`;
}
