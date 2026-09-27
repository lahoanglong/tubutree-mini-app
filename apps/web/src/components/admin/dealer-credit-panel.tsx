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

/**
 * A5-09 (docs/audit-2026-09/05-ctv-dealer-staff.md): trước đây đại lý tự bấm "Báo đã CK" là TRỪ NỢ
 * NGAY LẬP TỨC, không admin nào kiểm tra sao kê thật, không chặn số tiền vượt dư nợ — đại lý có thể
 * tự xoá nợ vô hạn lần. Giờ "Báo đã CK" chỉ còn là THÔNG BÁO cho admin (xem
 * DealerService.reportCreditPayment); sổ công nợ CHỈ giảm qua khối này, sau khi admin tự đối chiếu
 * sao kê ngân hàng. Hiện trong chi tiết MỌI đơn ĐẠI LÝ (không riêng đơn "ghi công nợ") vì công nợ là
 * một sổ cái CHUNG của cả đại lý, không gắn với một đơn cụ thể — đây chỉ là chỗ admin tiện xem/xử lý
 * ngay khi đang mở đơn của đại lý đó, không phải "công nợ của đơn này".
 */
export function DealerCreditPanel({ order }: { order: AdminOrder }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);

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
      setMsg({ ok: true, text: `Đã ghi giảm công nợ. Dư nợ còn lại: ${formatVnd(-r.balance)}.` });
      setAmount('');
      setBankRef('');
      setNote('');
      void qc.invalidateQueries({ queryKey: ['dealer-credit-ledger', userId] });
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Xác nhận thất bại.' }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  if (order.type !== 'DEALER' || !userId) return null;

  const onConfirm = () => {
    if (inFlight.current || payMut.isPending) return;
    const amt = Math.trunc(Number(amount));
    if (!amt || amt <= 0) {
      setMsg({ ok: false, text: 'Nhập số tiền hợp lệ (đơn vị đồng, số nguyên dương).' });
      return;
    }
    const ok = window.confirm(
      `Xác nhận đã nhận ${formatVnd(amt)} trả nợ từ đại lý này?\n\n` +
        'Số tiền sẽ bị chặn không vượt quá dư nợ hiện tại tại thời điểm xác nhận. Không có thao tác huỷ — chỉ bấm khi đã thấy tiền về tài khoản.',
    );
    if (!ok) return;
    inFlight.current = true;
    setMsg(null);
    payMut.mutate();
  };

  const balance = ledgerQ.data?.balance ?? 0; // âm = đang nợ
  const busy = payMut.isPending;

  return (
    <section aria-label="Công nợ đại lý" className="rounded border border-neutral-200 bg-white p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-neutral-500" aria-hidden />
          <span className="text-xs font-semibold uppercase text-neutral-600">Công nợ đại lý</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {ledgerQ.isLoading && <p className="text-xs text-neutral-500">Đang tải sổ công nợ…</p>}
          {ledgerQ.isError && <p role="alert" className="text-xs text-red-600">Không tải được sổ công nợ.</p>}
          {ledgerQ.data && (
            <>
              <p className="text-xs font-semibold text-neutral-800">
                Dư nợ hiện tại: <span className={balance < 0 ? 'text-red-600' : 'text-green-700'}>{formatVnd(-balance)}</span>
              </p>
              <ul className="max-h-32 overflow-y-auto rounded border border-neutral-100 bg-neutral-50 p-1.5 text-[11px] text-neutral-600">
                {ledgerQ.data.entries.slice(0, 20).map((e) => (
                  <li key={e.id} className="flex justify-between gap-2 py-0.5">
                    <span className="truncate">{e.note || e.refType}</span>
                    <span className={e.delta < 0 ? 'text-red-600' : 'text-green-700'}>{formatVnd(e.delta)}</span>
                  </li>
                ))}
                {ledgerQ.data.entries.length === 0 && <li className="py-0.5 text-neutral-400">Chưa có phát sinh.</li>}
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
                  className="w-32 rounded border border-neutral-300 px-2 py-1 text-xs"
                />
                <input
                  type="text"
                  aria-label="Mã giao dịch ngân hàng"
                  placeholder="Mã giao dịch (tuỳ chọn)"
                  maxLength={DEALER_BANK_REF_MAX}
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                />
                <input
                  type="text"
                  aria-label="Ghi chú"
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
                  {busy ? 'Đang xác nhận…' : 'Xác nhận đã nhận, giảm nợ'}
                </button>
              </div>
            </>
          )}
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>
              {msg.text}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
