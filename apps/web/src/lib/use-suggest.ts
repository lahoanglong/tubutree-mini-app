'use client';

import { useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { suggestQuery } from '@tubutree/app-core/queries/catalog';
import { popularSearchesQuery } from '@tubutree/app-core/browse/search-ux';
import { coreHttp } from './core-http';
import { useDebounced } from './use-debounced';
import { foldVietnamese } from './vn-fold';

export const SUGGEST_DEBOUNCE_MS = 250;
export const SUGGEST_MIN_CHARS = 2;

/** Từ khoá đủ dài để gọi /search/suggest: API gấp dấu rồi trả [] cho dưới 2 ký tự, nên "đ" hay " a " chưa tính. */
export const isSuggestable = (s: string) => foldVietnamese(s).length >= SUGGEST_MIN_CHARS;

/**
 * Gợi ý sản phẩm khi gõ: debounce 250ms, từ 2 ký tự; lỗi thì báo "Không tải được gợi ý" kèm Thử lại (không nuốt lỗi), lịch sử tìm vẫn hiện.
 * Query key theo từ khoá đã debounce nên phản hồi muộn của từ khoá cũ chỉ vào cache của chính nó. Cổng "đủ dài" xét cả
 * từ khoá hiện tại (chưa debounce): xoá xuống dưới 2 ký tự thì ẩn gợi ý ngay. Danh sách đang hiện giữ trong ref, ghi đồng
 * bộ lúc render: về rỗng ngay khi cổng đóng, nên mở lại cổng luôn bắt đầu từ rỗng.
 */
export function useSuggest(draft: string): { products: ProductSuggestion[]; isFetching: boolean; isError: boolean; refetch: () => void } {
  const term = useDebounced(draft.trim(), SUGGEST_DEBOUNCE_MS);
  const enabled = isSuggestable(term) && isSuggestable(draft);
  const q = useQuery({ ...suggestQuery(coreHttp, term), enabled, staleTime: 30_000, retry: false });
  const lastShown = useRef<ProductSuggestion[]>([]);
  if (!enabled) lastShown.current = [];
  else if (q.data) lastShown.current = q.data;
  // Lỗi chỉ báo khi chưa có gì để hiện: gợi ý cũ của từ khoá trước vẫn dùng được hơn một dòng lỗi.
  return {
    products: enabled ? (q.data ?? lastShown.current) : [],
    isFetching: enabled && q.isFetching,
    isError: enabled && q.isError && !q.data,
    refetch: () => void q.refetch(),
  };
}

/** Cụm tìm phổ biến cho ô tìm trống (cờ `catalog.search_popular_enabled`); chỉ tải khi khách đang ở ô tìm. */
export const usePopularSearches = (enabled: boolean): string[] => useQuery({ ...popularSearchesQuery(coreHttp), enabled }).data ?? [];

/** Thanh đầu gõ nhanh hơn trang Danh mục: chờ ngắn hơn, yêu cầu cũ bị huỷ khi từ khoá đổi. */
export const HEADER_SUGGEST_DEBOUNCE_MS = 150;

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');

export interface SuggestMeta {
  items: ProductSuggestion[];
  /** Bước chịu gõ sai đã thay kết quả (cờ `catalog.search_fuzzy_enabled`): `didYouMean` là cụm đang hiện. */
  corrected: boolean;
  didYouMean: string | null;
}

/**
 * `/search/suggest?meta=1` qua `fetch` thẳng để nhận AbortSignal: React Query huỷ yêu cầu của từ khoá cũ ngay khi khoá đổi. Endpoint công
 * khai nên không gửi cookie hay Authorization. Phản hồi dạng mảng (API trước meta) vẫn đọc được.
 */
export async function fetchSuggestMeta(q: string, signal?: AbortSignal): Promise<SuggestMeta> {
  const res = await fetch(`${API_BASE}/search/suggest?q=${encodeURIComponent(q)}&meta=1`, { signal, credentials: 'omit', headers: { 'X-Client-Platform': 'web' } });
  if (!res.ok) throw new Error(`suggest ${res.status}`);
  const body = (await res.json()) as unknown;
  if (Array.isArray(body)) return { items: body as ProductSuggestion[], corrected: false, didYouMean: null };
  const b = (body ?? {}) as Partial<SuggestMeta>;
  return { items: Array.isArray(b.items) ? b.items : [], corrected: b.corrected === true, didYouMean: typeof b.didYouMean === 'string' ? b.didYouMean : null };
}

/**
 * Gợi ý của hộp combobox ở thanh đầu: chờ 150 ms, từ 2 ký tự (đã bỏ dấu). Đang tải từ khoá mới thì giữ kết quả cũ (`stale` để làm mờ),
 * không để hộp co lại rồi giãn ra mỗi phím.
 */
export function useHeaderSuggest(draft: string, enabled: boolean): { data: SuggestMeta | undefined; stale: boolean; isError: boolean; refetch: () => void } {
  const term = useDebounced(draft.trim(), HEADER_SUGGEST_DEBOUNCE_MS);
  const on = enabled && isSuggestable(term) && isSuggestable(draft);
  const q = useQuery({
    queryKey: ['search-suggest-meta', term] as const,
    queryFn: ({ signal }) => fetchSuggestMeta(term, signal),
    enabled: on,
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  return {
    data: on ? q.data : undefined,
    stale: on && (q.isPlaceholderData || term !== draft.trim()),
    isError: on && q.isError && !q.data,
    refetch: () => void q.refetch(),
  };
}
