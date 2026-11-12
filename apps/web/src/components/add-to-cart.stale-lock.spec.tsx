// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from '@/lib/client-api';

// Máy chủ từ chối thêm giỏ vì màn đã cũ (400/404/409/422: hết hàng, phân loại ngừng bán): lời lỗi hiện NGAY, tồn kho và giỏ tải lại, hai nút giữ khoá
// (aria-busy) tới khi chúng về (tối đa `LOCK_REFRESH_WAIT_MS`), như Mini App (`holdUntilFresh`). Nhả sớm thì chạm lần hai gửi lại đúng lệnh trên tồn kho cũ.
// Mất mạng, 401 và 5xx không nói gì về trạng thái thật (lần tải lại cũng hỏng): nhả khoá ngay.
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

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AddToCart slug="dau-goi" variations={VARIATIONS} />);
  mounted.push(r);
  await flush();
  return r;
};
/** Như `mount` nhưng giữ QueryClient để ca kiểm lần tải lại theo khoá. */
const mountWithClient = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(<AddToCart slug="dau-goi" variations={VARIATIONS} />, qc);
  mounted.push(r);
  await flush();
  return { ...r, qc };
};
const addBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="pdp-add-to-cart"]')!;
const buyBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="pdp-buy-now"]')!;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
/** Từ lúc gọi: tồn kho và giỏ tải lại đều treo tới khi `resolve`, và số lần gọi tính lại từ 0. */
const holdReloads = () => {
  const gate = defer();
  mocks.getProductStock.mockReset().mockImplementation(async () => {
    await gate.promise;
    return { v1: 5 };
  });
  mocks.getCart.mockReset().mockImplementation(async () => {
    await gate.promise;
    return { items: [], itemCount: 0 };
  });
  return gate;
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

describe('AddToCart: máy chủ từ chối thêm giỏ vì màn đã cũ giữ khoá tới khi tồn kho và giỏ mới về', () => {
  it.each([400, 404, 409, 422])('%i: lời lỗi hiện ngay, tồn kho và giỏ tải lại, hai nút báo bận; chạm lần hai không gửi; về xong thì thêm lại được', async (status) => {
    mocks.addToCart.mockRejectedValueOnce(new ApiError('Chỉ còn 2 sản phẩm.', status)).mockResolvedValue(CART);
    const { container } = await mount();
    const gate = holdReloads();
    await tap(addBtn(container));
    await flush(3);
    expect(container.textContent).toContain('Chỉ còn 2 sản phẩm.');
    expect(mocks.getProductStock).toHaveBeenCalledTimes(1);
    expect(mocks.getCart).toHaveBeenCalledTimes(1);
    for (const btn of [addBtn(container), buyBtn(container)]) expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(addBtn(container).getAttribute('aria-busy')).toBe('true');
    await tap(addBtn(container));
    await tap(buyBtn(container));
    await tap(addBtn(container), addBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => gate.resolve());
    await flush(4);
    expect(addBtn(container).getAttribute('aria-busy')).toBeNull();
    expect(addBtn(container).getAttribute('aria-disabled')).toBeNull();
    await tap(addBtn(container));
    await flush(3);
    expect(mocks.addToCart).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Đã thêm vào giỏ!');
  });

  it('"Mua ngay" bị từ chối 409: lời lỗi hiện ngay, không sang thanh toán, nút giữ khoá tới khi dữ liệu về', async () => {
    mocks.addToCart.mockRejectedValueOnce(new ApiError('Sản phẩm đã hết hàng.', 409)).mockResolvedValue(CART);
    const { container } = await mount();
    const gate = holdReloads();
    await tap(buyBtn(container));
    await flush(3);
    expect(container.textContent).toContain('Sản phẩm đã hết hàng.');
    expect(buyBtn(container).getAttribute('aria-busy')).toBe('true');
    await tap(buyBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await flush(4);
    expect(buyBtn(container).getAttribute('aria-busy')).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  describe('mã mua chung GBUY- bị từ chối vì đã cũ', () => {
    const CODE = 'GBUY-ABCD1234-WXYZ5678';
    const openedFrom = (search: string) => window.history.replaceState(null, '', `/san-pham/dau-goi${search}`);
    const withLine = (over: Record<string, unknown> = {}) => ({ items: [{ id: 'line-A', variationId: 'v1', quantity: 1 }], itemCount: 1, couponCode: null, discount: 0, ...over });
    /** Từ lúc gọi: mọi lần tải lại `['my-coupons']`, `['coupons']`, `['quote']` đều treo tới khi `resolve`; trả thêm số lần đã bị gọi. */
    const watchCouponReloads = (qc: QueryClient) => {
      const gate = defer();
      const keys: string[] = [];
      const original = qc.invalidateQueries.bind(qc);
      vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
        const key = String((filters?.queryKey as unknown[] | undefined)?.[0]);
        if (['my-coupons', 'coupons', 'quote'].includes(key)) {
          keys.push(key);
          return gate.promise;
        }
        return original(filters);
      });
      return { gate, keys };
    };

    beforeEach(() => {
      mocks.addToCart.mockReset().mockResolvedValue(withLine());
      mocks.applyCoupon.mockReset();
    });
    afterEach(() => openedFrom(''));

    it.each([
      ['400', 400],
      ['404', 404],
      ['409', 409],
      ['422', 422],
    ])('%s khi áp mã: câu lý do hiện ngay, danh sách mã và báo giá tải lại, nút giữ khoá tới khi về; chạm lần hai không gửi', async (_name, status) => {
      mocks.applyCoupon.mockRejectedValue(new ApiError('Nhóm mua chung đã đóng.', status));
      openedFrom(`?ma=${CODE}`);
      const { container, qc } = await mountWithClient();
      const { gate, keys } = watchCouponReloads(qc);
      await tap(addBtn(container));
      await flush(3);
      expect(container.textContent).toContain('Đã thêm vào giỏ!');
      expect(container.textContent).toContain('Nhóm mua chung đã đóng.');
      expect([...new Set(keys)].sort()).toEqual(['coupons', 'my-coupons', 'quote']);
      for (const btn of [addBtn(container), buyBtn(container)]) expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(addBtn(container).getAttribute('aria-busy')).toBe('true');
      await tap(addBtn(container), buyBtn(container));
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      await act(async () => gate.resolve());
      await flush(4);
      expect(addBtn(container).getAttribute('aria-busy')).toBeNull();
      expect(addBtn(container).getAttribute('aria-disabled')).toBeNull();
      await tap(addBtn(container));
      await flush(3);
      expect(mocks.addToCart).toHaveBeenCalledTimes(2);
    });

    it('"Mua ngay" mà mã nhóm bị từ chối 409: giữ câu lý do và khoá, chỉ sang thanh toán sau khi dữ liệu mới về', async () => {
      mocks.applyCoupon.mockRejectedValue(new ApiError('Mã nhóm đã được dùng.', 409));
      openedFrom(`?ma=${CODE}`);
      const { container, qc } = await mountWithClient();
      const { gate } = watchCouponReloads(qc);
      await tap(buyBtn(container));
      await flush(3);
      expect(container.textContent).toContain('Mã nhóm đã được dùng.');
      expect(buyBtn(container).getAttribute('aria-busy')).toBe('true');
      // Hết thời gian giữ câu báo (1,8 giây) mà dữ liệu mới chưa về thì vẫn chưa sang thanh toán.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1900));
      });
      expect(mocks.push).not.toHaveBeenCalled();
      await act(async () => gate.resolve());
      await flush(4);
      expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['lỗi 500', () => new ApiError('Máy chủ bận.', 500)],
      ['lỗi 401', () => new ApiError('Phiên đăng nhập đã hết hạn.', 401)],
      ['mất mạng', () => new NetworkError(false)],
    ])('%s khi áp mã: không tải lại danh sách mã, nhả khoá ngay', async (_name, makeError) => {
      mocks.applyCoupon.mockRejectedValue(makeError());
      openedFrom(`?ma=${CODE}`);
      const { container, qc } = await mountWithClient();
      const { keys } = watchCouponReloads(qc);
      await tap(addBtn(container));
      await flush(3);
      expect(container.textContent).toContain('Đã thêm vào giỏ!');
      expect(keys).toEqual([]);
      expect(addBtn(container).getAttribute('aria-busy')).toBeNull();
      expect(addBtn(container).getAttribute('aria-disabled')).toBeNull();
    });
  });

  it.each([
    ['lỗi 500', () => new ApiError('Máy chủ bận.', 500)],
    ['lỗi 401', () => new ApiError('Phiên đăng nhập đã hết hạn.', 401)],
    ['mất mạng', () => new NetworkError(false)],
  ])('%s: lời lỗi hiện, không tải lại giỏ, nhả khoá ngay dù tồn kho còn đang tải; chạm lại gửi được', async (_name, makeError) => {
    mocks.addToCart.mockRejectedValueOnce(makeError()).mockResolvedValue(CART);
    const { container } = await mount();
    holdReloads();
    await tap(addBtn(container));
    await flush(3);
    expect(container.textContent).toMatch(/\S/);
    expect(mocks.getCart).not.toHaveBeenCalled();
    expect(addBtn(container).getAttribute('aria-busy')).toBeNull();
    expect(addBtn(container).getAttribute('aria-disabled')).toBeNull();
    await tap(addBtn(container));
    expect(mocks.addToCart).toHaveBeenCalledTimes(2);
  });
});
