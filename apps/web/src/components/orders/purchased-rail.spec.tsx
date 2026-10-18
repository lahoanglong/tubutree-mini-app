// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';

// Mini App purchased-rail.spec.tsx: kệ "Mua lại" ở tab Tất cả của trang Đơn hàng.

const m = vi.hoisted(() => ({ push: vi.fn(), auth: { status: 'authenticated', initialized: true, sessionUnavailable: false } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, replace: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => m.auth }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, cartKey: () => ['cart', null], useCartKey: () => ['cart', null] }));

import { PurchasedRail } from './purchased-rail';

const ITEM = {
  variationId: 'v1', productId: 'p1', slug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: null, stock: 8, inStock: true, timesBought: 2, lastPurchasedAt: '2026-09-10T00:00:00.000Z',
};
const CART = { items: [], couponCode: null, subtotal: 65000, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };

let mounted: Rendered[] = [];
let api: ReturnType<typeof mockFetch>;
const stub = (routes: Parameters<typeof mockFetch>[0]) => {
  api = mockFetch(routes);
  vi.stubGlobal('fetch', vi.fn(api.fn));
};
const mount = () => {
  const r = render(<PurchasedRail source="orders_tab" />);
  mounted.push(r);
  return r.container;
};
const buttonByText = (t: string) => Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === t) as HTMLButtonElement | undefined;

beforeEach(() => {
  m.push.mockReset();
  m.auth.status = 'authenticated';
  stub({ '/me/purchased-items': { body: { items: [ITEM], nextCursor: null } }, '/cart/items': { body: CART } });
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('PurchasedRail', () => {
  it('khách cũ: vùng "Mua lại" với thẻ SP, nhãn số lần đã mua; gọi đúng limit=10', async () => {
    const c = mount();
    await flush();
    const region = c.querySelector('section[aria-label="Mua lại"]')!;
    expect(region.textContent).toContain('Nước rửa chén · Chanh');
    expect(region.textContent).toContain('Đã mua 2 lần');
    expect(region.textContent).toContain('65.000đ');
    expect(api.calls[0]!.url).toContain('/me/purchased-items?limit=10');
  });

  it('khách mới (rỗng) → không render gì', async () => {
    stub({ '/me/purchased-items': { body: { items: [], nextCursor: null } } });
    const c = mount();
    await flush();
    expect(c.innerHTML).toBe('');
  });

  it('API cũ trả 404 → ẩn im lặng, không báo lỗi và không gọi lại', async () => {
    stub({ '/me/purchased-items': { status: 404, body: { message: 'Not Found' } } });
    const c = mount();
    await flush(8);
    expect(c.innerHTML).toBe('');
    expect(api.calls).toHaveLength(1);
  });

  it('chưa đăng nhập → không gọi API, không render', async () => {
    m.auth.status = 'idle';
    const c = mount();
    await flush();
    expect(api.calls).toHaveLength(0);
    expect(c.innerHTML).toBe('');
  });

  it('đang tải → khung chờ aria-hidden (không phải vùng có tên)', () => {
    const c = mount();
    const loading = c.querySelector('[data-testid="purchased-rail-loading"]');
    expect(loading?.getAttribute('aria-hidden')).toBe('true');
    expect(c.querySelector('section[aria-label="Mua lại"]')).toBeNull();
  });

  it('"Mua lại" → sheet → "Thêm vào giỏ (1)" → POST /cart/items kèm addSource rồi tự sang giỏ', async () => {
    const c = mount();
    await flush();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Mua lại') ?? null);
    await flush();
    click(buttonByText('Thêm vào giỏ (1)') ?? null);
    await flush(8);
    const call = api.calls.find((x) => x.url.includes('/cart/items'))!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ variationId: 'v1', quantity: 1, addSource: 'repurchase' });
    expect(m.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('hết hàng: sheet khoá dòng, không gọi API và không sang giỏ', async () => {
    stub({ '/me/purchased-items': { body: { items: [{ ...ITEM, stock: 0, inStock: false }], nextCursor: null } } });
    const c = mount();
    await flush();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Mua lại') ?? null);
    await flush();
    expect(buttonByText('Thêm vào giỏ (0)')?.disabled).toBe(true);
    expect(api.calls.some((x) => x.url.includes('/cart/items'))).toBe(false);
  });

  it('chạm thẻ → trang sản phẩm', async () => {
    const c = mount();
    await flush();
    expect(c.querySelector('a[href="/san-pham/nuoc-rua-chen"]')).not.toBeNull();
    expect(unnamedControls(c)).toEqual([]);
  });

  it('làm mới lỗi nhưng còn dữ liệu cũ → kệ không biến mất, có dòng báo nhẹ + "Thử lại"; thử lại xong thì dòng báo mất', async () => {
    let n = 0;
    stub({
      '/me/purchased-items': () => {
        n += 1;
        return n === 2 ? { status: 500, body: { message: 'boom' } } : { body: { items: [ITEM], nextCursor: null } };
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<QueryClientProvider client={qc}><PurchasedRail source="orders_tab" /></QueryClientProvider>));
    await flush();
    expect(container.textContent).not.toContain('Thử lại');
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['purchased-items', 10] });
    });
    await flush();
    expect(container.textContent).toContain('Nước rửa chén · Chanh');
    expect(container.textContent).toContain('Có chút trục trặc, thử lại nhé');
    click(Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Thử lại Mua lại') ?? null);
    await flush(8);
    expect(container.textContent).not.toContain('Có chút trục trặc, thử lại nhé');
    expect(container.textContent).toContain('Nước rửa chén · Chanh');
    act(() => root.unmount());
    container.remove();
  });
});
