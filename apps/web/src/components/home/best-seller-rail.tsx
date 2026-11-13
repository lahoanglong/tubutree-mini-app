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
import { ProductCard, ProductRail, ProductTileSkeleton, SectionHeader } from '@/components/mini';
import { GRID_RANK_IMAGE_SIZES } from '@/lib/product-grid';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

/** Số khung chờ: vừa đủ lấp một màn ở 375px (thẻ hạng rộng `--tile-w-sm`), phần dư cuộn ngang. */
const SKELETON_COUNT = 5;
/** Khung chờ của lưới lg: hai hàng 5 cột như kệ đầy (trần `home.bestSellers` là 10 món). */
const GRID_SKELETON_COUNT = 10;

/** Từ lg kệ thành lưới đúng 5 cột (10 món = hai hàng đầy, không thanh cuộn ngang): thẻ hạng cùng bề rộng thẻ lưới Sản phẩm, tên đọc trọn. Cùng cột với `/ban-chay`. */
const GRID_RANK_LG = 'grid grid-cols-5 gap-4';

/** Thẻ tải ảnh ngay khi kệ là khối ảnh đầu tiên của trang: ở 375px thấy trọn hai thẻ hạng (thẻ thứ ba lấp ló), một trong hai là ảnh LCP. */
export const BEST_SELLER_LEAD_PRIORITY = 2;

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
  /** Số thẻ đầu tải ảnh ngay; mặc định 0. Trang chủ đặt `BEST_SELLER_LEAD_PRIORITY` khi phía trên kệ không có khối ảnh nào (banner, Giờ vàng, Mua lại). */
  priorityCount?: number;
}

/**
 * Bán chạy nhất (Q18, bản web của `best-seller-rail.tsx` ở Mini App) cho MỌI khách: một hàng thẻ có hạng #1..#n xếp theo lượt bán 30 ngày, "Xem tất cả" tới trang
 * xếp hạng. Đứng sau Giờ vàng và Danh mục. Có banner hay Giờ vàng thì ảnh LCP là của khối đó nên kệ tải lười, không giành băng thông; không có thì ảnh của kệ là LCP (`priorityCount`). Khách cũ trước đây chỉ thấy tab "Bán chạy" ở cuối lưới gợi ý, giờ cũng thấy kệ này.
 */
export function BestSellerRail({ items, ranks, basis, loading, error, onRetry, retrying, priorityCount = 0 }: BestSellerRailProps) {
  const title = fillCopy('rank.title');
  if (!loading && items.length === 0) {
    return error ? <HomeBlockError title={title} error={error} onRetry={() => onRetry?.()} retrying={retrying} /> : null;
  }
  const seeAll = seeAllHref('home.bestSellers', 'web');
  const plain = ranks !== undefined && !ranksAreSequential(ranks);
  return (
    <section aria-label={title}>
      <SectionHeader title={title} subtitle={bestSellersBasisCopy([{ basis }])} action={seeAll ? { to: seeAll } : undefined} />
      {/* Hai bản, mỗi bản `display:none` ở một khổ (như `ShopSection`): kệ vuốt ngang của Mini App dưới lg, lưới 5×2 từ lg. Ảnh ưu tiên chỉ cấp cho kệ: bản lưới nằm ẩn ở điện thoại. */}
      <div data-testid="best-seller-rail" className="lg:hidden">
        <ProductRail label={`${title}, vuốt ngang để xem thêm`} variant="rank" rankFrom={1} ranks={ranks} rankPlain={plain} items={items} loading={loading} skeletonCount={SKELETON_COUNT} priorityCount={priorityCount} />
      </div>
      <div data-testid="best-seller-grid" className="hidden lg:block">
        {loading ? (
          <div aria-hidden="true" className={GRID_RANK_LG}>
            {Array.from({ length: GRID_SKELETON_COUNT }, (_, i) => (
              <ProductTileSkeleton key={i} variant="rank" />
            ))}
          </div>
        ) : (
          <ul role="list" className={GRID_RANK_LG} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((p, i) => (
              <li key={p.id} className="min-w-0">
                <ProductCard product={p} variant="rank" rank={ranks?.[i] ?? i + 1} rankPlain={plain} imageSizes={GRID_RANK_IMAGE_SIZES} />
              </li>
            ))}
          </ul>
        )}
      </div>
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
