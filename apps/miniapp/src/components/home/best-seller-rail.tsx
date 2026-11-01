import { useQuery } from '@tanstack/react-query';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { HOME_BEST_SELLER_LIMIT } from '@tubutree/app-core/home-layout';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { fetchProducts } from '../../services/shop-api';
import { ProductRail } from '../ui/product-rail';
import { SectionHeader } from '../ui/section-header';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

/** Số khung chờ: vừa đủ lấp một màn ở 375px (thẻ hạng rộng `--tile-w-sm`), phần dư cuộn ngang. */
const SKELETON_COUNT = 5;

export interface BestSellerRailProps {
  /** Đã qua `composeHomeShelves` (bỏ món trùng kệ trên, 3–10 món); dưới 3 món thì rỗng và khối ẩn. */
  items: ProductCardData[];
  /** Hạng thật của từng món (cùng chỉ số với `items`) khi kệ đã bỏ món trùng kệ trên; thiếu thì đánh #1..#n theo thứ tự. */
  ranks?: readonly number[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => unknown;
  retrying?: boolean;
}

/**
 * Bán chạy nhất (Q18) cho MỌI khách: một hàng thẻ có hạng #1..#n xếp theo lượt bán 30 ngày, "Xem tất cả" tới trang xếp hạng. Đứng sau Danh mục;
 * khách cũ trước đây chỉ thấy tab "Bán chạy" ở cuối lưới gợi ý, giờ cũng thấy kệ này.
 */
export function BestSellerRail({ items, ranks, loading, error, onRetry, retrying }: BestSellerRailProps) {
  const title = fillCopy('rank.title');
  if (!loading && items.length === 0) {
    return error ? <HomeBlockError title={title} error={error} onRetry={() => onRetry?.()} retrying={retrying} /> : null;
  }
  const seeAll = seeAllHref('home.bestSellers');
  return (
    <section aria-label={title}>
      <div style={{ padding: '0 16px' }}>
        <SectionHeader title={title} subtitle={fillCopy('rank.basis')} action={seeAll ? { to: seeAll } : undefined} />
      </div>
      <ProductRail label={`${title}, vuốt ngang để xem thêm`} variant="rank" rankFrom={1} ranks={ranks} items={items} listSource="home_best_seller" loading={loading} skeletonCount={SKELETON_COUNT} />
    </section>
  );
}

const SHELF = shelf('home.bestSellers');

/** Bán chạy nhất tự tải, cho màn không có kệ nào ở trên để chống trùng (Đơn hàng trống). Cùng khoá query với Trang chủ nên dùng chung dữ liệu đã tải. */
export function BestSellerRailQuery() {
  const q = useBlockQuery(
    useQuery({ queryKey: ['products', 'home-best-seller'], queryFn: () => fetchProducts({ limit: HOME_BEST_SELLER_LIMIT, sort: 'best_seller_30d' }) }),
  );
  const items = (q.data?.data ?? []).slice(0, SHELF.maxItems);
  return <BestSellerRail items={items.length >= SHELF.minItems ? items : []} loading={q.isLoading} error={q.error} onRetry={q.refetch} retrying={q.isFetching} />;
}
