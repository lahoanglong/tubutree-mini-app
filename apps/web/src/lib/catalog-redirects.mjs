/**
 * Danh mục sản phẩm đã chuyển từ "/" sang /san-pham (00-ma-tran dòng 2). Link cũ "/?q=", "/?category=", "/?brand=", "/?page=" đã được
 * lập chỉ mục và chia sẻ nên chuyển 307 sang trang mới; "/" không kèm các khoá này vẫn là trang chủ.
 * Dùng `has` theo query: Next tự giữ toàn bộ query gốc (kể cả page, utm, ref, s) khi đích không tự ghi query.
 * Là .mjs thuần vì `next.config.mjs` không nạp được TypeScript.
 */
const LEGACY_HOME_KEYS = ['q', 'category', 'brand', 'page'];
const SYSTEM_SUBDOMAINS = ['www', 'admin', 'api', 'app', 'mail'];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Host gian hàng CTV (cùng luật với lib/tenant-subdomain.ts: đúng một nhãn dưới gốc hoặc localhost, trừ subdomain hệ thống).
 * Next chạy `redirects()` trước middleware nên phải loại các host này ở đây, nếu không "/?brand=X&ref=ABC" mất gian hàng.
 */
function tenantHostPattern(rootDomain) {
  const roots = ['localhost', rootDomain].map(escapeRegex).join('|');
  return `^(?!(?:${SYSTEM_SUBDOMAINS.join('|')})\\.)[^.]+\\.(?:${roots})$`;
}

export function buildCatalogRedirects(rootDomain = process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/g, '') || 'tubutree.com') {
  return LEGACY_HOME_KEYS.map((key) => ({
    source: '/',
    has: [{ type: 'query', key }],
    missing: [{ type: 'host', value: tenantHostPattern(rootDomain) }],
    destination: '/san-pham',
    permanent: false,
  }));
}
