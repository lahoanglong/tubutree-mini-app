// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import {
  AUTO_OPEN_DELAY_MS,
  MINI_APP_AUTO_OPEN_COPY as COPY,
  MINI_AUTO_COOKIE,
  STAY_LINK_HIDE_MS,
  STAY_WEB_COOKIE,
  SUPPRESSED_CHECK_MS,
} from '@/lib/mini-app-auto-open';

const mocks = vi.hoisted(() => ({
  cfg: { isLoaded: true, mobileMiniappRedirectEnabled: true } as Record<string, unknown>,
  pathname: '/',
  track: vi.fn(),
  assign: vi.fn(),
  cookieAtAssign: '' as string,
}));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/lib/shell-pathname', () => ({ useShellPathname: () => mocks.pathname }));
vi.mock('@/lib/analytics', () => ({ routeTemplate: (p: string) => p, trackOncePerSession: (...a: unknown[]) => mocks.track(...a) }));

import { MiniAppAutoOpen } from './mini-app-auto-open';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const DEEP_LINK = 'https://zalo.me/s/2070857098114207963/';

let mounted: Rendered | null = null;
const mount = (search = '') => {
  vi.stubGlobal('location', {
    href: `http://localhost:3000${mocks.pathname}${search}`,
    origin: 'http://localhost:3000',
    protocol: 'http:',
    host: 'localhost:3000',
    hostname: 'localhost',
    pathname: mocks.pathname,
    search,
    hash: '',
    assign: mocks.assign,
    replace: vi.fn(),
    reload: vi.fn(),
  });
  mounted = render(<MiniAppAutoOpen />);
  return mounted.container;
};
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const overlay = (c: HTMLElement) => c.querySelector('[data-testid="miniapp-opening"]');
const banner = (c: HTMLElement) => c.querySelector('[data-testid="miniapp-smartbar"]');
const stayLink = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.tubu-miniapp-stay');
const cookie = (name: string) => document.cookie.split('; ').includes(`${name}=1`);
const tracked = () => mocks.track.mock.calls.map((c) => (c[2] as { result?: string; action?: string }).result ?? (c[2] as { action?: string }).action);
const setWebdriver = (v: boolean) => Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => v });
const setVisibility = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });

