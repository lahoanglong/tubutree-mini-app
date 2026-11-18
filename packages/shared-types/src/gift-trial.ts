/**
 * Quà tặng dùng thử 0đ theo mốc giỏ (cờ `commerce.gift_trial_enabled`). Máy chủ quyết định quà nào mở theo tạm tính phần hàng Tubu Tree giao
 * và kiểm lại khi đặt đơn; hai app chỉ vẽ `GiftTrialSummaryDTO` và gửi lựa chọn của khách.
 */

/** Số lựa chọn quà tối đa đọc từ cấu hình (một tấm chọn, không cuộn dài). */
export const GIFT_TRIAL_MAX_OPTIONS = 6;

/** Đặt đơn gửi một quà không còn hợp lệ với phần hàng đang đặt (đổi cấu hình, tạm tính tụt dưới mốc, quà ngừng bán). App tải lại báo giá. */
export const GIFT_TRIAL_CHANGED = 'GIFT_TRIAL_CHANGED';
/** Quà khách đã chọn vừa hết hàng lúc giữ kho. App tải lại báo giá để khách chọn quà khác hoặc đặt không kèm quà. */
export const GIFT_TRIAL_UNAVAILABLE = 'GIFT_TRIAL_UNAVAILABLE';

export interface GiftTrialOptionDTO {
  variationId: string;
  productName: string;
  variationName: string;
  slug: string;
  thumbnail: string | null;
  /** Tạm tính hàng Tubu Tree giao tối thiểu để chọn quà này (đồng). */
  minOrder: number;
  /** Tạm tính hiện tại đã đủ mốc của quà này. */
  unlocked: boolean;
}

export interface GiftTrialSummaryDTO {
  /** Tạm tính phần hàng Tubu Tree giao mà máy chủ dùng để xét mốc (đồng). */
  base: number;
  /** Mốc thấp nhất trong các quà đang còn (đồng). */
  minOrder: number;
  /** Mốc của quà kế tiếp chưa mở; null khi mọi quà đã mở. */
  nextMinOrder: number | null;
  /** Số tiền còn thiếu tới `nextMinOrder`; 0 khi không còn mốc nào. */
  shortfall: number;
  /** Quà còn hàng, xếp theo mốc tăng dần. Rỗng thì máy chủ không trả cả khối. */
  options: GiftTrialOptionDTO[];
  /** Quà sẽ đi cùng đơn nếu đặt lúc này; null khi chưa đủ mốc hoặc khách không nhận quà. */
  selectedVariationId: string | null;
  /** Khách đã chọn "Không nhận quà". */
  declined: boolean;
}
