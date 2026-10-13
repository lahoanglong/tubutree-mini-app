'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchOrdersPage, formatVnd } from '@/lib/shop-client';
import {
  ORDER_TABS,
  canPayAgain,
  orderDetailHref,
  orderStatusLabel,
  orderStatusTone,
  type OrderTabKey,
} from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { RecyclingStatus } from '@/components/recycling-status';
import { formatDate } from '@/lib/format-date';

/** Danh sách đơn có lọc theo trạng thái, tải thêm từng trang 20 đơn và hiện tổng số đơn. */
export function OrdersSection() {
  const [tab, setTab] = useState<OrderTabKey>('all');
  const current = ORDER_TABS.find((t) => t.key === tab) ?? ORDER_TABS[0];
  // ['orders', …]: các trang khác (chi tiết đơn) làm mới theo tiền tố ['orders'].
  const ordersQ = useInfiniteQuery({
    queryKey: ['orders', tab],
    queryFn: ({ pageParam }) => fetchOrdersPage(pageParam, current.filter),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
  });
  const orders = ordersQ.data?.pages.flatMap((p) => p.data) ?? [];
  const total = ordersQ.data?.pages[0]?.meta.total ?? 0;

  return (
    <section className="mt-6" aria-labelledby="orders-title">
      <h2 id="orders-title" className={ui.sectionTitle}>
        Đơn hàng của tôi{ordersQ.data && total > 0 ? ` (${total})` : ''}
      </h2>

      <div role="group" aria-label="Lọc đơn hàng theo trạng thái" className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {ORDER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={t.key === tab}
            onClick={() => setTab(t.key)}
            className={`inline-flex min-h-11 flex-none items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition ${
              t.key === tab
                ? 'bg-forest-600 text-stone-0 shadow-card'
                : 'border border-stone-300 bg-stone-0 text-stone-700 hover:border-stone-450 hover:bg-stone-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ordersQ.isLoading ? (
        <p className="py-6 text-center text-stone-600">Đang tải…</p>
      ) : ordersQ.isError && orders.length === 0 ? (
        <div className={`mt-3 p-6 text-center ${ui.card}`}>
          <p className={ui.error}>Không tải được danh sách đơn hàng.</p>
          <button type="button" onClick={() => void ordersQ.refetch()} className={`${ui.btnText} mt-1 text-forest-700`}>
            Thử lại
          </button>
        </div>
      ) : orders.length > 0 ? (
        <>
          <ul className="mt-3 space-y-3">
            {orders.map((o) => (
              <li key={o.code} className={`p-4 ${ui.card}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-all font-medium text-stone-900">#{o.code}</span>
                  <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-medium ${orderStatusTone(o.status)}`}>
                    {orderStatusLabel(o.status)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-stone-600">
                  {o.items.length} sản phẩm · {formatDate(o.createdAt)}
                </div>
                <div className="mt-1 font-semibold text-stone-900">{formatVnd(o.total)}</div>
                <RecyclingStatus order={o} />
                {/* Đơn chuyển khoản còn chờ tiền: lối riêng "Thanh toán" vì đó là việc khách còn phải làm. */}
                {canPayAgain(o) ? (
                  <Link href={orderDetailHref(o.code)} aria-label={`Thanh toán đơn ${o.code}`} className={`${ui.btnPrimary} mt-2`}>
                    Thanh toán
                  </Link>
                ) : (
                  <Link
                    href={orderDetailHref(o.code)}
                    aria-label={`Xem chi tiết đơn ${o.code}`}
                    className={`${ui.btnText} -ml-2 mt-1 text-forest-700`}
                  >
                    Xem chi tiết
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p role="status" className="mt-3 text-center text-xs text-stone-600">
            Đang hiển thị {orders.length.toLocaleString('vi-VN')} / {total.toLocaleString('vi-VN')} đơn
          </p>
          {ordersQ.hasNextPage && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={() => void ordersQ.fetchNextPage()}
                disabled={ordersQ.isFetchingNextPage}
                className={ui.btnSecondary}
              >
                {ordersQ.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm đơn cũ hơn'}
              </button>
              {ordersQ.isFetchNextPageError && (
                <p role="alert" className={`mt-2 ${ui.error}`}>
                  Không tải thêm được đơn hàng. Vui lòng thử lại.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <p className={`mt-3 p-6 text-center text-sm text-stone-600 ${ui.card}`}>
          {tab === 'all' ? 'Bạn chưa có đơn hàng nào.' : 'Không có đơn hàng nào ở trạng thái này.'}
        </p>
      )}
    </section>
  );
}
