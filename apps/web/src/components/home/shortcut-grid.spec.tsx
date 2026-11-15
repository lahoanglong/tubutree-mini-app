// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } } as Record<string, unknown>,
  // Route map thật không có đích web cho /points/scan (chỉ Mini App).
  pending: new Set<string>(['/points/scan']),
  phase: 'authenticated' as string,
  recycleOpen: false,
  recycleArgs: [] as unknown[],
  cfgArgs: [] as unknown[],
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-recycle-open-requests', () => ({
  useRecycleOpenRequests: (...a: unknown[]) => {
    mocks.recycleArgs = a;
    return mocks.recycleOpen;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/use-public-config', () => ({
  usePublicConfig: (...a: unknown[]) => {
    mocks.cfgArgs = a;
    return mocks.cfg;
  },
}));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => !mocks.pending.has(p) }));
vi.mock('./earn-sheet', () => ({ EarnSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Kiếm tiền cùng Tubu" /> : null) }));

import { ShortcutGrid } from './shortcut-grid';

let mounted: Rendered | null = null;
const mount = (initialConfig?: Record<string, unknown>) => {
  mounted = render(<ShortcutGrid initialConfig={initialConfig as never} />);
  return mounted.container;
};
const openAll = (c: HTMLElement) => click(c.querySelector('button[aria-label="Thêm lối tắt"]'));
const allSheet = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((d) => d.querySelector('h2')?.textContent === 'Tất cả lối tắt') ?? null;
const sheetRows = () => Array.from(allSheet()?.querySelectorAll<HTMLElement>('[role="button"]') ?? []);

beforeEach(() => {
  mocks.push.mockReset();
  mocks.pending = new Set(['/points/scan']);
  mocks.phase = 'authenticated';
  mocks.recycleOpen = false;
  mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ShortcutGrid web — Bento Hub 6 trụ cột + lối tắt nhanh (W171)', () => {
  it('hiện xuyên suốt cả máy tính lẫn điện thoại (không md:hidden, không lg:hidden), dựng tĩnh đủ 6 trụ cột ngay từ khung hình đầu', () => {
    const c = mount();
    const section = c.querySelector('section[data-testid="shortcut-grid"]')!;
    expect(section.className).not.toContain('md:hidden');
    expect(section.className).not.toContain('lg:hidden');

    const bentoCards = Array.from(c.querySelectorAll<HTMLAnchorElement>('[data-testid="ecosystem-bento-hub"] a[data-pillar]'));
    expect(bentoCards).toHaveLength(6);
    expect(bentoCards.map((a) => a.getAttribute('href'))).toEqual([
      '/vuon-xanh',
      '/doi-rac',
      '/kho-qua',
      '/mua-chung',
      '/san-pham?filter=subscription',
      '/dai-ly',
    ]);
    expect(bentoCards.map((a) => a.querySelector('[data-pillar-title]')?.textContent)).toEqual([
      'Vườn Xanh & Game',
      'Đổi rác lấy quà',
      'Kho quà 0đ',
      'Mua chung giá kho',
      'Mua xoay vòng',
      'Đại lý & Tiếp thị liên kết',
    ]);
    expect(c.querySelector('[data-pillar="recycle"]')?.textContent).toContain('Miễn ship khi gửi kèm đơn');
  });

  it('hàng lối tắt nhanh có Giờ vàng, Mã giảm giá, Cộng đồng và nút "Thêm" mở hộp thoại mọi lối tắt', () => {
    const c = mount();
    const quickLinks = Array.from(c.querySelectorAll<HTMLAnchorElement>('[data-testid="shortcut-quick-pills"] a'));
    expect(quickLinks.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Giờ vàng', '/gio-vang'],
      ['Mã giảm giá', '/ma-giam-gia'],
      ['Cộng đồng', '/cong-dong'],
    ]);

    const more = c.querySelector<HTMLButtonElement>('button[aria-label="Thêm lối tắt"]')!;
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(more.textContent?.trim()).toBe('Thêm');
    expect(more.querySelector('svg.lucide-ellipsis')).not.toBeNull();

    expect(allSheet()).toBeNull();
    openAll(c);
    expect(sheetRows()).toHaveLength(8);
    expect(document.body.textContent).not.toContain('sàn khác');
    click(sheetRows().find((b) => /Đơn hàng/.test(b.textContent ?? '')) ?? null);
    expect(mocks.push).toHaveBeenLastCalledWith('/tai-khoan/don-hang');
    expect(allSheet()).toBeNull();
  });

  it('"Kiếm tiền" trong hộp thoại mở bảng chọn thay vì điều hướng', () => {
    const c = mount();
    openAll(c);
    mocks.push.mockClear();
    click(sheetRows().find((b) => /Kiếm tiền/.test(b.textContent ?? '')) ?? null);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"][aria-label="Kiếm tiền cùng Tubu"]')).not.toBeNull();
  });

  it('Đổi rác tạm dừng nhưng khách còn yêu cầu đang mở: thẻ thứ hai đổi sang "Yêu cầu của tôi" mà vẫn giữ đủ 6 ô', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    mocks.recycleOpen = true;
    const c = mount();
    expect(c.querySelectorAll('[data-pillar]')).toHaveLength(6);
    expect(c.querySelector('[data-pillar="recycle"] [data-pillar-title]')?.textContent).toBe('Yêu cầu của tôi');
    expect(c.querySelector('[data-pillar="recycle"]')?.getAttribute('href')).toBe('/doi-rac/yeu-cau');
    expect(mocks.recycleArgs).toEqual([true, true]);
  });

  it('cấu hình dựng sẵn từ server được truyền cho usePublicConfig và cấu hình đang chờ vẫn giữ nguyên 6 trụ cột không đổi chiều cao', () => {
    const initial = { waste: { enabled: true } };
    mount(initial);
    expect(mocks.cfgArgs[0]).toBe(initial);
    mounted?.unmount();
    mocks.cfg = { isLoaded: false, isPending: true, waste: { enabled: false } };
    const c = mount();
    expect(c.querySelectorAll('[data-pillar]')).toHaveLength(6);
  });

  it('không dùng lề âm tay; tên truy cập của mỗi nút/liên kết có aria-label chứa chữ nhìn thấy (WCAG 2.5.3)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'shortcut-grid.tsx'), 'utf8');
    expect(src).not.toMatch(/margin: '0 -16px'|-mx-/);
    const c = mount();
    for (const el of Array.from(c.querySelectorAll<HTMLElement>('[aria-label]'))) {
      if (el.tagName === 'SECTION') continue;
      const visible = (el.textContent ?? '').trim().toLowerCase();
      expect((el.getAttribute('aria-label') ?? '').toLowerCase()).toContain(visible);
    }
  });
});
