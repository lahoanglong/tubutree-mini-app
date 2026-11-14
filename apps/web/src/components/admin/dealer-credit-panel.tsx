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
import {
  PAYMENT_DISCOUNT_ACCOUNT_LABEL,
  PAYMENT_DISCOUNT_LABEL,
  PAYMENT_DISCOUNT_LEDGER_REF,
  settlePayment,
  suggestPaymentDiscount,
} from '@tubutree/shared-types';
import { useConfirm } from './confirm-dialog';
import { actionErrorText } from '@/lib/admin-error-text';
import { settleWithin } from '@/lib/settle-within';
import { BTN_LINK, BTN_WARNING, FIELD_XS, LoadError, Field } from './ui';

const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `dp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

type SentSet = { key: string; amount: number; paymentDiscount?: number; bankRef: string; reportId: string | null; sentAt: number };
// Quá hạn này thì coi lần gửi trước đã xong hoặc hỏng hẳn: dùng lại khoá sẽ trả bản ghi cũ và nuốt khoản thật mới cùng số tiền.
const SENT_TTL_MS = 15 * 60 * 1000;
const sentStorageKey = (userId: string) => `dealer-credit-idem:${userId}`;
const readSent = (userId: string): SentSet | null => {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(sentStorageKey(userId)) ?? 'null');
    return v &&
      typeof v.key === 'string' &&
      typeof v.amount === 'number' &&
      (v.paymentDiscount === undefined || typeof v.paymentDiscount === 'number') &&
      typeof v.bankRef === 'string' &&
      (v.reportId === null || typeof v.reportId === 'string') &&
      typeof v.sentAt === 'number'
      ? v
      : null;
  } catch {
    return null;
  }
};
const writeSent = (userId: string, v: SentSet | null) => {
  try {
    if (v) window.sessionStorage.setItem(sentStorageKey(userId), JSON.stringify(v));
    else window.sessionStorage.removeItem(sentStorageKey(userId));
  } catch {
    // Trình duyệt chặn lưu trữ: chỉ mất khả năng giữ khoá qua lúc gập dòng.
  }
};

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
  defaultAmount,
  reportId,
  onPaid,
}: {
  order: Pick<AdminOrder, 'type' | 'user'>;
  /** Mở sẵn khi chính thao tác mở panel đã nằm ngoài (nút "Ghi nhận thanh toán" ở tab Đại lý). */
  defaultOpen?: boolean;
  /** Số tiền điền sẵn vào ô (số đại lý báo); kế toán vẫn sửa được nếu sao kê khác. */
  defaultAmount?: number;
  /** Ghi nhận cho một báo cáo chuyển khoản của đại lý: gửi kèm để báo cáo đóng cùng lúc ghi sổ. */
  reportId?: string;
  /** Gọi sau khi ghi nhận thành công, để nơi chứa panel (danh sách đại lý) tải lại số liệu và báo đúng số kế toán đã nhập. */
  onPaid?: (result: { amount: number; balance: number; reportClosed?: boolean; alreadyRecorded?: boolean; replayed?: boolean }) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '');
  const [discount, setDiscount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  // Khoá chống trừ nợ hai lần gắn với bộ {số tiền, mã GD, báo cáo} đã gửi: sau lỗi mạng/hết giờ (máy chủ có thể đã ghi rồi) gõ lại đúng bộ đó trong 15 phút tính từ lần gửi đầu vẫn dùng khoá cũ, kể cả sau khi gập dòng (sessionStorage). Quá 15 phút thì coi là một khoản mới, vì kế toán đã kịp thấy sổ tải lại.
  const sent = useRef<SentSet | null>(null);
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
      const disc = Math.trunc(Number(discount)) || 0;
      // Mã giao dịch được máy chủ kiểm trùng riêng, không dùng làm khoá.
      const ref = bankRef.trim();
      const stored = sent.current ?? readSent(userId as string);
      const rid = reportId ?? null;
      const reusable =
        !!stored && stored.amount === amt && (stored.paymentDiscount ?? 0) === disc && stored.bankRef === ref && stored.reportId === rid && Date.now() - stored.sentAt <= SENT_TTL_MS;
      const set: SentSet = reusable ? (stored as SentSet) : { key: newIdempotencyKey(), amount: amt, paymentDiscount: disc, bankRef: ref, reportId: rid, sentAt: Date.now() };
      sent.current = set;
      writeSent(userId as string, set);
      const key = set.key;
      return recordDealerCreditPayment(userId as string, { amount: amt, bankRef, note, ...(reportId ? { reportId } : {}), ...(disc > 0 ? { paymentDiscount: disc } : {}) }, key).then((r) => ({
        ...r,
        amount: amt,
      }));
    },
    onSuccess: (r) => {
      setMsg({
        ok: true,
        text: r.replayed
          ? `Khoản này đã được ghi ở lần bấm trước, sổ không đổi. Dư nợ hiện tại: ${formatVnd(r.balance)}. Nếu đây là một lần chuyển khác, nhập mã GD rồi ghi lại.`
          : r.alreadyRecorded
          ? `Báo cáo này đã được ghi nhận trước đó, lần này sổ công nợ không đổi. Dư nợ hiện tại: ${formatVnd(r.balance)}.`
          : r.reportClosed === false
            ? `Mã giao dịch này đã có trong sổ từ lần ghi trước nên không ghi thêm. Dư nợ hiện tại: ${formatVnd(r.balance)}.`
            : r.paymentDiscount
              ? `Đã ghi giảm công nợ: thực thu ${formatVnd(r.amount)} và ${PAYMENT_DISCOUNT_LABEL.toLowerCase()} ${formatVnd(r.paymentDiscount)} (${PAYMENT_DISCOUNT_ACCOUNT_LABEL}). Dư nợ còn lại: ${formatVnd(r.balance)}.`
              : `Đã ghi giảm công nợ. Dư nợ còn lại: ${formatVnd(r.balance)}.`,
      });
      sent.current = null;
      writeSent(userId as string, null);
      setAmount('');
      setDiscount('');
      setBankRef('');
      setNote('');
      const reload = qc.invalidateQueries({ queryKey: ['dealer-credit-ledger', userId] });
      onPaid?.({ amount: r.amount, balance: r.balance, reportClosed: r.reportClosed, alreadyRecorded: r.alreadyRecorded, replayed: r.replayed });
      // Giữ khoá (và inFlight) tới khi sổ tải lại xong, tối đa 4 giây: nhả sớm thì nút còn hiện với dư nợ cũ.
      return settleWithin(reload);
    },
    onError: (e: unknown) => {
      setMsg({ ok: false, text: actionErrorText(e) });
      // Lỗi mạng/hết giờ: máy chủ có thể đã ghi khoản này, tải lại sổ để kế toán thấy dư nợ thật trước khi bấm lại.
      // Khác các nơi khác (chỉ CHỜ tải lại khi 400/404/409): ở đây MỌI lỗi đều tải lại và chờ, vì 5xx/mất mạng chưa chứng minh khoản chưa được ghi
      // và khoá ['dealer-credit-ledger'] không mang tiền tố admin- nên MutationCache của production không làm cũ nó thay mình.
      return settleWithin(qc.invalidateQueries({ queryKey: ['dealer-credit-ledger', userId] }));
    },
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
    const disc = discount.trim() === '' ? 0 : Number(discount);
    if (!Number.isInteger(disc) || disc < 0) {
      setMsg({ ok: false, text: `${PAYMENT_DISCOUNT_LABEL} phải là số nguyên không âm (đồng).` });
      return;
    }
    if (disc > 0) {
      if (!note.trim()) {
        setMsg({ ok: false, text: `Ghi lý do ${PAYMENT_DISCOUNT_LABEL.toLowerCase()} (trả sớm hay đúng hạn theo hợp đồng) vào ô ghi chú.` });
        return;
      }
      const settled = settlePayment({ receivable: balance, cashCollected: amt, paymentDiscount: disc });
      if (!settled.ok) {
        setMsg({ ok: false, text: settled.reason });
        return;
      }
    }
    const ok = await confirm({
      title: 'Xác nhận đã nhận tiền trả nợ',
      message:
        (disc > 0
          ? `Xác nhận đã nhận ${formatVnd(amt)} và xoá thêm ${formatVnd(disc)} công nợ làm ${PAYMENT_DISCOUNT_LABEL.toLowerCase()} (ghi vào ${PAYMENT_DISCOUNT_ACCOUNT_LABEL})?\n\n` +
            `Hoá đơn của các đơn không đổi. Công nợ giảm ${formatVnd(amt + disc)}, còn lại ${formatVnd(balance - amt - disc)}.\n\n`
          : `Xác nhận đã nhận ${formatVnd(amt)} trả nợ từ đại lý này?\n\n`) +
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
  // Bảng đối chiếu: phải thu = thực thu + chiết khấu thanh toán (chi phí tài chính TK 635), cùng luật settlePayment với máy chủ.
  const cashNum = Math.trunc(Number(amount)) || 0;
  const discNum = discount.trim() === '' ? 0 : Number(discount);
  const settlement = cashNum > 0 && balance > 0 ? settlePayment({ receivable: balance, cashCollected: cashNum, paymentDiscount: discNum }) : null;
  const suggested = suggestPaymentDiscount(balance, cashNum);
  const clearRest = suggested > 0 && settlePayment({ receivable: balance, cashCollected: cashNum, paymentDiscount: suggested }).ok ? suggested : 0;

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
          {ledgerQ.isError && <LoadError onRetry={() => void ledgerQ.refetch()} retrying={ledgerQ.isFetching}>Không tải được sổ công nợ.</LoadError>}
          {ledgerQ.data && (
            <>
              <p className="text-xs font-semibold text-stone-800">
                Dư nợ hiện tại: <span className={balance > 0 ? 'text-danger-fg' : 'text-success-fg'}>{formatVnd(balance)}</span>
              </p>
              <ul className="max-h-32 overflow-y-auto rounded-control border border-stone-200 bg-stone-50 p-1.5 text-[11px] text-stone-600">
                {ledgerQ.data.entries.slice(0, 20).map((e) => (
                  <li key={e.id} className="flex justify-between gap-2 py-0.5">
                    <span className="truncate" data-ledger-ref={e.refType === PAYMENT_DISCOUNT_LEDGER_REF ? e.refType : undefined}>
                      {e.note || e.refType}
                    </span>
                    <span className={e.delta > 0 ? 'text-danger-fg' : 'text-success-fg'}>{formatVnd(e.delta)}</span>
                  </li>
                ))}
                {ledgerQ.data.entries.length === 0 && <li className="py-0.5 text-stone-500">Chưa có phát sinh.</li>}
              </ul>

              <div className="flex flex-wrap items-end gap-2">
                <Field label="Số tiền đã nhận (đ)" className="w-32">
                  <input
                    type="number"
                    min={1}
                    aria-label="Số tiền đã nhận (đ)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy}
                    className={`${FIELD_XS} w-full`}
                  />
                </Field>
                <Field label="CK thanh toán (đ, tuỳ chọn)" className="w-40">
                  <input
                    type="number"
                    min={0}
                    aria-label="CK thanh toán (đ, tuỳ chọn)"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    disabled={busy}
                    className={`${FIELD_XS} w-full`}
                  />
                </Field>
                <Field label="Mã giao dịch (tuỳ chọn)" className="grow basis-40">
                  <input
                    type="text"
                    maxLength={DEALER_BANK_REF_MAX}
                    value={bankRef}
                    onChange={(e) => setBankRef(e.target.value)}
                    disabled={busy}
                    className={`${FIELD_XS} w-full`}
                  />
                </Field>
                <Field label={discNum > 0 ? `Lý do ${PAYMENT_DISCOUNT_LABEL.toLowerCase()} (bắt buộc)` : 'Ghi chú (tuỳ chọn)'} className="grow basis-40">
                  <input
                    type="text"
                    maxLength={DEALER_PAYMENT_NOTE_MAX}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={busy}
                    className={`${FIELD_XS} w-full`}
                  />
                </Field>
                <button
                  type="button"
                  onClick={onConfirm}
                  aria-busy={busy || undefined}
                  aria-disabled={busy || undefined}
                  className={`${BTN_WARNING} aria-disabled:opacity-60`}
                >
                  {busy ? 'Đang xác nhận…' : 'Xác nhận đã nhận, giảm nợ'}
                </button>
              </div>
              {settlement && (
                <div data-payment-settlement className="space-y-1 rounded-control border border-stone-200 bg-stone-50 p-2 text-[11px] text-stone-700">
                  {settlement.ok ? (
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
                      <dt>Phải thu hoá đơn</dt>
                      <dd className="text-right font-semibold text-stone-900">{formatVnd(settlement.settlement.receivable)}</dd>
                      <dt>Thực thu tiền</dt>
                      <dd className="text-right">{formatVnd(settlement.settlement.cashCollected)}</dd>
                      <dt>CK thanh toán ({PAYMENT_DISCOUNT_ACCOUNT_LABEL})</dt>
                      <dd className="text-right">{formatVnd(settlement.settlement.financialExpense)}</dd>
                      <dt className="font-semibold">Công nợ còn lại</dt>
                      <dd className="text-right font-semibold text-stone-900">{formatVnd(settlement.settlement.remaining)}</dd>
                    </dl>
                  ) : (
                    <p className="text-danger-fg">{settlement.reason}</p>
                  )}
                  {clearRest > 0 && discNum !== clearRest && (
                    <button type="button" disabled={busy} onClick={() => setDiscount(String(clearRest))} className={`${BTN_LINK} text-[11px]`}>
                      Xoá nợ phần còn lại {formatVnd(clearRest)} bằng CK thanh toán
                    </button>
                  )}
                  <p className="text-stone-500">Hoá đơn bán hàng vẫn đủ 100%; CK thanh toán chỉ xoá công nợ lúc thu tiền.</p>
                </div>
              )}
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
