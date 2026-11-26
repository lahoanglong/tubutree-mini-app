// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } } as Record<string, unknown>,
  pending: new Set<string>(),
  gardenDot: false,
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
vi.mock('@/lib/use-engagement-dots', () => ({ useEngagementDots: () => ({ garden: mocks.gardenDot, profile: false, checkInElsewhere: false }) }));
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
  mocks.pending = new Set();
  mocks.gardenDot = false;
  mocks.phase = 'authenticated';
  mocks.recycleOpen = false;
  mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ShortcutGrid web — 2 thẻ chính + 4 ô phụ + lối tắt nhanh (W177)', () => {
  it('hiện xuyên suốt cả máy tính lẫn điện thoại (không md:hidden, không lg:hidden), dựng tĩnh đủ 6 lối vào ngay từ khung hình đầu', () => {
    const c = mount();
    const section = c.querySelector('section[data-testid="shortcut-grid"]')!;
    expect(section.className).not.toContain('md:hidden');
    expect(section.className).not.toContain('lg:hidden');

    const cards = Array.from(c.querySelectorAll<HTMLAnchorElement>('[data-testid="ecosystem-bento-hub"] a[data-pillar]'));
    expect(cards).toHaveLength(6);
    expect(cards.map((a) => [a.dataset.pillar, a.dataset.tier])).toEqual([
      ['retail', 'hero'],
      ['garden', 'hero'],
      ['recycle', 'chip'],
      ['groupBuy', 'chip'],
      ['subscription', 'chip'],
      ['rewards', 'chip'],
    ]);
    expect(cards.map((a) => a.getAttribute('href'))).toEqual([
      '/gio-vang',
      '/vuon-xanh',
      '/doi-rac',
      '/mua-chung',
      '/san-pham?filter=subscription',
      '/kho-qua',
    ]);
    expect(cards.map((a) => a.querySelector('[data-pillar-title]')?.textContent)).toEqual([
      'Mua lẻ · Giờ vàng',
      'Vườn Xanh',
      'Đổi rác',
      'Mua chung',
      'Mua xoay vòng',
      'Kho quà 0đ',
    ]);
    expect(c.querySelectorAll('.tubu-bento-card--hero')).toHaveLength(2);
    expect(c.querySelectorAll('.tubu-chip-row > .tubu-chip')).toHaveLength(4);
    for (const chip of Array.from(c.querySelectorAll('.tubu-chip'))) {
      expect(chip.querySelector('[data-pillar-sub], [data-pillar-tag]')).toBeNull();
    }
    expect(c.querySelector('[data-pillar="garden"] [data-pillar-sub]')).not.toBeNull();
    expect(c.querySelector('[data-pillar="recycle"]')?.textContent?.trim()).toBe('Đổi rác');
    expect(c.querySelector('[data-pillar="groupBuy"]')?.getAttribute('aria-label')).toBe('Mua chung. Rủ bạn đủ nhóm giảm sâu');
  });

  it('chấm "có việc hôm nay" của Vườn Xanh nằm trên thẻ chính (W42), nghĩa ở aria-label; không việc thì không chấm', () => {
    let c = mount();
    expect(c.querySelector('[data-testid="garden-card-dot"]')).toBeNull();
    expect(c.querySelector('[data-pillar="garden"]')?.getAttribute('aria-label')).toBeNull();
    mounted?.unmount();
    mocks.gardenDot = true;
    c = mount();
    const card = c.querySelector('[data-pillar="garden"]')!;
    expect(card.querySelector('[data-testid="garden-card-dot"]')?.className).toBe('tubu-remind-dot tubu-remind-dot--card');
    expect(card.getAttribute('aria-label')).toMatch(/^Vườn Xanh, có việc hôm nay\. /);
    expect(c.querySelectorAll('[data-testid="garden-card-dot"]')).toHaveLength(1);
  });

  it('hàng lối tắt nhanh chỉ còn Mã giảm giá, Cộng đồng và nút "Thêm" (Giờ vàng đã là thẻ chính); hộp thoại mọi lối tắt vẫn có Giờ vàng', () => {
    const c = mount();
    const quickLinks = Array.from(c.querySelectorAll<HTMLAnchorElement>('[data-testid="shortcut-quick-pills"] a'));
    expect(quickLinks.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Mã giảm giá', '/uu-dai?codes=all'],
      ['Cộng đồng', '/cong-dong'],
    ]);

    const more = c.querySelector<HTMLButtonElement>('button[aria-label="Thêm lối tắt"]')!;
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(more.textContent?.trim()).toBe('Thêm');
    expect(more.querySelector('svg.lucide-ellipsis')).not.toBeNull();

    expect(allSheet()).toBeNull();
    openAll(c);
    expect(sheetRows()).toHaveLength(9);
    expect(sheetRows().some((b) => /Giờ vàng/.test(b.textContent ?? ''))).toBe(true);
    expect(document.body.textContent).not.toContain('sàn khác');
    click(sheetRows().find((b) => /Đơn hàng/.test(b.textContent ?? '')) ?? null);
    expect(mocks.push).toHaveBeenLastCalledWith('/tai-khoan/don-hang');
    expect(allSheet()).toBeNull();
  });

  it('"Bộ quà tặng" chỉ nằm trong hộp thoại mọi lối tắt (Trang chủ không thêm ô nào) và mở /bo-qua-tang', () => {
    const c = mount();
    expect(c.textContent).not.toContain('Bộ quà tặng');
    expect(c.querySelectorAll('[data-testid="shortcut-quick-pills"] a')).toHaveLength(2);
    openAll(c);
    const names = sheetRows().map((b) => b.textContent ?? '');
    const at = names.findIndex((t) => t.startsWith('Bộ quà tặng'));
    expect(names[at]).toContain('Bộ quà tặng và combo khởi đầu');
    expect(at).toBe(names.findIndex((t) => t.startsWith('Đơn hàng')) + 1);
    click(sheetRows()[at] ?? null);
    expect(mocks.push).toHaveBeenLastCalledWith('/bo-qua-tang');
  });

  it('"Kiếm tiền" trong hộp thoại mở bảng chọn thay vì điều hướng', () => {
    const c = mount();
    openAll(c);
    mocks.push.mockClear();
    click(sheetRows().find((b) => /Kiếm tiền/.test(b.textContent ?? '')) ?? null);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"][aria-label="Kiếm tiền cùng Tubu"]')).not.toBeNull();
  });

  it('Đổi rác tạm dừng nhưng khách còn yêu cầu đang mở: thẻ chính thứ hai đổi sang "Yêu cầu của tôi" mà vẫn giữ đủ 6 ô', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    mocks.recycleOpen = true;
    const c = mount();
    expect(c.querySelectorAll('[data-pillar]')).toHaveLength(6);
    expect(c.querySelector('[data-pillar="recycle"] [data-pillar-title]')?.textContent).toBe('Yêu cầu của tôi');
    expect(c.querySelector('[data-pillar="recycle"]')?.getAttribute('href')).toBe('/doi-rac/yeu-cau');
    expect(mocks.recycleArgs).toEqual([true, true]);
  });

  it('cấu hình dựng sẵn từ server được truyền cho usePublicConfig và cấu hình đang chờ vẫn giữ nguyên 6 lối vào không đổi chiều cao', () => {
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
