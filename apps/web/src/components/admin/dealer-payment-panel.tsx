'use client';

import { useRef, useState } from 'react';
import { Landmark } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  confirmDealerOrderPayment,
  DEALER_BANK_REF_MAX,
  DEALER_PAYMENT_NOTE_MAX,
  type AdminOrder,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';

/**
 * Hiện "Xác nhận đã nhận chuyển khoản" khi: đơn ĐẠI LÝ, còn UNPAID, BE xác nhận KHÔNG phải đơn "Ghi công
 * nợ" (`dealerOnCredit === false` — thiếu cờ thì không đoán) và đơn chưa huỷ/trả. Cùng điều kiện với
 * DealerService.confirmDealerOrderPayment — BE vẫn là chốt chặn cuối (lỗi hiện nguyên văn).
 */
export function canConfirmDealerPayment(
  order: Pick<AdminOrder, 'type' | 'paymentStatus' | 'dealerOnCredit' | 'status'>,
): boolean {
  return (
    order.type === 'DEALER' &&
    order.paymentStatus === 'UNPAID' &&
    order.dealerOnCredit === false &&
    order.status !== 'CANCELLED' &&
    order.status !== 'RETURNED'
  );
}

/**
 * Khối "Đơn đại lý trả trước — chờ chuyển khoản" trong chi tiết đơn admin. Khi Pancake chưa cấu hình /
 * đối soát trượt, admin đối chiếu sao kê rồi bấm xác nhận: POST /admin/dealer-orders/:id/confirm-payment
 * (UNPAID → PAID; PENDING_PAYMENT → CONFIRMED), kèm mã giao dịch + ghi chú lưu vào lịch sử đơn.
 */
export function DealerPaymentPanel({ order }: { order: AdminOrder }) {
  const qc = useQueryClient();
  const [bankRef, setBankRef] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Chặn bấm lặp trước khi React kịp render lại nút disabled (double-submit ghi 2 dòng lịch sử / 2 thông báo).
  const inFlight = useRef(false);

  const confirmMut = useMutation({
    mutationFn: () => confirmDealerOrderPayment(order.id, { bankRef, note }),
    onSuccess: (r) => {
      setMsg({ ok: true, text: r.message });
      setBankRef('');
      setNote('');
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: ['admin-dashboard-stats'] });
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Xác nhận thanh toán thất bại.' }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  if (!canConfirmDealerPayment(order)) {
    // Vừa xác nhận xong: list refetch làm đơn thành PAID → khối ẩn; giữ lại dòng kết quả để admin thấy.
    return msg?.ok ? (
      <p role="status" className="text-xs text-green-700">
        {msg.text}
      </p>
    ) : null;
  }

  const onConfirm = () => {
    if (inFlight.current || confirmMut.isPending) return;
    const ok = window.confirm(
      `Xác nhận đã nhận ${formatVnd(order.total)} chuyển khoản cho đơn đại lý ${order.code}?\n\n` +
        `Đơn sẽ được ghi nhận "Đã thanh toán"${order.status === 'PENDING_PAYMENT' ? ' và chuyển sang "Đã xác nhận"' : ''}, ` +
        'được tính vào doanh số đại lý. Không có thao tác huỷ xác nhận — chỉ bấm khi đã thấy tiền về tài khoản.',
    );
    if (!ok) return;
    inFlight.current = true;
    setMsg(null);
    confirmMut.mutate();
  };

  const busy = confirmMut.isPending;
  return (
    <section aria-label="Xác nhận thanh toán đơn đại lý" className="rounded border border-amber-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Landmark className="h-4 w-4 text-amber-700" aria-hidden />
        <span className="text-xs font-semibold uppercase text-neutral-600">Đơn đại lý trả trước — chờ chuyển khoản</span>
        <span className="text-xs font-semibold text-neutral-800">{formatVnd(order.total)}</span>
      </div>
      <p className="mt-1 text-xs text-neutral-600">
        Đối chiếu sao kê ngân hàng trước khi xác nhận. Mã giao dịch và ghi chú được lưu vào lịch sử đơn để đối soát.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label="Mã giao dịch ngân hàng"
          placeholder="Mã giao dịch ngân hàng (tuỳ chọn), vd FT26270…"
          maxLength={DEALER_BANK_REF_MAX}
          value={bankRef}
          onChange={(e) => setBankRef(e.target.value)}
          disabled={busy}
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
        />
        <input
          type="text"
          aria-label="Ghi chú xác nhận thanh toán"
          placeholder="Ghi chú (tuỳ chọn)"
          maxLength={DEALER_PAYMENT_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:bg-neutral-300"
        >
          {busy ? 'Đang xác nhận…' : 'Xác nhận đã nhận chuyển khoản'}
        </button>
      </div>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
