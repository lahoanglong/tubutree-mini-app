'use client';

import Link from 'next/link';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { homeText } from '@/lib/home-text';
import ProductCard, { PRIORITY_CARDS } from '@/components/product-card';
import { ProductCardSkeleton } from '@/components/ui/skeleton';
import { HomeBlockError } from './home-block-error';

export interface SectionQuery {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data?: { data: ProductCardData[] };
  /** Đang có request bay, kể cả tải lại sau lỗi — để nút "Thử lại" hiện trạng thái đang tải. */
  isFetching?: boolean;
  refetch: () => unknown;
}

export interface HomeSectionProps {
  title: string;
  query: SectionQuery;
  /** Số SP tối đa khối xin từ API. Khung chờ vẽ ĐÚNG bằng chừng này ô để lúc dữ liệu về trang không nhảy (M2). */
  limit: number;
  /** Đích của nút "Xem tất cả" (vd `/san-pham?sort=best_seller`). Bỏ trống → không có nút (vd "Dành cho bạn", chỉ có ở Trang chủ). */
  seeAllTo?: string;
  /** Khối đầu tiên có lưới SP: ảnh các thẻ đầu là ứng viên LCP nên tải ngay. */
  priority?: boolean;
}

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6';

/**
 * Một khối lưới SP của Trang chủ. Đã tải mà rỗng → không vẽ gì (không để tiêu đề trống).
 * Tải lỗi và chưa có dữ liệu → khối lỗi có tiêu đề + "Thử lại" (C-084; trước đây ẩn lặng lẽ nên khách tưởng cửa hàng
 * ít hàng). Làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện dữ liệu cũ.
 */
export function HomeSection({ title, query, limit, seeAllTo, priority = false }: HomeSectionProps) {
  const items = query.data?.data ?? [];
  if (!query.isLoading && items.length === 0) {
    if (!query.isError) return null;
    return <HomeBlockError title={title} error={query.error} onRetry={query.refetch} retrying={query.isFetching} />;
  }
  return (
    <section aria-label={title} className="py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">{title}</h2>
        {seeAllTo && (
          <Link
            href={seeAllTo}
            aria-label={homeText.seeAllLabel(title)}
            className="inline-flex min-h-11 flex-none items-center px-1 text-sm font-semibold text-forest-700 underline"
          >
            {homeText.seeAll}
          </Link>
        )}
      </div>
      {query.isLoading ? (
        <ul className={GRID} aria-hidden="true">
          {Array.from({ length: limit }, (_, i) => (
            <li key={i}>
              <ProductCardSkeleton />
            </li>
          ))}
        </ul>
      ) : (
        <ul className={GRID}>
          {items.map((p, i) => (
            <li key={p.id}>
              <ProductCard product={p} priority={priority && i < PRIORITY_CARDS} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