beforeEach(() => {
  vi.useFakeTimers();
  mocks.cfg = { isLoaded: true, mobileMiniappRedirectEnabled: true };
  mocks.pathname = '/';
  mocks.track.mockReset();
  mocks.assign.mockReset();
  mocks.assign.mockImplementation(() => {
    mocks.cookieAtAssign = document.cookie;
  });
  mocks.cookieAtAssign = '';
  for (const name of [MINI_AUTO_COOKIE, STAY_WEB_COOKIE]) document.cookie = `${name}=; Path=/; Max-Age=0`;
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => IPHONE });
  setWebdriver(false);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  setVisibility('visible');
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MiniAppAutoOpen — tự mở Mini App trên web điện thoại (W42)', () => {
  it('cờ tắt hay chưa xác nhận: không vẽ gì, không cookie, không chuyển trang', () => {
    for (const cfg of [{ isLoaded: true, mobileMiniappRedirectEnabled: false }, { isLoaded: false, mobileMiniappRedirectEnabled: true }, { isLoaded: true }]) {
      mocks.cfg = cfg;
      const c = mount();
      advance(10_000);
      expect(c.innerHTML, JSON.stringify(cfg)).toBe('');
      mounted!.unmount();
      mounted = null;
    }
    expect(cookie(MINI_AUTO_COOKIE)).toBe(false);
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('đủ điều kiện: ghi tubu_mini_auto TRƯỚC khi chuyển, lớp phủ có lối "Ở lại bản Web" dạng chữ, rồi mở đúng link Mini App', () => {
    const c = mount();
    expect(overlay(c)).not.toBeNull();
    expect(cookie(MINI_AUTO_COOKIE)).toBe(true);
    const stay = stayLink(c)!;
    expect(stay.textContent).toBe(COPY.stayWeb);
    expect(stay.getAttribute('data-hidden')).toBeNull();
    expect(c.querySelector('[role="status"]')?.textContent).toBe(COPY.opening);
    advance(AUTO_OPEN_DELAY_MS - 1);
    expect(mocks.assign).not.toHaveBeenCalled();
    advance(1);
    expect(mocks.assign).toHaveBeenCalledWith(DEEP_LINK);
    expect(mocks.cookieAtAssign).toContain(`${MINI_AUTO_COOKIE}=1`);
    expect(tracked()).toEqual(['navigated']);
  });

  it('bấm "Ở lại bản Web" trước khi chuyển: ghi tubu_stay_web, đóng lớp phủ, không bao giờ chuyển trang', () => {
    const c = mount();
    click(stayLink(c));
    expect(overlay(c)).toBeNull();
    expect(banner(c)).toBeNull();
    expect(cookie(STAY_WEB_COOKIE)).toBe(true);
    advance(10_000);
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(tracked()).toEqual(['stayed']);
  });

  it('sau lượt chuyển mà trang còn hiện (hộp hỏi mở app): lối "Ở lại bản Web" vẫn bấm được tới giây 4,5, bấm thì ở lại, không chuyển lần nữa', () => {
    const c = mount();
    advance(AUTO_OPEN_DELAY_MS + 1500);
    expect(mocks.assign).toHaveBeenCalledTimes(1);
    expect(overlay(c)).not.toBeNull();
    click(stayLink(c));
    expect(overlay(c)).toBeNull();
    expect(banner(c)).toBeNull();
    expect(cookie(STAY_WEB_COOKIE)).toBe(true);
    advance(10_000);
    expect(mocks.assign).toHaveBeenCalledTimes(1);
    expect(tracked()).toEqual(['navigated', 'stayed']);
  });

  it('React StrictMode (gỡ rồi chạy lại hiệu ứng): không kẹt lớp phủ; lượt sau thấy cookie tự mở nên chỉ hiện dải mời', async () => {
    const { StrictMode } = await import('react');
    vi.stubGlobal('location', { href: 'http://localhost:3000/', origin: 'http://localhost:3000', protocol: 'http:', host: 'localhost:3000', hostname: 'localhost', pathname: '/', search: '', hash: '', assign: mocks.assign, replace: vi.fn(), reload: vi.fn() });
    mounted = render(
      <StrictMode>
        <MiniAppAutoOpen />
      </StrictMode>,
    );
    const c = mounted.container;
    advance(10_000);
    expect(overlay(c)).toBeNull();
    expect(banner(c)).not.toBeNull();
  });

  it('lối "Ở lại bản Web" tự ẩn sau ~4,5 giây khi lớp phủ còn (đã sang Zalo); quay lại thì đóng lớp phủ, hiện dải mời', () => {
    const c = mount();
    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(STAY_LINK_HIDE_MS);
    const stay = stayLink(c)!;
    expect(stay.getAttribute('data-hidden')).toBe('true');
    expect(stay.getAttribute('aria-hidden')).toBe('true');
    expect(stay.tabIndex).toBe(-1);
    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(overlay(c)).toBeNull();
    expect(banner(c)).not.toBeNull();
  });

  it('chuyển rồi mà trang vẫn hiện sau 2 giây (hệ điều hành chặn): đóng lớp phủ, hiện dải mời trong luồng', () => {
    const c = mount();
    advance(AUTO_OPEN_DELAY_MS + SUPPRESSED_CHECK_MS);
    expect(overlay(c)).toBeNull();
    const bar = banner(c)!;
    expect(bar.tagName).toBe('SECTION');
    expect(bar.textContent).toContain(COPY.bannerTitle);
    expect(tracked()).toEqual(['navigated', 'suppressed']);
  });

  it('dải mời: "Mở" mở link Mini App bằng cử chỉ của khách; × ghi tubu_stay_web và ẩn dải', () => {
    const c = mount();
    advance(AUTO_OPEN_DELAY_MS + SUPPRESSED_CHECK_MS);
    mocks.assign.mockClear();
    click(Array.from(banner(c)!.querySelectorAll('button')).find((b) => b.textContent === COPY.bannerOpen) ?? null);
    expect(mocks.assign).toHaveBeenCalledWith(DEEP_LINK);
    click(banner(c)!.querySelector(`button[aria-label="${COPY.bannerClose}"]`));
    expect(banner(c)).toBeNull();
    expect(cookie(STAY_WEB_COOKIE)).toBe(true);
    expect(tracked()).toEqual(['navigated', 'suppressed', 'open', 'dismiss']);
  });

  it('?stay=web: ghi tubu_stay_web, xoá tham số khỏi thanh địa chỉ, không lớp phủ, không dải', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const c = mount('?ref=A1&stay=web');
    advance(10_000);
    expect(c.innerHTML).toBe('');
    expect(cookie(STAY_WEB_COOKIE)).toBe(true);
    expect(cookie(MINI_AUTO_COOKIE)).toBe(false);
    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/?ref=A1');
    expect(mocks.assign).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it('trình duyệt tự động (webdriver): chỉ dải mời, không cookie tự mở, không chuyển', () => {
    setWebdriver(true);
    const c = mount();
    advance(10_000);
    expect(overlay(c)).toBeNull();
    expect(banner(c)).not.toBeNull();
    expect(cookie(MINI_AUTO_COOKIE)).toBe(false);
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('trang bị loại (giỏ hàng): không lớp phủ, không dải', () => {
    mocks.pathname = '/gio-hang';
    const c = mount();
    advance(10_000);
    expect(c.innerHTML).toBe('');
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('trình duyệt chặn cookie: không tự mở (tránh chuyển lặp mỗi lần vào), chỉ dải mời', () => {
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => {} });
    try {
      const c = mount();
      advance(10_000);
      expect(overlay(c)).toBeNull();
      expect(banner(c)).not.toBeNull();
      expect(mocks.assign).not.toHaveBeenCalled();
      expect(tracked()).toEqual(['blocked_cookie']);
    } finally {
      delete (document as unknown as Record<string, unknown>).cookie;
    }
  });

  it('CSS: lối ở lại là chữ nhỏ màu phụ (không nền, không viền), mờ dần rồi ẩn; tôn trọng prefers-reduced-motion; dải mời không nổi đè', () => {
    const css = readFileSync(path.join(__dirname, '../mini/mini.css'), 'utf8');
    const stay = /\.tubu-miniapp-stay\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(stay).toMatch(/background:\s*transparent/);
    expect(stay).toMatch(/border:\s*none/);
    expect(stay).toMatch(/color:\s*var\(--color-text-tertiary\)/);
    expect(stay).toMatch(/text-decoration:\s*underline/);
    expect(stay).toMatch(/transition:\s*opacity/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.tubu-miniapp-stay\s*\{\s*transition:\s*none/);
    const bar = /\.tubu-miniapp-bar\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(bar).not.toMatch(/position:\s*(fixed|sticky|absolute)/);
    expect(css).toMatch(/body\.with-back-btn:has\(\[data-page-bleed\]\) \.tubu-miniapp-bar\s*\{[^}]*margin-left:\s*calc\(12px \+ 44px/);
  });
});
