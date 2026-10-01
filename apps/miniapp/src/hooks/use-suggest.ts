import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { suggestProducts, type ProductSuggestion } from '../services/shop-api';
import { foldVietnamese } from '../utils/vn-fold';
import { useDebounced } from '../utils/use-debounced';

export const SUGGEST_DEBOUNCE_MS = 250;
export const SUGGEST_MIN_CHARS = 2;

const longEnough = (s: string) => foldVietnamese(s).length >= SUGGEST_MIN_CHARS;

/**
 * Gợi ý SP khi gõ (spec 5b.2): debounce 250ms, từ 2 ký tự; lỗi → im lặng (chỉ là gợi ý).
 * - Query key theo từ khoá đã debounce → phản hồi về muộn của từ khoá cũ chỉ vào cache của chính nó,
 *   không bao giờ ghi đè kết quả của từ khoá mới.
 * - Cổng "đủ dài" xét cả từ khoá hiện tại (chưa debounce): xoá bớt xuống dưới 2 ký tự thì ẩn gợi ý
 *   ngay thay vì còn hiện kết quả cũ trong 250ms.
 * - Đổi từ khoá khi cổng vẫn mở → giữ danh sách của từ khoá trước trong lúc tải (keepPreviousData), không
 *   nhấp nháy. Cổng đã đóng rồi mở lại (xoá xuống <2 ký tự rồi gõ từ khoá mới) → bắt đầu từ rỗng, không
 *   hiện lại kết quả của từ khoá cũ.
 */
export function useSuggest(draft: string): { products: ProductSuggestion[]; isFetching: boolean } {
  const term = useDebounced(draft.trim(), SUGGEST_DEBOUNCE_MS);
  const enabled = longEnough(term) && longEnough(draft);
  // `true` chỉ khi lần render TRƯỚC cổng đang mở (cập nhật trong effect, nên lần render đầu sau khi cổng mở
  // lại vẫn thấy `false` → không mượn dữ liệu cũ).
  const gateWasOpen = useRef(false);
  const q = useQuery({
    queryKey: ['search-suggest', term],
    queryFn: () => suggestProducts(term),
    enabled,
    staleTime: 30_000,
    retry: false,
    placeholderData: (previous) => (gateWasOpen.current ? previous : undefined),
  });
  useEffect(() => {
    gateWasOpen.current = enabled;
  }, [enabled]);
  return { products: enabled ? q.data ?? [] : [], isFetching: enabled && q.isFetching };
}
