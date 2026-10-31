// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'guest' }) }));
vi.mock('@/lib/cart-key', () => ({ useCartKey: () => ['cart', null] }));
vi.mock('@/lib/shop-client', () => ({ getCart: async () => ({ itemCount: 0 }) }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => true }));

import { HomeHeader } from './home-header';

let mounted: Rendered | null = null;
const mount = (unread = 0) => (mounted = render(<HomeHeader unreadCount={unread} />)).container;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HomeHeader web — một hàng dính 56px như Mini App (HM-01)', () => {
  it('khổ điện thoại: hàng cao 56 (h-14), ẩn từ md vì thanh đầu website đã có ô tìm, chuông và giỏ', () => {
    const root = mount().querySelector<HTMLElement>('[data-testid="home-header"]')!;
    expect(root.className).toContain('h-14');
    expect(root.className).toContain('md:hidden');
  });

  it('dấu logo, ô tìm, chuông và giỏ cùng một hàng; ô tìm mở /san-pham?focus=search', () => {
    const c = mount();
    const search = c.querySelector('a[aria-label="Bạn đang tìm gì hôm nay?"]')!;
    expect(search.getAttribute('href')).toBe('/san-pham?focus=search');
    expect(c.querySelector('a[aria-label="Thông báo"]')).not.toBeNull();
    expect(c.querySelector('a[aria-label="Giỏ hàng"]')).not.toBeNull();
    expect(c.querySelector('img[alt="Tubu Tree"]')).not.toBeNull();
  });

  it('chuông báo số chưa đọc; trang đã có một h1 (page.tsx) nên header không thêm h1; mọi điều khiển có tên', () => {
    const c = mount(3);
    expect(c.querySelector('a[aria-label="Thông báo, 3 chưa đọc"]')).not.toBeNull();
    expect(c.querySelector('h1')).toBeNull();
    expect(unnamedControls(c)).toEqual([]);
  });
});
