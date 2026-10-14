'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Leaf, Search } from 'lucide-react';
import { fetchOrdersPage, formatVnd, type OrderDTO } from '@/lib/shop-client';
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

/** Số sản phẩm đầu mỗi đơn hiện tên + ảnh; phần còn lại gộp thành "và N sản phẩm khác". */
const PREVIEW_ITEMS = 2;

function OrderItemsPreview({ items }: { items: OrderDTO['items'] }) {
  const shown = items.slice(0, PREVIEW_ITEMS);
  const more = items.length - shown.length;
  return (
    <div className="mt-2 space-y-1.5">
      {shown.map((it, i) => (
        <div key={`${it.productName}-${it.variationName}-${i}`} className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-control bg-forest-50">
            {it.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.thumbnail} alt="" className="h-full w-full object-cover" />
            ) : (
              <Leaf className="h-4 w-4 text-forest-600" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-sm text-stone-900">
            <span className="line-clamp-2 break-words">{it.productName}</span>
            {it.variationName ? <span className="text-xs text-stone-600"> · {it.variationName}</span> : null}
          </div>
          {it.quantity > 1 && <span className="flex-none text-xs text-stone-600">×{it.quantity}</span>}
        </div>
      ))}
      {more > 0 && <div className="text-xs text-stone-600">và {more.toLocaleString('vi-VN')} sản phẩm khác</div>}
    </div>
  );
}

/** Danh sách đơn có lọc theo trạng thái, ô tìm theo mã/tên sản phẩm, tải thêm từng trang 20 đơn và hiện tổng số đơn. */
export function OrdersSection() {
  const [tab, setTab] = useState<OrderTabKey>('all');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const current = ORDER_TABS.find((t) => t.key === tab) ?? ORDER_TABS[0];
  const filter = { ...current.filter, ...(query ? { q: query } : {}) };
  // ['orders', …]: các trang khác (chi tiết đơn) làm mới theo tiền tố ['orders'].
  const ordersQ = useInfiniteQuery({
    queryKey: ['orders', tab, query],
    queryFn: ({ pageParam }) => fetchOrdersPage(pageParam, filter),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
  });
  const orders = ordersQ.data?.pages.flatMap((p) => p.data) ?? [];
  const total = ordersQ.data?.pages[0]?.meta.total ?? 0;

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(draft.trim());
  };
  const clearSearch = () => {
    setDraft('');
    setQuery('');
  };

  return (
    <section className="mt-6" aria-labelledby="orders-title">
      <h2 id="orders-title" className={ui.sectionTitle}>
        Đơn hàng của tôi{ordersQ.data && total > 0 ? ` (${total})` : ''}
      </h2>

      <form role="search" onSubmit={submitSearch} className="mt-3 flex gap-2">
        <label htmlFor="orders-search" className="sr-only">
          Tìm đơn theo mã đơn hoặc tên sản phẩm
        </label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
          <input
            id="orders-search"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={100}
            placeholder="Tìm theo mã đơn hoặc tên sản phẩm"
            className={`${ui.field} pl-9`}
          />
        </div>
        <button type="submit" className={ui.btnSecondary}>
          Tìm
        </button>
      </form>
      {query && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-stone-700">
          <span role="status">Kết quả cho “{query}”</span>
          <button type="button" onClick={clearSearch} className={`${ui.btnText} text-forest-700`}>
            Xóa tìm kiếm
          </button>
        </div>
      )}

      <div role="group" aria-label="Lọc đơn hàng theo trạng thái" className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
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
                <OrderItemsPreview items={o.items} />
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
          {query
            ? `Không tìm thấy đơn nào khớp “${query}”${tab === 'all' ? '' : ' ở trạng thái này'}.`
            : tab === 'all'
              ? 'Bạn chưa có đơn hàng nào.'
              : 'Không có đơn hàng nào ở trạng thái này.'}
        </p>
      )}
    </section>
  );
}
