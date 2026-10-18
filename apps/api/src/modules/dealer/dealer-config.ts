/** Chiết khấu đại lý tối đa (phân số) khi chưa có SystemConfig `dealer.max_discount_pct`; DealerService kẹp giá theo số này và Mini App hiện lại trên trang đăng ký. */
export const DEALER_MAX_DISCOUNT_PCT_DEFAULT = 0.45;

/** Số giờ Tubu hẹn xét duyệt hồ sơ đại lý (SystemConfig `dealer.review_hours`); chỉ để hiện chữ cho người đăng ký, không có tác vụ nào tự duyệt theo số này. */
export const DEALER_REVIEW_HOURS_DEFAULT = 24;
