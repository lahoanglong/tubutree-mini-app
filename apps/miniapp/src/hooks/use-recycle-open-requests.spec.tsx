import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), armed: true, take: vi.fn() }));
vi.mock('../services/api', () => ({ api: { get: mocks.get } }));
vi.mock('../services/home-feed', () => ({ isHomeFeedArmed: () => mocks.armed, takeMeBlock: mocks.take }));

import { useRecycleOpenRequests } from './use-recycle-open-requests';

const wrap = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useRecycleOpenRequests (Mini App)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.armed = true;
  });

  it('Trang chủ đang mở: lấy số từ khối gộp /home/me, không gọi request nào thêm', async () => {
    mocks.take.mockResolvedValue(2);
    const { result } = renderHook(() => useRecycleOpenRequests(true, true), { wrapper: wrap() });
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.take).toHaveBeenCalledWith('wasteOpenRequestCount');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('API cũ không có trường (khối null) → 0, ẩn', async () => {
    mocks.take.mockResolvedValue(null);
    const { result } = renderHook(() => useRecycleOpenRequests(true, true), { wrapper: wrap() });
    await waitFor(() => expect(mocks.take).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('ở trang khác (Ưu đãi mở thẳng): hỏi /home/me một lần, không phải /waste/me', async () => {
    mocks.armed = false;
    mocks.get.mockResolvedValue({ data: { wasteOpenRequestCount: 1 } });
    const { result } = renderHook(() => useRecycleOpenRequests(true, true), { wrapper: wrap() });
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/home/me', { params: { purchasedLimit: 1 } });
  });

  it('chương trình đang chạy (paused=false) hoặc chưa đăng nhập: không hỏi gì', () => {
    const { result } = renderHook(() => useRecycleOpenRequests(true, false), { wrapper: wrap() });
    expect(result.current).toBe(false);
    renderHook(() => useRecycleOpenRequests(false, true), { wrapper: wrap() });
    expect(mocks.take).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('lỗi mạng → coi như không có', async () => {
    mocks.armed = false;
    mocks.get.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useRecycleOpenRequests(true, true), { wrapper: wrap() });
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
