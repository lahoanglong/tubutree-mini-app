import { privatePrefixes } from './route-map';
import { SYSTEM_SUBDOMAINS, TENANT_ROOT_DOMAIN, tenantSubdomain } from './tenant-subdomain';

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

const BASE_PRIVATE_PATHS = ['/admin', '/merchant', '/tai-khoan', '/gio-hang', '/thanh-toan', '/dang-nhap'];

/**
 * Route công khai trong route map (`private: false`: khách chưa đăng nhập vẫn mở được) nhưng chính trang đánh dấu noindex vì nội dung
 * là của riêng khách (ví mã, điểm). KHÔNG `Disallow` trong robots: Googlebot bị chặn thì không đọc được thẻ meta noindex, URL vẫn có thể
 * lên kết quả tìm kiếm khi có link trỏ tới. Chỉ meta noindex của trang (layout) và việc sitemap không nộp chúng giữ chúng khỏi chỉ mục.
 */
export const NOINDEX_PUBLIC_PATHS = ['/uu-dai', '/ma-giam-gia'];

/** Trang riêng tư/nội bộ — robots chặn cào. Danh sách gốc + tiền tố các route `private` của route map (không gồm NOINDEX_PUBLIC_PATHS). */
export const PRIVATE_PATHS = [
  ...new Set([
    ...BASE_PRIVATE_PATHS,
    ...privatePrefixes().filter((p) => !BASE_PRIVATE_PATHS.some((b) => p === b || p.startsWith(`${b}/`))),
  ]),
];

/**
 * Cổng nội bộ có giao diện riêng — chân trang bán hàng (hotline khách) không hiển thị ở đây.
 * Không có /brand: /brand/[slug] là trang nhãn hàng công khai cho khách, vẫn cần lối liên hệ.
 */
export const PORTAL_PATHS = ['/admin', '/merchant'];

export function isPortalPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return PORTAL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Subdomain gian hàng CTV của một host, hoặc null khi là host gốc/hệ thống/ngoài tên miền gốc. Cùng quy tắc với middleware.ts,
 * nơi `/` trên host này bị rewrite sang /s/{subdomain} (nên ?q= ở trang chủ không tới được).
 */
export function tenantSubdomainOf(host: string | null | undefined): string | null {
  return tenantSubdomain(host ?? '');
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
    "(function(){try{var h=location.host.split(':')[0].toLowerCase(),s=null,r=['localhost'," +
    `${JSON.stringify(TENANT_ROOT_DOMAIN)}],i,x,l;` +
    "for(i=0;i<r.length;i++){x='.'+r[i];if(h.length>x.length&&h.slice(-x.length)===x){l=h.slice(0,-x.length);if(l.indexOf('.')<0)s=l;break}}" +
    `if(s&&${JSON.stringify(SYSTEM_SUBDOMAINS)}.indexOf(s)<0)document.documentElement.setAttribute('data-tenant-host','')` +
    '}catch(e){}})()'
  );
}

/**
 * Script chạy ở <head> trước khi vẽ: máy có cờ phiên (localStorage.tubu_web_session) thì đặt `data-restoring` lên <html>, để khung khu
 * tài khoản (AccountShell) dựng đúng bố cục hai cột ngay khung hình đầu mà HTML server vẫn giống nhau cho mọi người (trang giữ tĩnh/ISR,
 * không đọc cookie). AccountShell gỡ thuộc tính khi biết đã đăng nhập hoặc là khách; clearSessionMarker cũng gỡ.
 */
export function restoringBootScript(): string {
  return "(function(){try{if(localStorage.getItem('tubu_web_session')==='1')document.documentElement.setAttribute('data-restoring','')}catch(e){}})()";
}

/**
 * Script chạy ở <head> trước khi vẽ: máy có "Đã xem gần đây" (localStorage.tubu_recently_viewed có ít nhất một mục hợp lệ) thì đặt
 * `data-has-recent` lên <html>. Trang Danh mục dựng sẵn (ISR) không biết khách đã xem gì, nên CSS giữ chỗ cho dải đó theo thuộc tính này;
 * không giữ thì dải ~250px chèn vào sau hydrate và đẩy "Bán chạy nhất" xuống. Luật "mục hợp lệ" lặp lại `isItem` của lib/recently-viewed.ts.
 */
export function recentlyViewedBootScript(): string {
  return (
    "(function(){try{var a=JSON.parse(localStorage.getItem('tubu_recently_viewed')||'null');" +
    "if(Array.isArray(a)&&a.some(function(x){return x&&typeof x==='object'&&typeof x.slug==='string'&&x.slug!==''&&typeof x.name==='string'&&" +
    "(x.thumbnail===null||typeof x.thumbnail==='string')&&typeof x.viewedAt==='number'&&isFinite(x.viewedAt)}))" +
    "document.documentElement.setAttribute('data-has-recent','')}catch(e){}})()"
  );
}

/**
 * Script chạy ở <head> trước khi vẽ: đọc cỡ chữ khách chọn ở Cài đặt (localStorage.tubu_prefs, cùng khoá với account/font-scale.ts) và đặt
 * font-size gốc + `data-font-scale` lên <html> ngay khung hình đầu. Chờ effect sau hydrate thì mọi trang dựng lại một lần với khách chọn cỡ nhỏ/lớn.
 * Dùng phần trăm (không px) để không đè cỡ chữ mặc định của trình duyệt (WCAG 1.4.4); ở 16px kết quả y hệt 15/16/18px.
 */
export function fontScaleBootScript(): string {
  return (
    "(function(){try{var p=JSON.parse(localStorage.getItem('tubu_prefs')||'null'),m={small:'93.75%',normal:'100%',large:'112.5%'},s=p&&p.fontScale;" +
    "if(typeof s==='string'&&Object.prototype.hasOwnProperty.call(m,s)){var e=document.documentElement;e.style.fontSize=m[s];e.setAttribute('data-font-scale',s)}}catch(e){}})()"
  );
}

/**
 * Script chạy ở <head> trước khi vẽ: máy còn nhớ lần trước khách có mã giảm giá dùng được (localStorage.tubu_offers_hint = '1', do `PdpCoupons` ghi) thì đặt
 * `data-has-offers`. Trang sản phẩm dựng sẵn không biết khách có mã hay không; chỗ giữ 44px cho hàng "Ưu đãi" chỉ nên hiện khi khách đang khôi phục phiên VÀ
 * thường có mã, vì giữ chỗ cho khách không có mã rồi gỡ đi cũng là một lần xê dịch.
 */
export function offersHintBootScript(): string {
  return "(function(){try{if(localStorage.getItem('tubu_offers_hint')==='1')document.documentElement.setAttribute('data-has-offers','')}catch(e){}})()";
}
