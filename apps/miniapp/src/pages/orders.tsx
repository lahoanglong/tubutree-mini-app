import { useState } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchOrders } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Button } from '../components/ui/button';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { OrderCard } from '../components/orders/order-card';
import { ORDERS_TABS, parseOrdersTab, type OrdersTabKey } from '../components/orders/orders-tabs';
import { PurchasedRail } from '../components/reorder/purchased-rail';
import { ReorderSheet } from '../components/reorder/reorder-sheet';
import { orderReorderTarget, type ReorderTarget } from '../components/reorder/reorder-types';
import { SubscriptionsPanel } from '../components/subscriptions-panel';

const PAGE_LIMIT = 20;

/**
 * Tab gốc "Đơn hàng" (spec 4a.1/4a.2): kệ Mua lại → tab trạng thái (+ Định kỳ) → thẻ đơn có ảnh,
 * số món, nút Mua lại. Trang gốc: không nút back, đệm đáy cho tab bar.
 */
export default function OrdersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const authStatus = useAuthStore((s) => s.status);
  const [tab, setTab] = useState<OrdersTabKey>(() => parseOrdersTab(location.search));
  // State ổn định (không dựng target trong JSX) — ReorderSheet reset lựa chọn theo identity của target.
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const current = ORDERS_TABS.find((t) => t.key === tab) ?? ORDERS_TABS[0]!;
  const isSubscriptions = tab === 'subscriptions';

  // Phân trang bằng useInfiniteQuery + "Xem thêm" (giữ fix cũ: >20 đơn vẫn xem được đơn cũ).
  // Key bắt đầu bằng ['orders'] để invalidateQueries({ queryKey: ['orders'] }) hiện có vẫn làm mới danh sách.
  const orders = useInfiniteQuery({
    queryKey: ['orders', 'list', tab],
    queryFn: ({ pageParam }) => fetchOrders(current.filter ?? {}, pageParam, PAGE_LIMIT),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, limit, total } = lastPage.meta;
      return page * limit < total ? page + 1 : undefined;
    },
    enabled: authStatus === 'authenticated' && !isSubscriptions,
  });
  const list = orders.data?.pages.flatMap((pg) => pg.data) ?? [];

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(76px + var(--safe-bottom))' }}>
      <PageHeader title={vi.orders.tabTitle} back={false} />
      <div style={{ paddingTop: 8 }}>
        <PurchasedRail source="orders_tab" />
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <SegmentedTabs
          items={ORDERS_TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={tab}
          onChange={(key) => {
            haptic('light');
            setTab(key as OrdersTabKey);
          }}
          scroll
        />
      </div>

      {isSubscriptions ? (
        <SubscriptionsPanel />
      ) : orders.isLoading || authStatus === 'loading' ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
          <LineItemSkeleton />
        </div>
      ) : orders.isError ? (
        <ErrorState message={getErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
      ) : list.length === 0 ? (
        tab === 'all' ? (
          <EmptyState
            art="box"
            heading={vi.orders.emptyHeading}
            body={vi.orders.emptyBody}
            ctaLabel={vi.orders.emptyCta}
            onCta={() => navigate('/browse')}
          />
        ) : (
          <EmptyState variant="inline" art="box" heading={vi.orders.emptyTabHeading} />
        )
      ) : (
        <>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                onOpen={() => navigate(`/order/${o.code}`)}
                onReorder={() => setReorderTarget(orderReorderTarget(o))}
              />
            ))}
          </div>
          {orders.hasNextPage && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 16 }}>
              <Button
                variant="secondary"
                loading={orders.isFetchingNextPage}
                onPress={() => void orders.fetchNextPage()}
                style={{ minWidth: 160 }}
              >
                {vi.orders.loadMore}
              </Button>
            </div>
          )}
        </>
      )}

      <ReorderSheet target={reorderTarget} source="order_card" navigateToCart onClose={() => setReorderTarget(null)} />
    </Page>
  );
}
