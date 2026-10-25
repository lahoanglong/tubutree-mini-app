// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { useRecycleOpenRequests } from './use-recycle-open-requests';

describe('useRecycleOpenRequests (web)', () => {
  beforeEach(() => mocks.get.mockReset());

  it('đọc wasteOpenRequestCount của /home/me (không gọi /waste/me)', async () => {
    mocks.get.mockResolvedValue({ wasteOpenRequestCount: 3 });
    const { result } = renderHook(() => useRecycleOpenRequests(true, true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/home/me', { query: { purchasedLimit: 1 } });
  });

  it('API cũ không có trường, hoặc 0 → ẩn', async () => {
    mocks.get.mockResolvedValue({});
    const { result } = renderHook(() => useRecycleOpenRequests(true, true));
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('chương trình đang chạy hoặc chưa đăng nhập: không hỏi gì', () => {
    expect(renderHook(() => useRecycleOpenRequests(true, false)).result.current).toBe(false);
    expect(renderHook(() => useRecycleOpenRequests(false, true)).result.current).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
