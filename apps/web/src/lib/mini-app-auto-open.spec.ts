import { describe, expect, it } from 'vitest';
import {
  AUTO_OPEN_COOKIE_MAX_AGE_S,
  AUTO_OPEN_DELAY_MS,
  MINI_AUTO_COOKIE,
  STAY_LINK_HIDE_MS,
  STAY_WEB_COOKIE,
  SUPPRESSED_CHECK_MS,
  decideMiniAppAutoOpen,
  hasCookie,
  hasStayWebParam,
  isBotUserAgent,
  isExcludedPath,
  isMobileUserAgent,
  isPrimaryWebHost,
  miniAppDeepLink,
  searchWithoutStay,
  shouldAutoOpenMiniApp,
  type AutoOpenContext,
} from './mini-app-auto-open';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const ZALO_INAPP = 'Mozilla/5.0 (Linux; Android 13; RMX3511) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Zalo android/12100';
const DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const GOOGLEBOT_MOBILE =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const base: AutoOpenContext = {
  flagOn: true,
  hostname: 'tubutree.com',
  siteHost: 'tubutree.com',
  userAgent: IPHONE_SAFARI,
  webdriver: false,
  narrowViewport: true,
  pathname: '/',
  search: '',
  cookies: '',
};
const ctx = (over: Partial<AutoOpenContext> = {}): AutoOpenContext => ({ ...base, ...over });
const AUTO = { autoOpen: true, banner: false };
const BANNER = { autoOpen: false, banner: true };
const NONE = { autoOpen: false, banner: false };

describe('decideMiniAppAutoOpen — bảng quyết định', () => {
  it('điện thoại, host chính, lần đầu trong 24 giờ: tự mở, không dải', () => {
    expect(decideMiniAppAutoOpen(ctx())).toEqual(AUTO);
    expect(decideMiniAppAutoOpen(ctx({ userAgent: ANDROID_CHROME, pathname: '/san-pham/nuoc-rua-chen' }))).toEqual(AUTO);
    expect(decideMiniAppAutoOpen(ctx({ userAgent: ZALO_INAPP, hostname: 'www.tubutree.com' }))).toEqual(AUTO);
    expect(shouldAutoOpenMiniApp(ctx())).toBe(true);
  });

  it('cờ tắt (mặc định, hay API cũ chưa trả cờ): không gì cả', () => {
    expect(decideMiniAppAutoOpen(ctx({ flagOn: false }))).toEqual(NONE);
  });

  it('máy dò, công cụ xem trước link và đo tốc độ: không bao giờ chuyển, không dải', () => {
    for (const ua of [
      GOOGLEBOT_MOBILE,
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'Zalo-Link-Preview/1.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile coccocbot-web/1.0',
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Mobile Safari/537.36',
    ]) {
      expect(decideMiniAppAutoOpen(ctx({ userAgent: ua })), ua).toEqual(NONE);
    }
  });

  it('máy tính hay khung nhìn rộng (> 767px): không gì cả', () => {
    expect(decideMiniAppAutoOpen(ctx({ userAgent: DESKTOP_CHROME }))).toEqual(NONE);
    expect(decideMiniAppAutoOpen(ctx({ narrowViewport: false }))).toEqual(NONE);
    expect(decideMiniAppAutoOpen(ctx({ userAgent: DESKTOP_CHROME, narrowViewport: true }))).toEqual(NONE);
  });

  it('host không phải host chính (gian hàng CTV, host lạ): không gì cả', () => {
    expect(decideMiniAppAutoOpen(ctx({ hostname: 'minh.tubutree.com', siteHost: 'tubutree.com' }))).toEqual(NONE);
    expect(decideMiniAppAutoOpen(ctx({ hostname: 'evil.example', siteHost: null }))).toEqual(NONE);
    expect(decideMiniAppAutoOpen(ctx({ hostname: 'app.tubutree.com', siteHost: 'app.tubutree.com' }))).toEqual(AUTO);
  });

  it.each([
    '/admin',
    '/admin/don-hang',
    '/merchant',
    '/nhan-vien/bang-luong',
    '/chu-thuong-hieu',
    '/dang-nhap',
    '/dang-nhap/zalo/callback',
    '/thanh-toan',
    '/thanh-toan/chuyen-khoan/TB123',
    '/gio-hang',
    '/don/TB8495',
    '/moi/ABC123',
    '/khoi-phuc/xac-minh',
    '/hub-san-pham',
    '/ds-gallery',
    '/api/health',
    '/auth/callback',
    '/payment/return',
    '/checkout/return',
    '/ctv/gian-hang',
    '/dai-ly',
    '/doi-rac/quay',
    '/GIO-HANG',
    '//thanh-toan',
  ])('trang bị loại %s: không tự mở, không dải', (pathname) => {
    expect(decideMiniAppAutoOpen(ctx({ pathname }))).toEqual(NONE);
    expect(decideMiniAppAutoOpen(ctx({ pathname, webdriver: true }))).toEqual(NONE);
  });

  it('chỉ loại theo ranh giới đoạn: /don-hang-mau, /moi-nhat, /doi-rac, /ctv không bị loại nhầm', () => {
    for (const pathname of ['/don-hang-mau', '/moi-nhat', '/dang-nhapx', '/doi-rac', '/ctv']) {
      expect(isExcludedPath(pathname), pathname).toBe(false);
    }
  });

  it('?stay=web hay cookie ở lại bản Web: không tự mở, không dải', () => {
    expect(decideMiniAppAutoOpen(ctx({ search: '?stay=web' }))).toEqual(NONE);
    expect(decideMiniAppAutoOpen(ctx({ search: '?ref=A1&stay=web' }))).toEqual(NONE);
    expect(decideMiniAppAutoOpen(ctx({ cookies: `x=1; ${STAY_WEB_COOKIE}=1` }))).toEqual(NONE);
    expect(decideMiniAppAutoOpen(ctx({ cookies: `${STAY_WEB_COOKIE}=1; ${MINI_AUTO_COOKIE}=1`, webdriver: true }))).toEqual(NONE);
  });

  it('đã tự mở trong 24 giờ (cookie đặt trước khi chuyển): chỉ dải mời, không lặp chuyển trang', () => {
    expect(decideMiniAppAutoOpen(ctx({ cookies: `${MINI_AUTO_COOKIE}=1` }))).toEqual(BANNER);
  });

  it('trình duyệt tự động (navigator.webdriver): chỉ dải mời, không chuyển ngầm', () => {
    expect(decideMiniAppAutoOpen(ctx({ webdriver: true }))).toEqual(BANNER);
  });

  it('autoOpen và banner không bao giờ cùng true', () => {
    const variants: Partial<AutoOpenContext>[] = [
      {},
      { webdriver: true },
      { cookies: `${MINI_AUTO_COOKIE}=1` },
      { cookies: `${STAY_WEB_COOKIE}=1` },
      { pathname: '/gio-hang' },
      { flagOn: false },
      { userAgent: DESKTOP_CHROME },
    ];
    for (const v of variants) {
      const d = decideMiniAppAutoOpen(ctx(v));
      expect(d.autoOpen && d.banner, JSON.stringify(v)).toBe(false);
    }
  });
});

