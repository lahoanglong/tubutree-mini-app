// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import {
  AUTO_OPEN_DELAY_MS,
  MINI_APP_AUTO_OPEN_COPY as COPY,
  MINI_APP_BAR_ATTR,
  MINI_AUTO_COOKIE,
  OVERLAY_FADE_MS,
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
  reducedMotion: false,
}));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/lib/shell-pathname', () => ({ useShellPathname: () => mocks.pathname }));
vi.mock('@/lib/analytics', () => ({ routeTemplate: (p: string) => p, trackOncePerSession: (...a: unknown[]) => mocks.track(...a) }));

import { MiniAppAutoOpen } from './mini-app-auto-open';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const DEEP_LINK = 'https://zalo.me/s/2070857098114207963/';

let mounted: Rendered | null = null;
const mount = (search = '', client?: QueryClient) => {
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
  mounted = client ? render(<MiniAppAutoOpen />, client) : render(<MiniAppAutoOpen />);
  return mounted.container;
};
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** Tới lúc lớp phủ rời đi (giây 4,5) rồi qua hết bước mờ. */
const pastFade = () => advance(AUTO_OPEN_DELAY_MS + SUPPRESSED_CHECK_MS + OVERLAY_FADE_MS);
const reserved = () => document.documentElement.hasAttribute(MINI_APP_BAR_ATTR);
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
  mocks.reducedMotion = false;
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduced-motion') ? mocks.reducedMotion : true,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  document.documentElement.removeAttribute(MINI_APP_BAR_ATTR);
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

  it('đủ điều kiện: ghi tubu_mini_auto TRƯỚC khi chuyển, lớp phủ có lối "Ở lại web" dạng chữ, rồi mở đúng link Mini App', () => {
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

  it('bấm "Ở lại web" trước khi chuyển: ghi tubu_stay_web, đóng lớp phủ, không bao giờ chuyển trang', () => {
    const c = mount();
    click(stayLink(c));
    expect(overlay(c)).toBeNull();
    expect(banner(c)).toBeNull();
    expect(cookie(STAY_WEB_COOKIE)).toBe(true);
    advance(10_000);
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(tracked()).toEqual(['stayed']);
  });

  it('sau lượt chuyển mà trang còn hiện (hộp hỏi mở app): lối "Ở lại web" vẫn bấm được tới giây 4,5, bấm thì ở lại, không chuyển lần nữa', () => {
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

  it('đang ở Zalo tới giây 4,5: lớp phủ rời đi (không ghi "bị chặn"), quay lại thì chỉ còn dải mời', () => {
    const c = mount();
    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(STAY_LINK_HIDE_MS);
    expect(overlay(c)?.hasAttribute('data-leaving')).toBe(true);
    advance(OVERLAY_FADE_MS);
    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(overlay(c)).toBeNull();
    expect(banner(c)).not.toBeNull();
    expect(tracked()).toEqual(['navigated']);
  });

  it('quay lại từ Zalo trước giây 4,5: lớp phủ mờ dần rồi nhường chỗ cho dải mời', () => {
    const c = mount();
    advance(AUTO_OPEN_DELAY_MS + 500);
    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(overlay(c)?.hasAttribute('data-leaving')).toBe(true);
    expect(banner(c)).not.toBeNull();
    advance(OVERLAY_FADE_MS);
    expect(overlay(c)).toBeNull();
  });

  it('W44 U1: giây 4,5 lớp phủ mờ dần 300ms (data-leaving, không bấm được), dải mời đã gắn bên dưới, rồi chỉ còn dải', () => {
    const c = mount();
    advance(STAY_LINK_HIDE_MS - 1);
    const stay = stayLink(c)!;
    expect(overlay(c)!.hasAttribute('data-leaving')).toBe(false);
    expect(stay.disabled).toBe(false);
    expect(banner(c)).toBeNull();
    advance(1);
    const leaving = overlay(c)!;
    expect(leaving.hasAttribute('data-leaving')).toBe(true);
    expect(leaving.getAttribute('aria-hidden')).toBe('true');
    expect(stayLink(c)!.disabled).toBe(true);
    expect(stayLink(c)!.tabIndex).toBe(-1);
    expect(banner(c)).not.toBeNull();
    expect(reserved()).toBe(true);
    advance(OVERLAY_FADE_MS - 1);
    expect(overlay(c)).not.toBeNull();
    advance(1);
    expect(overlay(c)).toBeNull();
    expect(banner(c)).not.toBeNull();
    expect(tracked()).toEqual(['navigated', 'suppressed']);
  });

  it('W44 U1: giảm chuyển động thì bỏ bước mờ, lớp phủ rời đi ngay ở giây 4,5', () => {
    mocks.reducedMotion = true;
    const c = mount();
    advance(STAY_LINK_HIDE_MS);
    expect(overlay(c)).toBeNull();
    expect(banner(c)).not.toBeNull();
  });

  it('chuyển rồi mà trang vẫn hiện sau 2 giây (hệ điều hành chặn): đóng lớp phủ, hiện dải mời trong luồng', () => {
    const c = mount();
    pastFade();
    expect(overlay(c)).toBeNull();
    const bar = banner(c)!;
    expect(bar.tagName).toBe('SECTION');
    expect(bar.textContent).toContain(COPY.bannerTitle);
    expect(tracked()).toEqual(['navigated', 'suppressed']);
  });

  it('dải mời: "Mở" mở link Mini App bằng cử chỉ của khách; × ghi tubu_stay_web và ẩn dải', () => {
    const c = mount();
    pastFade();
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

  it('CSS: lối ở lại là chữ nhỏ màu phụ (không nền, không viền); lớp phủ mờ đúng OVERLAY_FADE_MS, tôn trọng prefers-reduced-motion; dải mời không nổi đè', () => {
    const css = readFileSync(path.join(__dirname, '../mini/mini.css'), 'utf8');
    const stay = /\.tubu-miniapp-stay\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(stay).toMatch(/background:\s*transparent/);
    expect(stay).toMatch(/border:\s*none/);
    expect(stay).toMatch(/color:\s*var\(--color-text-tertiary\)/);
    expect(stay).toMatch(/text-decoration:\s*underline/);
    const opening = /\.tubu-miniapp-opening\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(opening).toContain(`transition: opacity ${OVERLAY_FADE_MS}ms`);
    const leaving = /\.tubu-miniapp-opening\[data-leaving\]\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(leaving).toMatch(/opacity:\s*0/);
    expect(leaving).toMatch(/pointer-events:\s*none/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.tubu-miniapp-opening\s*\{\s*transition:\s*none/);
    const bar = /\.tubu-miniapp-bar\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(bar).not.toMatch(/position:\s*(fixed|sticky|absolute)/);
    // W46: bỏ kiểu ép dải sang phải cạnh nút lùi nổi (trang sản phẩm không còn dải; trang tràn viền khác đặt dải dưới hàng nút lùi).
    expect(css).not.toMatch(/with-back-btn:has\(\[data-page-bleed\]\) \.tubu-miniapp-bar/);
    expect(css).not.toMatch(/margin-left:\s*calc\(12px \+ 44px/);
  });

  it('W46: chữ trên dải đạt 4,5:1 cả ở đầu trắng lẫn đầu lục nhạt của nền; × màu phụ và viên thuốc "Mở" đạt 4,5:1 (WCAG 1.4.3)', () => {
    const tokens = readFileSync(path.join(__dirname, '../../../../../packages/design-tokens/src/tokens.css'), 'utf8');
    const hex = (name: string): string => {
      const v = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)![1]!.trim();
      const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
      return ref ? hex(ref[1]!) : v;
    };
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    for (const bg of ['--color-bg-surface', '--forest-50']) {
      expect(ratio('--color-text-primary', bg), `tên app trên ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--color-text-secondary', bg), `dòng phụ 11px trên ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--color-text-tertiary', bg), `× trên ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio('--color-action-primary-fg', '--color-action-primary-bg')).toBeGreaterThanOrEqual(4.5);
  });

  it('CSS W46: dải kiểu Smart App Banner iOS: cao 56px, nền chuyển trắng → lục nhạt, viền lục, đổ bóng cấp 1; × và "Mở" vùng chạm 44px, viên thuốc 32px', () => {
    const css = readFileSync(path.join(__dirname, '../mini/mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()'=]/g, (ch) => `\\${ch}`)}\\s*\\{([^}]*)\\}`).exec(css)![1]!;
    expect(css).toMatch(/--miniapp-bar-h:\s*56px/);
    expect(css).toMatch(/--miniapp-bar-tint:\s*var\(--forest-50\)/);
    expect(css).toMatch(/--miniapp-bar-border:\s*var\(--forest-200\)/);
    const bar = rule('.tubu-miniapp-bar');
    expect(bar).toMatch(/background:\s*linear-gradient\(135deg, var\(--color-bg-surface\) 0%, var\(--miniapp-bar-tint\) 100%\)/);
    expect(bar).toMatch(/border:\s*1px solid var\(--miniapp-bar-border\)/);
    expect(bar).toMatch(/box-shadow:\s*var\(--elevation-1\)/);
    // Đệm dọc 5px + viền 1px hai đầu + vùng chạm 44px = 56px, đúng chiều cao ô giữ chỗ.
    expect(bar).toMatch(/padding:\s*5px 6px 5px 0/);
    const close = rule('.tubu-miniapp-bar__close');
    expect(close).toMatch(/width:\s*44px/);
    expect(close).toMatch(/height:\s*44px/);
    expect(close).toMatch(/background:\s*transparent/);
    expect(close).toMatch(/color:\s*var\(--color-text-tertiary\)/);
    const closeIcon = rule('.tubu-miniapp-bar__close-icon');
    expect(closeIcon).toMatch(/width:\s*24px/);
    expect(closeIcon).toMatch(/height:\s*24px/);
    const open = rule('.tubu-miniapp-bar__open');
    expect(open).toMatch(/min-width:\s*44px/);
    expect(open).toMatch(/height:\s*44px/);
    const pill = rule('.tubu-miniapp-bar__pill');
    expect(pill).toMatch(/height:\s*32px/);
    expect(pill).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(pill).toMatch(/background:\s*var\(--color-action-primary-bg\)/);
    const icon = rule('.tubu-miniapp-icon');
    expect(icon).toMatch(/width:\s*36px/);
    expect(icon).toMatch(/height:\s*36px/);
    expect(icon).toMatch(/border:\s*1px solid var\(--miniapp-bar-border\)/);
    expect(rule('.tubu-miniapp-bar__title')).toMatch(/font-size:\s*var\(--type-caption-size\)/);
    expect(rule('.tubu-miniapp-bar__sub')).toMatch(/font-size:\s*11px/);
    // Nhịp của biểu tượng trên lớp phủ tắt khi khách bật giảm chuyển động.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.tubu-miniapp-icon\[data-size='lg'\]\s*\{\s*animation:\s*none/);
  });

  it('CSS W44 U4: ô giữ chỗ cao đúng khe trên + dải; khe trên nằm ở ô, không phải lề của dải (lề con tràn ra ngoài ô)', () => {
    const css = readFileSync(path.join(__dirname, '../mini/mini.css'), 'utf8');
    // Cộng tại ô: khe của trang tràn viền (khai trên body) phải được đọc ở chính ô, không qua biến đã tính sẵn ở :root.
    expect(css).toMatch(/html\[data-miniapp-bar\] \.tubu-miniapp-slot\s*\{\s*min-height:\s*calc\(var\(--miniapp-bar-gap\) \+ var\(--miniapp-bar-h\)\)/);
    expect(css).toMatch(/\.tubu-miniapp-slot:has\(> \.tubu-miniapp-bar\)\s*\{\s*padding-top:\s*var\(--miniapp-bar-gap\)/);
    // W46: trang tràn viền có nút lùi nổi: dải xuống dưới hàng nút lùi (48px + khe 12px), không chen cạnh nút; biết trước khi vẽ nhờ data-back-bar.
    expect(css).toMatch(/body:has\(\[data-back-bar\]\):has\(\[data-page-bleed\]\)\s*\{\s*--miniapp-bar-gap:\s*calc\(48px \+ var\(--space-inline-md\)\)/);
    expect(css).not.toMatch(/--miniapp-bar-gap:\s*8px/);
    expect(css).not.toMatch(/--miniapp-bar-block/);
    const bar = /\.tubu-miniapp-bar\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(bar).toMatch(/min-height:\s*var\(--miniapp-bar-h\)/);
    expect(bar).toMatch(/margin:\s*0 var\(--space-gutter\)/);
  });
});

describe('MiniAppAutoOpen — chỗ giữ cho dải mời (W44 U4)', () => {
  it('cờ tắt: gỡ chỗ giữ script ở <head> đã đoán và xoá cookie tự mở (lần sau không giữ chỗ nữa)', () => {
    mocks.cfg = { isLoaded: true, mobileMiniappRedirectEnabled: false };
    document.cookie = `${MINI_AUTO_COOKIE}=1; Path=/`;
    document.documentElement.setAttribute(MINI_APP_BAR_ATTR, '');
    mount();
    expect(reserved()).toBe(false);
    expect(cookie(MINI_AUTO_COOKIE)).toBe(false);
  });

  it('không tải được cấu hình: gỡ chỗ giữ, không đụng cookie', () => {
    mocks.cfg = { isLoaded: false, isPending: false };
    document.cookie = `${MINI_AUTO_COOKIE}=1; Path=/`;
    document.documentElement.setAttribute(MINI_APP_BAR_ATTR, '');
    mount();
    expect(reserved()).toBe(false);
    expect(cookie(MINI_AUTO_COOKIE)).toBe(true);
  });

  it('cấu hình đang tải: giữ nguyên chỗ đã đoán', () => {
    mocks.cfg = { isLoaded: false, isPending: true };
    document.documentElement.setAttribute(MINI_APP_BAR_ATTR, '');
    mount();
    expect(reserved()).toBe(true);
  });

  it('cookie tự mở có sẵn: dải hiện ngay, chỗ giữ còn nguyên; × thì gỡ chỗ giữ cùng lúc ẩn dải', () => {
    document.cookie = `${MINI_AUTO_COOKIE}=1; Path=/`;
    document.documentElement.setAttribute(MINI_APP_BAR_ATTR, '');
    const c = mount();
    expect(banner(c)).not.toBeNull();
    expect(reserved()).toBe(true);
    click(banner(c)!.querySelector(`button[aria-label="${COPY.bannerClose}"]`));
    expect(banner(c)).toBeNull();
    expect(reserved()).toBe(false);
  });

  it('đã chọn ở lại (cookie tubu_stay_web) mà script vẫn đoán: gỡ chỗ giữ', () => {
    document.cookie = `${STAY_WEB_COOKIE}=1; Path=/`;
    document.documentElement.setAttribute(MINI_APP_BAR_ATTR, '');
    mount();
    expect(reserved()).toBe(false);
  });

  it('trang bị loại: không dải, gỡ chỗ giữ', () => {
    mocks.pathname = '/thanh-toan';
    document.cookie = `${MINI_AUTO_COOKIE}=1; Path=/`;
    document.documentElement.setAttribute(MINI_APP_BAR_ATTR, '');
    const c = mount();
    expect(banner(c)).toBeNull();
    expect(reserved()).toBe(false);
  });

  it('W46: dải theo thứ tự Smart App Banner iOS: × trái, ô biểu tượng app, "Tubu Tree trên Zalo" + "Mua nhanh · Tích điểm Xanh", viên thuốc "Mở" phải', () => {
    document.cookie = `${MINI_AUTO_COOKIE}=1; Path=/`;
    const c = mount();
    const bar = banner(c)!;
    const kids = Array.from(bar.children);
    expect(kids.map((k) => k.className.split(' ')[0])).toEqual([
      'tubu-miniapp-bar__close',
      'tubu-miniapp-icon',
      'tubu-miniapp-bar__copy',
      'tubu-miniapp-bar__open',
    ]);
    expect(kids[0]!.getAttribute('aria-label')).toBe(COPY.bannerClose);
    expect(kids[1]!.getAttribute('aria-hidden')).toBe('true');
    expect(kids[1]!.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(bar.querySelector('.tubu-miniapp-bar__title')?.textContent).toBe('Tubu Tree trên Zalo');
    expect(bar.querySelector('.tubu-miniapp-bar__sub')?.textContent).toBe('Mua nhanh · Tích điểm Xanh');
    expect(kids[3]!.querySelector('.tubu-miniapp-bar__pill')?.textContent).toBe('Mở');
    expect(bar.getAttribute('aria-label')).toBe('Tubu Tree trên Zalo');
  });

  it('W46 (PO A2): trang sản phẩm: không dải, không giữ chỗ; sang Danh mục thì dải hiện', () => {
    document.cookie = `${MINI_AUTO_COOKIE}=1; Path=/`;
    document.documentElement.setAttribute(MINI_APP_BAR_ATTR, '');
    mocks.pathname = '/san-pham/nuoc-rua-chen';
    const client = new QueryClient();
    mount('', client);
    const c = mounted!.container;
    expect(banner(c)).toBeNull();
    expect(reserved()).toBe(false);
    // Cùng cây (không gắn lại): khách đi tiếp trong phiên, quyết định ở trang đầu giữ nguyên, chỉ đường dẫn đổi.
    mocks.pathname = '/san-pham';
    act(() =>
      mounted!.root.render(
        <QueryClientProvider client={client}>
          <MiniAppAutoOpen />
        </QueryClientProvider>,
      ),
    );
    expect(banner(c)).not.toBeNull();
    expect(reserved()).toBe(true);
  });

  it('W46 (PO A2): vào thẳng trang sản phẩm vẫn tự mở đúng màn sản phẩm Mini App (chỉ dải mời bị ẩn ở trang này)', () => {
    mocks.pathname = '/san-pham/nuoc-rua-chen';
    const c = mount();
    expect(overlay(c)).not.toBeNull();
    advance(AUTO_OPEN_DELAY_MS);
    expect(mocks.assign).toHaveBeenCalledWith(`${DEEP_LINK}product/nuoc-rua-chen`);
    pastFade();
    expect(overlay(c)).toBeNull();
    expect(banner(c)).toBeNull();
  });
});
