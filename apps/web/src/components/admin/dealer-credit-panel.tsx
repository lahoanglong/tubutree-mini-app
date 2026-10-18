'use client';

import { useRef, useState } from 'react';
import { Landmark, ChevronDown, ChevronUp } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDealerCreditLedger,
  recordDealerCreditPayment,
  DEALER_BANK_REF_MAX,
  DEALER_PAYMENT_NOTE_MAX,
  type AdminOrder,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { useConfirm } from './confirm-dialog';
import { BTN_WARNING, FIELD_XS } from './ui';

/**
 * A5-09 (docs/audit-2026-09/05-ctv-dealer-staff.md): trước đây đại lý tự bấm "Báo đã CK" là TRỪ NỢ
 * NGAY LẬP TỨC, không admin nào kiểm tra sao kê thật, không chặn số tiền vượt dư nợ — đại lý có thể
 * tự xoá nợ vô hạn lần. Giờ "Báo đã CK" chỉ còn là THÔNG BÁO cho admin (xem
 * DealerService.reportCreditPayment); sổ công nợ CHỈ giảm qua khối này, sau khi admin tự đối chiếu
 * sao kê ngân hàng. Hiện trong chi tiết MỌI đơn ĐẠI LÝ (không riêng đơn "ghi công nợ") vì công nợ là
 * một sổ cái CHUNG của cả đại lý, không gắn với một đơn cụ thể — đây chỉ là chỗ admin tiện xem/xử lý
 * ngay khi đang mở đơn của đại lý đó, không phải "công nợ của đơn này".
 */
export function DealerCreditPanel({
  order,
  defaultOpen = false,
  onPaid,
}: {
  order: Pick<AdminOrder, 'type' | 'user'>;
  /** Mở sẵn khi chính thao tác mở panel đã nằm ngoài (nút "Ghi nhận thanh toán" ở tab Đại lý). */
  defaultOpen?: boolean;
  /** Gọi sau khi ghi giảm nợ thành công, để nơi chứa panel (danh sách đại lý) tải lại số liệu của nó. */
  onPaid?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [amount, setAmount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  const { confirm, dialog } = useConfirm();

  const userId = order.user?.id;
  const enabled = open && order.type === 'DEALER' && !!userId;

  const ledgerQ = useQuery({
    queryKey: ['dealer-credit-ledger', userId],
    queryFn: () => getDealerCreditLedger(userId as string),
    enabled,
  });

  const payMut = useMutation({
    mutationFn: () => {
      const amt = Math.trunc(Number(amount));
      const key = bankRef.trim() || undefined; // mã giao dịch làm idempotency-key nếu có
      return recordDealerCreditPayment(userId as string, { amount: amt, bankRef, note }, key);
    },
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Đã ghi giảm công nợ. Dư nợ còn lại: ${formatVnd(r.balance)}.` });
      setAmount('');
      setBankRef('');
      setNote('');
      void qc.invalidateQueries({ queryKey: ['dealer-credit-ledger', userId] });
      onPaid?.();
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Xác nhận thất bại.' }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  if (order.type !== 'DEALER' || !userId) return null;

  const onConfirm = async () => {
    if (inFlight.current || payMut.isPending) return;
    const amt = Math.trunc(Number(amount));
    if (!amt || amt <= 0) {
      setMsg({ ok: false, text: 'Nhập số tiền hợp lệ (đơn vị đồng, số nguyên dương).' });
      return;
    }
    const ok = await confirm({
      title: 'Xác nhận đã nhận tiền trả nợ',
      message:
        `Xác nhận đã nhận ${formatVnd(amt)} trả nợ từ đại lý này?\n\n` +
        'Số tiền sẽ bị chặn không vượt quá dư nợ hiện tại tại thời điểm xác nhận. Không có thao tác huỷ — chỉ bấm khi đã thấy tiền về tài khoản.',
      confirmLabel: 'Đã nhận tiền',
    });
    if (!ok || inFlight.current || payMut.isPending) return;
    inFlight.current = true;
    setMsg(null);
    payMut.mutate();
  };

  // Quy ước của sổ (DealerService): tổng delta dương = đang nợ; đơn ghi công nợ cộng, khoản đã trả trừ.
  const balance = ledgerQ.data?.balance ?? 0;
  const busy = payMut.isPending;

  return (
    <section aria-label="Công nợ đại lý" className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-control text-left sm:min-h-0"
      >
        <span className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-stone-500" aria-hidden />
          <span className="text-xs font-semibold uppercase text-stone-600">Công nợ đại lý</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-stone-500" aria-hidden /> : <ChevronDown className="h-4 w-4 text-stone-500" aria-hidden />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {ledgerQ.isLoading && <p className="text-xs text-stone-500">Đang tải sổ công nợ…</p>}
          {ledgerQ.isError && <p role="alert" className="text-xs text-danger-fg">Không tải được sổ công nợ.</p>}
          {ledgerQ.data && (
            <>
              <p className="text-xs font-semibold text-stone-800">
                Dư nợ hiện tại: <span className={balance > 0 ? 'text-danger-fg' : 'text-success-fg'}>{formatVnd(balance)}</span>
              </p>
              <ul className="max-h-32 overflow-y-auto rounded-control border border-stone-200 bg-stone-50 p-1.5 text-[11px] text-stone-600">
                {ledgerQ.data.entries.slice(0, 20).map((e) => (
                  <li key={e.id} className="flex justify-between gap-2 py-0.5">
                    <span className="truncate">{e.note || e.refType}</span>
                    <span className={e.delta > 0 ? 'text-danger-fg' : 'text-success-fg'}>{formatVnd(e.delta)}</span>
                  </li>
                ))}
                {ledgerQ.data.entries.length === 0 && <li className="py-0.5 text-stone-500">Chưa có phát sinh.</li>}
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  aria-label="Số tiền đã nhận (đ)"
                  placeholder="Số tiền đã nhận (đ)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  className={`${FIELD_XS} w-32`}
                />
                <input
                  type="text"
                  aria-label="Mã giao dịch ngân hàng"
                  placeholder="Mã giao dịch (tuỳ chọn)"
                  maxLength={DEALER_BANK_REF_MAX}
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                  disabled={busy}
                  className={`${FIELD_XS} grow basis-40`}
                />
                <input
                  type="text"
                  aria-label="Ghi chú"
                  placeholder="Ghi chú (tuỳ chọn)"
                  maxLength={DEALER_PAYMENT_NOTE_MAX}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                  className={`${FIELD_XS} grow basis-40`}
                />
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy}
                  className={BTN_WARNING}
                >
                  {busy ? 'Đang xác nhận…' : 'Xác nhận đã nhận, giảm nợ'}
                </button>
              </div>
            </>
          )}
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
              {msg.text}
            </p>
          )}
        </div>
      )}
      {dialog}
    </section>
  );
}
