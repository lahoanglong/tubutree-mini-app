import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userId: 'u1', coupons: [] as Array<{ code: string; endAt: string }> }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ status: 'authenticated', user: { id: mocks.userId } }),
}));
vi.mock('../services/account-api', () => ({
  getCoupons: async () => mocks.coupons,
  getDailyCheckInStatus: async () => ({ canCheckInToday: false, checkedInToday: true }),
}));

import { useMarkExpiringSeen, useOffersDot } from './use-offers-dot';

const DAY = 86_400_000;
const soon = (code: string, days: number) => ({ code, endAt: new Date(Date.now() + days * DAY).toISOString() });

const wrap = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

function both(coupons: ReadonlyArray<{ code: string; endAt: string }>) {
  return renderHook(
    () => {
      useMarkExpiringSeen(coupons as never);
      return useOffersDot(true);
    },
    { wrapper: wrap() },
  );
}

describe('chấm đỏ Ưu đãi theo tài khoản (Mini App)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.userId = 'u1';
    mocks.coupons = [];
  });

  it('mã sắp hết hạn: chấm sáng, mở trang Ưu đãi (đánh dấu đã xem) thì tắt', async () => {
    mocks.coupons = [soon('A', 2)];
    const dot = renderHook(() => useOffersDot(true), { wrapper: wrap() });
    await waitFor(() => expect(dot.result.current).not.toBeNull());
    const seen = both(mocks.coupons);
    await waitFor(() => expect(seen.result.current).toBeNull());
  });

  it('mã được gia hạn (endAt đổi) và vẫn sắp hết hạn: chấm sáng lại', async () => {
    mocks.coupons = [soon('A', 2)];
    const first = both(mocks.coupons);
    await waitFor(() => expect(first.result.current).toBeNull());
    mocks.coupons = [soon('A', 1)];
    const again = renderHook(() => useOffersDot(true), { wrapper: wrap() });
    await waitFor(() => expect(again.result.current).not.toBeNull());
  });

  it('đổi tài khoản trên cùng máy: mã tài khoản trước đã xem không tắt chấm của tài khoản sau', async () => {
    mocks.coupons = [soon('A', 2)];
    const first = both(mocks.coupons);
    await waitFor(() => expect(first.result.current).toBeNull());
    mocks.userId = 'u2';
    const other = renderHook(() => useOffersDot(true), { wrapper: wrap() });
    await act(async () => {});
    await waitFor(() => expect(other.result.current).not.toBeNull());
  });
});
