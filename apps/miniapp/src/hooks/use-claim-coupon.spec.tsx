import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: 'authenticated' as 'authenticated' | 'idle',
  login: vi.fn(),
  claimCoupon: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.status, login: mocks.login });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: () => state() });
  return { useAuthStore };
});
vi.mock('../services/coupon-claim', () => ({ claimCoupon: mocks.claimCoupon }));
vi.mock('./use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { useClaimCoupon } from './use-claim-coupon';

const httpError = (status: number, message: string) => ({ isHttpError: true, response: { status, data: { message } } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useClaimCoupon(), { wrapper }), invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = 'authenticated';
  mocks.claimCoupon.mockResolvedValue({ code: 'TUBU30', alreadyClaimed: false });
});

describe('useClaimCoupon', () => {
  it('chưa đăng nhập: mở đăng nhập, không gọi máy chủ, trả false', async () => {
    mocks.status = 'idle';
    const { result } = setup();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.claim('TUBU30');
    });
    expect(ok).toBe(false);
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.claimCoupon).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('thành công: gọi claim đúng mã, báo "Đã lưu vào Mã của tôi", làm mới cả ví lẫn kho, trả true', async () => {
    const { result, invalidate } = setup();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.claim('TUBU30');
    });
    expect(ok).toBe(true);
    expect(mocks.claimCoupon).toHaveBeenCalledWith('TUBU30');
    expect(mocks.notify).toHaveBeenCalledWith({ text: 'Đã lưu vào Mã của tôi', type: 'success' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coupons'] });
    expect(result.current.pendingCode).toBeNull();
  });

  it('lỗi: báo đúng câu của máy chủ, làm mới danh sách kho (cache 30 giây có thể đã cũ), trả false', async () => {
    mocks.claimCoupon.mockRejectedValue(httpError(400, 'Mã giảm giá đã hết lượt nhận.'));
    const { result, invalidate } = setup();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.claim('TUBU30');
    });
    expect(ok).toBe(false);
    expect(mocks.notify).toHaveBeenCalledWith({ text: 'Mã giảm giá đã hết lượt nhận.', type: 'error' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coupons', 'collectable'] });
    expect(result.current.pendingCode).toBeNull();
  });

  it('đang nhận một mã: pendingCode là mã đó; chạm đúp chỉ gọi máy chủ một lần', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.claimCoupon.mockReturnValue(new Promise((r) => (release = r)));
    const { result } = setup();
    let first: Promise<boolean> | undefined;
    let second: boolean | undefined;
    await act(async () => {
      first = result.current.claim('TUBU30');
      second = await result.current.claim('TUBU30');
    });
    expect(second).toBe(false);
    expect(result.current.pendingCode).toBe('TUBU30');
    await act(async () => {
      release({ code: 'TUBU30' });
      await first;
    });
    expect(mocks.claimCoupon).toHaveBeenCalledTimes(1);
    expect(result.current.pendingCode).toBeNull();
  });
});
