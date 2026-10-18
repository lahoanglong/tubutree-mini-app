'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { suggestQuery } from '@tubutree/app-core/queries/catalog';
import { coreHttp } from './core-http';
import { useDebounced } from './use-debounced';
import { foldVietnamese } from './vn-fold';

export const SUGGEST_DEBOUNCE_MS = 250;
export const SUGGEST_MIN_CHARS = 2;

/** Từ khoá đủ dài để gọi /search/suggest: API gấp dấu rồi trả [] cho dưới 2 ký tự, nên "đ" hay " a " chưa tính. */
export const isSuggestable = (s: string) => foldVietnamese(s).length >= SUGGEST_MIN_CHARS;

/**
 * Gợi ý sản phẩm khi gõ: debounce 250ms, từ 2 ký tự; lỗi thì im lặng (chỉ là gợi ý).
 * Query key theo từ khoá đã debounce nên phản hồi muộn của từ khoá cũ chỉ vào cache của chính nó. Cổng "đủ dài" xét cả
 * từ khoá hiện tại (chưa debounce): xoá xuống dưới 2 ký tự thì ẩn gợi ý ngay. Danh sách đang hiện giữ trong ref, ghi đồng
 * bộ lúc render: về rỗng ngay khi cổng đóng, nên mở lại cổng luôn bắt đầu từ rỗng.
 */
export function useSuggest(draft: string): { products: ProductSuggestion[]; isFetching: boolean } {
  const term = useDebounced(draft.trim(), SUGGEST_DEBOUNCE_MS);
  const enabled = isSuggestable(term) && isSuggestable(draft);
  const q = useQuery({ ...suggestQuery(coreHttp, term), enabled, staleTime: 30_000, retry: false });
  const lastShown = useRef<ProductSuggestion[]>([]);
  if (!enabled) lastShown.current = [];
  else if (q.data) lastShown.current = q.data;
  return { products: enabled ? (q.data ?? lastShown.current) : [], isFetching: enabled && q.isFetching };
}
