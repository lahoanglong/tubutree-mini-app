import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchActiveOrderCount: vi.fn(), status: 'authenticated' }));
vi.mock('../services/shop-api', () => ({ fetchActiveOrderCount: mocks.fetchActiveOrderCount }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { useActiveOrderCount } from './use-active-order-count';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useActiveOrderCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
  });
  it('trả số đơn đang xử lý', async () => {
    mocks.fetchActiveOrderCount.mockResolvedValue(2);
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
  });
  it('trang con (enabled=false) hoặc chưa đăng nhập → không gọi API, 0', () => {
    renderHook(() => useActiveOrderCount(false), { wrapper });
    mocks.status = 'loading';
    renderHook(() => useActiveOrderCount(true), { wrapper });
    expect(mocks.fetchActiveOrderCount).not.toHaveBeenCalled();
  });
  it('API cũ 404 → 0, không ném', async () => {
    mocks.fetchActiveOrderCount.mockRejectedValue(Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } }));
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(mocks.fetchActiveOrderCount).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });
});
