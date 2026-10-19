'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Leaf } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { payCredit } from '@tubutree/app-core/api/dealer';
import { dealerCreditQuery, dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { formatDate } from '@/lib/format-date';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { ui } from '@/lib/guest-ui';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errText } from './dealer-shell';

/**
 * Công nợ. "Báo đã CK" KHÔNG tự trừ nợ: chỉ tạo thông báo cho admin, sổ chỉ giảm sau khi admin đối chiếu sao kê và xác nhận.
 */
export function CreditTab() {
  const qc = useQueryClient();
  const ledgerQ = useQuery(dealerCreditQuery(coreHttp));
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // Key giữ nguyên qua các lần bấm lại của CÙNG một lần báo (bấm đúp/timeout), đổi sau khi báo thành công.
  const payKey = useRef(newIdempotencyKey());
  const payBusy = useRef(false);
  const pay = useMutation({
    mutationFn: () => payCredit(coreHttp, Number(amount), payKey.current, 'Báo đã chuyển khoản'),
    onSuccess: (res) => {
      setNotice((res as { message?: string })?.message ?? 'Đã báo cho quản trị viên — chờ xác nhận đã nhận được tiền.');
      payKey.current = newIdempotencyKey();
      setAmount('');
      void qc.invalidateQueries({ queryKey: dealerCreditQuery(coreHttp).queryKey });
      void qc.invalidateQueries({ queryKey: dealerMeQuery(coreHttp).queryKey });
    },
    onSettled: () => {
      payBusy.current = false;
    },
  });
  const submit = () => {
    if (payBusy.current) return;
    payBusy.current = true;
    setNotice(null);
    pay.mutate();
  };

  if (ledgerQ.isLoading) return <Skeleton height={140} />;
  if (ledgerQ.isError && !ledgerQ.data) return <ErrorState message={errText(ledgerQ.error)} onRetry={() => void ledgerQ.refetch()} />;

  const balance = ledgerQ.data?.balance ?? 0;
  const entries = ledgerQ.data?.entries ?? [];
  const payDisabled = !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > balance || pay.isPending;

  return (
    <div className="grid gap-4 pb-6 lg:grid-cols-2 lg:items-start">
      <section aria-label="Dư nợ" className={`p-4 ${ui.card}`}>
        <div className="text-sm text-stone-600">Dư nợ hiện tại</div>
        <div className={`text-3xl font-bold tabular-nums ${balance > 0 ? 'text-danger-fg' : 'text-forest-700'}`}>{formatVnd(balance)}</div>
        <div className="mt-3 flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            aria-label="Số tiền đã chuyển"
            placeholder="Số tiền đã chuyển"
            className={ui.field}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button type="button" disabled={payDisabled} onClick={submit} className={`${ui.btnPrimary} flex-none`}>
            {pay.isPending ? 'Đang gửi...' : 'Báo đã CK'}
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
          &ldquo;Báo đã CK&rdquo; chỉ gửi thông báo cho Tubu Tree — dư nợ chỉ giảm sau khi admin kiểm tra sao kê ngân hàng và xác nhận.
        </p>
      </section>

      <section aria-label="Sổ công nợ">
        <h2 className={`mb-2 ${ui.sectionTitle}`}>Sổ công nợ</h2>
        {entries.length > 0 ? (
          <ul className={`overflow-hidden ${ui.card}`}>
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
          <div className={`p-6 text-center ${ui.card}`}>
            <Leaf className="mx-auto h-6 w-6 text-stone-500" aria-hidden="true" />
            <p className="mt-1 text-sm text-stone-600">Chưa có giao dịch công nợ</p>
          </div>
        )}
      </section>
    </div>
  );
}
