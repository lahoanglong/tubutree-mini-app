import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BROWSE_PATH, serializeSearchState, type SearchState } from '@/lib/search-state';
import { ui } from '@/lib/guest-ui';

const pagedHref = (state: SearchState, page: number) => {
  const qs = serializeSearchState(state);
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `${BROWSE_PATH}?${s}` : BROWSE_PATH;
};

/**
 * Liên kết thật tới trang kế/trước của danh sách. Nút "Xem thêm" chỉ chạy bằng JS nên crawler không đi qua được; canonical
 * của ?page=N tự trỏ về chính nó (home-seo), nên mỗi trang phải có ít nhất một liên kết nội bộ dẫn tới.
 */
export function BrowsePager({ state, startPage, lastPage, hasNext }: { state: SearchState; startPage: number; lastPage: number; hasNext: boolean }) {
  if (startPage <= 1 && !hasNext) return null;
  return (
    <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-center gap-3 pt-3 text-sm">
      {startPage > 1 && (
        <Link href={pagedHref(state, startPage - 1)} rel="prev" className={`${ui.btnText} gap-1`}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Trang trước
        </Link>
      )}
      {hasNext && (
        <Link href={pagedHref(state, lastPage + 1)} rel="next" className={`${ui.btnText} gap-1`}>
          Trang sau
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </nav>
  );
}
