'use client';

import Link from 'next/link';
import { ChevronRight, Package } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { dealerOrdersQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { formatDate } from '@/lib/format-date';
import { orderStatusLabel } from '@/lib/order-view';
import { skin } from '@/components/pro-shared/mini-skin';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errText } from './dealer-shell';

/** Danh sách đơn đại lý. Đơn Trả trước chờ thanh toán dẫn thẳng tới trang chuyển khoản. */
export function OrdersTab() {
  const q = useQuery(dealerOrdersQuery(coreHttp));
  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-2.5">
        <Skeleton height={80} />
        <Skeleton height={80} />
      </div>
    );
  }
  if (q.isError && !q.data) return <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />;
  const orders = q.data ?? [];
  if (orders.length === 0) {
    return (
      <section aria-label="Chưa có đơn đại lý nào" className={`p-8 text-center ${skin.card}`}>
        <Package className="mx-auto h-8 w-8 text-stone-500" aria-hidden="true" />
        <h2 className="mt-2 font-display text-base font-semibold text-stone-900">Chưa có đơn đại lý nào</h2>
      </section>
    );
  }
  return (
    <ul className="grid gap-2.5 md:grid-cols-2">
      {orders.map((o) => {
        const needsPayment = o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'BANK_TRANSFER';
        const backordered = o.items?.reduce((s, it) => s + (it.backorderedQty || 0), 0) ?? 0;
        return (
          <li key={o.code}>
            <Link href={`/tai-khoan/don-hang/${encodeURIComponent(o.code)}`} aria-label={`Xem đơn ${o.code}`} className={`block min-h-11 p-3 hover:bg-stone-50 ${skin.card}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-stone-900">#{o.code}</span>
                <span className="flex items-center gap-0.5">
                  <Badge tone={needsPayment ? 'warning' : 'info'} size="sm">
                    {orderStatusLabel(o.status)}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
                </span>
              </div>
              <div className="mt-0.5 text-xs text-stone-600">
                {o.items?.length ?? 0} mặt hàng · {formatDate(o.createdAt)}
              </div>
              {backordered > 0 && (
                <div className="mt-1">
                  <Badge tone="warning" size="sm">
                    Đặt trước {backordered} — chờ hàng về
                  </Badge>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-base font-bold tabular-nums text-stone-900">{formatVnd(o.total)}</span>
                {needsPayment && <span className="text-xs font-semibold text-forest-700">Thanh toán ngay →</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
