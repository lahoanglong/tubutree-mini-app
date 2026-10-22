/** Chiết khấu đại lý tối đa (phân số) khi chưa có SystemConfig `dealer.max_discount_pct`; DealerService kẹp giá theo số này và Mini App hiện lại trên trang đăng ký. */
export const DEALER_MAX_DISCOUNT_PCT_DEFAULT = 0.45;

/** Số giờ Tubu hẹn xét duyệt hồ sơ đại lý (SystemConfig `dealer.review_hours`); chỉ để hiện chữ cho người đăng ký, không có tác vụ nào tự duyệt theo số này. */
export const DEALER_REVIEW_HOURS_DEFAULT = 24;

/** Tiền hàng tối thiểu của một đơn đại lý (SystemConfig `dealer.min_order_value_vnd`); 0 = không chặn. Luật nhóm C đã chốt: 3 triệu. */
export const DEALER_MIN_ORDER_VALUE_KEY = 'dealer.min_order_value_vnd';
export const DEALER_MIN_ORDER_VALUE_DEFAULT = 3_000_000;

/** Tiền hàng từ mức này thì đơn đại lý miễn phí giao (SystemConfig `dealer.free_ship_threshold_vnd`). Luật nhóm C đã chốt: 5 triệu. */
export const DEALER_FREE_SHIP_THRESHOLD_KEY = 'dealer.free_ship_threshold_vnd';
export const DEALER_FREE_SHIP_THRESHOLD_DEFAULT = 5_000_000;

/**
 * Phí giao đơn đại lý dưới ngưỡng miễn phí (SystemConfig `dealer.shipping_fee_below_threshold_vnd`). Chưa đặt thì dùng phí
 * phẳng của đơn lẻ (`shipping.flat_fee_below_threshold`): đơn sỉ không có bảng phí riêng theo địa chỉ để tính lại.
 */
export const DEALER_SHIPPING_FEE_BELOW_THRESHOLD_KEY = 'dealer.shipping_fee_below_threshold_vnd';
export const RETAIL_FLAT_SHIPPING_FEE_KEY = 'shipping.flat_fee_below_threshold';
export const RETAIL_FLAT_SHIPPING_FEE_DEFAULT = 19_000;

/** Bật thì đại lý còn nợ đơn quá hạn theo điều kiện thanh toán của bậc (NET n) không đặt được đơn ghi công nợ; trả trước vẫn đặt được. */
export const DEALER_BLOCK_CREDIT_WHEN_OVERDUE_KEY = 'dealer.block_credit_when_overdue';

/** Số ngày sau ngày cuối quý còn trả bù thưởng quý cho đơn chốt muộn hơn ngày chốt 10 (SystemConfig `dealer.bonus_topup_window_days`); 0 hoặc dưới 10 = tắt trả bù (ngày chốt thưởng là ngày 10 sau quý). Chủ chốt 60 ngày. */
export const DEALER_BONUS_TOPUP_WINDOW_DAYS_KEY = 'dealer.bonus_topup_window_days';
export const DEALER_BONUS_TOPUP_WINDOW_DAYS_DEFAULT = 60;
