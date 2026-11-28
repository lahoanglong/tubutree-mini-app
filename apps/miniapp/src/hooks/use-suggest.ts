import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { suggestCorrection, type SuggestMeta } from '@tubutree/app-core/api/catalog';
import { popularSearchesQuery } from '@tubutree/app-core/browse/search-ux';
import { coreHttp } from '../services/core-http';
import { suggestProductsMeta, type ProductSuggestion } from '../services/shop-api';
import { foldVietnamese } from '../utils/vn-fold';
import { useDebounced } from '../utils/use-debounced';

export const SUGGEST_DEBOUNCE_MS = 250;
export const SUGGEST_MIN_CHARS = 2;

/** Từ khoá đủ dài để gọi /search/suggest: API gấp dấu rồi trả [] cho dưới 2 ký tự, nên "đ" hay " a " chưa tính. */
export const isSuggestable = (s: string) => foldVietnamese(s).length >= SUGGEST_MIN_CHARS;

/**
 * Gợi ý SP khi gõ (spec 5b.2): debounce 250ms, từ 2 ký tự; lỗi → báo "Không tải được gợi ý" kèm Thử lại (không nuốt lỗi), lịch sử tìm vẫn hiện.
 * - Query key theo từ khoá đã debounce → phản hồi về muộn của từ khoá cũ chỉ vào cache của chính nó,
 *   không bao giờ ghi đè kết quả của từ khoá mới.
 * - Cổng "đủ dài" xét cả từ khoá hiện tại (chưa debounce): xoá bớt xuống dưới 2 ký tự thì ẩn gợi ý
 *   ngay thay vì còn hiện kết quả cũ trong 250ms.
 * - Gọi `/search/suggest?meta=1` nên nhận thêm `didYouMean` khi bước chịu gõ sai (cờ `catalog.search_fuzzy_enabled`) đã thay kết quả; cờ tắt thì
 *   API không báo sửa và `didYouMean` luôn null.
 * - Đổi từ khoá khi cổng vẫn mở → giữ kết quả của từ khoá trước trong lúc tải, không nhấp nháy. Kết quả
 *   "đang hiện" được giữ trong ref, GHI ĐỒNG BỘ trong lúc render: về rỗng ngay khi cổng đóng và chỉ nhận
 *   dữ liệu thật của từ khoá hiện tại. Nhờ vậy mở lại cổng (xoá xuống <2 ký tự rồi gõ từ khoá mới) luôn
 *   bắt đầu từ rỗng, kể cả khi render lại nhiều lần lúc request còn đang bay.
 */
export function useSuggest(draft: string): { products: ProductSuggestion[]; didYouMean: string | null; isFetching: boolean; isError: boolean; refetch: () => void } {
  const term = useDebounced(draft.trim(), SUGGEST_DEBOUNCE_MS);
  const enabled = isSuggestable(term) && isSuggestable(draft);
  const q = useQuery({
    queryKey: ['search-suggest-meta', term],
    queryFn: () => suggestProductsMeta(term),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const lastShown = useRef<SuggestMeta | null>(null);
  if (!enabled) lastShown.current = null;
  else if (q.data) lastShown.current = q.data;
  const shown = enabled ? (q.data ?? lastShown.current) : null;
  // Lỗi chỉ báo khi chưa có gì để hiện: gợi ý cũ của từ khoá trước vẫn dùng được hơn một dòng lỗi.
  return {
    products: shown?.items ?? [],
    didYouMean: suggestCorrection(shown ?? undefined),
    isFetching: enabled && q.isFetching,
    isError: enabled && q.isError && !q.data,
    refetch: () => void q.refetch(),
  };
}

/** Cụm tìm phổ biến cho ô tìm trống (cờ `catalog.search_popular_enabled`); chỉ tải khi khách đang ở ô tìm. */
export const usePopularSearches = (enabled: boolean): string[] => useQuery({ ...popularSearchesQuery(coreHttp), enabled }).data ?? [];
