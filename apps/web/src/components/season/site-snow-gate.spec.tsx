// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ pathname: '/san-pham', seasonalTheme: 'christmas' as string | undefined }));
vi.mock('@/lib/shell-pathname', () => ({ useShellPathname: () => mocks.pathname }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ seasonalTheme: mocks.seasonalTheme, isLoaded: true }) }));

import { SiteSnowGate } from './site-snow-gate';

function setMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const snow = () => document.body.querySelector('[data-testid="christmas-snow"]');
const toggle = () => document.body.querySelector<HTMLButtonElement>('[data-testid="site-snow-toggle"]');

// Lần import() đầu phải dịch mô-đun (lâu hơn vài vòng flush); nạp sẵn để mỗi ca chỉ còn chờ promise đã xong.
beforeAll(async () => {
  await import('./snowfall');
});

beforeEach(() => {
  mocks.pathname = '/san-pham';
  mocks.seasonalTheme = 'christmas';
  localStorage.clear();
  setMatchMedia(false);
});
afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('SiteSnowGate web: tuyết Noel ngoài Trang chủ (tubu-w62-01)', () => {
  it('trang có thanh đáy điện thoại: tuyết gắn vào body, nút ❄️ trên thanh đáy; tắt thì gỡ tuyết và nhớ chung khoá với thẻ Noel', async () => {
    const r = render(<SiteSnowGate />);
    await flush();
    expect(toggle()!.getAttribute('aria-label')).toBe('Tuyết rơi');
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    expect(toggle()!.hasAttribute('data-over-nav')).toBe(true);
    expect(snow()!.parentElement).toBe(document.body);
    click(toggle());
    expect(snow()).toBeNull();
    expect(toggle()!.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('tubu_snow_off')).toBe('1');
    r.unmount();
    const again = render(<SiteSnowGate />);
    await flush();
    expect(toggle()!.getAttribute('aria-pressed')).toBe('false');
    expect(snow()).toBeNull();
    again.unmount();
  });

  it('trang không có thanh đáy (Bộ quà tặng, màn chơi Vườn Xanh): nút ❄️ sát đáy', async () => {
    for (const pathname of ['/bo-qua-tang', '/vuon-xanh/choi']) {
      mocks.pathname = pathname;
      const r = render(<SiteSnowGate />);
      await flush();
      expect(toggle(), pathname).not.toBeNull();
      expect(toggle()!.hasAttribute('data-over-nav'), pathname).toBe(false);
      r.unmount();
    }
  });

  it('Trang chủ (thẻ Noel lo tuyết), trang ngoài danh sách, mùa khác Noel: không vẽ gì', async () => {
    for (const [pathname, theme] of [['/', 'christmas'], ['/thanh-toan', 'christmas'], ['/san-pham', 'none'], ['/san-pham', undefined]] as const) {
      mocks.pathname = pathname;
      mocks.seasonalTheme = theme;
      const r = render(<SiteSnowGate />);
      await flush();
      expect(r.container.innerHTML, `${pathname} ${theme}`).toBe('');
      expect(snow()).toBeNull();
      r.unmount();
    }
  });

  it('máy bật giảm chuyển động: không tuyết, không nút ❄️', async () => {
    setMatchMedia(true);
    const r = render(<SiteSnowGate />);
    await flush();
    expect(toggle()).toBeNull();
    expect(snow()).toBeNull();
    r.unmount();
  });

  it('mã tuyết chỉ vào bằng import() (0 byte trong JS tải đầu); vỏ trang gắn cổng', () => {
    const gate = readFileSync(join(__dirname, 'site-snow-gate.tsx'), 'utf8');
    expect(gate).toContain("import('./snowfall')");
    expect(gate).not.toMatch(/from '\.\/snowfall'/);
    expect(readFileSync(join(__dirname, '../../app/layout-shell.tsx'), 'utf8')).toContain('<SiteSnowGate />');
  });
});
