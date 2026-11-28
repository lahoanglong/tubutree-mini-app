import { fireEvent, render, screen } from '@testing-library/react';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/browse', seasonalTheme: 'christmas' as string | undefined }));
vi.mock('zmp-ui', () => ({ useLocation: () => ({ pathname: mocks.pathname }) }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ seasonalTheme: mocks.seasonalTheme, isLoaded: true }) }));

import { SRC, readText } from '../../test-support/contrast';
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

// Lần import() đầu phải dịch mô-đun; nạp sẵn để findBy không hết giờ khi máy bận.
beforeAll(async () => {
  await import('./snowfall');
});

beforeEach(() => {
  mocks.pathname = '/browse';
  mocks.seasonalTheme = 'christmas';
  localStorage.clear();
  setMatchMedia(false);
});
afterEach(() => localStorage.clear());

describe('SiteSnowGate: tuyết Noel ngoài Trang chủ (tubu-w62-01)', () => {
  it('trang có thanh đáy: tuyết gắn vào body và nút ❄️ nằm trên thanh đáy; tắt thì gỡ tuyết, nhớ chung khoá với thẻ Noel', async () => {
    const { unmount } = render(<SiteSnowGate />);
    const toggle = await screen.findByTestId('site-snow-toggle');
    expect(toggle).toHaveAccessibleName('Tuyết rơi');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('data-over-nav');
    expect(snow()!.parentElement).toBe(document.body);
    fireEvent.click(toggle);
    expect(snow()).toBeNull();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('tubu_snow_off')).toBe('1');
    unmount();
    render(<SiteSnowGate />);
    expect(await screen.findByTestId('site-snow-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(snow()).toBeNull();
  });

  it('màn chơi không có thanh đáy: nút ❄️ ở sát đáy', async () => {
    mocks.pathname = '/game/play/eco-merge';
    render(<SiteSnowGate />);
    expect(await screen.findByTestId('site-snow-toggle')).not.toHaveAttribute('data-over-nav');
    expect(snow()).not.toBeNull();
  });

  it('Trang chủ (thẻ Noel lo tuyết), trang ngoài danh sách, mùa khác Noel: không vẽ gì', () => {
    for (const [pathname, theme] of [['/', 'christmas'], ['/checkout', 'christmas'], ['/browse', 'none'], ['/browse', undefined]] as const) {
      mocks.pathname = pathname;
      mocks.seasonalTheme = theme;
      const { container, unmount } = render(<SiteSnowGate />);
      expect(container.innerHTML).toBe('');
      expect(snow()).toBeNull();
      unmount();
    }
  });

  it('máy bật giảm chuyển động: không tuyết, không nút ❄️', async () => {
    setMatchMedia(true);
    render(<SiteSnowGate />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('site-snow-toggle')).toBeNull();
    expect(snow()).toBeNull();
  });

  it('mã tuyết chỉ vào bằng import() (0 byte trong gói đầu); trang có thanh mua dính đáy thì nút ❄️ ẩn', () => {
    const gate = readText(path.join(SRC, 'components/season/site-snow-gate.tsx'));
    expect(gate).toContain("import('./snowfall')");
    expect(gate).not.toMatch(/from '\.\/snowfall'/);
    const css = readText(path.join(SRC, '../../../packages/design-tokens/src/seasonal-christmas.css'));
    expect(css).toMatch(/html\[data-sticky-bar\] \.tubu-xmas-snow-pill,\s*body\.has-sticky-bar \.tubu-xmas-snow-pill \{ display: none; \}/);
  });
});
