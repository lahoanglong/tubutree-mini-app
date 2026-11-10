'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { chooseRefundDestination, fetchMyRefunds, formatVnd } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { invalidateBalances } from '@/lib/balances';
import { settleWithin } from '@/lib/settle-within';
import {
  EMPTY_BANK,
  bankDetailsError,
  destinationBody,
  refundStatusText,
  type MyRefund,
  type RefundBankInput,
  type RefundMethodChoice,
} from '@/lib/refund-rules';
import { RefundDestinationPicker } from './refund-destination-picker';
import { actionErrorText } from '@/lib/error-text';

const TONE = {
  success: { Icon: CheckCircle2, text: 'text-success-fg' },
  warning: { Icon: TriangleAlert, text: 'text-warning-fg' },
  muted: { Icon: Clock, text: 'text-stone-700' },
} as const;

/**
 * Máy chủ từ chối vì khoản hoàn không còn như thẻ đang hiện: 400 (đã xử lý), 404 (không còn), 409 (máy khác vừa chọn, Tubu vừa bắt đầu chuyển).
 * Bấm lại trên thẻ cũ nhận đúng lỗi đó mãi nên phải tải lại. Mất mạng, quá hạn, 401, 403 và 5xx không nói gì về trạng thái thật: không tính.
 */
const isStaleRefundError = (e: unknown): boolean => [400, 404, 409].includes(errorStatus(e) ?? 0);

