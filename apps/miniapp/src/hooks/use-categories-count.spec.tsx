import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchCategories: vi.fn() }));
vi.mock('../services/shop-api', () => ({ fetchCategories: mocks.fetchCategories }));

import { CATEGORY_COUNT_KEY, SEGMENT_ENTRIES, useCategories } from './use-categories';

const cat = (id: string, productCount?: number) => ({ id, parentId: null, name: `DM ${id}`, slug: id, image: null, sortOrder: 1, productCount });

describe('useCategories.placeholderCount — khung chờ khớp lưới thật (carry 4b)', () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

  beforeEach(() => {
    localStorage.clear();
    mocks.fetchCategories.mockReset();
  });

  it('chưa từng thấy danh mục → bằng số phân khúc dự phòng (4)', async () => {
    mocks.fetchCategories.mockResolvedValue([]);
    const { result } = renderHook(() => useCategories(), { wrapper });
    expect(result.current.placeholderCount).toBe(SEGMENT_ENTRIES.length);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('nhớ số ô của lần tải thành công trước → lần mở sau (cache trống) dựng đúng số ô chờ', async () => {
    mocks.fetchCategories.mockResolvedValue([cat('a', 1), cat('b', 2), cat('c', 3), cat('d', 4), cat('e', 5), cat('f', 6)]);
    const first = renderHook(() => useCategories(), { wrapper });
    await waitFor(() => expect(first.result.current.entries).toHaveLength(6));
    await waitFor(() => expect(localStorage.getItem(CATEGORY_COUNT_KEY)).toBe('6'));
    first.unmount();

    mocks.fetchCategories.mockReturnValue(new Promise(() => undefined)); // lần mở sau: chưa có dữ liệu
    const second = renderHook(() => useCategories(), { wrapper });
    expect(second.result.current.isLoading).toBe(true);
    expect(second.result.current.placeholderCount).toBe(6);
  });

  it('giá trị lưu hỏng / ngoài khoảng hợp lý → quay về 4; lỗi tải không ghi đè số đã nhớ', async () => {
    localStorage.setItem(CATEGORY_COUNT_KEY, 'abc');
    mocks.fetchCategories.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useCategories(), { wrapper });
    expect(result.current.placeholderCount).toBe(SEGMENT_ENTRIES.length);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(localStorage.getItem(CATEGORY_COUNT_KEY)).toBe('abc');
    localStorage.setItem(CATEGORY_COUNT_KEY, '9999');
    expect(renderHook(() => useCategories(), { wrapper }).result.current.placeholderCount).toBe(SEGMENT_ENTRIES.length);
  });
});
