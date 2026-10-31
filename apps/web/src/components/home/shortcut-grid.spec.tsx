// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } } as Record<string, unknown>,
  // Route map thật không có đích web cho /points/scan (chỉ Mini App).
  pending: new Set<string>(['/points/scan']),
  phase: 'authenticated' as string,
  recycleOpen: false,
  recycleArgs: [] as unknown[],
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-recycle-open-requests', () => ({
  useRecycleOpenRequests: (...a: unknown[]) => {
    mocks.recycleArgs = a;
    return mocks.recycleOpen;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => !mocks.pending.has(p) }));
vi.mock('./earn-sheet', () => ({ EarnSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Kiếm tiền cùng Tubu" /> : null) }));

import { ShortcutGrid } from './shortcut-grid';

let mounted: Rendered | null = null;
const mount = () => {
  mounted = render(<ShortcutGrid />);
  return mounted.container;
};
const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).map((b) => b.textContent?.trim());
const openAll = (c: HTMLElement) => click(c.querySelector('button[aria-label="Tất cả lối tắt"]'));
// BottomSheet thật đặt tên hộp thoại bằng aria-labelledby trỏ tới tiêu đề h2.
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

describe('ShortcutGrid web — 4 ô cố định + "Tất cả" (Q7)', () => {

  it('nhãn tối đa hai dòng, cao cố định 32px, không nowrap: "Mã giảm giá" xuống dòng chứ không bị cắt "…"; ô vẫn cao 84px', () => {
    const c = mount();
    const buttons = Array.from(c.querySelectorAll<HTMLElement>('[data-testid="shortcut-grid"] button'));
    expect(buttons).toHaveLength(5);
    for (const b of buttons) {
      expect(b.style.height).toBe('84px');
      const label = b.lastElementChild as HTMLElement;
      expect(label.style.height).toBe('32px');
      expect(label.style.lineHeight).toBe('16px');
      expect(label.style.overflow).toBe('hidden');
      expect(label.style.whiteSpace).not.toBe('nowrap');
      expect(label.style.textOverflow).toBe('');
      expect(label.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    }
  });
  it('cờ bật hết: 4 ô cố định (Giờ vàng, Mã giảm giá, Đổi rác, Mua chung) và ô "Tất cả", lưới 5 cột không cuộn ngang; Giờ vàng là ô đầu tiên', () => {
    const c = mount();
    expect(labels(c)).toEqual(['Giờ vàng', 'Mã giảm giá', 'Đổi rác', 'Mua chung', 'Tất cả']);
    expect(c.querySelector<HTMLElement>('[data-testid="shortcut-grid"]')!.style.display).toBe('grid');
    expect(c.querySelector('[role="group"][aria-label*="vuốt ngang"]')).toBeNull();
  });

  it('chỉ ở khổ điện thoại: ẩn từ lg vì thanh điều hướng website đã có các lối này', () => {
    expect(mount().querySelector('section')!.className).toContain('lg:hidden');
  });

  it('Giờ vàng tới /gio-vang, Mã giảm giá tới mã của tôi, Đổi rác và Mua chung đúng route web', () => {
    const c = mount();
    const press = (re: RegExp) => click(Array.from(c.querySelectorAll('button')).find((b) => re.test(b.getAttribute('aria-label') ?? '')) ?? null);
    press(/Giờ vàng/);
    expect(mocks.push).toHaveBeenLastCalledWith('/gio-vang');
    press(/Mã giảm giá/);
    expect(mocks.push).toHaveBeenLastCalledWith('/uu-dai?section=coupons');
    press(/Đổi rác/);
    expect(mocks.push).toHaveBeenLastCalledWith('/doi-rac');
    press(/Mua chung/);
    expect(mocks.push).toHaveBeenLastCalledWith('/mua-chung');
  });

  it('"Tất cả" mở hộp thoại liệt kê đủ mục còn hiển thị (Tích điểm đơn sàn chưa có trang web nên không có); chọn mục đóng hộp và điều hướng', () => {
    const c = mount();
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

  it('cờ Đổi rác tắt: ô trống được Đổi quà lấp, vẫn đủ 4 ô + "Tất cả"; hộp thoại còn 7 mục', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    const c = mount();
    expect(labels(c)).toEqual(['Giờ vàng', 'Mã giảm giá', 'Mua chung', 'Đổi quà', 'Tất cả']);
    openAll(c);
    expect(sheetRows()).toHaveLength(7);
    expect(byText(document.body, 'button', 'Đổi rác')).toBeNull();
  });

  it('cấu hình chưa về: không hiện mục có cờ (đóng khi chưa biết)', () => {
    mocks.cfg = { isLoaded: false, waste: { enabled: false } };
    const c = mount();
    expect(byText(c, 'button', 'Đổi rác')).toBeNull();
    expect(c.querySelectorAll('button')).toHaveLength(5);
  });

  it('route còn pending thì lối tắt ẩn và mục kế lấp chỗ', () => {
    mocks.pending = new Set(['/points/scan', '/mua-chung']);
    expect(labels(mount())).toEqual(['Giờ vàng', 'Mã giảm giá', 'Đổi rác', 'Đổi quà', 'Tất cả']);
  });

  it('Đổi rác tạm dừng nhưng khách còn yêu cầu đang mở: vẫn hiện ở ô cố định, ghi "Yêu cầu"', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    mocks.recycleOpen = true;
    const c = mount();
    expect(labels(c)).toContain('Yêu cầu');
    expect(byText(c, 'button', 'Đổi rác')).toBeNull();
    expect(mocks.recycleArgs).toEqual([true, true]);
  });

  it('tên truy cập của mỗi ô chứa chữ nhìn thấy (WCAG 2.5.3); nhãn một dòng, vùng chạm ≥44px', () => {
    const c = mount();
    for (const b of Array.from(c.querySelectorAll('button'))) {
      const visible = (b.textContent ?? '').trim().toLowerCase();
      expect((b.getAttribute('aria-label') ?? '').toLowerCase()).toContain(visible);
      expect(b.style.minHeight).toBe('44px');
    }
  });

  it('không còn lề âm -16px ở mọi khổ; điện thoại chỉ lùi 8px (max-md:-mx-2) để mép lưới cách mép màn 8px như Mini (ô rộng 359/5, không phải 343/5)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'shortcut-grid.tsx'), 'utf8');
    expect(src).not.toMatch(/margin: '0 -16px'|-mx-4/);
    const cls = mount().querySelector('section')!.className;
    expect(cls).toContain('max-md:-mx-2');
    expect(cls).not.toMatch(/(?<!max-md:)-mx-/);
  });
});
