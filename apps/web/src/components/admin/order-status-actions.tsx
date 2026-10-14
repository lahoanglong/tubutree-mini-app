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
import { useConfirm, type ConfirmOptions } from './confirm-dialog';
import { BTN_WARNING, FIELD_XS, TOUCH_H } from './ui';

export interface OrderStatusAction {
  status: string;
  label: string;
  className: string;
  /** true = hỏi hộp thoại xác nhận trước khi gửi (kích hoạt điểm/hoa hồng hoặc huỷ đơn). */
  confirm: boolean;
}

// Nút nằm trong chi tiết đơn mở rộng: chạm 44px trên điện thoại, về cỡ gọn từ `sm` (admin tối ưu máy tính, Q-29).
const ACTION_BASE = `${TOUCH_H} rounded-control px-2.5 py-1 text-xs font-medium disabled:opacity-50`;

/**
 * Thứ tự hiển thị theo luồng giao. Không có RETURNED: trả hàng đi qua tab Đổi/Trả (duyệt yêu cầu, hoàn tiền) chứ
 * không bấm thẳng trạng thái ở đây.
 */
const ACTIONS: readonly OrderStatusAction[] = [
  { status: 'CONFIRMED', label: 'Xác nhận', className: `${ACTION_BASE} bg-info-fg text-stone-0 hover:brightness-90`, confirm: false },
  { status: 'PACKED', label: 'Đã đóng gói', className: `${ACTION_BASE} bg-sage-700 text-stone-0 hover:brightness-90`, confirm: false },
  { status: 'SHIPPING', label: 'Giao vận', className: `${ACTION_BASE} bg-forest-800 text-stone-0 hover:brightness-90`, confirm: false },
  { status: 'DELIVERED', label: 'Đã giao hàng', className: `${ACTION_BASE} bg-forest-600 text-stone-0 hover:bg-forest-700`, confirm: true },
  { status: 'CANCELLED', label: 'Hủy đơn', className: `${ACTION_BASE} border border-danger-fg text-danger-fg hover:bg-danger-bg`, confirm: true },
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

const PREPAID_METHODS = new Set(['WALLET', 'ZALOPAY', 'BANK_TRANSFER', 'VNPAY', 'XU']);

/** Hệ quả tiền/điểm của lần huỷ do admin bấm — admin/hệ thống huỷ luôn hoàn vào Ví Tubu (D2). */
function cancelConsequences(order: AdminOrder): string[] {
  const lines =
    order.paymentStatus === 'PAID' && PREPAID_METHODS.has(order.paymentMethod)
      ? [`Hoàn ${formatVnd(order.total)} vào Ví Tubu của khách ngay khi huỷ.`]
      : ['Khách chưa trả tiền — không có khoản hoàn tiền.'];
  if ((order.pointsUsed ?? 0) > 0) lines.push(`Trả lại ${order.pointsUsed} Điểm Xanh khách đã dùng.`);
  if (order.pancakeOrderId) lines.push('Hệ thống sẽ huỷ cả đơn trên kho Pancake.');
  return lines;
}

function confirmQuestion(order: AdminOrder, status: string): ConfirmOptions {
  if (status === 'DELIVERED') {
    return {
      title: 'Xác nhận đã giao hàng',
      message: `Xác nhận hoàn tất giao đơn ${order.code}? Điểm Xanh & hoa hồng CTV sẽ được kích hoạt.`,
      confirmLabel: 'Đã giao hàng',
    };
  }
  const gomdonNote =
    order.hasRecyclingPickup && order.gomdonOrderId
      ? ` Vận đơn thu gom Gomdon ${order.gomdonPartnerCode ?? ''} sẽ được huỷ tự động (nếu bưu tá chưa lấy hàng).`
      : '';
  return {
    title: 'Huỷ đơn hàng',
    message: [`Xác nhận huỷ đơn ${order.code}?`, ...cancelConsequences(order)].join('\n') + gomdonNote,
    confirmLabel: 'Huỷ đơn',
    cancelLabel: 'Giữ đơn',
    tone: 'danger',
  };
}

/**
 * Khối "Chuyển trạng thái" + "Đã nhận tiền" trong chi tiết đơn admin. `canConfirmPayment=false` cho nhân viên:
 * POST confirm-payment chỉ mở cho ADMIN, nút sẽ chỉ ra lỗi 403.
 */
export function OrderStatusActions({ order, canConfirmPayment = true }: { order: AdminOrder; canConfirmPayment?: boolean }) {
  const qc = useQueryClient();
  const [bankRef, setBankRef] = useState('');
  const [payMsg, setPayMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Chặn bấm lặp trước khi React kịp render nút disabled.
  const payInFlight = useRef(false);
  const { confirm, dialog } = useConfirm();

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

  const onConfirmPayment = async () => {
    if (payInFlight.current || payMut.isPending) return;
    const ok = await confirm({
      title: 'Xác nhận đã nhận tiền',
      message:
        `Xác nhận đã nhận ${formatVnd(order.total)} chuyển khoản cho đơn ${order.code}?\n\n` +
        `Đơn sẽ được ghi nhận "Đã thanh toán"${order.status === 'PENDING_PAYMENT' ? ' và chuyển sang "Đã xác nhận"' : ''}. ` +
        'Không có thao tác huỷ xác nhận — chỉ bấm khi đã thấy tiền về tài khoản.',
      confirmLabel: 'Đã nhận tiền',
    });
    if (!ok || payInFlight.current || payMut.isPending) return;
    payInFlight.current = true;
    setPayMsg(null);
    payMut.mutate();
  };

  const onStatus = async (a: OrderStatusAction) => {
    if (a.confirm && !(await confirm(confirmQuestion(order, a.status)))) return;
    statusMut.mutate(a.status);
  };

  const actions = orderStatusActions(order);
  const busy = statusMut.isPending || payMut.isPending;

  return (
    <div className="space-y-2 border-t border-stone-200 pt-2">
      {canConfirmPayment && order.canConfirmPayment && (
        <section aria-label="Xác nhận đã nhận tiền" className="rounded-card border border-warning-fg bg-stone-0 p-2.5">
          <p className="text-xs text-warning-fg">
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
              className={`${FIELD_XS} grow basis-40`}
            />
            <button
              type="button"
              onClick={onConfirmPayment}
              disabled={busy}
              className={BTN_WARNING}
            >
              Đã nhận tiền
            </button>
          </div>
        </section>
      )}
      {payMsg && (
        <p role={payMsg.ok ? 'status' : 'alert'} className={`text-xs ${payMsg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {payMsg.text}
        </p>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-stone-700">Chuyển trạng thái:</span>
          {actions.map((a) => (
            <button key={a.status} type="button" onClick={() => onStatus(a)} disabled={busy} className={a.className}>
              {a.label}
            </button>
          ))}
          {statusMut.isPending && <span className="text-xs text-stone-500">Đang cập nhật…</span>}
          {statusMut.isError && (
            <span role="alert" className="text-xs text-danger-fg">
              {(statusMut.error as Error).message}
            </span>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
