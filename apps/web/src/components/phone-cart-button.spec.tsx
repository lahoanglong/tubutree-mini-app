// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Nút giỏ tròn ở đầu trang (điện thoại): đi qua BackAwareLink nên Giỏ → Sản phẩm → bấm giỏ lùi về Giỏ cũ thay vì đẩy Giỏ thứ hai (W163).
const state = vi.hoisted(() => ({ itemCount: 0, router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/san-pham/xa-phong', useRouter: () => state.router }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/shop-client', () => ({ getCart: async () => ({ itemCount: state.itemCount }) }));

import { PhoneCartButton } from './phone-cart-button';

let mounted: Rendered | null = null;
const nextPush = (path: string) => window.history.pushState({ __NA: true }, '', path);
const mount = async () => {
  mounted = render(<PhoneCartButton />);
  await flush();
  return mounted.container.querySelector('a')!;
};
// Ghi lại "đã bị chặn chưa" khi sự kiện nổi tới document (sau React), rồi chặn nốt để jsdom không báo "navigation not implemented" cho ca để Link đi như thường.
let reached = false;
const swallow = (e: Event) => {
  reached = e.defaultPrevented;
  e.preventDefault();
};
const press = (a: HTMLAnchorElement) => {
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  return { defaultPrevented: reached };
};

beforeEach(() => {
  reached = false;
  state.itemCount = 0;
  state.router = { back: vi.fn(), push: vi.fn(), replace: vi.fn() };
  document.addEventListener('click', swallow);
  // Bản gốc của trình duyệt (không qua lớp đóng dấu): mỗi test bắt đầu ở một mục "vào thẳng" độ sâu 0.
  Object.getPrototypeOf(window.history).replaceState.call(window.history, { __NA: true }, '', '/gio-hang');
});
afterEach(() => {
  document.removeEventListener('click', swallow);
  mounted?.unmount();
  mounted = null;
});

describe('PhoneCartButton', () => {
  it('liên kết tới /gio-hang, vùng chạm 44x44, chỉ hiện ở điện thoại, nhãn đọc đúng', async () => {
    const a = await mount();
    expect(a.getAttribute('href')).toBe('/gio-hang');
    expect(a.className).toContain('h-11');
    expect(a.className).toContain('w-11');
    expect(a.className).toContain('md:hidden');
    expect(a.hasAttribute('data-cart-target')).toBe(true);
    expect(a.getAttribute('aria-label')).toBe('Giỏ hàng');
  });

  it('có hàng trong giỏ: nhãn nêu số lượng và hiện huy hiệu đếm', async () => {
    state.itemCount = 3;
    const a = await mount();
    expect(a.getAttribute('aria-label')).toBe('Giỏ hàng, 3 sản phẩm');
    expect(a.querySelector('[data-testid="count-badge"]')?.textContent).toBe('3');
  });

  it('Giỏ → Sản phẩm → bấm giỏ: trang ngay trước là /gio-hang và còn lịch sử ⇒ chặn Link, router.back()', async () => {
    nextPush('/san-pham/xa-phong');
    const a = await mount();
    const ev = press(a);
    expect(ev.defaultPrevented).toBe(true);
    expect(state.router.back).toHaveBeenCalledTimes(1);
  });

  it('vào thẳng trang (chưa có lịch sử trong web): để Link đẩy /gio-hang như thường', async () => {
    const a = await mount();
    const ev = press(a);
    expect(ev.defaultPrevented).toBe(false);
    expect(state.router.back).not.toHaveBeenCalled();
  });

  it('trang trước là trang khác (không phải Giỏ): để Link đẩy /gio-hang như thường', async () => {
    Object.getPrototypeOf(window.history).replaceState.call(window.history, { __NA: true }, '', '/san-pham');
    nextPush('/san-pham/xa-phong');
    const a = await mount();
    const ev = press(a);
    expect(ev.defaultPrevented).toBe(false);
    expect(state.router.back).not.toHaveBeenCalled();
  });
});
