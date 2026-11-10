import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), notify: vi.fn(), getCart: vi.fn(), applyCoupon: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('./use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCart: mocks.getCart,
  applyCoupon: mocks.applyCoupon,
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { useCouponUse } from './use-coupon-use';

const CART: { itemCount: number; couponCode: string | null; discount: number; freeship: boolean; couponNotice: string | null } = {
  itemCount: 2,
  couponCode: null,
  discount: 30000,
  freeship: false,
  couponNotice: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useCouponUse(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCart.mockResolvedValue(CART);
  mocks.applyCoupon.mockResolvedValue({ ...CART, couponCode: 'TUBU30' });
});

describe('useCouponUse.apply — "Dùng ngay" ở thẻ mã giảm giá', () => {
  it('chạm đúp: chỉ một lần chọn mã ở giỏ và chuyển trang đúng một lần', async () => {
    const applying = deferred<typeof CART>();
    mocks.applyCoupon.mockReturnValue(applying.promise);
    const { result } = setup();
    let first: Promise<void> | undefined;
    await act(async () => {
      first = result.current.apply('tubu30');
      await result.current.apply('tubu30');
    });
    await act(async () => {
      applying.resolve({ ...CART, couponCode: 'TUBU30' });
      await first;
    });
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
    expect(mocks.applyCoupon).toHaveBeenCalledWith('TUBU30');
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('xong rồi (kể cả khi máy chủ từ chối mã) thì nhả khoá: lần chạm sau chạy lại, lỗi của máy chủ được nói nguyên văn', async () => {
    mocks.applyCoupon.mockRejectedValueOnce({ isHttpError: true, response: { status: 400, data: { message: 'Mã giảm giá này đã được tài khoản khác nhận.' } } });
    const { result } = setup();
    await act(async () => {
      await result.current.apply('TUBU30');
    });
    expect(mocks.notify).toHaveBeenCalledWith({ text: 'Chưa chọn sẵn được mã: Mã giảm giá này đã được tài khoản khác nhận.', type: 'warning' });
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    await act(async () => {
      await result.current.apply('TUBU30');
    });
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
  });

  it('giỏ trống: không áp mã, đưa khách tới danh sách sản phẩm', async () => {
    mocks.getCart.mockResolvedValue({ ...CART, itemCount: 0 });
    const { result } = setup();
    await act(async () => {
      await result.current.apply('TUBU30');
    });
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });
});
