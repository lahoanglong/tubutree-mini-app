import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pageHref, pageItems } from '@/lib/catalog-filter';

const ITEM =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border px-3 text-sm font-semibold transition';

/** Phân trang lưới sản phẩm: mỗi trang là một URL thật (?page=N) nên ISR vẫn cache được và crawler đi được hết. */
export default function ProductPagination({
  page,
  totalPages,
  filter,
}: {
  page: number;
  totalPages: number;
  filter: { brand?: string; category?: string; q?: string };
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Phân trang sản phẩm" className="mt-8 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link
          href={pageHref(filter, page - 1)}
          rel="prev"
          aria-label="Trang trước"
          className={`${ITEM} border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
      {pageItems(page, totalPages).map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-stone-600">
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            aria-current="page"
            aria-label={`Trang ${item}, đang xem`}
            className={`${ITEM} border-forest-600 bg-forest-600 text-stone-0 shadow-card`}
          >
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={pageHref(filter, item)}
            aria-label={`Trang ${item}`}
            className={`${ITEM} border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50`}
          >
            {item}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link
          href={pageHref(filter, page + 1)}
          rel="next"
          aria-label="Trang sau"
          className={`${ITEM} border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50`}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  );
}
