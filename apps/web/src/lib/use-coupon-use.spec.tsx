// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ push: vi.fn(), getCart: vi.fn(), applyCoupon: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/shop-client', () => ({ getCart: mocks.getCart, applyCoupon: mocks.applyCoupon }));
vi.mock('@/lib/copy-text', () => ({ copyText: vi.fn(async () => true) }));

import { useCouponUse } from './use-coupon-use';

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let unmount: (() => void) | null = null;
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  unmount?.();
  unmount = null;
});

describe('useCouponUse (web): khoá "Dùng ngay"', () => {
  it('hai lần gọi cùng khung hình chỉ chạy một lần; usingCode báo mã đang chạy rồi trả về null khi xong', async () => {
    const cart = gate<{ itemCount: number }>();
    mocks.getCart.mockReturnValue(cart.promise);
    const h = renderHook(() => useCouponUse());
    unmount = h.unmount;
    expect(h.result.current.usingCode).toBeNull();
    await act(async () => {
      void h.result.current.use('NHAN10');
      void h.result.current.use('NHAN10');
    });
    expect(mocks.getCart).toHaveBeenCalledTimes(1);
    expect(h.result.current.usingCode).toBe('NHAN10');
    // Mã khác cũng bị bỏ qua khi một mã đang chạy.
    await act(async () => {
      void h.result.current.use('KHAC20');
    });
    expect(mocks.getCart).toHaveBeenCalledTimes(1);
    await act(async () => {
      cart.resolve({ itemCount: 0 });
      await cart.promise;
    });
    expect(h.result.current.usingCode).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith('/san-pham');
  });

  it('đang chạy một mã: lần gọi cùng khung hình và cả mã khác đều không áp thêm mã nào', async () => {
    const cart = gate<{ itemCount: number; couponCode: string | null }>();
    mocks.getCart.mockReturnValue(cart.promise);
    mocks.applyCoupon.mockResolvedValue({ itemCount: 2, couponCode: 'NHAN10' });
    const h = renderHook(() => useCouponUse());
    unmount = h.unmount;
    await act(async () => {
      void h.result.current.use('NHAN10');
      void h.result.current.use('NHAN10');
      void h.result.current.use('KHAC20');
    });
    await act(async () => {
      cart.resolve({ itemCount: 2, couponCode: null });
      await cart.promise;
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
    expect(mocks.applyCoupon).toHaveBeenCalledWith('NHAN10');
  });

  it('lỗi đọc giỏ: nhả khoá, usingCode về null, báo lỗi, gọi lại được', async () => {
    mocks.getCart.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue({ itemCount: 0 });
    const h = renderHook(() => useCouponUse());
    unmount = h.unmount;
    await act(async () => {
      await h.result.current.use('NHAN10');
    });
    expect(h.result.current.usingCode).toBeNull();
    expect(h.result.current.notice?.error).toBe(true);
    await act(async () => {
      await h.result.current.use('NHAN10');
    });
    expect(mocks.getCart).toHaveBeenCalledTimes(2);
  });
});
