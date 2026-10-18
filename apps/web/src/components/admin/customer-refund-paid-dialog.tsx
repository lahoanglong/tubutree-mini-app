'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { safeAreaPadX } from '@/lib/safe-area';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { claimCustomerRefund, markCustomerRefundPaid, type AdminCustomerRefund } from '@/lib/admin-client';
import {
  CUSTOMER_REFUNDS_QUERY_KEY,
  TAKE_OVER_REASON_MIN,
  markPaidFailure,
  needsBankAccount,
  type RefundAction,
} from '@/lib/customer-refunds-admin';
import { formatVnd } from '@/lib/shop-client';
import { formatDateTime } from '@/lib/format-date';
import { EMPTY_BANK, bankDetailsError, type RefundBankInput } from '@/lib/refund-rules';
import { INPUT_CLASS, Notice } from './ui';

export type MarkPaidOutcome = { kind: 'paid' } | { kind: 'claimed' } | { kind: 'stale'; message: string };

/**
 * Hộp xác nhận "Đã chuyển khoản" (mode paid) hoặc "Bắt đầu chuyển khoản" (mode claim: khoá nơi nhận trước khi chuyển
 * tiền để khách không rút về Ví giữa chừng) cho một khoản hoàn tiền khách. Không dùng useConfirm: hộp đó đóng ngay khi người
 * dùng bấm xác nhận và chỉ có một ô nhập, còn ở đây phải giữ hộp mở (kèm thông báo) khi lỗi mạng/5xx để admin thử
 * lại mà không nhập lại, và tự sở hữu lời gọi ghi để khoá nút đúng lúc đang gửi. Chỉ ghi sổ, không chuyển tiền.
 */
