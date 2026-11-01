import { useRef, type CSSProperties } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { BEST_SELLERS_ALL_KEY, bestSellerPanelLabel, bestSellerScope, bestSellerTabs, bestSellersRankFrom } from '@tubutree/app-core/browse/best-sellers';
import { bestSellersListQuery } from '@tubutree/app-core/queries/browse';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { PullToRefresh } from '../components/pull-to-refresh';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { ProductGrid } from '../components/ui/product-grid';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Text } from '../components/ui/text';
import { useCategories } from '../hooks/use-categories';
import { useScrollRestoration } from '../hooks/use-scroll-restoration';
import { vi } from '../i18n/vi';
import { getLoadErrorMessage } from '../services/api';
import { coreHttp } from '../services/core-http';
import { uniqueById } from '../utils/unique-by-id';

const PAGE_STYLE: CSSProperties = { background: 'var(--color-bg-canvas)', paddingBottom: 32 };

/**
 * Hàng tab dính ngay dưới thanh lùi đặc (cao 56px + vùng an toàn) mà `BackButton` vẽ khi cuộn: tab không chui dưới nó. Vị trí dính tính từ
 * chỗ nội dung của `.page` bắt đầu (đệm `--safe-top` + 48px khi có nút lùi), nên chỉ còn 56 - 48 = 8px; ghi 56px cộng vùng an toàn thì hở
 * một dải 48px để thẻ cuộn lộ ra giữa thanh lùi và hàng tab.
 */
const TABS_BAR: CSSProperties = {
  position: 'sticky',
  top: 8,
  zIndex: 2,
  padding: '8px 16px',
  background: 'var(--color-bg-canvas)',
};

/**
 * Bán chạy nhất: bảng xếp hạng 30 ngày (Q18) có hạng thật trên thẻ, lọc theo danh mục tầng 1 bằng tab. Phạm vi nằm trên URL
 * (`?category=<id>`, replace: Back rời trang chứ không tua từng tab). Hàng tab luôn vẽ, cây danh mục rỗng như PROD chỉ còn "Tất cả".
 * Khách chưa đăng nhập xem được: chỉ gọi API công khai. Danh sách phẳng từ trang 1 nên hạng thẻ tiếp nối qua "Xem thêm".
 */
export default function BestSellersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const categories = useCategories();
  const anchorRef = useRef<HTMLDivElement>(null);
  // `null` = cây chưa tải: tin tham số URL, khỏi tải danh sách hai lần.
  const tabs = categories.isLoading ? null : bestSellerTabs(categories.categories);
  const scope = bestSellerScope(tabs, params.get('category'));
  const tabItems = tabs ?? bestSellerTabs(undefined);
  const activeLabel = bestSellerPanelLabel(tabs, scope.tab);

  const products = useInfiniteQuery(bestSellersListQuery(coreHttp, scope.category));
  const list = uniqueById(products.data?.pages.flatMap((pg) => pg.data) ?? []);
  const { anchorRef: restoreRef } = useScrollRestoration(`best-sellers:${scope.category ?? 'all'}`, list.length > 0);

  const pickTab = (key: string) => {
    if (key === scope.tab) return;
    // Về đầu trang trước khi ghi URL: nội dung mới ngắn hơn lúc đang tải, trình duyệt sẽ kẹp vị trí cuộn về giữa trang.
    const scroller = anchorRef.current?.closest<HTMLElement>('.zaui-page');
    if (scroller) scroller.scrollTop = 0;
    const next = new URLSearchParams(params);
    if (key === BEST_SELLERS_ALL_KEY) next.delete('category');
    else next.set('category', key);
    setParams(next, { replace: true });
  };

  return (
    <Page className="page" style={PAGE_STYLE}>
      <PullToRefresh onRefresh={() => products.refetch()} />
      <div
        ref={(el) => {
          (anchorRef as { current: HTMLDivElement | null }).current = el;
          (restoreRef as { current: HTMLDivElement | null }).current = el;
        }}
      />
      <PageHeader title={fillCopy('rank.title')} subtitle={fillCopy('rank.basis')} />
      <div style={TABS_BAR}>
        <SegmentedTabs scroll label={fillCopy('rank.tabsLabel')} items={tabItems} value={scope.tab} onChange={pickTab} />
      </div>
      <div role="tabpanel" aria-label={activeLabel} style={{ padding: '8px 16px 24px' }}>
        {products.isLoading ? (
          <ProductGrid items={[]} variant="rank" loading skeletonCount={6} />
        ) : products.isError && list.length === 0 ? (
          <ErrorState message={getLoadErrorMessage(products.error)} retrying={products.isFetching} onRetry={() => void products.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            art="leaf"
            heading={fillCopy('rank.emptyTitle')}
            ctaLabel={fillCopy('rank.emptyCta')}
            onCta={() => navigate(scope.category ? `/browse?category=${encodeURIComponent(scope.category)}` : '/browse?all=1')}
          />
        ) : (
          <>
            <ProductGrid items={list} variant="rank" rankFrom={bestSellersRankFrom(1)} listSource="best_seller_page" />
            {/* Lỗi khi ĐÃ có dữ liệu ("Xem thêm" hoặc làm mới nền thất bại): giữ danh sách, báo và thử lại tại chỗ. */}
            {products.isError && (
              <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 16 }}>
                <Text variant="body-sm" tone="danger">
                  {vi.browse.loadMoreFailed}
                </Text>
                <Button
                  variant="secondary"
                  loading={products.isFetching}
                  onPress={() => {
                    (products.isFetchNextPageError ? products.fetchNextPage() : products.refetch()).catch(() => undefined);
                  }}
                  style={{ minWidth: 0 }}
                >
                  {vi.common.retry}
                </Button>
              </div>
            )}
            {products.hasNextPage && !products.isFetchNextPageError && (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 16 }}>
                <Button
                  variant="secondary"
                  loading={products.isFetchingNextPage}
                  onPress={() => {
                    products.fetchNextPage().catch(() => undefined);
                  }}
                  style={{ minWidth: 160 }}
                >
                  {vi.browse.loadMore}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
