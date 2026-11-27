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

/**
 * "1.250 điểm từ đơn sàn chỉ dùng khi mua hàng" — dưới số điểm của vòng quay và quỹ trồng cây (những chỗ không tiêu lô sàn), để khách
 * hiểu vì sao số dùng được ở đó thấp hơn tổng Điểm Xanh. null khi khách không có điểm sàn.
 */
export function marketplaceExcludedNote(marketplace: number | null | undefined): string | null {
  const n = Number(marketplace ?? 0);
  return n > 0 ? `${formatVnNumber(n)} điểm từ đơn sàn chỉ dùng khi mua hàng` : null;
}

/**
 * Số điểm Vườn Xanh dùng được: vòng quay tiêu lô thường dùng được, quỹ trồng cây tiêu lô thường + lô quy đổi; điểm từ đơn sàn chỉ dùng khi
 * mua hàng nên không tính ở cả hai (W42), kèm câu giải thích. Số máy chủ tính sẵn (`redeemablePoints`, `redeemableTotal`) thắng; API cũ chưa
 * trả thì tự tính. Chưa có dữ liệu → null.
 */
export function gardenPoints(
  ov:
    | {
        pointsBalance: number;
        pointsConvertedBalance?: number;
        pointsMarketplaceBalance?: number;
        redeemablePoints?: number;
        redeemableTotal?: number;
      }
    | null
    | undefined,
): { wheel: number | null; fund: number | null; marketplaceNote: string | null } {
  if (!ov) return { wheel: null, fund: null, marketplaceNote: null };
  const lots = pointsSummary(ov);
  return {
    wheel: ov.redeemablePoints ?? lots.standard,
    fund: ov.redeemableTotal ?? lots.standard + lots.converted,
    marketplaceNote: marketplaceExcludedNote(lots.marketplace),
  };
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

/**
 * Số Điểm Xanh từ đơn sàn trong ô Điểm Xanh thanh toán (W43), cho dòng chú thích `checkout.pointsOrderOnly`. Chỉ đọc số máy chủ tính:
 * lô sàn chung trần % với lô thường còn lô quy đổi thì không (`PricingService.resolvePointsRedemptionByLot`), nên FE không suy được từ
 * số dư hay `pointsMax`.
 *  - khách đã tick và báo giá đã trừ điểm (`applied`): `pointsUsedMarketplace`;
 *  - chưa tick: `pointsMaxMarketplace` (phần lô sàn khi dùng hết điểm, đúng số máy chủ sẽ trừ khi khách tick).
 * null khi 0, khi chưa có báo giá hay API cũ chưa trả số: không hiện dòng còn hơn đoán sai. File này nằm trong gói đầu Mini App nên không
 * điền chữ ở đây.
 */
export function checkoutMarketplacePoints(input: {
  quote: { pointsMaxMarketplace?: number; pointsUsedMarketplace?: number } | null | undefined;
  applied: boolean;
}): number | null {
  const raw = input.applied ? input.quote?.pointsUsedMarketplace : input.quote?.pointsMaxMarketplace;
  if (!Number.isFinite(raw)) return null;
  const n = Math.max(0, Math.floor(raw as number));
  return n > 0 ? n : null;
}
