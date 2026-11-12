// @vitest-environment jsdom
import { act } from 'react';
import { useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { cartKey } from '@/lib/cart-key';
import { ApiError, NetworkError } from '@/lib/client-api';

// "Dùng ngay" bị máy chủ từ chối vì màn đã cũ (400/404/409/422: mã hết lượt, bị tắt, giỏ vừa đổi): câu báo hiện NGAY, giỏ, ví mã, số xem trước và báo giá
// tải lại, `use` giữ khoá (usingCode) tới khi chúng về (tối đa `LOCK_REFRESH_WAIT_MS`), như `holdForCouponReload`. Nhả sớm thì chạm lần hai áp lại đúng mã
// vừa bị từ chối trên ví cũ. Mất mạng, 401 và 5xx không tải lại (lần tải cũng hỏng) và nhả khoá ngay.

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getCart: vi.fn(),
  applyCoupon: vi.fn(),
  myCoupons: vi.fn(),
  previews: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/shop-client', () => ({ getCart: mocks.getCart, applyCoupon: mocks.applyCoupon }));
vi.mock('@/lib/copy-text', () => ({ copyText: vi.fn(async () => true) }));

import { useCouponUse } from './use-coupon-use';

const CART = { itemCount: 2, couponCode: null as string | null };

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });

let unmount: (() => void) | null = null;
/** Hook cùng các truy vấn mà màn thẻ mã đang quan sát (giỏ, ví mã, số xem trước): chúng mới có lượt tải lại thật để giữ khoá chờ. */
const mount = async () => {
  const h = renderHook(() => {
    useQuery({ queryKey: cartKey(), queryFn: () => mocks.getCart() });
    useQuery({ queryKey: ['my-coupons'], queryFn: () => mocks.myCoupons() });
    useQuery({ queryKey: ['coupon-previews', 'x'], queryFn: () => mocks.previews() });
    return useCouponUse();
  });
  unmount = h.unmount;
  await settle();
  return h;
};
/** Từ lúc gọi: giỏ, ví mã và số xem trước tải lại đều treo tới khi `resolve`, và số lần gọi tính lại từ 0. */
const holdReloads = () => {
  const gate = defer();
  mocks.getCart.mockReset().mockImplementation(async () => {
    await gate.promise;
    return CART;
  });
  mocks.myCoupons.mockReset().mockImplementation(async () => {
    await gate.promise;
    return [];
  });
  mocks.previews.mockReset().mockImplementation(async () => {
    await gate.promise;
    return [];
  });
  return gate;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCart.mockReset().mockResolvedValue(CART);
  mocks.myCoupons.mockReset().mockResolvedValue([]);
  mocks.previews.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  unmount?.();
  unmount = null;
});

describe('useCouponUse (web): "Dùng ngay" bị từ chối vì màn đã cũ giữ khoá tới khi dữ liệu mới về', () => {
  it.each([400, 404, 409, 422])('%i: câu báo hiện ngay, giỏ/ví mã/số xem trước tải lại, usingCode giữ; gọi lần hai không áp; về xong thì dùng lại được', async (status) => {
    const h = await mount();
    mocks.applyCoupon.mockRejectedValueOnce(new ApiError('Mã đã hết lượt dùng.', status)).mockResolvedValue({ itemCount: 2, couponCode: 'NHAN10' });
    const gate = holdReloads();
    await act(async () => {
      void h.result.current.use('NHAN10');
    });
    await settle();
    expect(h.result.current.notice?.error).toBe(true);
    expect(h.result.current.notice?.text).toContain('Mã đã hết lượt dùng.');
    expect(mocks.getCart).toHaveBeenCalledTimes(1);
    expect(mocks.myCoupons).toHaveBeenCalledTimes(1);
    expect(mocks.previews).toHaveBeenCalledTimes(1);
    expect(h.result.current.usingCode).toBe('NHAN10');
    await act(async () => {
      void h.result.current.use('NHAN10');
      void h.result.current.use('KHAC20');
    });
    await settle();
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await settle();
    expect(h.result.current.usingCode).toBeNull();
    await act(async () => {
      void h.result.current.use('NHAN10');
    });
    await settle();
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['lỗi 500', () => new ApiError('Máy chủ bận.', 500)],
    ['lỗi 401', () => new ApiError('Phiên đăng nhập đã hết hạn.', 401)],
    ['mất mạng', () => new NetworkError(false)],
  ])('%s: câu báo hiện, KHÔNG tải lại (lần tải cũng hỏng), nhả khoá ngay; gọi lại áp được', async (_name, makeError) => {
    const h = await mount();
    mocks.applyCoupon.mockRejectedValueOnce(makeError()).mockResolvedValue({ itemCount: 2, couponCode: 'NHAN10' });
    holdReloads();
    await act(async () => {
      void h.result.current.use('NHAN10');
    });
    await settle();
    expect(h.result.current.notice?.error).toBe(true);
    expect(mocks.getCart).not.toHaveBeenCalled();
    expect(mocks.myCoupons).not.toHaveBeenCalled();
    expect(h.result.current.usingCode).toBeNull();
    await act(async () => {
      void h.result.current.use('NHAN10');
    });
    await settle();
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(2);
  });
});
