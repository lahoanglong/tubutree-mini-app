import { useState } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchOrders } from '../services/shop-api';
import { getLoadErrorMessage } from '../services/api';
import { getNewCustomerOffer } from '../services/account-api';
import { useAuthStore } from '../store/auth';
import { AuthGate } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { formatVnd } from '../utils/format';
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
 * Tab gốc "Đơn hàng" (spec 4a.1/4a.2): tab trạng thái (+ Định kỳ) → thẻ đơn có ảnh, số món, nút Mua lại → kệ Mua lại
 * (chỉ tab "Tất cả"). Trang gốc: không nút back, đệm đáy cho tab bar.
 */
export default function OrdersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const phase = useAuthPhase();
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
    enabled: phase === 'authenticated' && !isSubscriptions,
  });
  const list = orders.data?.pages.flatMap((pg) => pg.data) ?? [];

  // Chỉ nhắc mã chào mừng khi khách thật sự đang có mã (API trả kèm mã còn dùng được), số lấy từ chính mã đó: config có mệnh giá
  // không có nghĩa khách nhận được (chưa cấp, đã dùng, hết hạn, tài khoản vãng lai). Cùng khoá với khối "Quà khách mới" ở Trang chủ.
  const userId = useAuthStore((st) => st.user?.id);
  const showWelcomeHint = phase === 'authenticated' && tab === 'all' && orders.isSuccess && list.length === 0;
  const offerQ = useQuery({ queryKey: ['new-customer-offer', userId], queryFn: getNewCustomerOffer, enabled: showWelcomeHint, retry: false });
  const welcome = offerQ.data?.isNewCustomer ? offerQ.data.welcomeVoucher : null;
  const emptyBody =
    welcome && welcome.type === 'AMOUNT' && welcome.value > 0
      ? welcome.minOrder
        ? vi.orders.emptyBody(formatVnd(welcome.minOrder), formatVnd(welcome.value))
        : vi.orders.emptyBodyNoMin(formatVnd(welcome.value))
      : undefined;

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(24px + var(--safe-bottom))' }}>
      <PageHeader title={vi.orders.tabTitle} />

      <AuthGate>
        <div style={{ padding: '8px 12px' }}>
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
        ) : orders.isLoading ? (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <LineItemSkeleton />
            <LineItemSkeleton />
            <LineItemSkeleton />
          </div>
        ) : orders.isError && list.length === 0 ? (
          <ErrorState message={getLoadErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
        ) : list.length === 0 ? (
          tab === 'all' ? (
            <EmptyState
              art="box"
              heading={vi.orders.emptyHeading}
              body={emptyBody}
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
                  onPay={() => {
                    haptic('light');
                    navigate(`/bank-payment/${o.code}`);
                  }}
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

        {/* Khách vào tab này chủ yếu để xem đơn đang giao: kệ Mua lại đứng sau danh sách, chỉ ở "Tất cả". */}
        {tab === 'all' && !orders.isLoading && !orders.isError && <PurchasedRail source="orders_tab" />}
      </AuthGate>

      <ReorderSheet target={reorderTarget} source="order_card" navigateToCart onClose={() => setReorderTarget(null)} />
    </Page>
  );
}
