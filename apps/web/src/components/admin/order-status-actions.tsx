'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  confirmOrderPayment,
  updateOrderStatus,
  DEALER_BANK_REF_MAX,
  type AdminOrder,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';

export interface OrderStatusAction {
  status: string;
  label: string;
  className: string;
  /** true = hỏi window.confirm trước khi gửi (kích hoạt điểm/hoa hồng hoặc huỷ đơn). */
  confirm: boolean;
}

/**
 * Thứ tự hiển thị theo luồng giao. Không có RETURNED: trả hàng đi qua tab Đổi/Trả (duyệt yêu cầu, hoàn tiền) chứ
 * không bấm thẳng trạng thái ở đây.
 */
const ACTIONS: readonly OrderStatusAction[] = [
  { status: 'CONFIRMED', label: 'Xác nhận', className: 'rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50', confirm: false },
  { status: 'PACKED', label: 'Đã đóng gói', className: 'rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50', confirm: false },
  { status: 'SHIPPING', label: 'Giao vận', className: 'rounded bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50', confirm: false },
  { status: 'DELIVERED', label: 'Đã giao hàng', className: 'rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50', confirm: true },
  { status: 'CANCELLED', label: 'Hủy đơn', className: 'rounded border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50', confirm: true },
];

/**
 * Nút chuyển trạng thái = đúng `allowedTransitions` API trả (AdminService.listOrders — cùng luật
 * OrderStatusService.setStatus, gồm khoá giao đơn trả trước chưa PAID). API cũ không trả trường này thì không
 * hiện nút nào thay vì tự đoán (C-024).
 */
export function orderStatusActions(order: Pick<AdminOrder, 'allowedTransitions'>): OrderStatusAction[] {
  const allowed = new Set(order.allowedTransitions ?? []);
  return ACTIONS.filter((a) => allowed.has(a.status));
}

function confirmQuestion(order: AdminOrder, status: string): string {
  if (status === 'DELIVERED') return `Xác nhận hoàn tất giao đơn ${order.code}? Điểm xanh & hoa hồng CTV sẽ được kích hoạt.`;
  const gomdonNote =
    order.hasRecyclingPickup && order.gomdonOrderId
      ? ` Vận đơn thu gom Gomdon ${order.gomdonPartnerCode ?? ''} sẽ được huỷ tự động (nếu bưu tá chưa lấy hàng).`
      : '';
  return `Xác nhận hủy đơn ${order.code}?${gomdonNote}`;
}

/** Khối "Chuyển trạng thái" + "Đã nhận tiền" trong chi tiết đơn admin. */
export function OrderStatusActions({ order }: { order: AdminOrder }) {
  const qc = useQueryClient();
  const [bankRef, setBankRef] = useState('');
  const [payMsg, setPayMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Chặn bấm lặp trước khi React kịp render nút disabled.
  const payInFlight = useRef(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-orders'] });
    void qc.invalidateQueries({ queryKey: ['admin-dashboard-stats'] });
    void qc.invalidateQueries({ queryKey: ['admin-recycling-count'] });
  };

  const statusMut = useMutation({
    mutationFn: (status: string) => updateOrderStatus(order.id || order.code, status),
    onSuccess: refresh,
  });

  const payMut = useMutation({
    mutationFn: () => confirmOrderPayment(order.id || order.code, { bankRef }),
    onSuccess: (r) => {
      setPayMsg({ ok: true, text: r.message });
      setBankRef('');
      refresh();
    },
    onError: (e: unknown) => setPayMsg({ ok: false, text: e instanceof Error ? e.message : 'Xác nhận thanh toán thất bại.' }),
    onSettled: () => {
      payInFlight.current = false;
    },
  });

  const onConfirmPayment = () => {
    if (payInFlight.current || payMut.isPending) return;
    const ok = window.confirm(
      `Xác nhận đã nhận ${formatVnd(order.total)} chuyển khoản cho đơn ${order.code}?\n\n` +
        `Đơn sẽ được ghi nhận "Đã thanh toán"${order.status === 'PENDING_PAYMENT' ? ' và chuyển sang "Đã xác nhận"' : ''}. ` +
        'Không có thao tác huỷ xác nhận — chỉ bấm khi đã thấy tiền về tài khoản.',
    );
    if (!ok) return;
    payInFlight.current = true;
    setPayMsg(null);
    payMut.mutate();
  };

  const onStatus = (a: OrderStatusAction) => {
    if (a.confirm && !window.confirm(confirmQuestion(order, a.status))) return;
    statusMut.mutate(a.status);
  };

  const actions = orderStatusActions(order);
  const busy = statusMut.isPending || payMut.isPending;

  return (
    <div className="space-y-2 border-t border-neutral-200 pt-2">
      {order.canConfirmPayment && (
        <section aria-label="Xác nhận đã nhận tiền" className="rounded border border-amber-200 bg-white p-2.5">
          <p className="text-xs text-amber-800">
            Chuyển khoản chưa ghi nhận thanh toán — chưa giao được đơn. Đối chiếu sao kê rồi bấm &quot;Đã nhận tiền&quot;.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              aria-label="Mã giao dịch ngân hàng"
              placeholder="Mã giao dịch (tuỳ chọn), vd FT26270…"
              maxLength={DEALER_BANK_REF_MAX}
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              disabled={busy}
              className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={onConfirmPayment}
              disabled={busy}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:bg-neutral-300"
            >
              Đã nhận tiền
            </button>
          </div>
        </section>
      )}
      {payMsg && (
        <p role={payMsg.ok ? 'status' : 'alert'} className={`text-xs ${payMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
          {payMsg.text}
        </p>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-neutral-700">Chuyển trạng thái:</span>
          {actions.map((a) => (
            <button key={a.status} type="button" onClick={() => onStatus(a)} disabled={busy} className={a.className}>
              {a.label}
            </button>
          ))}
          {statusMut.isPending && <span className="text-xs text-neutral-500">Đang cập nhật…</span>}
          {statusMut.isError && (
            <span role="alert" className="text-xs text-red-600">
              {(statusMut.error as Error).message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
