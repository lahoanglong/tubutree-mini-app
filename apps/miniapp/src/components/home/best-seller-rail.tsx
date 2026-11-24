import { useQuery } from '@tanstack/react-query';
import type { BestSellersBasis } from '@tubutree/app-core/api/browse';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { bestSellersHeading, curatedShelfItems } from '@tubutree/app-core/browse/best-sellers';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { bestSellerShelfItems, ranksAreSequential, seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { homeBestSellerQuery } from './home-best-seller-query';
import { ProductRail } from '../ui/product-rail';
import { SectionHeader } from '../ui/section-header';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

/** Số khung chờ: vừa đủ lấp một màn ở 375px (thẻ hạng rộng `--tile-w-sm`), phần dư cuộn ngang. */
const SKELETON_COUNT = 5;

export interface BestSellerRailProps {
  /** Đã qua `composeHomeShelves` (bỏ món trùng kệ trên, 3–10 món); dưới 3 món thì rỗng và khối ẩn. */
  items: ProductCardData[];
  /** Hạng thật của từng món (cùng chỉ số với `items`) khi kệ đã bỏ món trùng kệ trên; thiếu thì đánh #1..#n theo thứ tự. null là món admin ghim: thẻ không số. Hạng không liền từ 1 thì thẻ chỉ ghi "Bán chạy", không ghi số hụt. */
  ranks?: readonly (number | null)[];
  /** Thước đo xếp hạng; mặc định 30 ngày. `total` khi API cũ buộc kệ lùi về tổng lượt bán. */
  basis?: BestSellersBasis;
  loading: boolean;
  error?: unknown;
  onRetry?: () => unknown;
  retrying?: boolean;
}

/**
 * Bán chạy nhất (Q18) cho MỌI khách: một hàng thẻ có hạng #1..#n xếp theo lượt bán 30 ngày, "Xem tất cả" tới trang xếp hạng. Đứng sau Danh mục;
 * khách cũ trước đây chỉ thấy tab "Bán chạy" ở cuối lưới gợi ý, giờ cũng thấy kệ này.
 */
export function BestSellerRail({ items: shelfItems, ranks, basis, loading, error, onRetry, retrying }: BestSellerRailProps) {
  // Kệ "Tubu chọn cho bạn" (món admin ghim khi chưa đủ số bán): đổi tiêu đề, bỏ dòng thước đo và số hạng, chỉ vẽ món ghim, giữ nguyên bố cục.
  const heading = bestSellersHeading(shelfItems, [{ basis }]);
  const items = curatedShelfItems(shelfItems, SHELF.minItems);
  const title = heading.title;
  if (!loading && items.length === 0) {
    return error ? <HomeBlockError title={title} error={error} onRetry={() => onRetry?.()} retrying={retrying} /> : null;
  }
  const seeAll = seeAllHref('home.bestSellers');
  const shownRanks = heading.ranked ? ranks : undefined;
  return (
    <section aria-label={title}>
      <div style={{ padding: '0 16px' }}>
        <SectionHeader title={title} subtitle={heading.subtitle} action={seeAll ? { to: seeAll } : undefined} />
      </div>
      <ProductRail label={`${title}, vuốt ngang để xem thêm`} variant="rank" rankFrom={heading.ranked ? 1 : undefined} ranks={shownRanks} rankPlain={shownRanks !== undefined && !ranksAreSequential(shownRanks)} items={items} listSource="home_best_seller" loading={loading} skeletonCount={SKELETON_COUNT} />
    </section>
  );
}

const SHELF = shelf('home.bestSellers');

/** Bán chạy nhất tự tải, cho màn không có kệ nào ở trên để chống trùng (Đơn hàng trống). Cùng khoá query với Trang chủ nên dùng chung dữ liệu đã tải. */
export function BestSellerRailQuery() {
  const q = useBlockQuery(useQuery(homeBestSellerQuery));
  const shelfItems = bestSellerShelfItems(q.data?.data ?? [], q.data?.pinnedIds).slice(0, SHELF.maxItems);
  const full = shelfItems.length >= SHELF.minItems;
  return (
    <BestSellerRail
      items={full ? shelfItems.map((x) => x.product) : []}
      ranks={full ? shelfItems.map((x) => x.rank) : undefined}
      basis={q.data?.basis}
      loading={q.isLoading}
      error={q.error}
      onRetry={q.refetch}
      retrying={q.isFetching}
    />
  );
}
