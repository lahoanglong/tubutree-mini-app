// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ get: vi.fn(), userId: 'u1' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: mocks.userId } }) }));

import { ApiError } from '@/lib/client-api';
import { RECYCLE_OPEN_COUNT_KEY, useRecycleOpenRequests } from './use-recycle-open-requests';

describe('useRecycleOpenRequests (web)', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.userId = 'u1';
  });

  it('hỏi /waste/me/open-count một lần (không gọi /waste/me)', async () => {
    mocks.get.mockResolvedValue({ count: 3 });
    const { result } = renderHook(() => useRecycleOpenRequests(true, true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/waste/me/open-count');
  });

  it('0, thiếu trường hoặc API cũ 404 → ẩn', async () => {
    mocks.get.mockResolvedValue({ count: 0 });
    const zero = renderHook(() => useRecycleOpenRequests(true, true));
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(zero.result.current).toBe(false);
    mocks.get.mockReset();
    mocks.get.mockRejectedValue(new ApiError('Not Found', 404));
    const missing = renderHook(() => useRecycleOpenRequests(true, true));
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(missing.result.current).toBe(false);
  });

  it('khoá có userId và là tiền tố làm mới của Trang chủ', async () => {
    mocks.get.mockResolvedValue({ count: 2 });
    const { result, client } = renderHook(() => useRecycleOpenRequests(true, true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(client.getQueryData([RECYCLE_OPEN_COUNT_KEY, 'u1'])).toBe(2);
  });

  it('chương trình đang chạy hoặc chưa đăng nhập: không hỏi gì', () => {
    expect(renderHook(() => useRecycleOpenRequests(true, false)).result.current).toBe(false);
    expect(renderHook(() => useRecycleOpenRequests(false, true)).result.current).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
