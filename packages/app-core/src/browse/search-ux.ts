import type { HttpClient } from '../http';

/**
 * Phần dùng chung của tìm kiếm ở Mini App và web (wave tubu-w2-05): trường "đã sửa" của `/products`, cụm tìm phổ biến, thứ tự khối
 * kết quả rỗng và danh mục gần với từ khoá. Hàm gấp dấu do app truyền vào (mỗi app có bản `foldVietnamese` cùng bảng với API).
 */

/** `/products` thêm hai trường khi bước chịu gõ sai thay kết quả (cờ `catalog.search_fuzzy_enabled`); API cũ hay cờ tắt thì vắng. */
export interface SearchCorrection {
  corrected?: boolean;
  didYouMean?: string | null;
}

/** Cờ `catalog.search_popular_enabled` tắt thì API trả `terms: []`; API cũ (404) thì query lỗi: cả hai đều không vẽ hàng chip. */
export const popularSearchesQuery = (http: HttpClient) => ({
  queryKey: ['search-popular'] as const,
  queryFn: () =>
    http
      .get<{ terms?: unknown }>('/search/popular', { anonymous: true })
      .then((r) => (Array.isArray(r?.terms) ? r.terms.filter((t): t is string => typeof t === 'string') : [])),
  staleTime: 60 * 60_000,
  retry: false,
});

export type ZeroResultBlock = 'didYouMean' | 'categories' | 'bestSellers' | 'chat';

/**
 * Thứ tự khối dưới "Không tìm thấy" (đề wave D): "Ý bạn là", danh mục gần, kệ bán chạy còn hàng, dòng nhắn Tubu. Khối không có dữ liệu
 * thì bỏ; kệ bán chạy luôn có chỗ vì tự ẩn khi đang tải, lỗi hay không có món còn hàng.
 */
export function zeroResultBlocks(p: { didYouMean?: string | null; nearCategories: number; canChat: boolean }): ZeroResultBlock[] {
  const out: ZeroResultBlock[] = [];
  if (p.didYouMean) out.push('didYouMean');
  if (p.nearCategories > 0) out.push('categories');
  out.push('bestSellers');
  if (p.canChat) out.push('chat');
  return out;
}

export const NEAR_CATEGORY_MAX = 3;

const words = (folded: string) => folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

/**
 * Tối đa 3 danh mục có tên gần từ khoá (so không dấu theo từ): từ khoá là đầu một từ của tên ("giat" → "Giặt xả"), hoặc từ của tên
 * (từ 3 chữ) là đầu từ khoá ("raucu" → "Rau"). Nhiều từ khớp hơn xếp trước, bằng nhau giữ thứ tự cây. Danh mục 0 món đã bị lọc từ nguồn.
 */
export function nearCategories<T extends { label: string }>(entries: readonly T[], q: string, fold: (s: string) => string, max = NEAR_CATEGORY_MAX): T[] {
  const qs = words(fold(q));
  if (qs.length === 0) return [];
  return entries
    .map((entry, i) => {
      const ls = words(fold(entry.label));
      return { entry, i, score: qs.filter((w) => ls.some((l) => l.startsWith(w) || (l.length >= 3 && w.startsWith(l)))).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .map((x) => x.entry);
}
