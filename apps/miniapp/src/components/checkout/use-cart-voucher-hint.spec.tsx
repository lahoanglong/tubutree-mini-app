import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import type { CouponPreviewDTO } from '@tubutree/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  previews: vi.fn(),
  apply: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('./use-coupon-hint', () => ({ useCouponPreviews: h.previews }));
vi.mock('../../services/shop-api', () => ({ applyCoupon: h.apply }));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e as Error).message }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: h.notify }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { useCartVoucherHint } from './use-cart-voucher-hint';

const coupon = (code: string, over: Partial<CouponDTO> = {}): CouponDTO => ({
  code,
  type: 'AMOUNT',
  value: 20_000,
  minOrder: null,
  maxDiscount: null,
  endAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  ...over,
});
const usable = (code: string, discount: number): CouponPreviewDTO => ({ code, eligible: true, discount });
const OPTS = { currentCode: null, subtotal: 250_000, previewParams: {}, previewKey: 'k' };

function setup(opts: Parameters<typeof useCartVoucherHint>[0] = OPTS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, invalidate, ...renderHook((props: typeof opts) => useCartVoucherHint(props), { wrapper, initialProps: opts }) };
}

beforeEach(() => {
  h.previews.mockReset();
  h.apply.mockReset();
  h.notify.mockReset();
});

describe('useCartVoucherHint (Mini)', () => {
  it('chưa có xem trước của máy chủ: không có gợi ý, không đoán', () => {
    h.previews.mockReturnValue(null);
    const { result } = setup();
    expect(result.current.hint).toBeNull();
    expect(result.current.applying).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('giỏ đã có mã: không hỏi xem trước (enabled=false) và không có gợi ý', () => {
    h.previews.mockReturnValue(null);
    const { result } = setup({ ...OPTS, currentCode: 'DACO' });
    expect(h.previews).toHaveBeenCalledWith(false, expect.anything(), 'k');
    expect(result.current.hint).toBeNull();
  });

  it('có mã đủ điều kiện: hint.apply theo số của máy chủ; xem trước gọi với enabled=true', () => {
    h.previews.mockReturnValue({ wallet: [coupon('GIAM45')], previews: [usable('GIAM45', 45_000)] });
    const { result } = setup();
    expect(h.previews).toHaveBeenCalledWith(true, expect.anything(), 'k');
    expect(result.current.hint?.apply).toMatchObject({ code: 'GIAM45', saving: 45_000 });
  });

  it('áp thành công: gọi applyCoupon với mã in hoa, ghi giỏ vào cache, làm mới báo giá, báo "Đã áp dụng mã …"', async () => {
    h.previews.mockReturnValue({ wallet: [coupon('GIAM45')], previews: [usable('GIAM45', 45_000)] });
    const cart = { items: [], couponCode: 'GIAM45' };
    h.apply.mockResolvedValue(cart);
    const { result, qc, invalidate } = setup();
    act(() => result.current.apply('giam45'));
    await waitFor(() => expect(h.notify).toHaveBeenCalledTimes(1));
    expect(h.apply).toHaveBeenCalledWith('GIAM45');
    expect(qc.getQueryData(['cart', null])).toBe(cart);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['quote'] });
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã áp dụng mã GIAM45', type: 'success' }));
  });

  it('áp lỗi: lời báo của máy chủ hiện cho đúng mã đang mời; đổi sang mã khác thì không hiện lỗi của mã cũ', async () => {
    h.previews.mockReturnValue({ wallet: [coupon('GIAM45')], previews: [usable('GIAM45', 45_000)] });
    h.apply.mockRejectedValue(new Error('Mã đã hết lượt dùng.'));
    const { result, rerender, invalidate } = setup();
    act(() => result.current.apply('giam45'));
    await waitFor(() => expect(result.current.error).toBe('Mã đã hết lượt dùng.'));
    // Mã bị từ chối: hỏi lại xem trước và ví để dải không giữ câu "đủ điều kiện" đã sai.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coupon-previews'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coupons'] });
    expect(h.notify).not.toHaveBeenCalled();

    h.previews.mockReturnValue({ wallet: [coupon('KHAC30')], previews: [usable('KHAC30', 30_000)] });
    rerender(OPTS);
    expect(result.current.hint?.apply?.code).toBe('KHAC30');
    expect(result.current.error).toBeNull();
  });

  it('đang áp: applying=true và cú chạm thứ hai không gọi máy chủ lần nữa', async () => {
    h.previews.mockReturnValue({ wallet: [coupon('GIAM45')], previews: [usable('GIAM45', 45_000)] });
    let release: (v: unknown) => void = () => {};
    h.apply.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result } = setup();
    act(() => result.current.apply('GIAM45'));
    await waitFor(() => expect(result.current.applying).toBe(true));
    act(() => result.current.apply('GIAM45'));
    expect(h.apply).toHaveBeenCalledTimes(1);
    await act(async () => release({ items: [], couponCode: 'GIAM45' }));
    await waitFor(() => expect(result.current.applying).toBe(false));
  });

  describe('khoá chạm đúp đồng bộ (W81A)', () => {
    const pending = <T,>() => {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    const CART = { items: [], couponCode: 'GIAM45' };

    beforeEach(() => {
      h.previews.mockReturnValue({ wallet: [coupon('GIAM45'), coupon('KHAC30')], previews: [usable('GIAM45', 45_000), usable('KHAC30', 30_000)] });
    });

    it('hai cú chạm cùng một khung hình, chưa kịp vẽ lại: chỉ gọi applyCoupon một lần', async () => {
      const call = pending<typeof CART>();
      h.apply.mockReturnValue(call.promise);
      const { result } = setup();
      await act(async () => {
        result.current.apply('GIAM45');
        result.current.apply('GIAM45');
      });
      expect(h.apply).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(result.current.applying).toBe(true));
      await act(async () => call.resolve(CART));
      await waitFor(() => expect(result.current.applying).toBe(false));
    });

    it('hai mã khác nhau liền nhau: giỏ chỉ có một mã nên chỉ mã chạm trước được gửi', async () => {
      const call = pending<typeof CART>();
      h.apply.mockReturnValue(call.promise);
      const { result } = setup();
      await act(async () => {
        result.current.apply('GIAM45');
        result.current.apply('KHAC30');
      });
      expect(h.apply).toHaveBeenCalledTimes(1);
      expect(h.apply).toHaveBeenCalledWith('GIAM45');
      await act(async () => call.resolve(CART));
    });

    it('lệnh bị từ chối thì nhả khoá: lời báo lỗi hiện và chạm lại gọi được lần hai', async () => {
      h.apply.mockRejectedValueOnce(new Error('Mã đã hết lượt dùng.')).mockResolvedValue(CART);
      const { result } = setup();
      await act(async () => result.current.apply('GIAM45'));
      await waitFor(() => expect(result.current.error).toBe('Mã đã hết lượt dùng.'));
      await act(async () => result.current.apply('GIAM45'));
      expect(h.apply).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(h.notify).toHaveBeenCalledTimes(1));
    });

    it('lệnh thành công thì nhả khoá: áp lại sau đó vẫn gọi được', async () => {
      h.apply.mockResolvedValue(CART);
      const { result } = setup();
      await act(async () => result.current.apply('GIAM45'));
      await waitFor(() => expect(h.notify).toHaveBeenCalledTimes(1));
      await act(async () => result.current.apply('KHAC30'));
      expect(h.apply).toHaveBeenCalledTimes(2);
      expect(h.apply).toHaveBeenLastCalledWith('KHAC30');
    });
  });
});
