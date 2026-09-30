import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchActiveOrderCount: vi.fn(), status: 'authenticated' }));
vi.mock('../services/shop-api', () => ({ fetchActiveOrderCount: mocks.fetchActiveOrderCount }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { ACTIVE_ORDER_COUNT_KEY, useActiveOrderCount } from './use-active-order-count';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('useActiveOrderCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
  });
  it('trả số đơn đang xử lý', async () => {
    mocks.fetchActiveOrderCount.mockResolvedValue(2);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
  });
  it('trang con (enabled=false) → không gọi API, 0', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(false), { wrapper });
    expect(result.current).toBe(0);
    expect(mocks.fetchActiveOrderCount).not.toHaveBeenCalled();
  });
  it('chưa đăng nhập → không gọi API, 0', () => {
    mocks.status = 'loading';
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    expect(result.current).toBe(0);
    expect(mocks.fetchActiveOrderCount).not.toHaveBeenCalled();
  });
  it('API cũ 404 → query kết thúc ở trạng thái lỗi nhưng hook vẫn trả 0, không ném', async () => {
    mocks.fetchActiveOrderCount.mockRejectedValue(Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } }));
    const { client, wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(client.getQueryState(ACTIVE_ORDER_COUNT_KEY)?.status).toBe('error'));
    expect(mocks.fetchActiveOrderCount).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(0);
  });
});
