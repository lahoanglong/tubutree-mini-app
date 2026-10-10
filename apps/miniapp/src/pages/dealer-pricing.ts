/** Trần số lượng một dòng trên màn đặt hàng đại lý — chỉ để chặn gõ nhầm; hạn mức thật do máy chủ. */
export const DEALER_MAX_QTY = 9999;

/** Phần vượt tồn của một dòng: máy chủ giữ hàng đang có, phần còn lại là đặt trước. */
export function preorderQty(qty: number, stock: number): number {
  return Math.max(0, qty - Math.max(0, stock));
}

/**
 * % giảm tính từ giá thật. `discountPct` máy chủ trả chỉ là mức giảm mặc định của bậc, trong khi
 * giá của từng phân loại có thể được đặt riêng cho bậc (dealerPrices) nên hai con số lệch nhau.
 */
export function realDiscountPct(retailPrice: number, dealerPrice: number): number {
  if (!(retailPrice > 0) || dealerPrice >= retailPrice) return 0;
  return Math.round((1 - dealerPrice / retailPrice) * 100);
}
