// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const nav = vi.hoisted(() => ({ router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() } as { back: () => void; push: () => void; replace: () => void } | null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/thanh-toan',
  useRouter: () => {
    if (!nav.router) throw new Error('invariant expected app router to be mounted');
    return nav.router;
  },
}));

import { BackAwareLink } from './back-aware-link';

let mounted: Rendered | null = null;

const nextPush = (path: string) => window.history.pushState({ __NA: true }, '', path);
const mount = (ui: React.ReactElement) => {
  mounted = render(ui);
  return mounted.container.querySelector('a')!;
};
// Ghi lại "đã bị chặn chưa" khi sự kiện nổi tới document (sau React), rồi chặn nốt để jsdom không báo "navigation not implemented" cho các ca để Link đi như thường.
let reached = false;
const swallow = (e: Event) => {
  reached = e.defaultPrevented;
  e.preventDefault();
};
const press = (a: HTMLAnchorElement, init: MouseEventInit = {}) => {
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  return { defaultPrevented: reached };
};

beforeEach(() => {
  reached = false;
  document.addEventListener('click', swallow);
  nav.router = { back: vi.fn(), push: vi.fn(), replace: vi.fn() };
  // Bản gốc của trình duyệt (không qua lớp đóng dấu): mỗi test bắt đầu ở một mục "vào thẳng" độ sâu 0.
  Object.getPrototypeOf(window.history).replaceState.call(window.history, { __NA: true }, '', '/gio-hang');
});
afterEach(() => {
  document.removeEventListener('click', swallow);
  mounted?.unmount();
  mounted = null;
});

describe('BackAwareLink', () => {
  it('đích là trang ngay trước và còn lịch sử: chặn Link, lùi một mục bằng router.back()', () => {
    nextPush('/thanh-toan');
    const a = mount(<BackAwareLink href="/gio-hang">Về giỏ hàng</BackAwareLink>);
    const ev = press(a);
    expect(ev.defaultPrevented).toBe(true);
    expect(nav.router!.back).toHaveBeenCalledTimes(1);
  });

  it('vẫn là liên kết thật: có href, hiện chữ', () => {
    const a = mount(<BackAwareLink href="/gio-hang">Về giỏ hàng</BackAwareLink>);
    expect(a.getAttribute('href')).toBe('/gio-hang');
    expect(a.textContent).toBe('Về giỏ hàng');
  });

  it('vào thẳng trang (chưa có lịch sử trong web): để Link đi như thường', () => {
    const a = mount(<BackAwareLink href="/gio-hang">Về giỏ hàng</BackAwareLink>);
    const ev = press(a);
    expect(nav.router!.back).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('đích khác trang trước: để Link đi như thường', () => {
    nextPush('/thanh-toan');
    const a = mount(<BackAwareLink href="/san-pham">Mua tiếp</BackAwareLink>);
    const ev = press(a);
    expect(nav.router!.back).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('đích có query không khớp trang trước trần thì không lùi', () => {
    nextPush('/thanh-toan');
    const a = mount(<BackAwareLink href="/gio-hang?tab=saved">Giỏ đã lưu</BackAwareLink>);
    press(a);
    expect(nav.router!.back).not.toHaveBeenCalled();
  });

  it('bấm kèm meta/ctrl/shift/alt hoặc chuột giữa thì không chặn (mở tab mới, tải về...)', () => {
    nextPush('/thanh-toan');
    const a = mount(<BackAwareLink href="/gio-hang">Về giỏ hàng</BackAwareLink>);
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const ev = press(a, init);
      expect(ev.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(nav.router!.back).not.toHaveBeenCalled();
  });

  it('target mở tab khác thì không lùi', () => {
    nextPush('/thanh-toan');
    const a = mount(
      <BackAwareLink href="/gio-hang" target="_blank">
        Về giỏ hàng
      </BackAwareLink>,
    );
    const ev = press(a);
    expect(ev.defaultPrevented).toBe(false);
    expect(nav.router!.back).not.toHaveBeenCalled();
  });

  it('onClick của người gọi chạy trước; gọi preventDefault ở đó thì không lùi', () => {
    nextPush('/thanh-toan');
    const seen = vi.fn((e: React.MouseEvent) => e.preventDefault());
    const a = mount(
      <BackAwareLink href="/gio-hang" onClick={seen}>
        Về giỏ hàng
      </BackAwareLink>,
    );
    press(a);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(nav.router!.back).not.toHaveBeenCalled();
  });

  it('ngoài App Router (không có router) vẫn lùi bằng History API', () => {
    nav.router = null;
    nextPush('/thanh-toan');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const a = mount(<BackAwareLink href="/gio-hang">Về giỏ hàng</BackAwareLink>);
    const ev = press(a);
    expect(ev.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });
});
