/**
 * Danh mục sản phẩm đã chuyển từ "/" sang /san-pham (00-ma-tran dòng 2). Link cũ "/?q=", "/?category=", "/?brand=" đã được
 * lập chỉ mục và chia sẻ nên chuyển 307 sang trang mới; "/" không kèm các khoá này vẫn là trang chủ.
 * Dùng `has` theo query: Next tự giữ toàn bộ query gốc (kể cả page, utm, ref, s) khi đích không tự ghi query.
 * Là .mjs thuần vì `next.config.mjs` không nạp được TypeScript.
 */
const LEGACY_HOME_KEYS = ['q', 'category', 'brand'];

export function buildCatalogRedirects() {
  return LEGACY_HOME_KEYS.map((key) => ({
    source: '/',
    has: [{ type: 'query', key }],
    destination: '/san-pham',
    permanent: false,
  }));
}
