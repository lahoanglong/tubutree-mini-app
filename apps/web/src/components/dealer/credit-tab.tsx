'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Leaf } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEALER_PAY_AMOUNT_LABEL } from '@tubutree/app-core/client-copy';
import { payCredit } from '@tubutree/app-core/api/dealer';
import { dealerCreditQuery, dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { formatDate } from '@/lib/format-date';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { errText } from './dealer-shell';

/**
 * Công nợ. "Báo đã chuyển khoản" KHÔNG tự trừ nợ: chỉ tạo thông báo cho admin, sổ chỉ giảm sau khi admin đối chiếu sao kê và xác nhận.
 */
export function CreditTab() {
  const qc = useQueryClient();
  const ledgerQ = useQuery(dealerCreditQuery(coreHttp));
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // Key vẫn gửi đi (header Idempotency-Key) nhưng `POST /dealer/credit-payment` chưa đọc nó: chống báo trùng hiện chỉ dựa vào khoá phía client bên dưới,
  // không chống được timeout rồi gửi lại. Key đổi sau mỗi lần báo thành công.
  const payKey = useRef(newIdempotencyKey());
  // Số tiền và key đi theo biến mutate (chụp lúc bấm lần đầu), không đọc `amount` mới hơn. Khoá giữ tới khi dư nợ mới về: nhả sớm thì bấm lần hai trên dư nợ cũ vẫn qua được kiểm "vượt dư nợ".
  const pay = useLockedMutation({
    mutationFn: (v: { amount: number; typed: string; key: string }) => payCredit(coreHttp, v.amount, v.key, 'Báo đã chuyển khoản'),
    // Xoá lời báo cũ ở đây: cú bấm bị khoá nuốt không chạy onMutate nên không làm mất lời báo vừa hiện.
    onMutate: () => setNotice(null),
    onSuccess: (res, v) => {
      setNotice((res as { message?: string })?.message ?? 'Đã báo cho quản trị viên — chờ xác nhận đã nhận được tiền.');
      payKey.current = newIdempotencyKey();
      // Khách gõ số khác trong lúc đang gửi thì giữ số đó, chỉ xoá khi ô vẫn là số vừa gửi.
      setAmount((cur) => (cur === v.typed ? '' : cur));
      return Promise.all([
        qc.invalidateQueries({ queryKey: dealerCreditQuery(coreHttp).queryKey }),
        qc.invalidateQueries({ queryKey: dealerMeQuery(coreHttp).queryKey }),
      ]);
    },
  });
  const submit = () => {
    pay.mutate({ amount: Number(amount), typed: amount, key: payKey.current });
  };

  if (ledgerQ.isLoading) return <Skeleton height={140} />;
  if (ledgerQ.isError && !ledgerQ.data) return <ErrorState message={errText(ledgerQ.error)} onRetry={() => ledgerQ.refetch()} />;

  const balance = ledgerQ.data?.balance ?? 0;
  const entries = ledgerQ.data?.entries ?? [];
  const payDisabled = !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > balance;

  return (
    <div className="grid gap-4 pb-6 lg:grid-cols-2 lg:items-start">
      <section aria-label="Dư nợ" className={`p-4 ${skin.card}`}>
        <div className="text-sm text-stone-600">Dư nợ hiện tại</div>
        <div className={`text-3xl font-bold tabular-nums ${balance > 0 ? 'text-danger-fg' : 'text-forest-700'}`}>{formatVnd(balance)}</div>
        <div className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={DEALER_PAY_AMOUNT_LABEL}>
              <input
                type="number"
                inputMode="numeric"
                className={ui.field}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
          {/* Đang gửi giữ aria-busy/aria-disabled chứ không `disabled`: nút đang giữ focus mà bị vô hiệu thì Chromium thả focus về body. */}
          <button
            type="button"
            disabled={payDisabled}
            aria-busy={pay.isPending || undefined}
            aria-disabled={pay.isPending || undefined}
            onClick={submit}
            className={`${ui.btnPrimary} ${skin.dealerInkBtn} flex-none`}
          >
            {pay.isPending ? 'Đang gửi…' : 'Báo đã chuyển khoản'}
          </button>
        </div>
        {Number(amount) > balance && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-danger-fg">
            <AlertTriangle className="h-4 w-4 flex-none" aria-hidden="true" />
            Số tiền vượt dư nợ hiện tại ({formatVnd(balance)}).
          </p>
        )}
        <div role="status" aria-live="polite">
          {notice && <p className="mt-2 text-sm font-medium text-success-fg">{notice}</p>}
        </div>
        {pay.isError && (
          <p role="alert" className={`mt-2 ${ui.error}`}>
            {errText(pay.error)}
          </p>
        )}
        <p className="mt-1.5 text-xs text-stone-600">
          &ldquo;Báo đã chuyển khoản&rdquo; chỉ gửi thông báo cho Tubu Tree — dư nợ chỉ giảm sau khi admin kiểm tra sao kê ngân hàng và xác nhận.
        </p>
      </section>

      <section aria-label="Sổ công nợ">
        <h2 className={`mb-2 ${ui.sectionTitle}`}>Sổ công nợ</h2>
        {entries.length > 0 ? (
          <ul className={`overflow-hidden ${skin.card}`}>
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 border-b border-stone-200 p-3 last:border-b-0">
                <div>
                  <div className="text-sm text-stone-900">{e.note ?? e.refType}</div>
                  <div className="text-xs text-stone-600">{formatDate(e.createdAt)}</div>
                </div>
                <span className={`text-sm font-bold tabular-nums ${e.delta > 0 ? 'text-danger-fg' : 'text-forest-700'}`}>
                  {e.delta > 0 ? '+' : ''}
                  {formatVnd(e.delta)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className={`p-6 text-center ${skin.card}`}>
            <Leaf className="mx-auto h-6 w-6 text-stone-500" aria-hidden="true" />
            <p className="mt-1 text-sm text-stone-600">Chưa có giao dịch công nợ</p>
          </div>
        )}
      </section>
    </div>
  );
}
