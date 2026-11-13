// @vitest-environment jsdom
import { act } from 'react';
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

describe('PortalHeader: --portal-header-h', () => {
  const readVar = () => document.documentElement.style.getPropertyValue('--portal-header-h');
  const height = { value: 61 };
  let observers: Array<{ cb: () => void; observed: Element[]; disconnected: boolean }> = [];

  beforeEach(() => {
    height.value = 61;
    observers = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: height.value }) as DOMRect);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        rec: (typeof observers)[number];
        constructor(cb: () => void) {
          this.rec = { cb, observed: [], disconnected: false };
          observers.push(this.rec);
        }
        observe(el: Element) {
          this.rec.observed.push(el);
        }
        disconnect() {
          this.rec.disconnected = true;
        }
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--portal-header-h');
  });

  it('đo chiều cao thật của chính thanh đầu và đặt lên :root', () => {
    mount('/admin');
    expect(readVar()).toBe('61px');
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observed[0]).toBe(document.querySelector('header'));
  });

  it('thanh đổi cao (đổi khổ chữ, xoay máy) thì biến theo kịp', () => {
    mount('/admin');
    height.value = 97;
    act(() => observers[0]!.cb());
    expect(readVar()).toBe('97px');
  });

  it('gỡ thanh thì dọn biến và ngắt theo dõi', () => {
    mount('/admin');
    mounted!.unmount();
    mounted = null;
    expect(readVar()).toBe('');
    expect(observers[0]!.disconnected).toBe(true);
  });

  it('trang khách không vẽ thanh nên không đặt biến', () => {
    mount('/');
    expect(readVar()).toBe('');
    expect(observers).toHaveLength(0);
  });

  it('trình duyệt không có ResizeObserver: vẫn đặt biến một lần và cập nhật khi đổi cỡ cửa sổ', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    mount('/admin');
    expect(readVar()).toBe('61px');
    height.value = 80;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(readVar()).toBe('80px');
    mounted!.unmount();
    mounted = null;
    expect(readVar()).toBe('');
  });
});
