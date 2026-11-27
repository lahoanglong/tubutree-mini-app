import { miniappPathFor } from './route-map';
import { PORTAL_PATHS } from './site';
import { MD_DOWN } from './breakpoints';
import { MINI_APP_BAR_ATTR } from './mini-app-attr';
import { miniAppLink } from './zalo-mini-app';

/**
 * Web điện thoại tự mở Zalo Mini App (W42, cờ `app.mobile_miniapp_redirect_enabled`, mặc định tắt). Hàm thuần, không đụng DOM: thành phần
 * `components/layout/mini-app-auto-open.tsx` gom ngữ cảnh rồi hỏi ở đây.
 *
 * Luật:
 * - Tự mở tối đa 1 lần mỗi 24 giờ mỗi trình duyệt: cookie `tubu_mini_auto` ghi TRƯỚC khi chuyển trang, đọc lại được mới chuyển (khách không có
 *   Zalo hay bấm Back quay lại thì không bị chuyển lần hai, không lặp vô hạn). Cookie bị chặn thì không tự mở, chỉ còn dải mời.
 * - Khách bấm "Ở lại bản Web", đóng dải mời, hay vào bằng `?stay=web` (link từ chính Mini App): cookie `tubu_stay_web` 24 giờ, không mở, không dải.
 * - Chỉ điện thoại (UA di động VÀ khung nhìn ≤ 767px), chỉ host chính (không phải gian hàng CTV), không bot, không trình duyệt tự động
 *   (`navigator.webdriver`), không ở trang bị loại (quản trị, đăng nhập, thanh toán, giỏ, theo dõi đơn vãng lai, link mời, khôi phục...).
 * - Trình duyệt tự động vẫn thấy dải mời (bấm "Mở" là cử chỉ thật), chỉ không bị chuyển trang ngầm.
 */

export const STAY_WEB_COOKIE = 'tubu_stay_web';
export const MINI_AUTO_COOKIE = 'tubu_mini_auto';
/** 24 giờ. */
export const AUTO_OPEN_COOKIE_MAX_AGE_S = 86_400;
/** Tham số (link từ Mini App sang web) để ở lại bản web 24 giờ. */
export const STAY_WEB_PARAM = 'stay';
export const STAY_WEB_VALUE = 'web';
/** Dưới điểm gãy `md:` của Tailwind (từ 768px là giao diện máy tính bảng/máy tính); cùng truy vấn cổng tải lười ở `app/layout-shell.tsx`. */
export const MOBILE_MEDIA_QUERY = MD_DOWN;

/** Lớp phủ "Đang mở…" hiện bao lâu trước khi chuyển sang Zalo. */
export const AUTO_OPEN_DELAY_MS = 1200;
/**
 * Lớp phủ (cùng lối "Ở lại bản Web") rời đi sau chừng này (PO 26/11 23:13: lối thoát kín đáo, tự ẩn sau 4–5 giây). Lối ở lại bấm được suốt
 * đời lớp phủ, tới lúc lớp phủ bắt đầu mờ.
 */
export const STAY_LINK_HIDE_MS = 4500;
/**
 * Sau khi chuyển mà trang vẫn hiện tới lúc lớp phủ rời đi: coi như hệ điều hành chặn (hoặc khách đang ở hộp hỏi "Mở bằng Zalo?"), đóng lớp phủ
 * và hiện dải mời. Lớp phủ sống đủ 4,5 giây nên lối "Ở lại bản Web" bấm được suốt thời gian đó, không chỉ 1,2 giây trước khi chuyển.
 */
export const SUPPRESSED_CHECK_MS = STAY_LINK_HIDE_MS - AUTO_OPEN_DELAY_MS;
/**
 * Lớp phủ mờ dần chừng này khi rời đi (W44 U1), dải mời đã gắn sẵn bên dưới nên không có khoảng trống nháy. Khớp `transition` của
 * `.tubu-miniapp-opening` ở `components/mini/mini.css`. Máy bật giảm chuyển động thì bỏ bước mờ.
 */
export const OVERLAY_FADE_MS = 300;
export { MINI_APP_BAR_ATTR };

