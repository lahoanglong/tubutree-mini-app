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
const mount = (props: { initialConfig?: Record<string, unknown>; flashLive?: boolean } = {}) => {
  mounted = render(<ShortcutGrid initialConfig={props.initialConfig as never} flashLive={props.flashLive} />);
  return mounted.container;
};
const MORE = 'Thêm lối tắt';
const cells = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.tubu-shortcut-grid > .tubu-shortcut-cell'));
const cellIds = (c: HTMLElement) => cells(c).map((el) => el.dataset.pillar ?? el.dataset.shortcut ?? 'more');
const openMore = (c: HTMLElement) => click(c.querySelector(`button[aria-label="${MORE}"]`));
const moreSheet = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((d) => d.querySelector('h2')?.textContent === MORE) ?? null;
const sheetRows = () => Array.from(moreSheet()?.querySelectorAll<HTMLElement>('[role="button"]') ?? []);

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

describe('ShortcutGrid web: MỘT lưới biểu tượng 4 cột × 2 hàng (W47)', () => {
  it('hiện xuyên suốt máy tính lẫn điện thoại, dựng tĩnh 8 ô: sáu lối vào, Mã giảm giá, "Thêm"; không còn thẻ chính, ô phụ hay viên lối tắt', () => {
    const c = mount();
    const section = c.querySelector('section[data-testid="shortcut-grid"]')!;
    expect(section.className).not.toContain('md:hidden');
    expect(section.className).not.toContain('lg:hidden');
    expect(cellIds(c)).toEqual(['retail', 'garden', 'recycle', 'groupBuy', 'subscription', 'rewards', 'coupons', 'more']);
    expect(c.querySelectorAll('[data-tier], .tubu-bento-card--hero, .tubu-chip, [data-testid="shortcut-quick-pills"]')).toHaveLength(0);
    expect(cells(c).map((el) => el.querySelector('[data-shortcut-label]')?.textContent)).toEqual([
      'Giờ vàng',
      'Vườn Xanh',
      'Đổi rác',
      'Mua chung',
      'Định kỳ',
      'Kho quà',
      'Mã giảm giá',
      'Thêm',
    ]);
  });

  it('lối vào và Mã giảm giá là liên kết thật (crawler, mở tab mới); ô "Thêm" là nút mở hộp thoại', () => {
    const c = mount();
    const links = cells(c).filter((el) => el.tagName === 'A');
    expect(links.map((a) => [a.dataset.pillar ?? a.dataset.shortcut, a.getAttribute('href')])).toEqual([
      ['retail', '/gio-vang'],
      ['garden', '/vuon-xanh'],
      ['recycle', '/doi-rac'],
      ['groupBuy', '/mua-chung'],
      ['subscription', '/san-pham?filter=subscription'],
      ['rewards', '/kho-qua'],
      ['coupons', '/uu-dai?codes=all'],
    ]);
    const more = c.querySelector<HTMLButtonElement>(`button[aria-label="${MORE}"]`)!;
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(more.textContent?.trim()).toBe('Thêm');
    expect(more.querySelector('svg.lucide-ellipsis')).not.toBeNull();
  });

  it('"Thêm" mở hộp thoại chỉ gồm lối tắt chưa lên lưới (Cộng đồng, Bộ quà tặng, Kiếm tiền): không lặp Giờ vàng, không có Đơn hàng', () => {
    const c = mount();
    expect(moreSheet()).toBeNull();
    openMore(c);
    const names = sheetRows().map((b) => b.textContent ?? '');
    expect(names).toHaveLength(3);
    expect(names.map((t) => t.split(/\s/)[0])).toEqual(['Cộng', 'Bộ', 'Kiếm']);
    expect(names.some((t) => /Giờ vàng|Đơn hàng|Mã giảm giá/.test(t))).toBe(false);
    expect(document.body.textContent).not.toContain('sàn khác');
    click(sheetRows()[0] ?? null);
    expect(mocks.push).toHaveBeenLastCalledWith('/cong-dong');
    expect(moreSheet()).toBeNull();
  });

  it('"Bộ quà tặng" nằm trong hộp thoại (không thêm ô nào trên Trang chủ) và mở /bo-qua-tang', () => {
    const c = mount();
    expect(c.querySelector('.tubu-shortcut-grid')!.textContent).not.toContain('Bộ quà tặng');
    openMore(c);
    const row = sheetRows().find((b) => (b.textContent ?? '').startsWith('Bộ quà tặng'));
    expect(row?.textContent).toContain('Bộ quà tặng và combo khởi đầu');
    click(row ?? null);
    expect(mocks.push).toHaveBeenLastCalledWith('/bo-qua-tang');
  });

  it('"Kiếm tiền" trong hộp thoại mở bảng chọn thay vì điều hướng', () => {
    const c = mount();
    openMore(c);
    mocks.push.mockClear();
    click(sheetRows().find((b) => /Kiếm tiền/.test(b.textContent ?? '')) ?? null);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"][aria-label="Kiếm tiền cùng Tubu"]')).not.toBeNull();
  });

  it('lối tắt có đích web chưa sẵn sàng bị bỏ; lưới không quá 8 ô', () => {
    mocks.pending = new Set(['/uu-dai', '/bo-qua-tang']);
    const c = mount();
    expect(cellIds(c).filter((id) => id === 'coupons' || id === 'gifts')).toEqual([]);
    expect(cells(c).length).toBeLessThanOrEqual(8);
  });

  it('flashLive=false: bỏ ô Giờ vàng, Cộng đồng lên lưới, vẫn 8 ô', () => {
    const c = mount({ flashLive: false });
    expect(cellIds(c)).toEqual(['garden', 'recycle', 'groupBuy', 'subscription', 'rewards', 'coupons', 'community', 'more']);
  });

  it('chấm "có việc hôm nay" của Vườn Xanh nằm trên biểu tượng ô (W42), nghĩa ở aria-label; không việc thì không chấm', () => {
    let c = mount();
    expect(c.querySelector('[data-testid="garden-card-dot"]')).toBeNull();
    expect(c.querySelector('[data-pillar="garden"]')?.getAttribute('aria-label')).toBe('Vườn Xanh. Tưới cây mỗi ngày nhận quà thật');
    mounted?.unmount();
    mocks.gardenDot = true;
    c = mount();
    const cell = c.querySelector('[data-pillar="garden"]')!;
    expect(cell.querySelector('[data-testid="garden-card-dot"]')?.className).toBe('tubu-remind-dot tubu-remind-dot--card');
    expect(cell.getAttribute('aria-label')).toMatch(/^Vườn Xanh, có việc hôm nay\. /);
    expect(c.querySelectorAll('[data-testid="garden-card-dot"]')).toHaveLength(1);
  });

  it('Đổi rác tạm dừng nhưng khách còn yêu cầu đang mở: ô Đổi rác ghi "Yêu cầu", tới /doi-rac/yeu-cau, vẫn đủ 8 ô', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    mocks.recycleOpen = true;
    const c = mount();
    expect(cells(c)).toHaveLength(8);
    expect(c.querySelector('[data-pillar="recycle"] [data-shortcut-label]')?.textContent).toBe('Yêu cầu');
    expect(c.querySelector('[data-pillar="recycle"]')?.getAttribute('aria-label')).toContain('Yêu cầu của tôi');
    expect(c.querySelector('[data-pillar="recycle"]')?.getAttribute('href')).toBe('/doi-rac/yeu-cau');
    expect(mocks.recycleArgs).toEqual([true, true]);
  });

  it('cấu hình dựng sẵn từ server được truyền cho usePublicConfig; cấu hình đang chờ vẫn đủ 8 ô (không đổi chiều cao)', () => {
    const initial = { waste: { enabled: true } };
    mount({ initialConfig: initial });
    expect(mocks.cfgArgs[0]).toBe(initial);
    mounted?.unmount();
    mocks.cfg = { isLoaded: false, isPending: true, waste: { enabled: false } };
    const c = mount();
    expect(cells(c)).toHaveLength(8);
  });

  it('không dùng lề âm tay; tên truy cập của mỗi ô bắt đầu bằng chữ nhìn thấy (WCAG 2.5.3)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'shortcut-grid.tsx'), 'utf8');
    expect(src).not.toMatch(/margin: '0 -16px'|-mx-/);
    const c = mount();
    for (const el of cells(c)) {
      const visible = (el.querySelector('[data-shortcut-label]')?.textContent ?? '').trim().toLowerCase();
      expect((el.getAttribute('aria-label') ?? '').toLowerCase().startsWith(visible), `${el.getAttribute('aria-label')} / ${visible}`).toBe(true);
    }
  });
});
