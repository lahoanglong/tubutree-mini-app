'use client';

import { useQuery } from '@tanstack/react-query';
import type { BestSellersBasis } from '@tubutree/app-core/api/browse';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { bestSellersHeading, curatedShelfItems } from '@tubutree/app-core/browse/best-sellers';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { bestSellerShelfItems, ranksAreSequential, seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { coreHttp } from '@/lib/core-http';
import { ProductCard, ProductTileSkeleton, ScrollRow, SectionHeader } from '@/components/mini';
import { RANK_SHELF_IMAGE_SIZES } from '@/lib/image-sizes';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

/** Số khung chờ dưới lg: vừa đủ lấp một màn ở 375px (thẻ hạng rộng `--tile-w-sm`), phần dư cuộn ngang. */
const SKELETON_COUNT = 5;
/** Khung chờ từ lg: hai hàng 5 cột như kệ đầy (trần `home.bestSellers` là 10 món). */
const GRID_SKELETON_COUNT = 10;

/**
 * Một danh sách cho mọi khổ (HTML chỉ có một bản thẻ): dưới lg là kệ vuốt ngang của Mini App (cùng số đo `RailShell`/`RailCell`: đệm
 * `--rail-pad-block`, lùi lề `tubu-bleed-rail`, khe 12, ô `--tile-w-sm`); từ lg lưới đúng 5 cột (10 món = hai hàng đầy, không thanh cuộn
 * ngang), thẻ cùng bề rộng thẻ lưới Sản phẩm như `/ban-chay`: bỏ lề âm, đệm và vùng cuộn để bóng thẻ không bị cắt.
 */
const SHELF_SCROLL = 'tubu-bleed-rail p-[var(--rail-pad-block)] lg:mx-0 lg:overflow-visible lg:p-0';
const SHELF_TRACK = 'm-0 flex w-max min-w-full list-none items-stretch gap-3 p-0 lg:grid lg:w-full lg:grid-cols-5 lg:gap-4';
const SHELF_CELL = 'flex w-[var(--tile-w-sm)] flex-none lg:w-auto lg:min-w-0';

/** Thẻ tải ảnh ngay khi kệ là khối ảnh đầu tiên của trang: ở 375px thấy trọn hai thẻ hạng (thẻ thứ ba lấp ló), một trong hai là ảnh LCP. */
export const BEST_SELLER_LEAD_PRIORITY = 2;

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
  /** Số thẻ đầu tải ảnh ngay; mặc định 0. Trang chủ đặt `BEST_SELLER_LEAD_PRIORITY` khi phía trên kệ không có khối ảnh nào (banner, Giờ vàng, Mua lại). */
  priorityCount?: number;
}

/**
 * Bán chạy nhất (Q18, bản web của `best-seller-rail.tsx` ở Mini App) cho MỌI khách: một hàng thẻ có hạng #1..#n xếp theo lượt bán 30 ngày, "Xem tất cả" tới trang
 * xếp hạng. Đứng sau Giờ vàng và Danh mục. Có banner hay Giờ vàng thì ảnh LCP là của khối đó nên kệ tải lười, không giành băng thông; không có thì ảnh của kệ là LCP (`priorityCount`). Khách cũ trước đây chỉ thấy tab "Bán chạy" ở cuối lưới gợi ý, giờ cũng thấy kệ này.
 */
export function BestSellerRail({ items: shelfItems, ranks, basis, loading, error, onRetry, retrying, priorityCount = 0 }: BestSellerRailProps) {
  // Kệ "Tubu chọn cho bạn" (món admin ghim khi chưa đủ số bán): đổi tiêu đề, bỏ dòng thước đo và số hạng, chỉ vẽ món ghim, giữ nguyên bố cục.
  const heading = bestSellersHeading(shelfItems, [{ basis }]);
  const items = curatedShelfItems(shelfItems, SHELF.minItems);
  const title = heading.title;
  if (!loading && items.length === 0) {
    return error ? <HomeBlockError title={title} error={error} onRetry={() => onRetry?.()} retrying={retrying} /> : null;
  }
  const seeAll = seeAllHref('home.bestSellers', 'web');
  const shownRanks = heading.ranked ? ranks : undefined;
  const plain = shownRanks !== undefined && !ranksAreSequential(shownRanks);
  return (
    <section aria-label={title}>
      <SectionHeader title={title} subtitle={heading.subtitle} action={seeAll ? { to: seeAll } : undefined} />
      <div data-testid="best-seller-rail">
        <ScrollRow label={`${title}, vuốt ngang để xem thêm`} arrows className={SHELF_SCROLL}>
          {loading ? (
            <div aria-hidden="true" className={SHELF_TRACK}>
              {Array.from({ length: GRID_SKELETON_COUNT }, (_, i) => (
                <div key={i} className={i < SKELETON_COUNT ? SHELF_CELL : `${SHELF_CELL} max-lg:hidden`}>
                  <div className="min-w-0 flex-1">
                    <ProductTileSkeleton variant="rank" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul role="list" className={SHELF_TRACK}>
              {items.map((p, i) => (
                <li key={p.id} className={SHELF_CELL}>
                  <div className="min-w-0 flex-1">
                    <ProductCard
                      product={p}
                      variant="rank"
                      rank={!heading.ranked ? undefined : shownRanks ? (shownRanks[i] ?? undefined) : i + 1}
                      rankPlain={plain}
                      priority={i < priorityCount}
                      imageSizes={RANK_SHELF_IMAGE_SIZES}
                      shelf="bestSellers"
                      position={i + 1}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollRow>
      </div>
    </section>
  );
}

const SHELF = shelf('home.bestSellers');

/** Bán chạy nhất tự tải, cho màn không có kệ nào ở trên để chống trùng (tab Đơn hàng trống). Cùng khoá query với Trang chủ nên dùng chung dữ liệu đã tải. */
export function BestSellerRailQuery() {
  const q = useBlockQuery(useQuery(homeBestSellerQuery(coreHttp)));
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