/**
 * Crawler, công cụ xem trước link và đo tốc độ: không bao giờ bị chuyển trang (Google coi chuyển hướng theo UA là cloaking) và không thấy dải mời.
 * "Zalo" trong UA của trình duyệt Zalo là khách thật nên chỉ loại bộ xem trước link của Zalo.
 */
export const BOT_UA_RE =
  /Googlebot|Google-InspectionTool|AdsBot|Mediapartners-Google|bingbot|BingPreview|Slurp|DuckDuckBot|Baiduspider|YandexBot|Applebot|coccocbot|facebookexternalhit|Facebot|meta-externalagent|Twitterbot|LinkedInBot|Bytespider|TikTokSpider|Zalo-?Link-?Preview|Zalo-?Preview|Chrome-Lighthouse|PageSpeed|HeadlessChrome|WhatsApp|TelegramBot|Discordbot|Slackbot|SkypeUriPreview|crawler|spider/i;

const MOBILE_UA_RE = /Android|iPhone|iPod|iPad|Mobile|Mobi|Windows Phone|Opera Mini|IEMobile/i;

/**
 * Trang không bao giờ tự mở và không có dải mời: cổng quản trị/đối tác/nhân sự, đăng nhập (kể cả callback OAuth), thanh toán (kể cả trang chuyển
 * khoản), giỏ (giỏ khách vãng lai không sang được Mini App), theo dõi đơn vãng lai, link mời, khôi phục tài khoản, trang dev và các đường
 * không có trên web nhưng giữ cho chắc (`/api`, `/auth`, `/payment`, `/checkout/return`). Ba trang cổng web của W177 (dựng gian hàng CTV,
 * kênh đại lý có thanh toán sỉ, quầy nhận rác) cũng bị loại: màn Mini App tương ứng chỉ là thẻ "mở trên website", tự mở sẽ dội khách qua lại.
 */
export const EXCLUDED_PREFIXES: readonly string[] = [
  ...PORTAL_PATHS,
  '/nhan-vien',
  '/chu-thuong-hieu',
  '/ctv/gian-hang',
  '/dai-ly',
  '/doi-rac/quay',
  '/dang-nhap',
  '/thanh-toan',
  '/gio-hang',
  '/don',
  '/moi',
  '/khoi-phuc',
  '/hub-san-pham',
  '/ds-gallery',
  '/api',
  '/auth',
  '/payment',
  '/checkout/return',
];

