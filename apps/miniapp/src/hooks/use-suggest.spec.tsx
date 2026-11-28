import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ suggestProductsMeta: vi.fn() }));
vi.mock('../services/shop-api', () => ({ suggestProductsMeta: mocks.suggestProductsMeta }));

import type { SuggestMeta } from '@tubutree/app-core/api/catalog';
import { SUGGEST_DEBOUNCE_MS, SUGGEST_MIN_CHARS, useSuggest } from './use-suggest';

const P = { slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65000 };
const meta = (items: (typeof P)[], didYouMean: string | null = null): SuggestMeta => ({ items, corrected: didYouMean !== null, didYouMean });
const Q = { slug: 'nrb', name: 'Nước rửa bình', thumbnail: null, basePrice: 45000 };

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
/** Chạy hết timer (debounce + lịch của react-query) trong act. */
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('useSuggest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('hằng số theo spec: debounce 250ms, từ 2 ký tự', () => {
    expect(SUGGEST_DEBOUNCE_MS).toBe(250);
    expect(SUGGEST_MIN_CHARS).toBe(2);
  });

  it('gõ liên tục → chỉ 1 lần gọi, với từ khoá CUỐI (đã trim), sau khi ngừng gõ', async () => {
    mocks.suggestProductsMeta.mockResolvedValue(meta([P]));
    const { result, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: '' }, wrapper });
    rerender({ d: 'n' });
    rerender({ d: 'nu' });
    await advance(SUGGEST_DEBOUNCE_MS - 50);
    rerender({ d: 'nuo ' });
    await advance(SUGGEST_DEBOUNCE_MS - 1);
    expect(mocks.suggestProductsMeta).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.suggestProductsMeta).toHaveBeenCalledTimes(1);
    expect(mocks.suggestProductsMeta).toHaveBeenCalledWith('nuo');
    await advance(0);
    expect(result.current.products).toEqual([P]);
  });

  it('dưới 2 ký tự (sau trim) → không gọi API, products rỗng', async () => {
    const { result, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: 'n' }, wrapper });
    await advance(SUGGEST_DEBOUNCE_MS + 500);
    rerender({ d: '  n  ' });
    await advance(SUGGEST_DEBOUNCE_MS + 500);
    expect(mocks.suggestProductsMeta).not.toHaveBeenCalled();
    expect(result.current.products).toEqual([]);
    expect(result.current.isFetching).toBe(false);
  });

  it('xoá bớt xuống dưới 2 ký tự → ẩn gợi ý NGAY (không chờ debounce) và không gọi thêm', async () => {
    mocks.suggestProductsMeta.mockResolvedValue(meta([P]));
    const { result, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: 'nuoc' }, wrapper });
    await advance(SUGGEST_DEBOUNCE_MS);
    expect(result.current.products).toEqual([P]);
    rerender({ d: 'n' });
    expect(result.current.products).toEqual([]);
    await advance(SUGGEST_DEBOUNCE_MS + 500);
    expect(result.current.products).toEqual([]);
    expect(mocks.suggestProductsMeta).toHaveBeenCalledTimes(1);
  });

  it('đổi ý trước khi hết debounce (về rỗng) → huỷ việc đang chờ, không gọi API', async () => {
    const { rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: '' }, wrapper });
    rerender({ d: 'ab' });
    await advance(SUGGEST_DEBOUNCE_MS - 50);
    rerender({ d: '' });
    await advance(SUGGEST_DEBOUNCE_MS + 500);
    expect(mocks.suggestProductsMeta).not.toHaveBeenCalled();
  });

  it('chuỗi chỉ toàn khoảng trắng / chỉ dấu kết hợp không đủ 2 ký tự chữ → không gọi API', async () => {
    renderHook(() => useSuggest('   '), { wrapper });
    renderHook(() => useSuggest(' đ '), { wrapper });
    await advance(SUGGEST_DEBOUNCE_MS + 500);
    expect(mocks.suggestProductsMeta).not.toHaveBeenCalled();
  });

  it('đua: gõ "ab" rồi "abc" — phản hồi của "ab" về SAU không được ghi đè kết quả của "abc"', async () => {
    const first = deferred<SuggestMeta>();
    const second = deferred<SuggestMeta>();
    mocks.suggestProductsMeta.mockImplementation((q: string) => (q === 'ab' ? first.promise : second.promise));
    const { result, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: 'ab' }, wrapper });
    await advance(SUGGEST_DEBOUNCE_MS);
    expect(mocks.suggestProductsMeta).toHaveBeenLastCalledWith('ab');
    rerender({ d: 'abc' });
    await advance(SUGGEST_DEBOUNCE_MS);
    expect(mocks.suggestProductsMeta).toHaveBeenLastCalledWith('abc');

    second.resolve(meta([Q]));
    await advance(0);
    expect(result.current.products).toEqual([Q]);
    first.resolve(meta([P])); // về muộn
    await advance(SUGGEST_DEBOUNCE_MS + 500);
    expect(result.current.products).toEqual([Q]);
    expect(result.current.isFetching).toBe(false);
  });

  it('đổi từ khoá (vẫn ≥2 ký tự) → giữ danh sách của từ khoá trước trong lúc tải, không nhấp nháy; có kết quả mới thì thay', async () => {
    const second = deferred<SuggestMeta>();
    mocks.suggestProductsMeta.mockImplementation((q: string) => (q === 'ab' ? Promise.resolve(meta([P])) : second.promise));
    const { result, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: 'ab' }, wrapper });
    await advance(SUGGEST_DEBOUNCE_MS);
    expect(result.current.products).toEqual([P]);

    rerender({ d: 'abc' });
    await advance(SUGGEST_DEBOUNCE_MS); // đã gọi API cho "abc", chưa có phản hồi
    expect(mocks.suggestProductsMeta).toHaveBeenLastCalledWith('abc');
    expect(result.current.isFetching).toBe(true);
    expect(result.current.products).toEqual([P]);

    // Cổng vẫn mở: render lại (không đổi gì / gõ thêm) trong lúc chờ vẫn giữ danh sách cũ.
    rerender({ d: 'abc' });
    expect(result.current.products).toEqual([P]);
    rerender({ d: 'abcd' });
    expect(result.current.products).toEqual([P]);

    second.resolve(meta([Q]));
    await advance(0);
    expect(result.current.products).toEqual([Q]);
    expect(result.current.isFetching).toBe(false);
  });

  it('xoá xuống dưới 2 ký tự rồi gõ từ khoá mới → KHÔNG hiện lại kết quả của từ khoá cũ trong lúc tải', async () => {
    const second = deferred<SuggestMeta>();
    mocks.suggestProductsMeta.mockImplementation((q: string) => (q === 'ab' ? Promise.resolve(meta([P])) : second.promise));
    const { result, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: 'ab' }, wrapper });
    await advance(SUGGEST_DEBOUNCE_MS);
    expect(result.current.products).toEqual([P]);

    rerender({ d: 'a' });
    expect(result.current.products).toEqual([]);
    await advance(SUGGEST_DEBOUNCE_MS + 100);
    rerender({ d: 'xy' });
    expect(result.current.products).toEqual([]);
    await advance(SUGGEST_DEBOUNCE_MS);
    expect(mocks.suggestProductsMeta).toHaveBeenLastCalledWith('xy');
    expect(result.current.isFetching).toBe(true);
    expect(result.current.products).toEqual([]);

    // Render lại khi request còn đang bay (cùng từ khoá, rồi gõ thêm) vẫn không được lộ danh sách cũ.
    rerender({ d: 'xy' });
    expect(result.current.products).toEqual([]);
    rerender({ d: 'xyz' });
    expect(result.current.products).toEqual([]);
    await advance(0);
    expect(result.current.products).toEqual([]);

    second.resolve(meta([Q]));
    await advance(0);
    expect(result.current.products).toEqual([Q]);
  });

  it('API lỗi → products rỗng, không ném, nhưng báo isError để màn hiện "Không tải được gợi ý" và Thử lại gọi lại API', async () => {
    mocks.suggestProductsMeta.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useSuggest('nuoc'), { wrapper });
    await advance(SUGGEST_DEBOUNCE_MS);
    await advance(0);
    expect(mocks.suggestProductsMeta).toHaveBeenCalledTimes(1);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.products).toEqual([]);
    expect(result.current.isError).toBe(true);
    mocks.suggestProductsMeta.mockResolvedValue(meta([P]));
    await act(async () => {
      result.current.refetch();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.suggestProductsMeta).toHaveBeenCalledTimes(2);
    expect(result.current.isError).toBe(false);
    expect(result.current.products).toEqual([P]);
  });

  it('gọi /search/suggest?meta=1 và trả didYouMean khi API báo đã sửa gõ sai (cờ catalog.search_fuzzy_enabled bật)', async () => {
    mocks.suggestProductsMeta.mockResolvedValue(meta([P], 'nước rửa chén'));
    const { result } = renderHook(() => useSuggest('nuoc rua chen'), { wrapper });
    await advance(SUGGEST_DEBOUNCE_MS);
    await advance(0);
    expect(result.current.products).toEqual([P]);
    expect(result.current.didYouMean).toBe('nước rửa chén');
  });

  it('cờ chịu gõ sai tắt (corrected=false, dù API còn gửi cụm): didYouMean là null', async () => {
    mocks.suggestProductsMeta.mockResolvedValue({ items: [P], corrected: false, didYouMean: 'nước rửa chén' });
    const { result } = renderHook(() => useSuggest('nuoc rua chen'), { wrapper });
    await advance(SUGGEST_DEBOUNCE_MS);
    await advance(0);
    expect(result.current.products).toEqual([P]);
    expect(result.current.didYouMean).toBeNull();
  });

  it('xoá xuống dưới 2 ký tự: didYouMean cũng ẩn ngay', async () => {
    mocks.suggestProductsMeta.mockResolvedValue(meta([P], 'nước rửa chén'));
    const { result, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: 'nuoc rua chen' }, wrapper });
    await advance(SUGGEST_DEBOUNCE_MS);
    await advance(0);
    expect(result.current.didYouMean).toBe('nước rửa chén');
    rerender({ d: 'n' });
    expect(result.current.didYouMean).toBeNull();
    expect(result.current.products).toEqual([]);
  });

  it('unmount khi đang chờ debounce → không gọi API', async () => {
    const { unmount, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: '' }, wrapper });
    rerender({ d: 'nuoc' });
    await advance(SUGGEST_DEBOUNCE_MS - 50);
    unmount();
    await advance(SUGGEST_DEBOUNCE_MS + 500);
    expect(mocks.suggestProductsMeta).not.toHaveBeenCalled();
  });
});
