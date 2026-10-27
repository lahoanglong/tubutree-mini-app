'use client';

import { useId } from 'react';
import Link from 'next/link';
import type { OrderView } from '@tubutree/app-core/api/orders';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { bankPaymentHref, buyerOrderStatusLabel, isReorderable, orderDetailHref } from '@/lib/order-view';
import { formatVnd } from '@/lib/format-vnd';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';
import { canPayNow, orderUnitCount, showsPaymentDeadline } from './order-rules';
import { ProductThumb } from '@/components/mini';

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'brand',
  PACKED: 'brand',
  SHIPPING: 'info',
  DELIVERED: 'success',
  RETURNED: 'neutral',
  CANCELLED: 'danger',
};

export interface OrderCardProps {
  order: OrderView;
  /** Có = hiện nút "Mua lại" cho đơn đã xong. */
  onReorder?: () => void;
}

/**
 * Thẻ đơn trong trang Đơn hàng: ảnh SP đầu, số món, tổng tiền, trạng thái, "Mua lại" ở đơn đã xong, "Thanh toán ngay" + hạn ở
 * đơn chuyển khoản còn chờ tiền. Mã đơn là liên kết phủ cả thẻ (`after:inset-0`), các nút hành động nổi lên trên bằng z-index nên
 * không có phần tử tương tác lồng nhau.
 */
export function OrderCard({ order: o, onReorder }: OrderCardProps) {
  const first = o.items[0];
  const canReorder = onReorder !== undefined && isReorderable(o.status);
  const canPay = canPayNow(o);
  const summaryId = useId();
  return (
    <li data-testid="order-card" className={`relative isolate flex flex-col gap-2.5 p-3 ${ui.card} ${mini.card}`}>
      <div className="flex items-center justify-between gap-2">
        <Link
          href={orderDetailHref(o.code)}
          aria-label={`Đơn ${o.code}`}
          aria-describedby={summaryId}
          className="flex min-h-11 min-w-0 items-center break-all text-sm font-semibold tracking-wide text-stone-900 max-md:min-h-6 max-md:text-xs max-md:font-bold after:absolute after:inset-0 after:content-['']"
        >
          {o.code}
        </Link>
        <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{buyerOrderStatusLabel(o)}</Badge>
      </div>
      <div id={summaryId} className="flex items-center gap-3">
        <div className={`flex-none ${mini.thumb}`}>
          <ProductThumb src={first?.thumbnail} alt="" size={56} />
        </div>
        <div className="min-w-0 flex-1">
          {first && (
            <div className="truncate text-sm text-stone-900">
              {first.productName}
              {o.items.length > 1 ? ` +${o.items.length - 1}` : ''}
            </div>
          )}
          <div className="text-xs text-stone-600">
            {orderUnitCount(o.items)} món · {formatDate(o.createdAt)}
          </div>
        </div>
        <span className="flex-none text-sm font-semibold text-stone-900">{formatVnd(o.total)}</span>
      </div>
      {canPay && (
        <div data-testid="order-card-actions" className="flex items-center justify-between gap-2">
          {showsPaymentDeadline(o) ? <span className="text-xs text-stone-600">Hạn {formatDateTime(o.paymentDeadline)}</span> : <span />}
          <Link href={bankPaymentHref(o.code)} className={`${ui.btnPrimary} relative z-10`}>
            Thanh toán ngay
          </Link>
        </div>
      )}
      {canReorder && (
        <div data-testid="order-card-actions" className="flex justify-end">
          <button type="button" onClick={onReorder} className={`${ui.btnSecondary} ${mini.secondary} relative z-10 max-md:text-base`}>
            Mua lại
          </button>
        </div>
      )}
    </li>
  );
}