/** Khoản hoàn tiền của đơn (chuyển khoản chờ xử lý, tiền về muộn): trạng thái từng bước và chọn nơi nhận (D2). */
export function OrderRefunds({ orderId, returnRequestIds }: { orderId: string; returnRequestIds?: ReadonlySet<string> }) {
  const refunds = useQuery({
    queryKey: ['my-refunds', orderId],
    queryFn: () => fetchMyRefunds(orderId),
    retry: 0,
  });
  // Khoản hoàn của một yêu cầu trả hàng đã nằm cùng dòng với yêu cầu đó ở khối thao tác (ReturnStatus): không lặp lại ở đây.
  const shown = (refunds.data ?? []).filter((r) => !(r.kind === 'RETURN' && r.refKey && returnRequestIds?.has(r.refKey)));

  if (!shown.length) return null;
  return (
    <section aria-labelledby="refunds-title" className={`mt-4 p-4 tabular-nums ${ui.card}`}>
      <h2 id="refunds-title" className={ui.sectionTitle}>
        Hoàn tiền
      </h2>
      <ul className="mt-2 space-y-3">
        {shown.map((r) => {
          const s = refundStatusText(r);
          const tone = TONE[s.tone];
          return (
            <li key={r.id} className="flex items-start gap-2">
              <tone.Icon className={`mt-0.5 h-4 w-4 flex-none ${tone.text}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${tone.text}`}>
                  {s.title} · {formatVnd(r.amount)}
                </p>
                {s.detail && <p className="text-xs text-stone-600">{s.detail}</p>}
                <RefundDestinationControl refund={r} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Nút "Chọn/Đổi nơi nhận tiền" của một khoản hoàn, kèm form và lời xác nhận sau khi lưu; dùng ở khối Hoàn tiền và dòng yêu cầu trả hàng. */
export function RefundDestinationControl({ refund: r }: { refund: MyRefund }) {
  const [choosing, setChoosing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // Lời máy chủ từ chối còn lại sau khi form tự đóng (khoản hoàn đã sang bước khác): nằm trong form thì mất cùng form.
  const [rejected, setRejected] = useState<string | null>(null);
  return (
    <>
      {done && (
        <p role="status" className="mt-2 text-sm font-medium text-success-fg">
          {done}
        </p>
      )}
      {rejected && (
        <p role="alert" className={`mt-2 ${ui.error}`}>
          {rejected}
        </p>
      )}
      {r.canChooseDestination && !choosing && (
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setRejected(null);
            setChoosing(true);
          }}
          className={`mt-2 ${r.bankAccountNo ? ui.btnSecondary : ui.btnPrimary}`}
        >
          {r.bankAccountNo ? 'Đổi nơi nhận' : 'Chọn nơi nhận tiền'}
        </button>
      )}
      {choosing && (
        <ChooseDestination
          key={r.id}
          refund={r}
          onClose={() => setChoosing(false)}
          onUnavailable={(msg) => {
            setChoosing(false);
            setRejected(msg);
          }}
          onSaved={(msg) => {
            setChoosing(false);
            setDone(msg);
          }}
        />
      )}
    </>
  );
}

function ChooseDestination({
  refund,
  onClose,
  onUnavailable,
  onSaved,
}: {
  refund: MyRefund;
  onClose: () => void;
  onUnavailable: (rejection: string | null) => void;
  onSaved: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<RefundMethodChoice>(
    refund.bankAccountNo ? 'BANK' : 'WALLET',
  );
  const [bank, setBank] = useState<RefundBankInput>(
    refund.bankAccountNo
      ? {
          bankName: refund.bankName ?? '',
          accountNumber: refund.bankAccountNo,
          accountName: refund.bankAccountName ?? '',
        }
      : EMPTY_BANK,
  );
  const [touched, setTouched] = useState(false);
  // State riêng cho lời lỗi: `save.isError` chỉ lật sau khi Promise của onError xong, tức sau lúc tải lại, mà lời lỗi phải hiện ngay.
  const [error, setError] = useState<string | null>(null);
  const bankError = method === 'BANK' ? bankDetailsError(bank) : null;

  // Khoá đồng bộ: `save.isPending` chỉ đổi sau lần vẽ kế, hai cú bấm "Xác nhận" sát nhau sẽ gọi API hai lần.
  const savingRef = useRef(false);
  // Phương thức đi theo biến của mutation: khách đổi radio lúc đang lưu thì onSuccess vẫn nói đúng điều đã gửi lên máy chủ.
  const save = useMutation({
    mutationFn: (choice: RefundMethodChoice) => chooseRefundDestination(refund.id, destinationBody(choice, bank)),
    onSuccess: (_data, choice) => {
      void qc.invalidateQueries({ queryKey: ['my-refunds', refund.orderId] });
      // Chỉ Ví Tubu đổi số dư; chuyển khoản chỉ ghi tài khoản để Tubu chuyển trong 1-3 ngày làm việc.
      if (choice === 'WALLET') invalidateBalances(qc);
      onSaved(
        choice === 'WALLET'
          ? `Đã hoàn ${formatVnd(refund.amount)} vào Ví Tubu.`
          : 'Đã lưu tài khoản. Tubu sẽ chuyển khoản trong 1-3 ngày làm việc.',
      );
    },
    // Khoản hoàn đã khác thẻ: tải lại để thẻ và nút theo số thật, khoá giữ tới lúc đó (có hạn). Ví cũng tải lại vì bên thắng có thể vừa cộng tiền vào Ví.
    onError: (e) => {
      setError(actionErrorText(e));
      if (!isStaleRefundError(e)) return undefined;
      return settleWithin(Promise.all([qc.invalidateQueries({ queryKey: ['my-refunds', refund.orderId] }), invalidateBalances(qc)]));
    },
    onSettled: () => {
      savingRef.current = false;
    },
  });

  // Khoản đã sang bước khác trên máy chủ: form này không lưu được nữa nên đóng, khối phía sau đã hiện trạng thái thật. Không đóng giữa lúc
  // đang lưu: lệnh đang bay còn phải báo kết quả, và sau lỗi bị từ chối khoá giữ tới khi dữ liệu mới về nên effect chạy lại ngay khi khoá nhả.
  useEffect(() => {
    if (!refund.canChooseDestination && !save.isPending) onUnavailable(error);
  }, [refund.canChooseDestination, save.isPending, error, onUnavailable]);

  const submit = () => {
    if (savingRef.current || save.isPending) return;
    setTouched(true);
    if (bankError) return;
    setError(null);
    savingRef.current = true;
    save.mutate(method);
  };

  return (
    <div
      role="group"
      aria-label={`Nơi nhận tiền hoàn đơn ${refund.orderCode}`}
      className="mt-2 rounded-control border border-stone-200 p-3"
    >
      <RefundDestinationPicker
        method={method}
        onMethod={setMethod}
        bank={bank}
        onBank={setBank}
        bankError={touched ? bankError : null}
        amountLabel={formatVnd(refund.amount)}
      />
      {error && (
        <p role="alert" className={`mt-2 ${ui.error}`}>
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={save.isPending}
          className={ui.btnSecondary}
        >
          Để sau
        </button>
        {/* Nút đang giữ focus mà `disabled` thì Chromium thả focus về <body>: bận thì aria-busy + aria-disabled, chặn ở `submit`. */}
        <button
          type="button"
          aria-busy={save.isPending || undefined}
          aria-disabled={save.isPending || undefined}
          onClick={submit}
          className={ui.btnPrimary}
        >
          {save.isPending ? 'Đang lưu…' : 'Xác nhận'}
        </button>
      </div>
    </div>
  );
}
