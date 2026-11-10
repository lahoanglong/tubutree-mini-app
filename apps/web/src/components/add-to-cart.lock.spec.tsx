// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// W79B: Thêm vào giỏ và Mua ngay ghi cùng một giỏ nên dùng chung một khoá ref (Mini ↔ web, W79A).
const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated' as string, initialized: true, user: { id: 'u1' } as unknown },
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

const VARIATIONS = [{ id: 'v1', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 }];
const CART = { items: [], itemCount: 1 };

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AddToCart slug="dau-goi" variations={VARIATIONS} />);
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

beforeEach(() => {
  sessionStorage.clear();
  mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
  mocks.push.mockReset();
  mocks.addToCart.mockReset().mockResolvedValue(CART);
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
});

describe('AddToCart: Thêm vào giỏ và Mua ngay dùng chung một khoá ghi giỏ (W79B)', () => {
  it('chạm đúp "Thêm vào giỏ" trong cùng một khung hình chỉ ghi giỏ một lần; xong thì chạm lại được', async () => {
    const call = deferred<typeof CART>();
    mocks.addToCart.mockReturnValueOnce(call.promise);
    const { container } = await mount();
    await tap(addBtn(container), addBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await act(async () => call.resolve(CART));
    await flush();
    await tap(addBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(2);
  });

  it('chạm "Thêm vào giỏ" rồi "Mua ngay" sát nhau: chỉ một lệnh ghi giỏ, không sang thanh toán khi lệnh đầu là thêm giỏ', async () => {
    const call = deferred<typeof CART>();
    mocks.addToCart.mockReturnValueOnce(call.promise);
    const { container } = await mount();
    await tap(addBtn(container), buyBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await act(async () => call.resolve(CART));
    await flush();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('chạm "Mua ngay" rồi "Thêm vào giỏ" sát nhau: chỉ một lệnh, và đó là Mua ngay (sang thanh toán)', async () => {
    const call = deferred<typeof CART>();
    mocks.addToCart.mockReturnValueOnce(call.promise);
    const { container } = await mount();
    await tap(buyBtn(container), addBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await act(async () => call.resolve(CART));
    await flush();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
  });

  it('thêm giỏ lỗi: khoá nhả, nút Mua ngay chạm được ngay sau đó', async () => {
    mocks.addToCart.mockRejectedValueOnce(new Error('Hết hàng.')).mockResolvedValue(CART);
    const { container } = await mount();
    await tap(addBtn(container));
    await flush();
    expect(container.textContent).toContain('Hết hàng.');
    await tap(buyBtn(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
  });

  it('Mua ngay thành công giữ khoá tới khi trang chuyển đi: chạm "Thêm vào giỏ" sau đó không cộng đôi', async () => {
    const { container } = await mount();
    await tap(buyBtn(container));
    await flush();
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    await tap(addBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it('lệnh thêm nốt sau đăng nhập đang bay: chạm "Thêm vào giỏ" cùng lúc bị bỏ, hai nút cùng aria-busy/aria-disabled và không disabled', async () => {
    const call = deferred<typeof CART>();
    mocks.addToCart.mockReturnValueOnce(call.promise);
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'v1', quantity: 1, at: Date.now() }));
    const { container } = await mount();
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    for (const btn of [addBtn(container), buyBtn(container)]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.disabled).toBe(false);
    }
    await tap(addBtn(container), buyBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await act(async () => call.resolve(CART));
    await flush();
    expect(addBtn(container).hasAttribute('aria-disabled')).toBe(false);
  });
});