describe('hàm phụ', () => {
  it('cookie 24 giờ, lối ở lại ẩn sau ~4,5 giây', () => {
    expect(AUTO_OPEN_COOKIE_MAX_AGE_S).toBe(86_400);
    expect(STAY_LINK_HIDE_MS).toBeGreaterThanOrEqual(4000);
    expect(STAY_LINK_HIDE_MS).toBeLessThanOrEqual(5000);
    // Lớp phủ (và lối ở lại) sống đến đúng lúc lối ở lại ẩn, không tắt sớm sau lượt chuyển.
    expect(AUTO_OPEN_DELAY_MS + SUPPRESSED_CHECK_MS).toBe(STAY_LINK_HIDE_MS);
  });

  it('hasCookie chỉ nhận đúng tên và giá trị 1', () => {
    expect(hasCookie(`a=1; ${MINI_AUTO_COOKIE}=1`, MINI_AUTO_COOKIE)).toBe(true);
    expect(hasCookie(`${MINI_AUTO_COOKIE}=0`, MINI_AUTO_COOKIE)).toBe(false);
    expect(hasCookie(`x${MINI_AUTO_COOKIE}=1`, MINI_AUTO_COOKIE)).toBe(false);
    expect(hasCookie('', MINI_AUTO_COOKIE)).toBe(false);
  });

  it('stay=web: nhận đúng giá trị web, xoá tham số mà giữ phần còn lại', () => {
    expect(hasStayWebParam('?stay=web')).toBe(true);
    expect(hasStayWebParam('?stay=mini')).toBe(false);
    expect(searchWithoutStay('?stay=web')).toBe('');
    expect(searchWithoutStay('?ref=A1&stay=web&utm_source=fb')).toBe('?ref=A1&utm_source=fb');
  });

  it('UA: điện thoại và máy dò', () => {
    expect(isMobileUserAgent(IPHONE_SAFARI)).toBe(true);
    expect(isMobileUserAgent(ANDROID_CHROME)).toBe(true);
    expect(isMobileUserAgent(DESKTOP_CHROME)).toBe(false);
    expect(isMobileUserAgent(GOOGLEBOT_MOBILE)).toBe(false);
    expect(isBotUserAgent(GOOGLEBOT_MOBILE)).toBe(true);
    expect(isBotUserAgent(ZALO_INAPP)).toBe(false);
  });

  it('host chính: tubutree.com, www, host cấu hình, máy dev', () => {
    expect(isPrimaryWebHost('tubutree.com')).toBe(true);
    expect(isPrimaryWebHost('WWW.tubutree.com')).toBe(true);
    expect(isPrimaryWebHost('localhost')).toBe(true);
    expect(isPrimaryWebHost('app.tubutree.com', 'app.tubutree.com')).toBe(true);
    expect(isPrimaryWebHost('shop-a.tubutree.com', 'tubutree.com')).toBe(false);
  });
});

describe('miniAppDeepLink', () => {
  const HOME = 'https://zalo.me/s/2070857098114207963';

  it('trang có màn Mini App tương ứng: mở đúng màn', () => {
    expect(miniAppDeepLink('/san-pham/nuoc-rua-chen', '')).toBe(`${HOME}/product/nuoc-rua-chen`);
    expect(miniAppDeepLink('/quet-ma', '')).toBe(`${HOME}/points/scan`);
  });

  it('trang chủ hay trang không có màn tương ứng: trang chủ Mini App', () => {
    expect(miniAppDeepLink('/', '')).toBe(`${HOME}/`);
    expect(miniAppDeepLink('/trang-khong-co', '')).toBe(`${HOME}/`);
  });

  it('chỉ mang theo tham số nguồn/giới thiệu, bỏ tham số lạ và stay', () => {
    expect(miniAppDeepLink('/', '?ref=A1&utm_source=fb&token=x&stay=web&q=abc')).toBe(`${HOME}/?ref=A1&utm_source=fb`);
  });
});
