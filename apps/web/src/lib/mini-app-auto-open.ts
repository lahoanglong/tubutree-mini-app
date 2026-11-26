import { miniappPathFor } from './route-map';
import { PORTAL_PATHS } from './site';
import { MD_DOWN } from './use-media-query';
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
/** Lối "Ở lại bản Web" mờ dần rồi ẩn sau chừng này (PO 26/11 23:13: lối thoát kín đáo, tự ẩn sau 4–5 giây). */
export const STAY_LINK_HIDE_MS = 4500;
/**
 * Sau khi chuyển mà trang vẫn hiện tới lúc lối ở lại ẩn: coi như hệ điều hành chặn (hoặc khách đang ở hộp hỏi "Mở bằng Zalo?"), đóng lớp phủ và
 * hiện dải mời. Lớp phủ sống đủ 4,5 giây nên lối "Ở lại bản Web" bấm được suốt thời gian đó, không chỉ 1,2 giây trước khi chuyển.
 */
export const SUPPRESSED_CHECK_MS = STAY_LINK_HIDE_MS - AUTO_OPEN_DELAY_MS;

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

export function isExcludedPath(pathname: string): boolean {
  const path = (pathname.split(/[?#]/)[0] ?? '').replace(/\/{2,}/g, '/').toLowerCase();
  return EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
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
  /** Hiện dải mời "Mở Tubu Tree trên Zalo" ở đầu nội dung (khi không tự mở). */
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

/** Chữ của lớp phủ và dải mời (chỉ web; Mini App không có màn này). */
export const MINI_APP_AUTO_OPEN_COPY = {
  opening: 'Đang mở Tubu Tree trên Zalo…',
  stayWeb: 'Ở lại bản Web',
  bannerTitle: 'Mở Tubu Tree trên Zalo',
  bannerSub: 'Mua nhanh hơn, tích điểm, nhận báo đơn',
  bannerOpen: 'Mở',
  bannerClose: 'Đóng, ở lại bản Web',
} as const;
