'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrderStatusHistory, invalidateInbox, PAYMENT_UNLINKED_NOTE_MIN, PANCAKE_RESOLVE_NOTE_MAX, resolvePaymentUnlinked, type AdminOrder } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { BTN_XS_SECONDARY } from './ui';
import { useConfirm } from './confirm-dialog';
import { actionErrorText } from '@/lib/admin-error-text';
import { settleWithin } from '@/lib/settle-within';
import { useLockedMutation } from '@/components/game/use-locked-mutation';

/** Đơn còn mở thì Kế toán đóng bằng "Đã nhận tiền"; đơn đã huỷ/trả thì chỉ ADMIN đóng sau khi ghi tiền về muộn hoặc hoàn. */
export const PAYMENT_UNLINKED_OPEN_TEXT =
  'Pancake báo đã thanh toán nhưng đơn chưa gắn đúng đơn Pancake. Đối chiếu sao kê: khách đã chuyển thì bấm "Đã nhận tiền".';
export const PAYMENT_UNLINKED_CLOSED_TEXT =
  'Pancake báo đã thanh toán cho đơn đã huỷ/trả. Quản trị viên đối chiếu sao kê: khách đã chuyển thì ghi tiền về muộn; việc này không tự đóng, nên bấm "Đã đối chiếu" kèm ghi chú.';

/** Lời cho người không có nút trong tay (KHO/CSKH): chỉ nói việc đang chờ ai. */
export const PAYMENT_UNLINKED_OPEN_NEUTRAL_TEXT = 'Pancake báo đã thanh toán nhưng đơn chưa gắn đúng đơn Pancake. Kế toán đang đối chiếu sao kê.';
export const PAYMENT_UNLINKED_CLOSED_NEUTRAL_TEXT = 'Pancake báo đã thanh toán cho đơn đã huỷ/trả. Quản trị viên đang đối chiếu sao kê.';

/** Trùng UNLINKED_HISTORY_PREFIX của PancakeProcessor: dòng lịch sử PANCAKE ghi mỗi khoản chưa gắn. */
const UNLINKED_HISTORY_PREFIX = 'Pancake báo đã thanh toán (đơn Pancake #';

const isClosed = (status: string) => status === 'CANCELLED' || status === 'RETURNED';

export function PaymentUnlinkedBadge({ order }: { order: AdminOrder }) {
  if (!order.paymentUnlinkedAt || order.paymentStatus !== 'UNPAID') return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-fg">
      <AlertTriangle className="h-3 w-3" aria-hidden />
      Chờ đối chiếu sao kê
    </span>
  );
}

/**
 * Lời nhắc ở chi tiết đơn khi Pancake báo đã thanh toán mà đơn chưa gắn đúng đơn Pancake (cờ paymentUnlinkedAt, đơn còn UNPAID).
 * Nút "Đã đối chiếu" chỉ ADMIN thấy: API cũng chỉ mở cho ADMIN. Đơn còn mở tự rời hàng đợi khi Kế toán bấm "Đã nhận tiền".
 */
