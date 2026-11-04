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
import { GRID_IMAGE_SIZES, GRID_IMAGE_SIZES_WITH_FILTER, GRID_RANK_IMAGE_SIZES } from './image-sizes';
export { GRID_IMAGE_SIZES, GRID_IMAGE_SIZES_WITH_FILTER, GRID_RANK_IMAGE_SIZES };

export function gridImageSizes(className: string): string {
  if (className === GRID_PRODUCTS_WITH_FILTER) return GRID_IMAGE_SIZES_WITH_FILTER;
  if (!className.includes('xl:grid-cols-6') && className.includes('lg:grid-cols-5')) return GRID_RANK_IMAGE_SIZES;
  return GRID_IMAGE_SIZES;
}
