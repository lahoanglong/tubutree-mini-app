// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Khách chưa đăng nhập bấm mua khi cờ web.guest_cart_enabled bật: món vào giỏ khách ngay, không sang đăng nhập.
// Cờ tắt (hoặc trình duyệt chặn bộ nhớ) thì giữ lối cũ: nhớ món rồi sang đăng nhập.

const mocks = vi.hoisted(() => ({
  auth: { status: 'idle' as string, initialized: true, user: null as unknown },
  push: vi.fn(),
  addToCart: vi.fn(),
  applyCoupon: vi.fn(),
  getProductStock: vi.fn(),
  getActiveFlashSales: vi.fn(),
  getFlashAllowance: vi.fn(),
  getCart: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  addToCart: mocks.addToCart,
  applyCoupon: mocks.applyCoupon,
  getProductStock: mocks.getProductStock,
  getActiveFlashSales: mocks.getActiveFlashSales,
  getFlashAllowance: mocks.getFlashAllowance,
  getCart: mocks.getCart,
}));

import AddToCart from './add-to-cart';
import { resetFlashSales } from '@/lib/use-flash-sales';
import { PUBLIC_CONFIG_FALLBACK } from '@/lib/use-public-config';
import { GUEST_CART_KEY, readGuestCart } from '@/lib/guest-cart/store';

const VARIATIONS = [{ id: 'v1', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 }];
const PENDING_ADD_KEY = 'tubu_pending_add';

const clientWith = (flag: boolean | null, guestCheckout?: boolean) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (flag !== null) qc.setQueryData(['public-config'], { ...PUBLIC_CONFIG_FALLBACK, webGuestCartEnabled: flag, ...(guestCheckout === undefined ? {} : { webGuestCheckoutEnabled: guestCheckout }) });
  return qc;
};

