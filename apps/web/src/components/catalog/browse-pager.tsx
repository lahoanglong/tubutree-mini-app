import { BROWSE_PATH, serializeSearchState, type SearchState } from '@/lib/search-state';
import { NumberedPager } from './numbered-pager';

/**
 * Trang 1 của danh sách ở gốc phải mang `all=1` (`/san-pham` trơn là hub); từ trang 2 thì bỏ `all`: `?page=N` đã là danh sách và
 * canonical của nó tự trỏ về chính nó (home-seo), còn `all=1` là noindex.
 */
const pagedHref = (state: SearchState, page: number) => {
  const qs = serializeSearchState({ ...state, all: page <= 1 });
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `${BROWSE_PATH}?${s}` : BROWSE_PATH;
};

/** Phân trang của Danh mục: liên kết giữ nguyên bộ lọc đang chọn (xem `NumberedPager`). */
export function BrowsePager({
  state,
  startPage,
  lastPage,
  totalPages,
  hasNext,
}: {
  state: SearchState;
  startPage: number;
  lastPage: number;
  totalPages: number;
  hasNext: boolean;
}) {
  return <NumberedPager hrefFor={(page) => pagedHref(state, page)} startPage={startPage} lastPage={lastPage} totalPages={totalPages} hasNext={hasNext} />;
}
