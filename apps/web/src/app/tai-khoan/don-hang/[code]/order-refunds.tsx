'use client';

import { useState } from 'react';
import { CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chooseRefundDestination, fetchMyRefunds, formatVnd } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
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

const TONE = {
  success: { Icon: CheckCircle2, text: 'text-success-fg' },
  warning: { Icon: TriangleAlert, text: 'text-warning-fg' },
  muted: { Icon: Clock, text: 'text-stone-700' },
} as const;

/** Khoản hoàn tiền của đơn (chuyển khoản chờ xử lý, tiền về muộn): trạng thái từng bước và chọn nơi nhận (D2). */
export function OrderRefunds({ orderId }: { orderId: string }) {
  const refunds = useQuery({
    queryKey: ['my-refunds', orderId],
    queryFn: () => fetchMyRefunds(orderId),
    retry: 0,
  });
  const [choosing, setChoosing] = useState<MyRefund | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!refunds.data?.length && !done) return null;
  return (
    <section aria-labelledby="refunds-title" className={`mt-4 p-4 ${ui.card}`}>
      <h2 id="refunds-title" className={ui.sectionTitle}>
        Hoàn tiền
      </h2>
      {done && (
        <p role="status" className="mt-2 text-sm font-medium text-success-fg">
          {done}
        </p>
      )}
      <ul className="mt-2 space-y-3">
        {(refunds.data ?? []).map((r) => {
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
                {r.canChooseDestination && choosing?.id !== r.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setDone(null);
                      setChoosing(r);
                    }}
                    className={`mt-2 ${r.bankAccountNo ? ui.btnSecondary : ui.btnPrimary}`}
                  >
                    {r.bankAccountNo ? 'Đổi nơi nhận' : 'Chọn nơi nhận tiền'}
                  </button>
                )}
                {choosing?.id === r.id && (
                  <ChooseDestination
                    key={r.id}
                    refund={r}
                    onClose={() => setChoosing(null)}
                    onSaved={(msg) => {
                      setChoosing(null);
                      setDone(msg);
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ChooseDestination({
  refund,
  onClose,
  onSaved,
}: {
  refund: MyRefund;
  onClose: () => void;
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
  const bankError = method === 'BANK' ? bankDetailsError(bank) : null;

  const save = useMutation({
    mutationFn: () => chooseRefundDestination(refund.id, destinationBody(method, bank)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-refunds', refund.orderId] });
      onSaved(
        method === 'WALLET'
          ? `Đã hoàn ${formatVnd(refund.amount)} vào Ví Tubu.`
          : 'Đã lưu tài khoản. Tubu sẽ chuyển khoản trong 1-3 ngày làm việc.',
      );
    },
  });

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
      {save.isError && (
        <p role="alert" className={`mt-2 ${ui.error}`}>
          {save.error instanceof Error ? save.error.message : 'Không lưu được nơi nhận tiền.'}
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
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            setTouched(true);
            if (!bankError) save.mutate();
          }}
          className={ui.btnPrimary}
        >
          {save.isPending ? 'Đang lưu…' : 'Xác nhận'}
        </button>
      </div>
    </div>
  );
}
