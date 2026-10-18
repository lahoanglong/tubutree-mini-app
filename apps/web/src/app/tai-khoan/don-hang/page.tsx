'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ordersListQuery } from '@tubutree/app-core/queries/orders';
import { newCustomerOfferQuery } from '@tubutree/app-core/queries/loyalty';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs, useTabParam } from '@/components/ui/segmented-tabs';
import { ErrorState } from '@/components/ui/error-state';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { OrderCard } from '@/components/orders/order-card';
import { PurchasedRail } from '@/components/orders/purchased-rail';
import { ReorderSheet } from '@/components/orders/reorder-sheet';
import { SubscriptionsPanel } from '@/components/orders/subscriptions-panel';
import { orderReorderTarget, type ReorderTarget } from '@/components/orders/reorder';
import type { ReorderNotice } from '@/components/orders/use-reorder';
import { ORDERS_TABS, ORDERS_TAB_KEYS, type OrdersTabKey } from '@/components/orders/orders-tabs';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';

const PAGE_LIMIT = 20;

/**
 * Tab gốc "Đơn hàng" như `orders.tsx` của Mini App: tab trạng thái (kèm Định kỳ) → thẻ đơn có ảnh, số món, "Mua lại" → kệ Mua lại
 * (chỉ tab "Tất cả"). Tab đang chọn nằm ở `?tab=`. Hub `/tai-khoan` vẫn có khối OrdersSection riêng (có ô tìm).
 */
function OrdersPageBody() {
  const phase = useAuthPhase();
  const { user } = useAuth();
  const [tab, setTab] = useTabParam(ORDERS_TAB_KEYS, 'all');
  const current = ORDERS_TABS.find((t) => t.key === tab) ?? ORDERS_TABS[0]!;
  const isSubscriptions = tab === 'subscriptions';
  // State ổn định (không dựng target trong JSX): ReorderSheet khởi tạo lại lựa chọn theo danh tính của target.
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [notice, setNotice] = useState<ReorderNotice | null>(null);

  // Khoá bắt đầu bằng ['orders'] nên invalidateQueries({ queryKey: ['orders'] }) ở trang chuyển khoản/huỷ đơn làm mới danh sách.
  const orders = useInfiniteQuery({
    ...ordersListQuery(coreHttp, tab, current.filter ?? {}, PAGE_LIMIT),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const { page, limit, total } = last.meta;
      return page * limit < total ? page + 1 : undefined;
    },
    enabled: phase === 'authenticated' && !isSubscriptions,
  });
  const list = orders.data?.pages.flatMap((pg) => pg.data) ?? [];

  // Chỉ nhắc mã chào mừng khi khách thật sự đang có mã (API trả kèm mã còn dùng được), số lấy từ chính mã đó: cấu hình có mệnh giá
  // không có nghĩa khách nhận được (chưa cấp, đã dùng, hết hạn, tài khoản vãng lai).
  const showWelcomeHint = phase === 'authenticated' && tab === 'all' && orders.isSuccess && list.length === 0;
  const offerQ = useQuery({ ...newCustomerOfferQuery(coreHttp, user?.id), enabled: showWelcomeHint, retry: false });
  const welcome = offerQ.data?.isNewCustomer ? offerQ.data.welcomeVoucher : null;
  const emptyBody =
    welcome && welcome.type === 'AMOUNT' && welcome.value > 0
      ? welcome.minOrder
        ? `Đơn đầu từ ${formatVnd(welcome.minOrder)} dùng được mã giảm giá chào mừng ${formatVnd(welcome.value)}`
        : `Đơn đầu dùng được mã giảm giá chào mừng ${formatVnd(welcome.value)}`
      : undefined;

  let body: React.ReactNode;
  if (phase === 'loading') body = <AuthLoading />;
  else if (phase === 'unavailable') body = <SessionUnavailable />;
  else if (phase === 'guest') body = <LoginRequired message="Đăng nhập để xem đơn hàng của bạn." returnTo="/tai-khoan/don-hang" />;
  else {
    body = (
      <>
        <div className="mt-3">
          <SegmentedTabs
            items={ORDERS_TABS.map((t) => ({ key: t.key, label: t.label }))}
            value={tab}
            onChange={(key) => setTab(key as OrdersTabKey)}
            label="Lọc đơn hàng theo trạng thái"
            scroll
          />
        </div>

        {notice && (
          <div role="status" className={`mt-3 rounded-control border p-3 text-sm ${notice.tone === 'warning' ? 'border-warning-fg bg-warning-bg text-warning-fg' : 'border-forest-200 bg-forest-50 text-forest-800'}`}>
            <p>{notice.text}</p>
            <Link href="/gio-hang" className="mt-1 inline-flex min-h-11 items-center font-semibold underline">
              Xem giỏ hàng
            </Link>
          </div>
        )}

        {isSubscriptions ? (
          <SubscriptionsPanel />
        ) : orders.isLoading ? (
          <div className="mt-3 flex flex-col gap-2.5">
            <LineItemSkeleton />
            <LineItemSkeleton />
            <LineItemSkeleton />
          </div>
        ) : orders.isError && list.length === 0 ? (
          <div className="mt-3">
            <ErrorState message={orders.error instanceof Error ? orders.error.message : undefined} onRetry={() => void orders.refetch()} />
          </div>
        ) : list.length === 0 ? (
          tab === 'all' ? (
            <section aria-label="Bạn chưa có đơn nào" className={`mt-3 p-8 text-center ${ui.card}`}>
              <h2 className="font-display text-base font-semibold text-stone-900">Bạn chưa có đơn nào</h2>
              {emptyBody && <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">{emptyBody}</p>}
              <Link href="/san-pham" className={`${ui.btnPrimary} mt-4`}>
                Bắt đầu mua
              </Link>
            </section>
          ) : (
            <p className={`mt-3 p-6 text-center text-sm text-stone-600 ${ui.card}`}>Không có đơn nào ở mục này</p>
          )
        ) : (
          <>
            <ul className="mt-3 flex flex-col gap-2.5">
              {list.map((o) => (
                <OrderCard key={o.id} order={o} onReorder={() => setReorderTarget(orderReorderTarget(o))} />
              ))}
            </ul>
            {orders.isFetchNextPageError && (
              <p role="alert" className={`mt-2 text-center ${ui.error}`}>
                Không tải thêm được đơn hàng. Vui lòng thử lại.
              </p>
            )}
            {orders.hasNextPage && (
              <div className="mt-3 text-center">
                <button type="button" disabled={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()} className={`${ui.btnSecondary} min-w-40`}>
                  {orders.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Khách vào tab này chủ yếu để xem đơn đang giao: kệ Mua lại đứng sau danh sách, chỉ ở "Tất cả". */}
        {tab === 'all' && !orders.isLoading && !orders.isError && <PurchasedRail source="orders_tab" onNotice={setNotice} />}
      </>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader title="Đơn hàng" backHref="/tai-khoan" backLabel="Tài khoản" />
      {body}
      <ReorderSheet target={reorderTarget} source="order_card" navigateToCart onNotice={setNotice} onClose={() => setReorderTarget(null)} />
    </main>
  );
}

// useTabParam đọc useSearchParams: build tĩnh bắt buộc có Suspense bao ngoài.
export default function OrdersPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <OrdersPageBody />
    </Suspense>
  );
}