/** Tham số được chuyển sang Mini App (nguồn, giới thiệu, thẻ, tab); mọi tham số khác bị bỏ để không mang dữ liệu lạ sang Zalo. */
export const MINIAPP_KEEP_PARAMS: readonly string[] = ['ref', 'src', 'card', 'l', 'tab', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

const PRIMARY_HOSTS = new Set(['tubutree.com', 'www.tubutree.com']);
/** Máy dev và bộ kiểm e2e chạy trên localhost; không có trên PROD. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Trang vẫn được tự mở (link chia sẻ sản phẩm sang đúng màn Mini App) nhưng không có dải mời: chỉ trang con của các đường này, trang gốc vẫn có dải.
 * `/san-pham/<slug>` (trang sản phẩm, PO 27/11 22:25 A2): nút lùi nổi nằm trên ảnh sản phẩm, dải không chen cạnh nó; `/san-pham` (Danh mục) giữ dải.
 */
export const SMARTBAR_HIDDEN_CHILD_PREFIXES: readonly string[] = ['/san-pham'];

const normalizePath = (pathname: string): string => (pathname.split(/[?#]/)[0] ?? '').replace(/\/{2,}/g, '/').toLowerCase();

export function isExcludedPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Trang không vẽ dải mời: trang bị loại hẳn, cộng trang con trong `SMARTBAR_HIDDEN_CHILD_PREFIXES` (vẫn tự mở được). */
export function isSmartBarHiddenPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return isExcludedPath(path) || SMARTBAR_HIDDEN_CHILD_PREFIXES.some((p) => path.startsWith(`${p}/`));
}

export function isBotUserAgent(ua: string): boolean {
  return BOT_UA_RE.test(ua);
}

export function isMobileUserAgent(ua: string): boolean {
  return MOBILE_UA_RE.test(ua) && !isBotUserAgent(ua);
}

/** Host chính của web: tubutree.com, www.tubutree.com, host của `NEXT_PUBLIC_SITE_URL` hoặc máy dev. Subdomain gian hàng CTV thì không. */
export function isPrimaryWebHost(hostname: string, siteHost?: string | null): boolean {
  const h = hostname.toLowerCase();
  return PRIMARY_HOSTS.has(h) || LOCAL_HOSTS.has(h) || (!!siteHost && h === siteHost.toLowerCase());
}

/** Cookie `name=1` có trong chuỗi `document.cookie`. */
export function hasCookie(cookieString: string, name: string): boolean {
  return cookieString.split(';').some((part) => {
    const [k, v] = part.trim().split('=');
    return k === name && v === '1';
  });
}

/** `?stay=web`: khách tới từ Mini App (hoặc tự chọn) để ở lại bản web. */
export function hasStayWebParam(search: string): boolean {
  return new URLSearchParams(search).get(STAY_WEB_PARAM) === STAY_WEB_VALUE;
}

/** Chuỗi query sau khi bỏ `stay` (rỗng thì không có `?`), để `history.replaceState` xoá tham số khỏi thanh địa chỉ. */
export function searchWithoutStay(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(STAY_WEB_PARAM);
  const q = params.toString();
  return q ? `?${q}` : '';
}

/**
 * Link mở đúng màn Mini App của trang web đang xem (`/san-pham/x` → `/product/x`), trang không có màn tương ứng thì Trang chủ Mini App.
 * Chỉ giữ tham số trong `MINIAPP_KEEP_PARAMS`. Không sửa `miniAppLink()` (nút "Mở trên Zalo" ở đăng nhập vẫn bỏ query).
 */
export function miniAppDeepLink(pathname: string, search: string): string {
  const base = miniAppLink().replace(/\/$/, '');
  const target = miniappPathFor(pathname.split(/[?#]/)[0] || '/') ?? '/';
  const from = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of MINIAPP_KEEP_PARAMS) {
    const value = from.get(key);
    if (value) kept.set(key, value);
  }
  const q = kept.toString();
  return `${base}${target}${q ? `?${q}` : ''}`;
}

export interface AutoOpenContext {
  /** Cờ `mobileMiniappRedirectEnabled` của cấu hình công khai (API cũ chưa trả: false). */
  flagOn: boolean;
  hostname: string;
  /** Host của `NEXT_PUBLIC_SITE_URL`. */
  siteHost?: string | null;
  userAgent: string;
  /** `navigator.webdriver`. */
  webdriver: boolean;
  /** `matchMedia(MOBILE_MEDIA_QUERY).matches`. */
  narrowViewport: boolean;
  pathname: string;
  search: string;
  /** `document.cookie`. */
  cookies: string;
}

export interface AutoOpenDecision {
  /** Chuyển ngầm sang Zalo lần này. */
  autoOpen: boolean;
  /**
   * Phiên này có dải mời "Tubu Tree trên Zalo" ở đầu nội dung (khi không tự mở). Từng trang còn lọc theo `isSmartBarHiddenPath`: vào từ trang sản
   * phẩm thì dải chưa hiện ở đó, sang Trang chủ hay Danh mục mới hiện.
   */
  banner: boolean;
}

const NONE: AutoOpenDecision = { autoOpen: false, banner: false };

/** Bảng quyết định đầy đủ. `autoOpen` và `banner` không bao giờ cùng true. */
export function decideMiniAppAutoOpen(ctx: AutoOpenContext): AutoOpenDecision {
  if (!ctx.flagOn) return NONE;
  if (!isPrimaryWebHost(ctx.hostname, ctx.siteHost)) return NONE;
  if (isBotUserAgent(ctx.userAgent) || !isMobileUserAgent(ctx.userAgent) || !ctx.narrowViewport) return NONE;
  if (isExcludedPath(ctx.pathname)) return NONE;
  if (hasStayWebParam(ctx.search) || hasCookie(ctx.cookies, STAY_WEB_COOKIE)) return NONE;
  if (ctx.webdriver || hasCookie(ctx.cookies, MINI_AUTO_COOKIE)) return { autoOpen: false, banner: true };
  return { autoOpen: true, banner: false };
}

export function shouldAutoOpenMiniApp(ctx: AutoOpenContext): boolean {
  return decideMiniAppAutoOpen(ctx).autoOpen;
}

/**
 * Script chạy ở `<head>` trước khi vẽ (W44 U4, cùng mẫu `offersHintBootScript` ở `lib/site.ts`): đoán trước dải mời sẽ hiện để giữ chỗ, vì dải
 * chỉ biết được sau khi cấu hình công khai về và chunk tải lười nạp xong, không giữ thì dải ~66px chèn vào và đẩy cả trang xuống.
 * Đặt `data-miniapp-bar` trên `<html>` khi đủ cả 5 điều kiện của nhánh "dải mời" trong `decideMiniAppAutoOpen` (trừ cờ, chưa biết lúc này):
 * khung nhìn điện thoại (và UA di động, không bot), đã có cookie `tubu_mini_auto=1` (lần trước đã tự mở), chưa chọn ở lại (`tubu_stay_web`,
 * `?stay=web`), host chính và đường dẫn không bị loại; cộng thêm trang không ẩn dải (`isSmartBarHiddenPath`, vd trang sản phẩm). Đoán sai (cờ tắt, chưa tải được cấu hình) thì `mini-app-auto-open.tsx` gỡ thuộc tính.
 * Hằng số sinh từ cùng nguồn với luật ở trên (JSON), không chép tay.
 */
export function miniAppBarBootScript(siteHost?: string | null): string {
  const hosts = [...PRIMARY_HOSTS, ...LOCAL_HOSTS, ...(siteHost ? [siteHost.toLowerCase()] : [])];
  const j = JSON.stringify;
  return (
    '(function(){try{var w=window,d=document,l=w.location,u=navigator.userAgent||"";' +
    `if(!w.matchMedia||!w.matchMedia(${j(MOBILE_MEDIA_QUERY)}).matches)return;` +
    `if(!new RegExp(${j(MOBILE_UA_RE.source)},"i").test(u)||new RegExp(${j(BOT_UA_RE.source)},"i").test(u))return;` +
    `if(${j(hosts)}.indexOf(l.hostname.toLowerCase())<0)return;` +
    `var p=l.pathname.replace(/\\/{2,}/g,"/").toLowerCase(),x=${j(EXCLUDED_PREFIXES)},y=${j(SMARTBAR_HIDDEN_CHILD_PREFIXES)},i;` +
    'for(i=0;i<x.length;i++)if(p===x[i]||p.indexOf(x[i]+"/")===0)return;' +
    'for(i=0;i<y.length;i++)if(p.indexOf(y[i]+"/")===0)return;' +
    `if(new URLSearchParams(l.search).get(${j(STAY_WEB_PARAM)})===${j(STAY_WEB_VALUE)})return;` +
    'var c={};d.cookie.split(";").forEach(function(s){var k=s.trim().split("=");c[k[0]]=k[1]});' +
    `if(c[${j(STAY_WEB_COOKIE)}]==="1"||c[${j(MINI_AUTO_COOKIE)}]!=="1")return;` +
    `d.documentElement.setAttribute(${j(MINI_APP_BAR_ATTR)},"")}catch(e){}})()`
  );
}

/**
 * Chữ của lớp phủ và dải mời (chỉ web; Mini App không có màn này). Dải kiểu Smart App Banner của iOS (PO 27/11 22:25 A2): tên app một dòng, dòng
 * phụ một dòng, cả hai không bị cắt "…" ở 360px (e2e `mini-app-auto-open.web` đo).
 */
export const MINI_APP_AUTO_OPEN_COPY = {
  opening: 'Đang mở Tubu Tree trên Zalo…',
  stayWeb: 'Ở lại web',
  bannerTitle: 'Tubu Tree trên Zalo',
  bannerSub: 'Mua nhanh · Tích điểm Xanh',
  bannerOpen: 'Mở',
  bannerClose: 'Đóng, ở lại bản Web',
} as const;
