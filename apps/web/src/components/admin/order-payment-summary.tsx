'use client';

import type { AdminOrder, AdminOrderRefund } from '@/lib/admin-client';
import { PAYMENT_METHOD_LABELS } from '@/lib/export-csv';
import { formatDateTime } from '@/lib/format-date';
import { isRefundInProgress, orderPaymentStatusLabel } from '@/lib/order-view';
import { formatVnd } from '@/lib/shop-client';
import {
  CUSTOMER_REFUND_VIEW_LABEL,
  CUSTOMER_REFUND_VIEW_TONE,
  customerRefundView,
  refundKindLabel,
} from '@/lib/customer-refunds-admin';
import { ToneBadge } from './ui';

/** Nơi tiền về; khoản chờ đối soát chưa có nơi nhận (khách chọn sau khi admin xác nhận), khoản vào Ví đã nói ở nhãn. */
function destination(r: AdminOrderRefund): string {
  if (r.method === 'WALLET' || r.status === 'UNVERIFIED') return '';
  return r.kind === 'END_CUSTOMER' ? 'chuyển cho khách cuối theo SĐT' : 'về tài khoản ngân hàng';
}

/**
 * Thanh toán và các khoản hoàn của đơn, ở đầu chi tiết đơn (mọi độ rộng — ngăn kéo điện thoại không có cột Thanh toán).
 * Nhãn dùng cùng hàm với chi tiết đơn của khách nên hai bên không nói khác nhau ("Đang hoàn tiền" khi khoản chuyển khoản
 * còn Chờ/Đang chuyển). Không có tài khoản ngân hàng ở đây: nhân viên CSKH/kho cũng xem màn này.
 */
export function OrderPaymentSummary({ order: o, isAdmin }: { order: AdminOrder; isAdmin: boolean }) {
  const refunds = o.customerRefunds ?? [];
  const status = orderPaymentStatusLabel(o, refunds);
  const inProgress = isRefundInProgress(o, refunds);
  const bankOpen = refunds.some((r) => r.method === 'MANUAL_TRANSFER' && ['UNVERIFIED', 'PENDING', 'PROCESSING'].includes(r.status));
  return (
    <div data-order-payment className="space-y-1.5 rounded-control border border-stone-200 bg-stone-0 px-3 py-2 text-xs text-stone-700">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-semibold text-stone-800">Thanh toán:</span>
        <span>{PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod}</span>
        {status && (
          <span data-payment-status>
            <ToneBadge tone={inProgress ? 'warning' : 'neutral'}>{status}</ToneBadge>
          </span>
        )}
      </div>
      {refunds.map((r) => {
        const view = customerRefundView(r);
        const dest = destination(r);
        return (
          <div key={r.id} data-order-refund={view} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>
              Khoản hoàn ({refundKindLabel(r.kind)}): <b className="text-stone-900">{formatVnd(r.amount)}</b>
            </span>
            <ToneBadge tone={CUSTOMER_REFUND_VIEW_TONE[view]}>{CUSTOMER_REFUND_VIEW_LABEL[view]}</ToneBadge>
            {(dest || r.completedAt) && (
              <span className="text-stone-500">{[dest, r.completedAt ? formatDateTime(r.completedAt) : ''].filter(Boolean).join(' · ')}</span>
            )}
          </div>
        );
      })}
      {bankOpen && (
        <p className="text-stone-500">
          {isAdmin ? 'Xử lý khoản chuyển khoản ở mục Hoàn tiền khách.' : 'Quản trị viên chuyển khoản ở mục Hoàn tiền khách.'}
        </p>
      )}
    </div>
  );
}
