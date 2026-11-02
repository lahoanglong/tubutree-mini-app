/** Số suất Giờ vàng tối đa cho một lần hỏi `GET /flash-sales/me/allowance` (đủ cho mọi phân loại của một sản phẩm). */
export const FLASH_ALLOWANCE_MAX_ITEMS = 50;

/** Số suất Giờ vàng của MỘT suất (flashSaleItemId) mà khách đang đăng nhập còn mua được, tính như lúc đặt đơn. */
export interface FlashAllowanceEntry {
  /** Giới hạn mỗi khách trừ số khách đã mua ở các đơn trước. */
  perUserLeft: number;
  /** min(suất còn lại của đợt, perUserLeft): quá số này thì máy chủ tính cả dòng giá thường. */
  allowance: number;
}

/** Chỉ có các suất còn chạy: suất hết giờ, hết suất hoặc không tồn tại vắng mặt (client coi là chưa biết). */
export interface FlashAllowanceResponse {
  items: Record<string, FlashAllowanceEntry>;
}