let mounted: Rendered[] = [];
const mount = async (qc: QueryClient) => {
  const r = render(<AddToCart slug="dau-goi" variations={VARIATIONS} />, qc);
  mounted.push(r);
  await flush();
  return r;
};
// Bản máy tính (nút cạnh số lượng) và thanh dính đáy cùng có mặt trong DOM của jsdom.
const addBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="pdp-add-to-cart"]')!;
const buyBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="pdp-buy-now"]')!;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const guestQty = () => readGuestCart().find((l) => l.variationId === 'v1')?.quantity ?? 0;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.auth = { status: 'idle', initialized: true, user: null };
  mocks.push.mockReset();
  mocks.addToCart.mockReset();
  mocks.applyCoupon.mockReset();
  mocks.getProductStock.mockReset().mockResolvedValue({ v1: 5 });
  resetFlashSales();
  mocks.getActiveFlashSales.mockReset().mockResolvedValue([]);
  mocks.getCart.mockReset().mockResolvedValue({ items: [], itemCount: 0 });
  mocks.getFlashAllowance.mockReset().mockRejectedValue(new Error('404'));
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AddToCart — giỏ khách (cờ bật)', () => {
  it('bấm "Thêm vào giỏ": món vào giỏ khách, không sang trang nào, báo "Đã thêm vào giỏ!"', async () => {
    const { container } = await mount(clientWith(true));
    await tap(addBtn(container));
    await flush();

    expect(readGuestCart()).toEqual([{ variationId: 'v1', slug: 'dau-goi', quantity: 1, addedAt: expect.any(Number) }]);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_ADD_KEY)).toBeNull();
    expect(container.textContent).toContain('Đã thêm vào giỏ!');
    expect(container.querySelector('a[href="/gio-hang"][aria-label="Xem giỏ hàng"]')!.textContent).toContain('1');
  });

  it('bấm lần hai khi khoá còn giữ (dưới 400ms) không cộng thêm; hết khoá thì bấm lại được', async () => {
    const { container } = await mount(clientWith(true));
    await tap(addBtn(container));
    await flush(1);
    expect(guestQty()).toBe(1);
    expect(addBtn(container).getAttribute('aria-disabled')).toBe('true');

    await tap(addBtn(container));
    await flush(1);
    expect(guestQty()).toBe(1);

    await wait(450);
    expect(addBtn(container).hasAttribute('aria-disabled')).toBe(false);
    await tap(addBtn(container));
    await flush(1);
    expect(guestQty()).toBe(2);
  });

  it('chạm đúp trong cùng một khung hình chỉ thêm một lần', async () => {
    const { container } = await mount(clientWith(true));
    await tap(addBtn(container), addBtn(container));
    await flush();
    expect(guestQty()).toBe(1);
  });

  it('cấu hình công khai chưa về lúc bấm (lần tải đầu): đi lối cũ ngay, không chờ cờ, không ghi giỏ khách', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/config/public')
          ? new Promise<Response>(() => {})
          : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    const { container } = await mount(clientWith(null));
    await tap(addBtn(container));

    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADD_KEY)!)).toMatchObject({ variationId: 'v1', quantity: 1 });
    expect(readGuestCart()).toEqual([]);

    await tap(buyBtn(container));
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADD_KEY)!)).toMatchObject({ variationId: 'v1', quantity: 1, buyNow: true });
    await flush();
    expect(readGuestCart()).toEqual([]);
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it('"Mua ngay": món vào giỏ khách rồi sang /gio-hang (đặt hàng cần đăng nhập ở đó)', async () => {
    const { container } = await mount(clientWith(true));
    await tap(buyBtn(container));
    await flush();
    expect(guestQty()).toBe(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_ADD_KEY)).toBeNull();
  });

  it('"Mua ngay" khi đặt hàng không đăng nhập bật (web.guest_checkout_enabled): món vào giỏ khách rồi đi thẳng /thanh-toan', async () => {
    const { container } = await mount(clientWith(true, true));
    await tap(buyBtn(container));
    await flush();
    expect(guestQty()).toBe(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_ADD_KEY)).toBeNull();
  });

  it('"Mua ngay" khi đặt hàng không đăng nhập bật mà giỏ khách đã đủ số còn hàng: không cộng thêm, vẫn đi /thanh-toan', async () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([{ variationId: 'v1', slug: 'dau-goi', quantity: 5, addedAt: 1 }]));
    const { container } = await mount(clientWith(true, true));
    await tap(buyBtn(container));
    await flush();
    expect(guestQty()).toBe(5);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
  });

  it('"Mua ngay" khi đặt hàng không đăng nhập tắt rõ ràng: vẫn dừng ở /gio-hang', async () => {
    const { container } = await mount(clientWith(true, false));
    await tap(buyBtn(container));
    await flush();
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('"Thêm vào giỏ" không đổi khi đặt hàng không đăng nhập bật: ở lại trang, không sang /thanh-toan', async () => {
    const { container } = await mount(clientWith(true, true));
    await tap(addBtn(container));
    await flush();
    expect(guestQty()).toBe(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('"Mua ngay" khi giỏ khách đã đủ số còn hàng: không cộng thêm, vẫn sang /gio-hang', async () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([{ variationId: 'v1', slug: 'dau-goi', quantity: 5, addedAt: 1 }]));
    const { container } = await mount(clientWith(true));
    await tap(buyBtn(container));
    await flush();
    expect(guestQty()).toBe(5);
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('trình duyệt chặn bộ nhớ: đi lối cũ (nhớ món, sang đăng nhập)', async () => {
    const { container } = await mount(clientWith(true));
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GUEST_CART_KEY) throw new DOMException('quota', 'QuotaExceededError');
      return realSet.call(this, key, value);
    });
    await tap(addBtn(container));
    await flush();
    expect(readGuestCart()).toEqual([]);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADD_KEY)!)).toMatchObject({ variationId: 'v1', quantity: 1 });
  });
});

describe('AddToCart — giỏ khách tắt (hành vi cũ)', () => {
  it('"Thêm vào giỏ": nhớ món rồi sang đăng nhập, giỏ khách không đổi', async () => {
    const { container } = await mount(clientWith(false));
    await tap(addBtn(container));
    await flush();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADD_KEY)!)).toMatchObject({ variationId: 'v1', quantity: 1 });
    expect(readGuestCart()).toEqual([]);
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('"Mua ngay": nhớ món kèm ý định mua ngay rồi sang đăng nhập', async () => {
    const { container } = await mount(clientWith(false));
    await tap(buyBtn(container));
    await flush();
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADD_KEY)!)).toMatchObject({ variationId: 'v1', quantity: 1, buyNow: true });
    expect(readGuestCart()).toEqual([]);
  });
});
