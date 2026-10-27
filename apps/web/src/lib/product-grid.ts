/**
 * Lưới sản phẩm dùng chung (trang chủ, thương hiệu, yêu thích, gian hàng CTV): 2 cột điện thoại, 3 cột từ md (640–767px vẫn là khổ điện thoại), 5 cột từ lg, 6 cột từ xl.
 * Trang danh mục có cột lọc bên trái nên bớt một cột để thẻ không hẹp lại.
 */
export const GRID_PRODUCTS = 'grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5 xl:grid-cols-6';
export const GRID_PRODUCTS_WITH_FILTER = 'grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4 xl:grid-cols-5';
