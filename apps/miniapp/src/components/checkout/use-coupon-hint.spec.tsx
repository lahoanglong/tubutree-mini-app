import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  getCoupons: vi.fn(),
  getCouponPreviews: vi.fn(),
  applyCoupon: vi.fn(),
  removeCoupon: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: h.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCoupons: h.getCoupons,
}));
vi.mock('../../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  applyCoupon: h.applyCoupon,
  removeCoupon: h.removeCoupon,
  getCouponPreviews: h.getCouponPreviews,
}));

import { useCheckoutCoupon } from './use-coupon-hint';
import { HttpError } from '../../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';

const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
const deferred = () => {
  let resolve!: (v?: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
const CART = { items: [], couponCode: null, subtotal: 50_000, discount: 0, freeship: false, itemCount: 1 };
const APPLIED = { ...CART, couponCode: 'WELCOME30', discount: 30_000 };
/** Đúng thứ tự `holdForCouponReload` đọc lại: xem trước, ví mã, giỏ, báo giá. */
const RELOAD_KEYS = [{ queryKey: ['coupon-previews'] }, { queryKey: ['coupons'] }, { queryKey: ['cart'] }, { queryKey: ['quote'] }];

function setup(over: Partial<Parameters<typeof useCheckoutCoupon>[0]> = {}, refresh: () => Promise<unknown> = () => Promise.resolve()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const opts = {
    enabled: true,
    autoAllowed: true,
    userId: 'u1',
    cartLoaded: true,
    currentCode: null as string | null,
    previewParams: {},
    previewKey: 'k',
    onChanged: vi.fn(),
    ...over,
  };
  const view = renderHook(() => useCheckoutCoupon(opts), { wrapper });
  return { ...view, invalidate, qc };
}
const filters = (invalidate: ReturnType<typeof setup>['invalidate']) => invalidate.mock.calls.map(([filter]) => filter);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.getCoupons.mockResolvedValue([{ code: 'WELCOME30', type: 'AMOUNT', value: 30_000, minOrder: null, maxDiscount: null, endAt: null }]);
  h.getCouponPreviews.mockResolvedValue([{ code: 'WELCOME30', eligible: true, discount: 30_000 }]);
  h.applyCoupon.mockReset();
  h.removeCoupon.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

// W113A: tự áp và gỡ mã bị máy chủ từ chối vì màn đã cũ (400/404/409) thì đọc lại xem trước, ví mã, giỏ, báo giá và giữ cờ bận tới khi dữ liệu về (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx không nói gì về giỏ: nhả ngay, không đọc lại.
describe('useCheckoutCoupon — máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W113A)', () => {
  describe('tự áp mã (không có onError trước đây)', () => {
    it.each([
      [400, 'Mã đã hết lượt.'],
      [404, 'Không tìm thấy mã.'],
      [409, 'Giỏ vừa đổi.'],
    ])('bị từ chối %i: đọc lại đúng bốn khoá, `busy` giữ tới khi dữ liệu về rồi mới nhả; không tự áp lại', async (status, message) => {
      h.applyCoupon.mockRejectedValue(serverError(message, status));
      const refresh = deferred();
      const { result, invalidate } = setup({}, () => refresh.promise);
      await waitFor(() => expect(h.applyCoupon).toHaveBeenCalledTimes(1), { timeout: 3_000 });
      expect(h.applyCoupon).toHaveBeenCalledWith('WELCOME30');
      await waitFor(() => expect(filters(invalidate)).toEqual(RELOAD_KEYS));
      expect(result.current.busy).toBe(true);
      await act(async () => refresh.resolve());
      await waitFor(() => expect(result.current.busy).toBe(false));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      expect(h.applyCoupon).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: im lặng như trước, không đọc lại, `busy` nhả ngay', async (_label, error) => {
      h.applyCoupon.mockRejectedValue(error);
      const { result, invalidate } = setup({}, () => new Promise(() => undefined));
      await waitFor(() => expect(h.applyCoupon).toHaveBeenCalledTimes(1), { timeout: 3_000 });
      await waitFor(() => expect(result.current.busy).toBe(false));
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('đọc lại treo mãi: `busy` nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      h.applyCoupon.mockRejectedValue(serverError('Giỏ vừa đổi.', 409));
      const { result } = setup({}, () => new Promise(() => undefined));
      await waitFor(() => expect(h.applyCoupon).toHaveBeenCalledTimes(1), { timeout: 3_000 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(result.current.busy).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(result.current.busy).toBe(false));
    });
  });

  describe('gỡ mã', () => {
    const withCode = () => setup({ currentCode: 'WELCOME30', enabled: false });

    it.each([
      [400, 'Giỏ chưa có mã nào.'],
      [404, 'Không tìm thấy giỏ.'],
      [409, 'Giỏ vừa đổi.'],
    ])('bị từ chối %i: báo lỗi một lần, đọc lại đúng bốn khoá, giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      h.removeCoupon.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(CART);
      const refresh = deferred();
      const { result, invalidate } = setup({ currentCode: 'WELCOME30', enabled: false }, () => refresh.promise);
      act(() => result.current.remove());
      await waitFor(() => expect(h.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
      expect(h.openSnackbar).toHaveBeenCalledTimes(1);
      expect(filters(invalidate)).toEqual(RELOAD_KEYS);
      expect(result.current.removing).toBe(true);
      act(() => {
        result.current.remove();
        result.current.remove();
      });
      expect(h.removeCoupon).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await waitFor(() => expect(result.current.removing).toBe(false));
      act(() => result.current.remove());
      await waitFor(() => expect(h.removeCoupon).toHaveBeenCalledTimes(2));
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: báo lỗi, không đọc lại, nhả khoá ngay', async (_label, error) => {
      h.removeCoupon.mockRejectedValueOnce(error).mockResolvedValue(CART);
      const { result, invalidate } = withCode();
      act(() => result.current.remove());
      await waitFor(() => expect(h.openSnackbar).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.removing).toBe(false));
      expect(invalidate).not.toHaveBeenCalled();
      act(() => result.current.remove());
      await waitFor(() => expect(h.removeCoupon).toHaveBeenCalledTimes(2));
    });

    it('đọc lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      h.removeCoupon.mockRejectedValueOnce(serverError('Giỏ vừa đổi.', 409)).mockResolvedValue(APPLIED);
      const { result } = setup({ currentCode: 'WELCOME30', enabled: false }, () => new Promise(() => undefined));
      act(() => result.current.remove());
      await waitFor(() => expect(h.openSnackbar).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      act(() => result.current.remove());
      expect(h.removeCoupon).toHaveBeenCalledTimes(1);
      expect(result.current.removing).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(result.current.removing).toBe(false));
      act(() => result.current.remove());
      await waitFor(() => expect(h.removeCoupon).toHaveBeenCalledTimes(2));
    });
  });
});