export function PaymentUnlinkedPanel({ order, isAdmin, canFinance = false }: { order: AdminOrder; isAdmin: boolean; canFinance?: boolean }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { ask, dialog } = useConfirm();

  const flagged = !!order.paymentUnlinkedAt && order.paymentStatus === 'UNPAID';
  // Cờ gộp nhiều khoản Pancake chưa gắn: liệt kê từng khoản để người đóng thấy đủ.
  const historyQ = useQuery({
    queryKey: ['admin-order-history', order.id],
    queryFn: () => getOrderStatusHistory(order.id || order.code),
    enabled: flagged,
  });
  // Chỉ các khoản của đợt cờ hiện tại: từ mốc đầu (khoản cũ đã "Đã đối chiếu" hoặc đã PAID không hiện lại).
  const sinceMs = order.paymentUnlinkedFirstAt ? new Date(order.paymentUnlinkedFirstAt).getTime() : 0;
  const payments = (historyQ.data?.history ?? []).filter(
    (h) => h.actorType === 'PANCAKE' && (h.note ?? '').startsWith(UNLINKED_HISTORY_PREFIX) && new Date(h.createdAt).getTime() >= sinceMs,
  );

  const reloadOrder = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-order-history', order.id] }), qc.invalidateQueries({ queryKey: ['admin-orders'] })]);
  // Khoá giữ tới khi đơn và danh sách khoản làm mới về (tối đa 4 giây): nhả sớm thì nút còn hiện với cờ cũ và bấm lại được.
  const resolve = useLockedMutation({
    mutationFn: ({ note, seenAt }: { note: string; seenAt: string }) => resolvePaymentUnlinked(order.id, note, seenAt),
    onSuccess: (r) => {
      setMsg({ ok: true, text: r.message });
      return settleWithin(Promise.all([reloadOrder(), invalidateInbox(qc)]));
    },
    onError: (e: unknown) => {
      setMsg({ ok: false, text: actionErrorText(e) });
      // 409 (khoản mới tới) hay 400 (bên kia đã đóng): lấy lại mốc cờ và danh sách khoản mới nhất. Lỗi nào cũng tải lại như trước
      // (đã ghi rồi mới lỗi mạng/5xx thì cờ đã gỡ), khác quy tắc chung chỉ 400/404/409.
      return settleWithin(reloadOrder());
    },
  });

  const message = msg && (
    <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
      {msg.text}
    </p>
  );
  if (!order.paymentUnlinkedAt || order.paymentStatus !== 'UNPAID') return message || null;

  const onResolve = async () => {
    if (resolve.isPending) return;
    const note = await ask({
      title: 'Đánh dấu đã đối chiếu',
      message: `Đơn ${order.code} sẽ rời hàng đợi "Pancake báo đã thanh toán". Chỉ bấm khi đã đối chiếu sao kê và đã ghi tiền về muộn hoặc hoàn cho khách (nếu khách đã chuyển). Việc này không tự ghi tiền.`,
      confirmLabel: 'Đã đối chiếu',
      input: {
        label: 'Ghi chú đối chiếu (bắt buộc)',
        placeholder: 'vd: đã ghi tiền về muộn theo sao kê 04/11',
        maxLength: PANCAKE_RESOLVE_NOTE_MAX,
        required: true,
        validate: (t) => (t.trim().length < PAYMENT_UNLINKED_NOTE_MIN ? `Ghi chú cần ít nhất ${PAYMENT_UNLINKED_NOTE_MIN} ký tự` : null),
      },
    });
    if (note === null) return;
    setMsg(null);
    resolve.mutate({ note, seenAt: order.paymentUnlinkedAt! });
  };

  const closed = isClosed(order.status);
  const reminder = closed
    ? isAdmin
      ? PAYMENT_UNLINKED_CLOSED_TEXT
      : PAYMENT_UNLINKED_CLOSED_NEUTRAL_TEXT
    : isAdmin || canFinance
      ? PAYMENT_UNLINKED_OPEN_TEXT
      : PAYMENT_UNLINKED_OPEN_NEUTRAL_TEXT;

  return (
    <section aria-label="Pancake báo đã thanh toán, chờ đối chiếu" className="rounded-card border border-warning-fg bg-warning-bg p-3 text-xs text-warning-fg">
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <span>Chờ đối chiếu sao kê</span>
        <span className="font-normal text-stone-600">{formatDateTime(order.paymentUnlinkedAt)}</span>
      </div>
      <p className="mt-1 text-stone-800">{reminder}</p>
      {payments.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-stone-700">
          {payments.map((h) => (
            <li key={h.id}>
              <span className="text-stone-600">{formatDateTime(h.createdAt)}</span> — {h.note}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onResolve}
            aria-busy={resolve.isPending || undefined}
            aria-disabled={resolve.isPending || undefined}
            className={`${BTN_XS_SECONDARY} aria-disabled:opacity-60`}
          >
            {resolve.isPending ? 'Đang lưu…' : 'Đã đối chiếu'}
          </button>
        </div>
      )}
      {message}
      {dialog}
    </section>
  );
}
