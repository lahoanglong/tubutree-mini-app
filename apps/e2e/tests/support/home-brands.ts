/** Khối cuối Trang chủ (khối `suggest`, W47): lưới 2 cột "Gợi ý cho bạn" kèm một thẻ chen. */
export const HOME_SUGGEST = 'Gợi ý cho bạn';

/** Hàng chip dưới lưới Danh mục: mỗi chip một thương hiệu, chạm thì mở danh sách của nhãn đó. Chỉ hiện khi có từ 2 nhãn thật ngoài "Tubu Tree". */
export const BRAND_BAR = 'Thương hiệu';

/**
 * Khung chờ lưới của Trang chủ trừ khối "Gợi ý cho bạn": khối đó chỉ tải (và vẽ khung chờ) khi khách cuộn tới gần, không thuộc lúc Trang chủ "xong",
 * nên spec chờ Trang chủ "xong" đếm khung chờ ở các khối khác.
 */
export const LOADING_GRID_OUTSIDE_SUGGEST = '[data-testid="catalog-grid-skeleton"]:not([data-home-block="suggest"] *)';
