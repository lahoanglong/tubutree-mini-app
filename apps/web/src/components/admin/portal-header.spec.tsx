// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { headingLevels } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({
  pathname: '/admin',
  auth: { user: { fullName: 'Nguyễn Văn An' } as { fullName: string } | null, status: 'authenticated', logout: vi.fn(async () => {}) },
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));

import PortalHeader, { portalLabel } from './portal-header';

let mounted: Rendered | null = null;
const mount = (pathname: string) => {
  mocks.pathname = pathname;
  mounted = render(<PortalHeader />);
  return mounted.container;
};

beforeEach(() => {
  mocks.auth = { user: { fullName: 'Nguyễn Văn An' }, status: 'authenticated', logout: vi.fn(async () => {}) };
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('portalLabel', () => {
  it.each([
    ['/admin', 'Quản trị'],
    ['/admin/pos', 'Quản trị'],
    ['/merchant', 'Đối tác'],
    ['/merchant/doanh-thu', 'Đối tác'],
  ])('%s → %s', (path, label) => {
    expect(portalLabel(path)).toBe(label);
  });

  it.each(['/', '/san-pham/xa-phong', '/brand/abc', '/administrator', null, undefined])('%s không phải cổng nội bộ', (path) => {
    expect(portalLabel(path)).toBeNull();
  });
});

describe('PortalHeader', () => {
  it('trang khách: không vẽ gì (header bán hàng của khách đảm nhiệm)', () => {
    expect(mount('/').innerHTML).toBe('');
  });

  it('khu quản trị và POS: thanh đầu riêng gắn nhãn "Quản trị", có lối về cửa hàng', () => {
    for (const path of ['/admin', '/admin/pos']) {
      const root = mount(path);
      const header = root.querySelector('header')!;
      expect(header.textContent).toContain('Tubu Tree');
      expect(header.querySelector('[data-portal-label]')!.textContent).toBe('Quản trị');
      const back = Array.from(header.querySelectorAll('a')).find((a) => a.textContent?.includes('Về cửa hàng'))!;
      expect(back.getAttribute('href')).toBe('/');
      expect(back.className).toContain('min-h-[44px]');
      mounted!.unmount();
      mounted = null;
    }
  });

  it('cổng đối tác: nhãn "Đối tác"', () => {
    expect(mount('/merchant').querySelector('[data-portal-label]')!.textContent).toBe('Đối tác');
  });

  it('không có giỏ hàng, ô tìm kiếm hay lối vào tài khoản khách; không chiếm h1 của trang', () => {
    const root = mount('/admin');
    expect(root.querySelector('a[href="/gio-hang"]')).toBeNull();
    expect(root.querySelector('a[href="/tai-khoan"]')).toBeNull();
    expect(root.querySelector('[data-site-search], input')).toBeNull();
    expect(headingLevels(root)).toEqual([]);
  });

  // jsdom bỏ qua env() khi phân tích style, nên kiểm trên HTML tĩnh như site-header.spec.
  it('header dính đầu trang, chừa inset phía trên của thiết bị', () => {
    mocks.pathname = '/admin';
    const header = renderToStaticMarkup(<PortalHeader />).match(/<header[^>]*>/)?.[0] ?? '';
    expect(header).toMatch(/\bsticky\b/);
    expect(header).toContain('padding-top:env(safe-area-inset-top, 0px)');
  });

  it('đã đăng nhập: hiện tên ngắn và nút Đăng xuất cao 44px gọi logout', () => {
    const root = mount('/admin');
    expect(root.querySelector('[data-portal-user]')!.textContent).toBe('An');
    const logout = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Đăng xuất'))!;
    expect(logout.className).toContain('min-h-[44px]');
    expect(logout.getAttribute('type')).toBe('button');
    click(logout);
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
  });

  it('chưa đăng nhập: không có tên và không có nút Đăng xuất', () => {
    mocks.auth = { user: null, status: 'anonymous', logout: vi.fn(async () => {}) };
    const root = mount('/merchant');
    expect(root.querySelector('[data-portal-user]')).toBeNull();
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.includes('Đăng xuất'))).toBe(false);
  });
});
