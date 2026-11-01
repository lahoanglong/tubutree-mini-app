'use client';

import { useQuery } from '@tanstack/react-query';
import type { BestSellersBasis } from '@tubutree/app-core/api/browse';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { bestSellersBasisCopy } from '@tubutree/app-core/browse/best-sellers';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { ranksAreSequential, seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '@/lib/core-http';
import { ProductRail, SectionHeader } from '@/components/mini';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

/** Số khung chờ: vừa đủ lấp một màn ở 375px (thẻ hạng rộng `--tile-w-sm`), phần dư cuộn ngang. */
const SKELETON_COUNT = 5;

export interface BestSellerRailProps {
  /** Đã qua `composeHomeShelves` (bỏ món trùng kệ trên, 3–10 món); dưới 3 món thì rỗng và khối ẩn. */
  items: ProductCardData[];
  /** Hạng thật của từng món (cùng chỉ số với `items`) khi kệ đã bỏ món trùng kệ trên; thiếu thì đánh #1..#n theo thứ tự. Hạng không liền từ 1 thì thẻ chỉ ghi "Bán chạy", không ghi số hụt. */
  ranks?: readonly number[];
  /** Thước đo xếp hạng; mặc định 30 ngày. `total` khi API cũ buộc kệ lùi về tổng lượt bán. */
  basis?: BestSellersBasis;
  loading: boolean;
  error?: unknown;
  onRetry?: () => unknown;
  retrying?: boolean;
}

/**
 * Bán chạy nhất (Q18, bản web của `best-seller-rail.tsx` ở Mini App) cho MỌI khách: một hàng thẻ có hạng #1..#n xếp theo lượt bán 30 ngày, "Xem tất cả" tới trang
 * xếp hạng. Đứng sau Danh mục; khách cũ trước đây chỉ thấy tab "Bán chạy" ở cuối lưới gợi ý, giờ cũng thấy kệ này.
 */
export function BestSellerRail({ items, ranks, basis, loading, error, onRetry, retrying }: BestSellerRailProps) {
  const title = fillCopy('rank.title');
  if (!loading && items.length === 0) {
    return error ? <HomeBlockError title={title} error={error} onRetry={() => onRetry?.()} retrying={retrying} /> : null;
  }
  const seeAll = seeAllHref('home.bestSellers', 'web');
  return (
    <section aria-label={title}>
      <SectionHeader title={title} subtitle={bestSellersBasisCopy([{ basis }])} action={seeAll ? { to: seeAll } : undefined} />
      <ProductRail label={`${title}, vuốt ngang để xem thêm`} variant="rank" rankFrom={1} ranks={ranks} rankPlain={ranks !== undefined && !ranksAreSequential(ranks)} items={items} loading={loading} skeletonCount={SKELETON_COUNT} priorityCount={2} />
    </section>
  );
}

const SHELF = shelf('home.bestSellers');

/** Bán chạy nhất tự tải, cho màn không có kệ nào ở trên để chống trùng (tab Đơn hàng trống). Cùng khoá query với Trang chủ nên dùng chung dữ liệu đã tải. */
export function BestSellerRailQuery() {
  const q = useBlockQuery(useQuery(homeBestSellerQuery(coreHttp)));
  const items = (q.data?.data ?? []).slice(0, SHELF.maxItems);
  return <BestSellerRail items={items.length >= SHELF.minItems ? items : []} basis={q.data?.basis} loading={q.isLoading} error={q.error} onRetry={q.refetch} retrying={q.isFetching} />;
}
