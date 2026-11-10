import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), addToCart: vi.fn(), addAll: vi.fn(), haptic: vi.fn() }));

vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../utils/cart-feedback', () => ({ playCartFeedback: vi.fn() }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../services/cart-batch', () => ({ addAllToCart: mocks.addAll }));
vi.mock('../../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addToCart: mocks.addToCart,
}));

import { HttpError } from '../../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';
import { useQuickReorder } from './use-quick-reorder';

const ITEM = { key: 'v1', productId: 'p1', slug: 'sp-1', variationId: 'v1', name: 'Dầu gội', thumbnail: null, price: 100_000, compareAt: null, savePct: 0, isFlash: false } as unknown as QuickReorderItem;
const CART = { items: [{ id: 'l1', variationId: 'v1', quantity: 1 }], itemCount: 1 };

const deferred = () => {
  let resolve!: (v?: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
const errorNotices = () => mocks.notify.mock.calls.filter((c) => c[0].type === 'error').length;
// TanStack báo cache qua setTimeout(0): đợi một nhịp để trạng thái kịp cập nhật sau khi lệnh xong.
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

function setup(refresh: () => Promise<unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, invalidate, ...renderHook(() => useQuickReorder(), { wrapper }) };
}

// W113A: một chạm "thêm lại" bị máy chủ từ chối vì món hết hàng/ngừng bán/giá đổi (400/404/409) thì khoá và vòng bận giữ tới khi giỏ và dải làm mới về (tối đa LOCK_REFRESH_WAIT_MS).
// Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
describe('useQuickReorder.addOne — máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W113A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addToCart.mockReset();
    mocks.addAll.mockReset();
  });

  it.each([
    [400, 'Sản phẩm đã hết hàng'],
    [404, 'Sản phẩm không còn bán'],
    [409, 'Vừa có thay đổi, bạn thử lại nhé'],
  ])('bị từ chối %i: báo lỗi một lần, tải lại giỏ và dải, giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
    mocks.addToCart.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(CART);
    const refresh = deferred();
    const { result, invalidate } = setup(() => refresh.promise);
    act(() => void result.current.addOne(ITEM));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ text: message, type: 'error' })));
    expect(errorNotices()).toBe(1);
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['cart'] }, { queryKey: ['purchased-items'] }]);
    // Đã báo lỗi mà dữ liệu chưa về: thẻ vẫn bận, chạm thêm (kể cả "Thêm lại tất cả") không gửi lệnh nào.
    expect(result.current.busyKey).toBe('v1');
    act(() => {
      void result.current.addOne(ITEM);
      void result.current.addOne(ITEM);
      result.current.addAll([ITEM]);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addAll).not.toHaveBeenCalled();
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(result.current.busyKey).toBeNull());
    expect(errorNotices()).toBe(1);
    act(() => void result.current.addOne(ITEM));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay', async (_label, error) => {
    mocks.addToCart.mockRejectedValueOnce(error).mockResolvedValue(CART);
    const { result, invalidate } = setup(() => new Promise(() => undefined));
    act(() => void result.current.addOne(ITEM));
    await waitFor(() => expect(errorNotices()).toBe(1));
    await waitFor(() => expect(result.current.busyKey).toBeNull());
    expect(invalidate).not.toHaveBeenCalled();
    act(() => void result.current.addOne(ITEM));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
  });

  it('thành công: ghi giỏ vào cache, không tải lại, khoá nhả', async () => {
    mocks.addToCart.mockResolvedValue(CART);
    const { result, invalidate, qc } = setup(() => Promise.resolve());
    act(() => void result.current.addOne(ITEM));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    await waitFor(() => expect(result.current.busyKey).toBeNull());
    expect(qc.getQueryData(['cart', null])).toEqual(CART);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.addToCart.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(CART);
    const { result } = setup(() => new Promise(() => undefined));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => void result.current.addOne(ITEM));
      await waitFor(() => expect(errorNotices()).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(result.current.busyKey).toBe('v1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(result.current.busyKey).toBeNull());
    } finally {
      vi.useRealTimers();
    }
    act(() => void result.current.addOne(ITEM));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
  });
});
