/**
 * % hoa hồng CTV mặc định khi biến thể CHƯA có `affiliateRate` (NULL). Hàng đồng bộ liên tục từ Pancake nên không thể nhập
 * từng biến thể; mức tường minh của biến thể (kể cả 0) luôn thắng. PHẦN TRĂM (8 = 8%), số nguyên như `rateProblem`.
 * Chỉ áp cho hàng Tubu: hàng gian hàng đối tác chỉ có hoa hồng khi admin đặt riêng mức cho biến thể.
 */
export const AFFILIATE_DEFAULT_RATE_KEY = 'affiliate.default_rate_pct';
export const DEFAULT_AFFILIATE_DEFAULT_RATE_PCT = 8;

/** Giá trị đọc từ cấu hình; hỏng (không phải số nguyên 0–50) thì dùng mặc định thay vì ra 0đ hay mức vô lý. */
export function sanitizeDefaultRate(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 50 ? value : DEFAULT_AFFILIATE_DEFAULT_RATE_PCT;
}

export interface VariationRateInput {
  /** `Variation.affiliateRate` (Decimal hoặc số); null = chưa đặt. */
  explicit: { toString(): string } | number | null | undefined;
  /** `Product.affiliateBlocked`. */
  blocked: boolean;
  /** Sản phẩm thuộc gian hàng đối tác (`Product.storefrontId` khác null). */
  partnerProduct: boolean;
  /** Hàng ký gửi của chính người giới thiệu mà bảng kê đối tác sẽ trả tiền cho họ. */
  ownConsignment: boolean;
  defaultPct: number;
}

/** % hoa hồng áp cho một dòng hàng lúc đặt đơn. Kết quả được chốt vào Commission.lineAmounts nên đổi mặc định sau này không ghi đè đơn cũ. */
export function resolveVariationRate(i: VariationRateInput): number {
  if (i.blocked || i.ownConsignment) return 0;
  if (i.explicit !== null && i.explicit !== undefined) {
    const n = Number(i.explicit.toString());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return i.partnerProduct ? 0 : i.defaultPct;
}
