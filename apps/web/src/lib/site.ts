/**
 * URL gốc của web, dùng cho metadataBase / robots / sitemap.
 *
 * Thiếu `metadataBase` thì ảnh openGraph khai bằng đường dẫn tương đối không dựng được URL tuyệt
 * đối (Next cảnh báo mỗi lần build, và link chia sẻ mất ảnh).
 *
 * Mặc định app.tubutree.com (Q-20): host đang phục vụ web trên PROD; middleware coi `shop` là
 * subdomain gian hàng CTV nên shop.tubutree.com không dùng được làm gốc.
 */
// `||` chứ không `??`: ARG/ENV của Dockerfile biến build không truyền arg thành chuỗi rỗng, mà `new URL('')` ném lỗi.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://app.tubutree.com').replace(/\/+$/, '');

/** Trang riêng tư/nội bộ — không được để công cụ tìm kiếm lập chỉ mục. */
export const PRIVATE_PATHS = ['/admin', '/merchant', '/tai-khoan', '/gio-hang', '/thanh-toan', '/dang-nhap'];

/**
 * Cổng nội bộ có giao diện riêng — chân trang bán hàng (hotline khách) không hiển thị ở đây.
 * Không có /brand: /brand/[slug] là trang nhãn hàng công khai cho khách, vẫn cần lối liên hệ.
 */
export const PORTAL_PATHS = ['/admin', '/merchant'];

export function isPortalPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return PORTAL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const SYSTEM_SUBDOMAINS = ['www', 'admin', 'api', 'app', 'mail'];

/**
 * Subdomain gian hàng CTV của một host, hoặc null khi là host gốc/hệ thống. Khớp quy tắc ở
 * middleware.ts, nơi `/` trên host này bị rewrite sang /s/{subdomain} (nên ?q= ở trang chủ không tới được).
 */
export function tenantSubdomainOf(host: string | null | undefined): string | null {
  const hostname = (host ?? '').split(':')[0]!.toLowerCase();
  const parts = hostname.split('.');
  let sub: string | null = null;
  if (hostname.endsWith('.localhost') && parts.length === 2) sub = parts[0]!;
  else if (parts.length >= 3 && !hostname.endsWith('.localhost')) sub = parts[0]!;
  return sub && !SYSTEM_SUBDOMAINS.includes(sub) ? sub : null;
}

/**
 * Mã JS chạy ở <head> trước khi trình duyệt vẽ: gắn `data-tenant-host` lên <html> khi đang ở host gian hàng CTV,
 * để CSS ẩn ô tìm kiếm ngay từ khung hình đầu. Trang dựng sẵn (ISR) có HTML như nhau cho mọi host nên server không
 * biết host nào đang xem; chờ effect sau hydrate mới ẩn thì ô hiện lên rồi biến mất, và không bao giờ ẩn khi JS chưa
 * chạy. Quy tắc nhận host lặp lại `tenantSubdomainOf` (site.spec.ts so hai bên trên cùng bảng host); sai thì chỉ
 * mất việc ẩn sớm, `SiteSearch` vẫn tự gỡ sau hydrate.
 */
export function tenantHostBootScript(): string {
  return (
    "(function(){try{var h=location.host.split(':')[0].toLowerCase(),p=h.split('.'),s=null;" +
    "if(/\\.localhost$/.test(h)){if(p.length===2)s=p[0]}else if(p.length>=3)s=p[0];" +
    `if(s&&${JSON.stringify(SYSTEM_SUBDOMAINS)}.indexOf(s)<0)document.documentElement.setAttribute('data-tenant-host','')` +
    '}catch(e){}})()'
  );
}
