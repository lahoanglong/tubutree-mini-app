/**
 * URL gốc của web, dùng cho metadataBase / robots / sitemap.
 *
 * Thiếu `metadataBase` thì ảnh openGraph khai bằng đường dẫn tương đối không dựng được URL tuyệt
 * đối (Next cảnh báo mỗi lần build, và link chia sẻ mất ảnh).
 *
 * Mặc định app.tubutree.com (Q-20): host đang phục vụ web trên PROD; middleware coi `shop` là
 * subdomain gian hàng CTV nên shop.tubutree.com không dùng được làm gốc.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.tubutree.com').replace(/\/+$/, '');

/** Trang riêng tư/nội bộ — không được để công cụ tìm kiếm lập chỉ mục. */
export const PRIVATE_PATHS = ['/admin', '/merchant', '/tai-khoan', '/gio-hang', '/thanh-toan', '/dang-nhap'];

/**
 * Cổng nội bộ có giao diện riêng — chân trang bán hàng (hotline khách) không hiển thị ở đây.
 * Dùng chung đường dẫn chuẩn với PRIVATE_PATHS để hai danh sách không lệch nhau.
 */
export const PORTAL_PATHS = ['/admin', '/merchant', '/brand'];

export function isPortalPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return PORTAL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
