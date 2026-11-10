// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Nút đang chạy báo aria-busy (như `Button` của Mini App khi loading), nút kia chỉ aria-disabled: cả hai không `disabled` để nút đang giữ focus không rớt focus về body.
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

const stickyAdd = (c: HTMLElement) => c.querySelectorAll<HTMLButtonElement>('[data-testid="pdp-add-to-cart"]')[1]!;
const stickyBuy = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="buy-now"]')!;
const state = (el: HTMLButtonElement) => ({ busy: el.getAttribute('aria-busy'), disabled: el.getAttribute('aria-disabled'), native: el.disabled });

describe('AddToCart: nút đang chạy báo aria-busy, nút kia chỉ aria-disabled', () => {
  it('Thêm vào giỏ đang bay: hai nút Thêm (bàn và thanh dính) aria-busy + aria-disabled, hai nút Mua ngay chỉ aria-disabled; không nút nào disabled; xong thì sạch', async () => {
    const call = deferred<typeof CART>();
    mocks.addToCart.mockReturnValueOnce(call.promise);
    const { container } = await mount();
    for (const el of [addBtn(container), stickyAdd(container), buyBtn(container), stickyBuy(container)]) {
      expect(state(el)).toEqual({ busy: null, disabled: null, native: false });
    }
    await tap(addBtn(container));
    for (const el of [addBtn(container), stickyAdd(container)]) {
      expect(state(el)).toEqual({ busy: 'true', disabled: 'true', native: false });
    }
    for (const el of [buyBtn(container), stickyBuy(container)]) {
      expect(state(el)).toEqual({ busy: null, disabled: 'true', native: false });
    }
    await act(async () => call.resolve(CART));
    await flush();
    for (const el of [addBtn(container), stickyAdd(container), buyBtn(container), stickyBuy(container)]) {
      expect(state(el)).toEqual({ busy: null, disabled: null, native: false });
    }
  });

  it('Mua ngay đang bay: hai nút Mua ngay aria-busy + aria-disabled, hai nút Thêm chỉ aria-disabled; lỗi thì nhả hết', async () => {
    const call = deferred<typeof CART>();
    mocks.addToCart.mockReturnValueOnce(call.promise);
    const { container } = await mount();
    await tap(stickyBuy(container));
    for (const el of [buyBtn(container), stickyBuy(container)]) {
      expect(state(el)).toEqual({ busy: 'true', disabled: 'true', native: false });
    }
    for (const el of [addBtn(container), stickyAdd(container)]) {
      expect(state(el)).toEqual({ busy: null, disabled: 'true', native: false });
    }
    await act(async () => call.reject(new Error('Hết hàng.')));
    await flush();
    for (const el of [addBtn(container), stickyAdd(container), buyBtn(container), stickyBuy(container)]) {
      expect(state(el)).toEqual({ busy: null, disabled: null, native: false });
    }
  });

  it('nút đang giữ focus vẫn giữ focus khi bận', async () => {
    const call = deferred<typeof CART>();
    mocks.addToCart.mockReturnValueOnce(call.promise);
    const { container } = await mount();
    const bar = stickyAdd(container);
    bar.focus();
    await tap(bar);
    expect(document.activeElement).toBe(bar);
    await act(async () => call.resolve(CART));
    await flush();
    expect(document.activeElement).toBe(bar);
  });

  it('nhãn của nút Thêm ở máy tính có giá đổi theo số lượng nên số căn đều (tabular-nums)', async () => {
    const { container } = await mount();
    expect(addBtn(container).className).toContain('tabular-nums');
  });
});
