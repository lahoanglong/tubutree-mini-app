import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), armed: true, take: vi.fn(), userId: 'u1' }));
vi.mock('../services/api', () => ({ api: { get: mocks.get } }));
vi.mock('../services/home-feed', () => ({ isHomeFeedArmed: () => mocks.armed, takeMeBlock: mocks.take }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: mocks.userId } }) }));
vi.mock('../services/http', () => ({ isHttpError: (e: unknown) => typeof e === 'object' && e !== null && 'response' in e }));

import { RECYCLE_OPEN_COUNT_KEY, useRecycleOpenRequests } from './use-recycle-open-requests';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('useRecycleOpenRequests (Mini App)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.armed = true;
    mocks.userId = 'u1';
  });

  it('Trang chủ đang mở: lấy số từ khối gộp /home/me, không gọi request nào thêm', async () => {
    mocks.take.mockResolvedValue(2);
    const { wrapper } = setup();
    const { result } = renderHook(() => useRecycleOpenRequests(true, true), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.take).toHaveBeenCalledWith('wasteOpenRequestCount');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('khối đã bị nhận (lần tải lại) hoặc API cũ không có trường → hỏi endpoint nhẹ, không rơi về 0 và không gọi /waste/me', async () => {
    mocks.take.mockResolvedValue(null);
    mocks.get.mockResolvedValue({ data: { count: 3 } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useRecycleOpenRequests(true, true), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/waste/me/open-count');
  });

  it('kéo làm mới: làm mới khoá theo tiền tố của Trang chủ thì lần sau lấy số mới từ endpoint', async () => {
    mocks.take.mockResolvedValueOnce(1).mockResolvedValue(null);
    mocks.get.mockResolvedValue({ data: { count: 0 } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useRecycleOpenRequests(true, true), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
    await client.invalidateQueries({ queryKey: [RECYCLE_OPEN_COUNT_KEY] });
    await waitFor(() => expect(result.current).toBe(false));
    expect(mocks.get).toHaveBeenCalledWith('/waste/me/open-count');
  });

  it('khoá có userId: đổi tài khoản không mang số của người trước', async () => {
    mocks.armed = false;
    mocks.get.mockResolvedValueOnce({ data: { count: 2 } }).mockResolvedValueOnce({ data: { count: 0 } });
    const { client, wrapper } = setup();
    const first = renderHook(() => useRecycleOpenRequests(true, true), { wrapper });
    await waitFor(() => expect(first.result.current).toBe(true));
    mocks.userId = 'u2';
    const second = renderHook(() => useRecycleOpenRequests(true, true), { wrapper });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(second.result.current).toBe(false);
    expect(client.getQueryData([RECYCLE_OPEN_COUNT_KEY, 'u1'])).toBe(2);
  });

  it('API cũ 404 → 0, ẩn', async () => {
    mocks.armed = false;
    mocks.get.mockRejectedValue({ response: { status: 404 } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useRecycleOpenRequests(true, true), { wrapper });
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('chương trình đang chạy hoặc chưa đăng nhập: không hỏi gì', () => {
    const { wrapper } = setup();
    expect(renderHook(() => useRecycleOpenRequests(true, false), { wrapper }).result.current).toBe(false);
    renderHook(() => useRecycleOpenRequests(false, true), { wrapper });
    expect(mocks.take).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
