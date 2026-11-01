import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { pageItems } from '@/lib/catalog-filter';
import { ui } from '@/lib/guest-ui';

const NUMBER =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 text-sm font-medium text-stone-800 transition hover:bg-forest-50';

/**
 * Liên kết thật tới các trang của một danh sách (Danh mục, Bán chạy nhất). Điện thoại: "Trang trước / Trang sau" chỉ còn trong HTML (`sr-only`, như Mini App
 * chỉ có nút "Xem thêm"); bàn phím nhảy vào thì hiện ra (`focus-within`) để không có điểm Tab vô hình, từ md hiện hẳn.
 * Từ lg: dãy số trang (1 … 2 3 4 … 6), mỗi số là một liên kết. Nút "Xem thêm" chỉ chạy bằng JS nên crawler không đi qua được; canonical của
 * ?page=N tự trỏ về chính nó (home-seo), nên mỗi trang phải có ít nhất một liên kết nội bộ dẫn tới (cả hai kiểu đều có trong HTML, chỉ khác CSS).
 * `hrefFor` do trang gọi quyết định (giữ bộ lọc nào, trang 1 có `page` hay không).
 */
export function NumberedPager({
  hrefFor,
  startPage,
  lastPage,
  totalPages,
  hasNext,
}: {
  hrefFor: (page: number) => string;
  startPage: number;
  lastPage: number;
  totalPages: number;
  hasNext: boolean;
}) {
  if (startPage <= 1 && !hasNext) return null;
  return (
    <nav aria-label={fillCopy('browse.pageLabel')} className="flex flex-col items-center gap-3 pt-3 text-sm">
      <div className="sr-only flex flex-wrap items-center justify-center gap-3 focus-within:not-sr-only md:not-sr-only lg:hidden">
        {startPage > 1 && (
          <Link href={hrefFor(startPage - 1)} rel="prev" className={`${ui.btnText} gap-1`}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {fillCopy('browse.prevPage')}
          </Link>
        )}
        {hasNext && (
          <Link href={hrefFor(lastPage + 1)} rel="next" className={`${ui.btnText} gap-1`}>
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
                href={hrefFor(item)}
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
