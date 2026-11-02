import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ME_SUMMARY_KEY } from '@tubutree/app-core/api/me-summary';

const mocks = vi.hoisted(() => ({ get: vi.fn(), status: 'authenticated' }));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { useActiveOrderCount } from './use-active-order-count';

const summary = (active: number) => ({
  orders: { pending_payment: 1, processing: 0, shipping: 0, delivered: 0, closed: 0, active },
  unreadNotifications: 0,
  activeSubscriptions: 0,
});

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('useActiveOrderCount (từ /me/summary)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
  });
  it('trả số đơn đang xử lý từ một lời gọi /me/summary', async () => {
    mocks.get.mockResolvedValue(summary(2));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0]![0]).toBe('/me/summary');
  });
  it('trang con (enabled=false) → không gọi API, 0', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(false), { wrapper });
    expect(result.current).toBe(0);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('chưa đăng nhập → không gọi API, 0', () => {
    mocks.status = 'loading';
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    expect(result.current).toBe(0);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('summary lỗi (API cũ 404) → query ở trạng thái lỗi, hook trả 0 chứ không ném', async () => {
    mocks.get.mockRejectedValue(Object.assign(new Error('404'), { isHttpError: true, response: { status: 404 } }));
    const { client, wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(client.getQueryState(ME_SUMMARY_KEY)?.status).toBe('error'));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(0);
  });
  it('body sai dạng (route khác trả nhầm { count }) → lỗi, không hiện số', async () => {
    mocks.get.mockResolvedValue({ count: 9 });
    const { client, wrapper } = makeWrapper();
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(client.getQueryState(ME_SUMMARY_KEY)?.status).toBe('error'));
    expect(result.current).toBe(0);
  });
});
