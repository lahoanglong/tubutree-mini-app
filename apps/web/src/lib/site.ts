/**
 * URL gốc của web, dùng cho metadataBase / robots / sitemap.
 *
 * Thiếu `metadataBase` thì ảnh openGraph khai bằng đường dẫn tương đối không dựng được URL tuyệt
 * đối (Next cảnh báo mỗi lần build, và link chia sẻ mất ảnh).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shop.tubutree.com').replace(/\/+$/, '');

/** Trang riêng tư/nội bộ — không được để công cụ tìm kiếm lập chỉ mục. */
export const PRIVATE_PATHS = ['/admin', '/merchant', '/tai-khoan', '/gio-hang', '/thanh-toan', '/dang-nhap'];
