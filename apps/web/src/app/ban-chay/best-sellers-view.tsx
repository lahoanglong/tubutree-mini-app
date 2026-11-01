'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CategoryDTO, PageResponse, ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import {
  BEST_SELLERS_ALL_KEY, BEST_SELLERS_PAGE_LIMIT, bestSellerPanelLabel, bestSellerScope, bestSellerTabs, bestSellersHref, bestSellersRankFrom,
} from '@tubutree/app-core/browse/best-sellers';
import { bestSellersListQuery } from '@tubutree/app-core/queries/browse';
import { categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { NumberedPager } from '@/components/catalog/numbered-pager';
import { EmptyState } from '@/components/empty-state';
import { ListingBreadcrumb } from '@/components/layouts/listing-layout';
import { Button, PRIORITY_CARDS, ProductGrid, SegmentedTabs } from '@/components/mini';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { parsePage } from '@/lib/catalog-filter';
import { browseText } from '@/lib/browse-text';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { useShellPathname } from '@/lib/shell-pathname';

/** Trang đầu do server tải sẵn cho đúng URL (`category`, `?page=`): hiện ngay và cho crawler, rồi React Query tiếp quản. */
export interface BestSellersInitial {
  category: string | undefined;
  startPage: number;
  page: PageResponse<ProductCardData>;
}

export interface BestSellersViewProps {
  initial?: BestSellersInitial | null;
  categories?: CategoryDTO[];
}

// Từ lg đúng 5 cột để 20 món là bốn hàng đầy (lưới chung có thêm 6 cột ở xl, để lại hàng cụt).
const GRID_RANK = 'grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5';

const uniqueById = (list: ProductCardData[]) => {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
};

/**
 * Bán chạy nhất của web (nguồn: apps/miniapp/src/pages/best-sellers.tsx): bảng xếp hạng 30 ngày có hạng thật trên thẻ, lọc theo danh mục tầng 1 bằng
 * tab, trạng thái nằm trên URL (`?category=`, replace). Điện thoại: tiêu đề và "Xem thêm" như Mini App; từ lg: breadcrumb và phân trang số
 * (liên kết thật, mở `?page=N`). Hạng của thẻ đầu theo trang bắt đầu của danh sách nên tiếp nối (#21 ở trang 2).
 */
export default function BestSellersView({ initial = null, categories: initialCategories }: BestSellersViewProps) {
  const router = useRouter();
  const pathname = useShellPathname();
  const params = useSearchParams();
  const gridRef = useRef<HTMLDivElement>(null);
  /** Số thẻ trước "Xem thêm": thẻ đầu của trang mới nhận focus khi dữ liệu về (không mất vị trí đang đọc). */
  const focusFrom = useRef<number | null>(null);

  const categoriesQ = useQuery({
    ...categoriesQuery(coreHttp),
    staleTime: 60_000,
    retry: false,
    ...(initialCategories ? { initialData: initialCategories } : {}),
  });
  // `null` = cây chưa tải: tin tham số URL, khỏi tải danh sách hai lần.
  const tabs = categoriesQ.isLoading ? null : bestSellerTabs(categoriesQ.data);
  const scope = bestSellerScope(tabs, params.get('category'));
  const tabItems = tabs ?? bestSellerTabs(undefined);
  const activeLabel = bestSellerPanelLabel(tabs, scope.tab);
  const page = parsePage(params.get('page'));

  const seeded = initial !== null && initial.category === scope.category && initial.startPage === page ? initial : null;
  // Mục cache bắt đầu từ trang N khác mục bắt đầu từ trang 1 (khoá có `startPage`): gỡ về trang 1 không dùng lại danh sách thiếu các trang đầu.
  const startPage = seeded?.startPage ?? page;
  const products = useInfiniteQuery({
    ...bestSellersListQuery(coreHttp, scope.category, startPage),
    ...(seeded ? { initialData: { pages: [seeded.page], pageParams: [seeded.startPage] }, staleTime: 60_000 } : {}),
  });
  const list = uniqueById(products.data?.pages.flatMap((pg) => pg.data) ?? []);
  const listLength = list.length;
  const fetchingMore = products.isFetchingNextPage;
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || fetchingMore) return;
    focusFrom.current = null;
    if (listLength > from) gridRef.current?.querySelector<HTMLElement>(`ul[data-testid="catalog-grid"] li:nth-child(${from + 1}) a`)?.focus();
  }, [listLength, fetchingMore]);
  const loadMore = () => {
    // Button đang `loading` không nhận chạm, nhưng thẻ này còn gọi được từ nơi khác: không gọi hai trang cùng lúc.
    if (products.isFetchingNextPage) return;
    focusFrom.current = list.length;
    products.fetchNextPage().catch(() => {
      focusFrom.current = null;
    });
  };

  const pickTab = (key: string) => {
    if (key === scope.tab) return;
    // Về đầu trang trước khi ghi URL: nội dung mới ngắn hơn lúc đang tải, trình duyệt sẽ kẹp vị trí cuộn về giữa trang.
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    if (key === BEST_SELLERS_ALL_KEY) next.delete('category');
    else next.set('category', key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const title = fillCopy('rank.title');
  const lastPageMeta = products.data?.pages.at(-1)?.meta;
  const totalPages = lastPageMeta ? Math.max(1, Math.ceil(lastPageMeta.total / (lastPageMeta.limit || BEST_SELLERS_PAGE_LIMIT))) : page;
  const emptyHref = browseHref(scope.category ? { ...EMPTY_SEARCH_STATE, category: scope.category } : { ...EMPTY_SEARCH_STATE, all: true });

  // Phần tử gốc là Fragment để `PageHeader` là con trực tiếp của <main> (CSS kéo dải tiêu đề sát mép trên ở điện thoại).
  return (
    <>
      <ListingBreadcrumb trail={[{ label: fillCopy('browse.crumbHome'), href: '/' }, { label: title }]} />
      <PageHeader title={title} subtitle={fillCopy('rank.basis')} parentHref="/" />
      {/* Hàng tab dính dưới thanh lùi đặc ở điện thoại (`sticky-below-back` đặt top đúng), dưới thanh đầu từ md. */}
      <div className="sticky-below-back sticky top-0 z-[2] -mx-4 bg-[var(--color-bg-canvas)] px-4 py-2 md:top-[var(--header-h)] md:mx-0 md:px-0">
        <div className="md:w-fit md:max-w-full">
          <SegmentedTabs scroll label={fillCopy('rank.tabsLabel')} items={tabItems} value={scope.tab} onChange={pickTab} />
        </div>
      </div>
      <div role="tabpanel" aria-label={activeLabel} className="pb-6 pt-2">
        {products.isLoading ? (
          <ProductGrid items={[]} variant="rank" loading skeletonCount={8} className={GRID_RANK} />
        ) : products.isError && list.length === 0 ? (
          <ErrorState message={loadErrorText(products.error)} onRetry={() => void products.refetch()} retryLabel={browseText.retry} />
        ) : list.length === 0 ? (
          <EmptyState title={fillCopy('rank.emptyTitle')} actionHref={emptyHref} actionLabel={fillCopy('rank.emptyCta')} />
        ) : (
          <>
            <div ref={gridRef}>
              <ProductGrid items={list} variant="rank" rankFrom={bestSellersRankFrom(startPage)} className={GRID_RANK} priorityCount={PRIORITY_CARDS} />
            </div>
            {/* Lỗi khi ĐÃ có dữ liệu ("Xem thêm" hoặc làm mới nền thất bại): giữ nguyên danh sách, báo và thử lại tại chỗ. */}
            {products.isError && (
              <div role="alert" className="flex flex-wrap items-center justify-center gap-2 pt-4">
                <p className="text-sm text-danger-fg">{browseText.loadMoreFailed}</p>
                <Button
                  variant="secondary"
                  loading={products.isFetching}
                  onPress={() => {
                    (products.isFetchNextPageError ? products.fetchNextPage() : products.refetch()).catch(() => undefined);
                  }}
                  style={{ minWidth: 0 }}
                >
                  {browseText.retry}
                </Button>
              </div>
            )}
            {products.hasNextPage && !products.isFetchNextPageError && (
              <div className="flex justify-center pt-4 lg:hidden">
                <Button variant="secondary" loading={products.isFetchingNextPage} onPress={loadMore} style={{ minWidth: 160 }}>
                  {browseText.loadMore}
                </Button>
              </div>
            )}
            <NumberedPager
              hrefFor={(p) => bestSellersHref('web', { category: scope.category, page: p })}
              startPage={startPage}
              lastPage={lastPageMeta?.page ?? startPage}
              totalPages={totalPages}
              hasNext={products.hasNextPage}
            />
          </>
        )}
      </div>
    </>
  );
}
