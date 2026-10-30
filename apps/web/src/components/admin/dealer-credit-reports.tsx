'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEALER_CREDIT_REPORTS_QUERY_KEY,
  dismissDealerCreditReport,
  invalidateInbox,
  listDealerCreditReports,
  type DealerCreditReport,
} from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { DealerCreditPanel } from './dealer-credit-panel';
import { useConfirm } from './confirm-dialog';
import { BTN_SMALL, BTN_XS_DANGER, LoadError } from './ui';

/**
 * Đại lý bấm "Báo đã chuyển khoản" trả nợ nhưng sổ công nợ chỉ giảm khi kế toán ghi nhận. Khối này giữ các báo cáo chưa xử lý, cũ nhất
 * trước: "Ghi nhận" mở khối công nợ với số tiền điền sẵn và gắn báo cáo (ghi nhận xong báo cáo tự đóng), "Không thấy tiền" đóng báo cáo
 * kèm lý do. Không có báo cáo nào thì không hiện gì.
 */
export function DealerCreditReportsSection({ onChanged }: { onChanged?: () => void }) {
  const qc = useQueryClient();
  const [flash, setFlash] = useState<string | null>(null);
  const q = useQuery({ queryKey: DEALER_CREDIT_REPORTS_QUERY_KEY, queryFn: listDealerCreditReports, refetchInterval: 60_000 });
  const reports = q.data ?? [];

  const done = (text: string) => {
    setFlash(text);
    void qc.invalidateQueries({ queryKey: DEALER_CREDIT_REPORTS_QUERY_KEY });
    void invalidateInbox(qc);
    onChanged?.();
  };

  if (q.isError) return <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được các báo cáo chuyển khoản của đại lý.</LoadError>;
  if (reports.length === 0 && !flash) return null;

  return (
    <section aria-label="Đại lý báo đã chuyển" data-dealer-credit-reports className="space-y-2 rounded-card border border-warning-fg bg-warning-bg p-3">
      <h2 className="font-display text-base font-semibold text-stone-900">Đại lý báo đã chuyển ({reports.length})</h2>
      {reports.length > 0 && (
        <p className="text-xs text-stone-700">
          Đại lý bấm &quot;Báo đã chuyển khoản&quot; nhưng sổ công nợ chưa đổi. Đối chiếu sao kê rồi bấm &quot;Ghi nhận&quot;, hoặc &quot;Không thấy tiền&quot; kèm lý do.
        </p>
      )}
      {flash && (
        <p role="status" className="text-xs text-success-fg">
          {flash}
        </p>
      )}
      <ul className="space-y-2">
        {reports.map((r) => (
          <ReportRow key={r.id} report={r} onDone={done} />
        ))}
      </ul>
    </section>
  );
}

function ReportRow({ report: r, onDone }: { report: DealerCreditReport; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  const who = r.dealer.fullName || r.dealer.phone || r.userId;

  const dismiss = useMutation({
    mutationFn: (reason: string) => dismissDealerCreditReport(r.id, reason),
    onSuccess: (res) =>
      onDone(
        res.alreadyProcessed
          ? `Báo cáo ${formatVnd(r.amount)} của ${who} đã được xử lý trước đó, lần này sổ công nợ không đổi.`
          : `Đã đóng báo cáo ${formatVnd(r.amount)} của ${who}: không thấy tiền. Sổ công nợ không đổi.`,
      ),
    onError: (e) => setErr(e instanceof Error ? e.message : 'Thao tác thất bại.'),
  });

  const onDismiss = async () => {
    setErr(null);
    const reason = await ask({
      title: 'Không thấy tiền',
      message: `Đại lý ${who} báo đã chuyển ${formatVnd(r.amount)}. Ghi vì sao không thấy tiền (vd chưa có trên sao kê ngày nào) để người sau còn đối chiếu. Sổ công nợ không đổi.`,
      confirmLabel: 'Đánh dấu không thấy tiền',
      input: { label: 'Lý do', placeholder: 'vd chưa thấy trên sao kê VCB đến 16h', maxLength: 500, required: true },
    });
    if (reason) dismiss.mutate(reason);
  };

  return (
    <li data-dealer-credit-report className="space-y-2 rounded-control border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-semibold text-stone-900">{who}</div>
          {r.dealer.fullName && r.dealer.phone && <div className="text-xs text-stone-500">{r.dealer.phone}</div>}
        </div>
        <div className="text-right">
          <div className="font-semibold text-stone-900">{formatVnd(r.amount)}</div>
          <div className="text-xs text-stone-500">Báo lúc {formatDateTime(r.createdAt)}</div>
        </div>
      </div>
      {r.note && <p className="break-words text-xs text-stone-600">Đại lý ghi: {r.note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={BTN_SMALL}>
          Ghi nhận
        </button>
        <button type="button" onClick={() => void onDismiss()} disabled={dismiss.isPending} className={BTN_XS_DANGER}>
          Không thấy tiền
        </button>
      </div>
      {err && (
        <p role="alert" className="text-xs text-danger-fg">
          {err}
        </p>
      )}
      {open && (
        <DealerCreditPanel
          order={{ type: 'DEALER', user: { id: r.userId, phone: r.dealer.phone, fullName: r.dealer.fullName } }}
          defaultOpen
          defaultAmount={r.amount}
          reportId={r.id}
          onPaid={({ amount, balance, reportClosed, alreadyRecorded }) =>
            onDone(
              alreadyRecorded
                ? `Báo cáo ${formatVnd(r.amount)} của ${who} đã được ghi nhận trước đó, sổ công nợ lần này không đổi. Dư nợ hiện tại ${formatVnd(balance)}.`
                : reportClosed === false
                  ? `Mã giao dịch này đã được ghi nhận trước đó, sổ công nợ của ${who} không đổi. Báo cáo ${formatVnd(r.amount)} vẫn mở: nếu trùng khoản đã ghi, đóng bằng "Không thấy tiền" kèm lý do.`
                  : `Đã ghi nhận ${formatVnd(amount)} của ${who}. Báo cáo đã đóng. Dư nợ còn lại ${formatVnd(balance)}.`,
            )
          }
        />
      )}
      {dialog}
    </li>
  );
}
