import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchActiveFlashSales: vi.fn() }));
vi.mock('../services/shop-api', () => ({ fetchActiveFlashSales: mocks.fetchActiveFlashSales }));

import { useFlashSalesPoller } from './use-flash-sales-poller';

describe('useFlashSalesPoller — chủ duy nhất của nhịp tải lại Giờ vàng', () => {
  it('gắn refetchInterval vào queryKey dùng chung, nhịp sát mốc kết thúc gần nhất', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([{ itemId: 'a', endAt: new Date(Date.now() + 20_000).toISOString() }]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => useFlashSalesPoller(), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['flash-sales', 'active'])).toBeTruthy());
    const query = qc.getQueryCache().find({ queryKey: ['flash-sales', 'active'] })!;
    expect(query.observers).toHaveLength(1);
    const interval = query.observers[0]!.options.refetchInterval as (q: unknown) => number | false;
    const ms = interval(query);
    expect(ms).toBeGreaterThan(15_000);
    expect(ms).toBeLessThanOrEqual(20_000);
  });

  it('không có suất đang chạy: không đặt nhịp nào', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => useFlashSalesPoller(), { wrapper });
    await waitFor(() => expect(qc.getQueryData(['flash-sales', 'active'])).toEqual([]));
    const query = qc.getQueryCache().find({ queryKey: ['flash-sales', 'active'] })!;
    expect((query.observers[0]!.options.refetchInterval as (q: unknown) => number | false)(query)).toBe(false);
  });
});
