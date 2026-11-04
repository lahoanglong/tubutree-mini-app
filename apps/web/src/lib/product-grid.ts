/**
 * Lưới sản phẩm dùng chung (trang chủ, thương hiệu, yêu thích, gian hàng CTV): 2 cột điện thoại, 3 cột từ md (640–767px vẫn là khổ điện thoại), 5 cột từ lg, 6 cột từ xl.
 * Trang danh mục có cột lọc bên trái nên bớt một cột để thẻ không hẹp lại.
 */
export const GRID_PRODUCTS = 'grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5 xl:grid-cols-6';
export const GRID_PRODUCTS_WITH_FILTER = 'grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4 xl:grid-cols-5';

/**
 * `sizes` của ảnh thẻ trong lưới, khớp các lớp cột ở trên (lề trang 16/24px, khe 12/16/20px; khung trang tối đa 1200px). Trình duyệt chọn bản srcset
 * theo bề rộng ô thật thay vì đoán 100vw. Lưới lạ (lớp cột riêng) dùng bản của `GRID_PRODUCTS`.
 */
const SIZES_PHONE = '(max-width: 767px) calc((100vw - 44px) / 2)';
const SIZES_MD = '(max-width: 1023px) calc((100vw - 80px) / 3)';
export const GRID_IMAGE_SIZES = `${SIZES_PHONE}, ${SIZES_MD}, (max-width: 1279px) calc((min(100vw, 1200px) - 112px) / 5), 179px`;
/** Có cột lọc bên trái (200px + khe 24px, listing-layout): lg 4 cột, xl 5 cột. */
export const GRID_IMAGE_SIZES_WITH_FILTER = `${SIZES_PHONE}, ${SIZES_MD}, (max-width: 1279px) calc((min(100vw, 1200px) - 332px) / 4), 170px`;
export const GRID_RANK_IMAGE_SIZES = `${SIZES_PHONE}, ${SIZES_MD}, calc((min(100vw, 1200px) - 112px) / 5)`;

export function gridImageSizes(className: string): string {
  if (className === GRID_PRODUCTS_WITH_FILTER) return GRID_IMAGE_SIZES_WITH_FILTER;
  if (!className.includes('xl:grid-cols-6') && className.includes('lg:grid-cols-5')) return GRID_RANK_IMAGE_SIZES;
  return GRID_IMAGE_SIZES;
}
