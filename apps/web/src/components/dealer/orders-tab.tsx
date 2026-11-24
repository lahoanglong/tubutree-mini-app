'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, FileText, Package, RotateCcw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { OrderDTO } from '@tubutree/shared-types';
import { dealerOrdersQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { formatDate } from '@/lib/format-date';
import { orderStatusLabel } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { Chip } from '@/components/mini/chip';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errText } from './dealer-shell';
import { DEALER_ORDER_FILTERS, canReorder, filterDealerOrders, reorderLinesOf, type DealerOrderFilter, type ReorderRequest } from './dealer-order-tools';
import { DealerInvoiceSheet, type DealerNotice } from './dealer-invoice-sheet';
import { invoiceEligibleOrders, invoiceTag } from './dealer-tier-tools';

/**
 * Danh sách đơn đại lý, lọc theo trạng thái bằng một hàng chip. Đơn Trả trước chờ thanh toán dẫn thẳng tới trang chuyển khoản.
 * "Đặt lại đơn sỉ" đưa các dòng của đơn sang tab Bảng giá (`onReorder`), nơi số lượng được nạp theo bảng giá hôm nay.
 */
export function OrdersTab({ onOrderFirst, onReorder }: { onOrderFirst: () => void; onReorder?: (r: ReorderRequest) => void }) {
  const q = useQuery(dealerOrdersQuery(coreHttp));
  const [filter, setFilter] = useState<DealerOrderFilter>('all');
  // Danh sách đơn được xin hoá đơn chụp lúc mở sheet: danh sách tải lại khi sheet đang mở không làm đổi các dòng đại lý đang chọn.
  const [invoiceOrders, setInvoiceOrders] = useState<OrderDTO[] | null>(null);
  const [notice, setNotice] = useState<DealerNotice | null>(null);
  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-2.5">
        <Skeleton height={80} />
        <Skeleton height={80} />
      </div>
    );
  }
  if (q.isError && !q.data) return <ErrorState message={errText(q.error)} onRetry={() => q.refetch()} />;
  const orders = q.data ?? [];
  if (orders.length === 0) {
    return (
      <section aria-label="Chưa có đơn đại lý nào" className={`p-8 text-center ${skin.card}`}>
        <Package className="mx-auto h-8 w-8 text-stone-500" aria-hidden="true" />
        <h2 className="mt-2 font-display text-base font-semibold text-stone-900">Chưa có đơn đại lý nào</h2>
        <button type="button" onClick={onOrderFirst} className={`${ui.btnPrimary} mt-3`}>
          Đặt đơn sỉ
        </button>
      </section>
    );
  }
  const shown = filterDealerOrders(orders, filter);
  const invoiceable = invoiceEligibleOrders(orders, new Date());
  return (
    <>
      <div role="status" aria-live="polite">
        {notice && (
          <p role={notice.error ? 'alert' : undefined} className={`mb-3 text-sm ${notice.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>
            {notice.text}
          </p>
        )}
      </div>
      <div role="group" aria-label="Lọc đơn theo trạng thái" className="scroll-x mb-3 flex gap-2 overflow-x-auto py-1">
        {DEALER_ORDER_FILTERS.map((f) => (
          <Chip key={f.key} selected={filter === f.key} onPress={() => setFilter(f.key)}>
            {f.label}
          </Chip>
        ))}
      </div>
      {invoiceable.length > 0 && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className={`${ui.btnText} gap-1 no-underline`}
            onClick={() => {
              setNotice(null);
              setInvoiceOrders(invoiceable);
            }}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Yêu cầu hoá đơn VAT ({invoiceable.length} đơn)
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className={`p-6 text-center text-sm text-stone-600 ${skin.card}`}>Không có đơn nào ở mục này.</p>
      ) : (
        <ul className="grid gap-2.5 md:grid-cols-2">
          {shown.map((o) => {
            const needsPayment = o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'BANK_TRANSFER';
            const backordered = o.items?.reduce((s, it) => s + (it.backorderedQty || 0), 0) ?? 0;
            const reorderable = !!onReorder && canReorder(o);
            return (
              <li key={o.code} className={reorderable ? `overflow-hidden ${skin.card}` : undefined}>
                <Link
                  href={`/tai-khoan/don-hang/${encodeURIComponent(o.code)}`}
                  aria-label={`Xem đơn ${o.code}`}
                  className={`block min-h-11 p-3 hover:bg-stone-50 ${reorderable ? 'pb-1' : skin.card}`}
                >
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
                    {invoiceTag(o) ? ` · ${invoiceTag(o)}` : ''}
                  </div>
                  {backordered > 0 && (
                    <div className="mt-1">
                      <Badge tone="warning" size="sm">
                        Đặt trước {backordered} — chờ hàng về
                      </Badge>
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-base font-bold tabular-nums text-stone-900 max-md:text-[var(--color-dealer-ink)]">{formatVnd(o.total)}</span>
                    {needsPayment && <span className="text-xs font-semibold text-forest-700">Thanh toán ngay →</span>}
                  </div>
                </Link>
                {reorderable && (
                  <div className="flex justify-end px-1.5">
                    <button
                      type="button"
                      aria-label={`Đặt lại đơn sỉ ${o.code}`}
                      onClick={() => onReorder?.({ code: o.code, lines: reorderLinesOf(o) })}
                      className={`${ui.btnText} gap-1 no-underline`}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Đặt lại đơn sỉ
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <DealerInvoiceSheet
        open={invoiceOrders !== null}
        orders={invoiceOrders ?? []}
        onClose={() => setInvoiceOrders(null)}
        onDone={(n) => {
          setInvoiceOrders(null);
          setNotice(n);
        }}
      />
    </>
  );
}