export function CustomerRefundPaidDialog({
  refund,
  mode = 'paid',
  takeOverFrom = null,
  canEnterBank = true,
  onClose,
  onDone,
}: {
  refund: AdminCustomerRefund;
  mode?: RefundAction;
  /** Khoản đang do admin khác chuyển khoản: hộp bắt ghi lý do tiếp quản (R3-MONEY-4). */
  takeOverFrom?: { holder: string; since: string | null } | null;
  /** Chỉ quản trị viên nhập tài khoản nhận; nhân viên chỉ chuyển tới tài khoản đã có. */
  canEnterBank?: boolean;
  onClose: () => void;
  onDone: (outcome: MarkPaidOutcome) => void;
}) {
  const claiming = mode === 'claim';
  const qc = useQueryClient();
  const titleId = useId();
  const bodyId = useId();
  const bankRefId = useId();
  const noteId = useId();
  const takeOverId = useId();
  const bankRefRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const takeOverRef = useRef<HTMLTextAreaElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [bankRef, setBankRef] = useState('');
  const [note, setNote] = useState('');
  const [takeOverReason, setTakeOverReason] = useState('');
  const [takeOverMissing, setTakeOverMissing] = useState(false);
  const [bank, setBank] = useState<RefundBankInput>(EMPTY_BANK);
  const [error, setError] = useState<string | null>(null);
  const [refMissing, setRefMissing] = useState(false);
  const bankEntryRef = useRef<HTMLDivElement>(null);
  const toBank = needsBankAccount(refund);
  // Khoản của khách có tài khoản nhưng khách chưa chọn nơi nhận: admin nhập tài khoản khách gửi qua hỗ trợ.
  const staffBlocked = !canEnterBank && !refund.bankAccountNo;
  const needsEntry = toBank && !refund.bankAccountNo && canEnterBank;
  // Cờ đồng bộ chặn lần bấm thứ hai trước khi React kịp vẽ lại nút đã khoá.
  const inFlight = useRef(false);

  const mut = useMutation({
    mutationFn: () =>
      claiming
        ? claimCustomerRefund(refund.id, needsEntry ? bank : {})
        : markCustomerRefundPaid(
            refund.id,
            { bankRef, note, ...(needsEntry ? bank : {}) },
            takeOverFrom ? { takeOverReason } : undefined,
          ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      onDone({ kind: claiming ? 'claimed' : 'paid' });
    },
    onError: (e) => {
      const failure = markPaidFailure(e, mode);
      if (failure.stale) {
        void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
        onDone({ kind: 'stale', message: failure.message });
      } else {
        setError(failure.message);
      }
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const busy = mut.isPending;

  const submit = () => {
    if (inFlight.current || busy || staffBlocked) return;
    if (!claiming && !bankRef.trim()) {
      setRefMissing(true);
      setError('Nhập mã giao dịch ngân hàng của lần chuyển khoản.');
      bankRefRef.current?.focus();
      return;
    }
    setRefMissing(false);
    if (takeOverFrom && takeOverReason.trim().length < TAKE_OVER_REASON_MIN) {
      setTakeOverMissing(true);
      setError(`Ghi lý do tiếp quản (ít nhất ${TAKE_OVER_REASON_MIN} ký tự) — được lưu vào lịch sử đơn.`);
      takeOverRef.current?.focus();
      return;
    }
    setTakeOverMissing(false);
    const bankError = needsEntry ? bankDetailsError(bank) : null;
    if (bankError) {
      setError(bankError);
      return;
    }
    inFlight.current = true;
    setError(null);
    mut.mutate();
  };

  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Đang gửi thì cả bốn phần tử bị khoá và nút vừa bấm mất tiêu điểm: giữ tiêu điểm ở chính hộp (không để rơi ra thanh
  // tab phía sau trang), rồi trả về nút xác nhận khi gửi lỗi và hộp được mở khoá lại.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) dialogRef.current?.focus();
    else if (wasBusy.current) acceptRef.current?.focus();
    wasBusy.current = busy;
  }, [busy]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (bankRefRef.current ?? bankEntryRef.current?.querySelector('input') ?? acceptRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busyRef.current) onCloseRef.current();
      } else if (e.key === 'Tab') {
        const bankInputs = Array.from(bankEntryRef.current?.querySelectorAll('input') ?? []);
        const order = [...bankInputs, bankRefRef.current, noteRef.current, takeOverRef.current, cancelRef.current, acceptRef.current].filter(
          (el): el is HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement => !!el && !el.disabled,
        );
        if (order.length === 0) {
          e.preventDefault();
          dialogRef.current?.focus();
          return;
        }
        const at = order.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : at === order.length - 1 ? 0 : at + 1;
        e.preventDefault();
        order[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      data-confirm-backdrop
      onClick={() => {
        if (!busy) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-900/40 p-4 sm:items-center"
      style={safeAreaPadX('1rem')}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        aria-busy={busy}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-sheet bg-stone-0 p-5 shadow-raised outline-none"
      >
        <h2 id={titleId} className="font-display text-base font-semibold text-stone-900">
          {claiming ? 'Bắt đầu chuyển khoản' : 'Xác nhận đã chuyển khoản'}
        </h2>
        <div id={bodyId} className="mt-2 space-y-2 text-sm leading-relaxed text-stone-600">
          {takeOverFrom && (
            <Notice tone="warning">
              Khoản này đang do {takeOverFrom.holder} chuyển khoản
              {takeOverFrom.since ? ` từ ${formatDateTime(takeOverFrom.since)}` : ''}. Chỉ xác nhận thay khi chắc chắn tiền đã đi
              đúng một lần (đối chiếu sao kê) — lý do tiếp quản được lưu vào lịch sử đơn.
            </Notice>
          )}
          {claiming ? (
            <p>
              Bấm trước khi chuyển tiền: nơi nhận được khoá, khách không đổi sang Ví Tubu được nữa. Chuyển khoản xong, bấm
              &quot;Đã chuyển khoản&quot; kèm mã giao dịch. Chưa chuyển được thì &quot;Trả về hàng chờ&quot;.
            </p>
          ) : (
            <p>
              Chỉ xác nhận sau khi bạn đã chuyển tiền cho khách bên ngoài hệ thống. Hệ thống chỉ ghi sổ, không tự chuyển tiền
              và không hoàn tác được.
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-control bg-stone-50 p-3">
            <dt className="text-stone-500">Số tiền</dt>
            <dd className="font-semibold text-stone-900">{formatVnd(refund.amount)}</dd>
            {toBank ? (
              refund.bankAccountNo && (
                <>
                  <dt className="text-stone-500">Ngân hàng</dt>
                  <dd className="min-w-0 break-words font-medium text-stone-800">{refund.bankName || 'Chưa ghi tên ngân hàng'}</dd>
                  <dt className="text-stone-500">Số tài khoản</dt>
                  <dd className="min-w-0 break-all font-medium text-stone-800">{refund.bankAccountNo}</dd>
                  <dt className="text-stone-500">Chủ tài khoản</dt>
                  <dd className="min-w-0 break-words font-medium text-stone-800">{refund.bankAccountName || 'Chưa có tên'}</dd>
                </>
              )
            ) : (
              <>
                <dt className="text-stone-500">Người nhận</dt>
                <dd className="min-w-0 break-words font-medium text-stone-800">{refund.recipientName || 'Chưa có tên'}</dd>
                <dt className="text-stone-500">SĐT</dt>
                <dd className={`min-w-0 font-medium ${refund.phone ? 'text-stone-800' : 'text-warning-fg'}`}>
                  {refund.phone || 'Chưa có SĐT'}
                </dd>
              </>
            )}
            <dt className="text-stone-500">Đơn</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-stone-800">{refund.orderCode}</dd>
          </dl>
        </div>

        <div className="mt-3 space-y-3">
          {staffBlocked && <Notice tone="warning">Khách chưa chọn tài khoản nhận — nhờ quản trị viên nhập.</Notice>}
          {needsEntry && (
            <div ref={bankEntryRef} className="space-y-2 rounded-control border border-warning-fg bg-warning-bg p-3">
              <p className="text-xs text-warning-fg">Khách chưa chọn nơi nhận. Nhập tài khoản khách đã gửi cho Tubu.</p>
              {(
                [
                  ['bankName', 'Tên ngân hàng'],
                  ['accountNumber', 'Số tài khoản'],
                  ['accountName', 'Chủ tài khoản'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-xs font-medium text-stone-700">{label}</span>
                  <input
                    name={key}
                    type="text"
                    autoComplete="off"
                    inputMode={key === 'accountNumber' ? 'numeric' : undefined}
                    maxLength={key === 'accountNumber' ? 40 : 120}
                    value={bank[key]}
                    disabled={busy}
                    onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </label>
              ))}
            </div>
          )}
          {!claiming && (
            <>
              <div>
                <label htmlFor={bankRefId} className="mb-1 block text-xs font-medium text-stone-700">
                  Mã giao dịch ngân hàng
                </label>
                <input
                  id={bankRefId}
                  ref={bankRefRef}
                  name="bankRef"
                  type="text"
                  maxLength={100}
                  autoComplete="off"
                  value={bankRef}
                  disabled={busy}
                  required
                  aria-invalid={refMissing ? true : undefined}
                  onChange={(e) => setBankRef(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-stone-700">
                  Ghi chú (tuỳ chọn)
                </label>
                <textarea
                  id={noteId}
                  ref={noteRef}
                  name="note"
                  rows={3}
                  maxLength={500}
                  value={note}
                  disabled={busy}
                  onChange={(e) => setNote(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              {takeOverFrom && (
                <div>
                  <label htmlFor={takeOverId} className="mb-1 block text-xs font-medium text-stone-700">
                    Lý do tiếp quản
                  </label>
                  <textarea
                    id={takeOverId}
                    ref={takeOverRef}
                    name="takeOverReason"
                    rows={2}
                    maxLength={300}
                    value={takeOverReason}
                    disabled={busy}
                    required
                    aria-invalid={takeOverMissing ? true : undefined}
                    onChange={(e) => setTakeOverReason(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="mt-3">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            data-confirm="cancel"
            disabled={busy}
            onClick={onClose}
            className="min-h-[44px] rounded-control border border-stone-450 bg-stone-0 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            ref={acceptRef}
            type="button"
            data-confirm="accept"
            disabled={busy || staffBlocked}
            onClick={submit}
            className="min-h-[44px] rounded-control bg-warning-fg px-4 text-sm font-medium text-stone-0 hover:brightness-90 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
          >
            {busy ? 'Đang lưu…' : claiming ? 'Bắt đầu chuyển khoản' : 'Đã chuyển khoản'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
