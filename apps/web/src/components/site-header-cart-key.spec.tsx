// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { fullName: 'An' }, status: 'authenticated', initialized: true, sessionUnavailable: false }),
}));
// Giỏ không bao giờ trả về: huy hiệu chỉ có thể đổi nhờ số liệu đã ghi vào cache đúng khoá.
vi.mock('@/lib/shop-client', () => ({ getCart: () => new Promise(() => {}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/' }));

import SiteHeader from './site-header';
import { cartKey } from '@/lib/cart-key';
import { clearStorefrontContext, rememberStorefront } from '@/lib/storefront-context';

let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const badge = () => container.querySelector('a[href="/gio-hang"]')?.getAttribute('aria-label');

beforeEach(() => {
  sessionStorage.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  qc.setQueryData(['cart', null], { itemCount: 2 });
  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <SiteHeader />
      </QueryClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SiteHeader — huy hiệu giỏ theo gian hàng đang ghi công', () => {
  it('đang ở giỏ không gian hàng: hiện 2 sản phẩm', async () => {
    await tick();
    expect(badge()).toBe('Giỏ hàng, 2 sản phẩm');
  });

  it('điều hướng phía khách vào /s/[slug] (header không remount): huy hiệu theo giỏ của gian hàng đó', async () => {
    act(() => rememberStorefront('shop-a', 'CTV'));
    act(() => {
      qc.setQueryData(cartKey(), { itemCount: 3 });
    });
    await tick();
    expect(badge()).toBe('Giỏ hàng, 3 sản phẩm');
  });

  it('gian hàng CTV A sang B: huy hiệu theo giỏ của B, không giữ số của A', async () => {
    act(() => rememberStorefront('shop-a', 'CTV'));
    act(() => {
      qc.setQueryData(cartKey(), { itemCount: 3 });
    });
    act(() => rememberStorefront('shop-b', 'CTV'));
    act(() => {
      qc.setQueryData(cartKey(), { itemCount: 5 });
    });
    await tick();
    expect(badge()).toBe('Giỏ hàng, 5 sản phẩm');
    expect(qc.getQueryData(['cart', 'shop-a'])).toEqual({ itemCount: 3 });
  });

  it('CTV sang trang nhãn hàng: quay về giỏ không gian hàng', async () => {
    act(() => rememberStorefront('shop-a', 'CTV'));
    act(() => {
      qc.setQueryData(cartKey(), { itemCount: 3 });
    });
    act(() => rememberStorefront('visante', 'BRAND'));
    await tick();
    expect(badge()).toBe('Giỏ hàng, 2 sản phẩm');
    act(() => clearStorefrontContext());
    await tick();
    expect(badge()).toBe('Giỏ hàng, 2 sản phẩm');
  });
});
