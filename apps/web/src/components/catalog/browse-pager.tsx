import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { pageItems } from '@/lib/catalog-filter';
import { BROWSE_PATH, serializeSearchState, type SearchState } from '@/lib/search-state';
import { ui } from '@/lib/guest-ui';

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

const NUMBER =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 text-sm font-medium text-stone-800 transition hover:bg-forest-50';

/**
 * Liên kết thật tới các trang của danh sách. Điện thoại: "Trang trước / Trang sau" (cạnh nút "Xem thêm", như Mini App). Từ lg: dãy số trang
 * (1 … 2 3 4 … 6), mỗi số là một liên kết. Nút "Xem thêm" chỉ chạy bằng JS nên crawler không đi qua được; canonical của ?page=N tự trỏ về
 * chính nó (home-seo), nên mỗi trang phải có ít nhất một liên kết nội bộ dẫn tới (cả hai kiểu đều có trong HTML, chỉ khác CSS).
 */
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
  if (startPage <= 1 && !hasNext) return null;
  return (
    <nav aria-label={fillCopy('browse.pageLabel')} className="flex flex-col items-center gap-3 pt-3 text-sm">
      <div className="flex flex-wrap items-center justify-center gap-3 lg:hidden">
        {startPage > 1 && (
          <Link href={pagedHref(state, startPage - 1)} rel="prev" className={`${ui.btnText} gap-1`}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {fillCopy('browse.prevPage')}
          </Link>
        )}
        {hasNext && (
          <Link href={pagedHref(state, lastPage + 1)} rel="next" className={`${ui.btnText} gap-1`}>
            {fillCopy('browse.nextPage')}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <ol className="hidden items-center justify-center gap-1 lg:flex">
        {pageItems(lastPage, Math.max(totalPages, lastPage)).map((item, i) =>
          item === 'gap' ? (
            <li key={`gap${i}`} aria-hidden="true" className="px-1 text-stone-500">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={pagedHref(state, item)}
                aria-label={fillCopy('browse.pageN', { n: item })}
                aria-current={item === lastPage ? 'page' : undefined}
                className={`${NUMBER} ${item === lastPage ? 'bg-forest-600 font-semibold text-stone-0 hover:bg-forest-600' : ''}`}
              >
                {item}
              </Link>
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
