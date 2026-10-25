// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } } as Record<string, unknown>,
  // Route map thật không có đích web cho /points/scan (chỉ Mini App).
  pending: new Set<string>(['/points/scan']),
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

beforeEach(() => {
  mocks.push.mockReset();
  mocks.pending = new Set(['/points/scan']);
  mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ShortcutGrid web — lối tắt', () => {
  it('cờ bật hết: 7 lối tắt (Tích điểm đơn sàn chưa có trang web nên không hiện)', () => {
    const c = mount();
    expect(c.querySelectorAll('button')).toHaveLength(7);
    expect(c.textContent).not.toContain('sàn');
  });

  it('cờ Đổi rác tắt hoặc cấu hình chưa về: ẩn Đổi rác, hàng dồn lại', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false } };
    expect(mount().querySelectorAll('button')).toHaveLength(6);
    mounted!.unmount();
    mocks.cfg = { isLoaded: false, waste: { enabled: false } };
    const c = mount();
    expect(c.querySelectorAll('button')).toHaveLength(6);
    expect(byText(c, 'button', 'Đổi rác')).toBeNull();
  });

  it('route còn pending thì lối tắt ẩn', () => {
    mocks.pending = new Set(['/points/scan', '/cong-dong']);
    expect(mount().querySelectorAll('button')).toHaveLength(6);
  });

  it('mỗi lối tắt dẫn đúng route web; "Kiếm tiền" mở bảng chọn thay vì điều hướng', () => {
    const c = mount();
    const press = (re: RegExp) => click(Array.from(c.querySelectorAll('button')).find((b) => re.test(b.getAttribute('aria-label') ?? b.textContent ?? '')) ?? null);
    press(/Đổi quà/);
    expect(mocks.push).toHaveBeenLastCalledWith('/kho-qua');
    press(/Mã giảm giá/);
    expect(mocks.push).toHaveBeenLastCalledWith('/uu-dai?section=coupons');
    press(/Đổi rác/);
    expect(mocks.push).toHaveBeenLastCalledWith('/doi-rac');
    mocks.push.mockClear();
    press(/Kiếm tiền/);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"][aria-label="Kiếm tiền cùng Tubu"]')).not.toBeNull();
  });
});
