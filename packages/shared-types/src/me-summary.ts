/**
 * Các số chỉ để hiện nhanh ở trang Cá nhân và thanh đáy, trả trong MỘT lời gọi GET /me/summary.
 * Số đơn dùng đúng nhóm trạng thái của từng tab trang Đơn hàng; `active` là số đơn đang xử lý của huy hiệu thanh đáy.
 */
export interface MeSummaryDTO {
  orders: {
    pending_payment: number;
    processing: number;
    shipping: number;
    delivered: number;
    closed: number;
    active: number;
  };
  unreadNotifications: number;
  /** Gói định kỳ đang chạy hoặc tạm dừng. */
  activeSubscriptions: number;
}
