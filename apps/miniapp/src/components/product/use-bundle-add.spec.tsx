import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), addAll: vi.fn(), haptic: vi.fn() }));

vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../services/cart-batch', () => ({ addAllToCart: mocks.addAll }));

import { HttpError } from '../../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';
import { useBundleAdd, type BundleAdd } from './use-bundle-add';

const LINES = [{ variationId: 'v1', quantity: 1 }, { variationId: 'v2', quantity: 1 }];
const BUNDLE: BundleAdd = { id: 'combo-1', lines: LINES, errorKey: 'shop.comboError', successText: 'Đã thêm cả combo' };
const KEYS = [['bundles'], ['product'], ['bought-together'], ['purchased-items']];

const deferred = () => {
  let resolve!: (v?: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
// TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false sau khi lệnh xong.
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

function setup(refresh: () => Promise<unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { invalidate, ...renderHook(() => useBundleAdd(), { wrapper }) };
}

// W113A: "Thêm cả combo" bị máy chủ từ chối vì món hết hàng/ngừng bán/giá đổi (400/404/409) thì ô giữ khoá tới khi giỏ và tồn kho làm mới về (tối đa LOCK_REFRESH_WAIT_MS).
// Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
describe('useBundleAdd — máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W113A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addAll.mockReset();
  });

  it.each([
    [400, 'Sản phẩm Xà phòng đã hết hàng'],
    [404, 'Sản phẩm không còn bán'],
    [409, 'Vừa có thay đổi, bạn thử lại nhé'],
  ])('bị từ chối %i: báo lỗi một lần, tải lại tồn kho (không tải giỏ vì lô bị từ chối cả lô), giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
    mocks.addAll.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({});
    const refresh = deferred();
    const { result, invalidate } = setup(() => refresh.promise);
    act(() => result.current.add(BUNDLE));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.notify.mock.calls.filter((c) => c[0].type === 'error')).toHaveLength(1);
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(KEYS.map((queryKey) => ({ queryKey })));
    // Đã báo lỗi mà dữ liệu chưa về: khoá vẫn giữ, chạm thêm (kể cả sang combo khác) không gửi lần hai.
    expect(result.current.inFlight()).toBe(true);
    expect(result.current.busyId).toBe('combo-1');
    act(() => {
      result.current.add(BUNDLE);
      result.current.add({ ...BUNDLE, id: 'combo-2' });
    });
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(result.current.inFlight()).toBe(false));
    expect(result.current.busyId).toBeUndefined();
    act(() => result.current.add(BUNDLE));
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay', async (_label, error) => {
    mocks.addAll.mockRejectedValueOnce(error).mockResolvedValue({});
    const { result, invalidate } = setup(() => new Promise(() => undefined));
    act(() => result.current.add(BUNDLE));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(result.current.inFlight()).toBe(false));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => result.current.add(BUNDLE));
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledTimes(2));
  });

  it('thành công: tải lại giỏ như cũ, khoá nhả, không động tới khoá tồn kho', async () => {
    mocks.addAll.mockResolvedValue({});
    const { result, invalidate } = setup(() => Promise.resolve());
    act(() => result.current.add(BUNDLE));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text: 'Đã thêm cả combo' })));
    await waitFor(() => expect(result.current.inFlight()).toBe(false));
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['cart'] }]);
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.addAll.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue({});
    const { result } = setup(() => new Promise(() => undefined));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => result.current.add(BUNDLE));
      await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(result.current.inFlight()).toBe(true);
      expect(result.current.busyId).toBe('combo-1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(result.current.inFlight()).toBe(false));
    } finally {
      vi.useRealTimers();
    }
    act(() => result.current.add(BUNDLE));
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledTimes(2));
  });
});
