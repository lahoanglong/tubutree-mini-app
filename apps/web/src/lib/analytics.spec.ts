// @vitest-environment jsdom
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('./client-api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import {
  ANON_ID_KEY,
  BEACON_URL,
  SESSION_IDLE_MS,
  SESSION_KEY,
  WEB_DYNAMIC_ROUTES,
  __resetWebEventsForTest,
  flushWebEvents,
  getAnonymousId,
  getSessionId,
  markCheckoutEntry,
  onPageHide,
  routeTemplate,
  takeCheckoutEntry,
  trackOncePerSession,
  trackPurchase,
  trackScreenView,
  trackWebEvent,
} from './analytics';

type Sent = Array<Record<string, unknown> & { props: Record<string, unknown> }>;
const sentEvents = (): Sent => apiFetch.mock.calls.flatMap((c) => (c[1] as { body: { events: Sent } }).body.events);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setDnt(v: string | null) {
  Object.defineProperty(navigator, 'doNotTrack', { value: v, configurable: true });
}

describe('web analytics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetWebEventsForTest();
    localStorage.clear();
    sessionStorage.clear();
    apiFetch.mockReset().mockResolvedValue({ accepted: 1 });
    document.cookie = 'tubu_ft=; Max-Age=0; Path=/';
    setDnt(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('khách chưa đăng nhập vẫn gửi: gom 5 giây rồi POST /events/web một lô, có platform web, eventId, anonymousId, sessionId', async () => {
    trackPurchase('pdp_action', { action: 'add_to_cart', productSlug: 'a' });
    expect(apiFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = apiFetch.mock.calls[0] as [string, { method: string }];
    expect(path).toBe('/events/web');
    expect(opts.method).toBe('POST');
    const [ev] = sentEvents();
    expect(ev).toMatchObject({ eventName: 'pdp_action', platform: 'web', props: { action: 'add_to_cart', productSlug: 'a' } });
    expect(ev!.eventId).toMatch(UUID);
    expect(ev!.anonymousId).toMatch(UUID);
    expect(ev!.sessionId).toMatch(UUID);
  });

  it('đủ 20 sự kiện thì gửi ngay một lô 20, không đợi 5 giây', async () => {
    for (let i = 0; i < 20; i++) trackWebEvent('home_block_viewed', { block: `b${i}` });
    await vi.advanceTimersByTimeAsync(0);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(sentEvents()).toHaveLength(20);
  });

  it('API lỗi: không ném, bỏ lô đó, không gửi lại', async () => {
    apiFetch.mockRejectedValueOnce(new Error('network'));
    trackWebEvent('home_block_viewed', { block: 'flash' });
    await expect(flushWebEvents()).resolves.toBeUndefined();
    await flushWebEvents();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('anonymousId bền qua tải lại (localStorage), không đổi giữa các lần gọi', () => {
    const a = getAnonymousId();
    expect(a).toMatch(UUID);
    expect(localStorage.getItem(ANON_ID_KEY)).toBe(a);
    __resetWebEventsForTest();
    expect(getAnonymousId()).toBe(a);
  });

  it('localStorage/sessionStorage ném lỗi (chế độ riêng tư): không ném, vẫn có mã ổn định trong trang', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const a = getAnonymousId();
    expect(a).toMatch(UUID);
    expect(getAnonymousId()).toBe(a);
    const s = getSessionId();
    expect(getSessionId()).toBe(s);
    expect(() => trackOncePerSession('home:flash', 'home_block_viewed', { block: 'flash' })).not.toThrow();
    expect(() => markCheckoutEntry('cart')).not.toThrow();
    expect(takeCheckoutEntry()).toBe('unknown');
    trackPurchase('cart_viewed', { itemCount: 1, subtotalBucket: '0-99k' });
    await flushWebEvents();
    expect(sentEvents().map((e) => e.eventName)).toEqual(['home_block_viewed', 'cart_viewed']);
  });

  it('sessionId giữ nguyên khi còn thao tác, đổi mã sau 30 phút không có sự kiện', () => {
    const t0 = 1_763_300_000_000;
    const s1 = getSessionId(t0);
    expect(getSessionId(t0 + SESSION_IDLE_MS - 1)).toBe(s1);
    expect(getSessionId(t0 + 2 * SESSION_IDLE_MS - 2)).toBe(s1);
    const s2 = getSessionId(t0 + 3 * SESSION_IDLE_MS);
    expect(s2).not.toBe(s1);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual({ id: s2, at: t0 + 3 * SESSION_IDLE_MS });
  });

  it('Do Not Track bật: không xếp hàng, không gửi gì', async () => {
    setDnt('1');
    trackPurchase('pdp_action', { action: 'share', productSlug: 'a' });
    trackScreenView('/');
    trackOncePerSession('home:x', 'home_block_viewed', { block: 'x' });
    await vi.advanceTimersByTimeAsync(10_000);
    await flushWebEvents();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('trang xem trước MSS (/san-pham/_preview...): không xếp hàng, không gửi gì, kể cả screen_viewed của layout gốc', async () => {
    for (const path of ['/san-pham/_preview?token=x&frame=miniapp', '/san-pham/_preview/nuoc-rua-chen?token=x']) {
      window.history.replaceState(null, '', path);
      trackScreenView(window.location.pathname);
      trackPurchase('pdp_action', { action: 'share', productSlug: 'a' });
      trackOncePerSession(`home:${path}`, 'home_block_viewed', { block: 'x' });
    }
    await vi.advanceTimersByTimeAsync(10_000);
    await flushWebEvents();
    expect(apiFetch).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/san-pham/_previewx');
    trackScreenView(window.location.pathname);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentEvents().map((e) => e.eventName)).toEqual(['screen_viewed']);
    window.history.replaceState(null, '', '/');
  });

  it('trackOncePerSession: một lần mỗi khoá mỗi phiên, kể cả sau tải lại trang', async () => {
    trackOncePerSession('home:flash', 'home_block_viewed', { block: 'flash' });
    trackOncePerSession('home:flash', 'home_block_viewed', { block: 'flash' });
    await flushWebEvents();
    __resetWebEventsForTest();
    trackOncePerSession('home:flash', 'home_block_viewed', { block: 'flash' });
    trackOncePerSession('home:stories', 'home_block_viewed', { block: 'stories' });
    await flushWebEvents();
    expect(sentEvents().map((e) => e.props.block)).toEqual(['flash', 'stories']);
  });

  it('screen_viewed: mẫu route, referrer là route trước; cùng đường dẫn gọi lặp (render lại) không phát thêm', async () => {
    trackScreenView('/');
    trackScreenView('/');
    trackScreenView('/san-pham/nuoc-rua-chen-fuwa3e-3-8l-ef3979');
    trackScreenView('/tai-khoan/don-hang/TT2511ABC');
    await flushWebEvents();
    expect(sentEvents().map((e) => e.props)).toEqual([
      { route: '/', referrerRoute: null },
      { route: '/san-pham/:slug', referrerRoute: '/' },
      { route: '/tai-khoan/don-hang/:code', referrerRoute: '/san-pham/:slug' },
    ]);
  });

  it('markCheckoutEntry / takeCheckoutEntry: lấy một lần rồi xoá; giá trị lạ thành unknown', () => {
    markCheckoutEntry('cart_subset');
    expect(takeCheckoutEntry()).toBe('cart_subset');
    expect(takeCheckoutEntry()).toBe('unknown');
    sessionStorage.setItem('tubu_ck_entry', 'hack');
    expect(takeCheckoutEntry()).toBe('unknown');
  });

  it('pagehide: chạy hook đăng ký trước (checkout_abandoned) rồi gửi cả hàng đợi bằng sendBeacon dạng form payload=<json>', () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    trackPurchase('checkout_started', { entry: 'cart', itemCount: 2 });
    const off = onPageHide(() => trackPurchase('checkout_abandoned', { lastStep: 'started' }));
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as unknown as [string, URLSearchParams];
    expect(url).toBe(BEACON_URL);
    expect(body).toBeInstanceOf(URLSearchParams);
    const events = (JSON.parse(body.get('payload')!) as { events: Sent }).events;
    expect(events.map((e) => e.eventName)).toEqual(['checkout_started', 'checkout_abandoned']);
    expect(apiFetch).not.toHaveBeenCalled();
    off();
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('trang ẩn, beacon bị từ chối: lùi về fetch keepalive không preflight (no-cors, không cookie), từng lô tối đa 20', () => {
    const beacon = vi.fn(() => false);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    for (let i = 0; i < 19; i++) trackWebEvent('home_block_viewed', { block: `b${i}` });
    onPageHide(() => {
      for (let i = 0; i < 6; i++) trackWebEvent('home_block_viewed', { block: `c${i}` });
    });
    window.dispatchEvent(new Event('pagehide'));
    const sizes = fetchSpy.mock.calls.map((c) => (JSON.parse((c[1] as { body: URLSearchParams }).body.get('payload')!) as { events: Sent }).events.length);
    expect(sizes.reduce((a, b) => a + b, 0) + sentEvents().length).toBe(25);
    expect(sizes.every((n) => n <= 20)).toBe(true);
    expect(fetchSpy.mock.calls[0]![0]).toBe(BEACON_URL);
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', mode: 'no-cors' });
  });

  it('gắn entrySource/campaign từ cookie chạm đầu', async () => {
    document.cookie = `tubu_ft=${encodeURIComponent(JSON.stringify({ source: 'oa', campaign: 'thang11' }))}; Path=/`;
    trackWebEvent('recycle_funnel_step', { step: 'enter', surface: 'web' });
    await flushWebEvents();
    expect(sentEvents()[0]).toMatchObject({ entrySource: 'oa', campaign: 'thang11' });
  });
});

describe('routeTemplate', () => {
  it.each([
    ['/', '/'],
    ['/san-pham', '/san-pham'],
    ['/san-pham/', '/san-pham'],
    ['/san-pham/nuoc-rua-chen-x?utm_source=fb#top', '/san-pham/:slug'],
    ['/doi-rac/yeu-cau/abc/sua', '/doi-rac/yeu-cau/:id/sua'],
    ['/thanh-toan/chuyen-khoan/TT123', '/thanh-toan/chuyen-khoan/:code'],
    ['/thanh-toan', '/thanh-toan'],
    ['/wp-content/Uploads/2024/x.PNG', '/wp-content/:x/:x/:x'],
    ['/0912345678', '/:x'],
  ])('%s → %s', (path, want) => expect(routeTemplate(path)).toBe(want));

  it('WEB_DYNAMIC_ROUTES khai đủ mọi route động có page.tsx trong src/app', () => {
    const appDir = join(__dirname, '..', 'app');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === 'page.tsx') {
          // Thư mục `%5Fpreview` là đường `/_preview` (Next mã hoá `_` để thư mục không thành thư mục riêng tư).
          const route = '/' + relative(appDir, dir).split(sep).filter((s) => !/^\(.*\)$/.test(s)).map(decodeURIComponent).join('/');
          if (route.includes('[')) found.push(route.replace(/\[\.{0,3}([^\]]+)\]/g, ':$1'));
        }
      }
    };
    walk(appDir);
    expect(found.length).toBeGreaterThan(0);
    for (const r of found) expect(WEB_DYNAMIC_ROUTES).toContain(r);
  });
});
