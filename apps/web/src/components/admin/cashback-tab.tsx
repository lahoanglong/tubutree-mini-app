'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listCashbackTxns, reviewCashbackTxn, type AdminCashbackTxn } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { useConfirm } from './confirm-dialog';
import { BTN_XS_DANGER, BTN_XS_PRIMARY, LoadError } from './ui';

/** Nhãn trạng thái hoàn tiền sàn ngoài cho kế toán: Đã duyệt là chờ hết thời gian giữ; PAID do cron cộng thẳng vào Ví Tubu của khách, không có bước chi nào của kế toán. */
export const CASHBACK_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  CONFIRMED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  PAID: 'Đã cộng vào Ví',
};

/**
 * Duyệt tay hoàn tiền sàn ngoài. Trước đây trạng thái chỉ đổi qua postback của sàn, mà cron đối
 * soát thì tắt khi chưa có API key — postback rớt là giao dịch treo PENDING vĩnh viễn, khách
 * thấy "Chờ duyệt" vô thời hạn và không ai trong tổ chức xử lý được.
 */
export function CashbackTab() {
  const qc = useQueryClient();
  const { confirm, ask, dialog } = useConfirm();
  const [filter, setFilter] = useState('PENDING');
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin-cashback', filter],
    queryFn: () => listCashbackTxns(filter || undefined),
  });
  const review = useMutation({
    mutationFn: (v: { id: string; status: 'CONFIRMED' | 'REJECTED'; note?: string }) =>
      reviewCashbackTxn(v.id, v.status, v.note),
    onSuccess: () => {
      setErr(null);
      void qc.invalidateQueries({ queryKey: ['admin-cashback'] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không cập nhật được'),
  });

  const label = (t: AdminCashbackTxn) => `${t.merchant?.name ?? t.provider} · ${t.merchantOrderId}`;

  const approve = async (t: AdminCashbackTxn) => {
    const ok = await confirm({
      title: 'Duyệt hoàn tiền',
      message:
        `Giao dịch ${label(t)} (khách ${t.user?.fullName ?? 'Khách hàng'}): khách sẽ nhận ${formatVnd(t.userReward)} ` +
        'vào Ví Tubu sau thời gian giữ. Chỉ duyệt khi đã đối chiếu với sàn.',
      confirmLabel: 'Duyệt hoàn tiền',
    });
    if (ok) review.mutate({ id: t.id, status: 'CONFIRMED' });
  };

  const reject = async (t: AdminCashbackTxn) => {
    const note = await ask({
      title: 'Từ chối hoàn tiền',
      message: `Giao dịch ${label(t)}: khách sẽ không nhận ${formatVnd(t.userReward)}.`,
      confirmLabel: 'Từ chối',
      tone: 'danger',
      input: { label: 'Lý do từ chối (tuỳ chọn)', placeholder: 'Vd: sàn báo huỷ đơn', maxLength: 300 },
    });
    if (note === null) return;
    review.mutate({ id: t.id, status: 'REJECTED', note: note || undefined });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {['PENDING', 'CONFIRMED', 'REJECTED', 'PAID', ''].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setFilter(s)}
            className={`min-h-[44px] rounded-control px-3 py-1 text-sm ${filter === s ? 'bg-forest-600 text-stone-0' : 'bg-stone-100 text-stone-700'}`}
          >
            {s ? CASHBACK_STATUS_LABELS[s] : 'Tất cả'}
          </button>
        ))}
      </div>
      {err && <p className="mb-2 text-sm text-danger-fg">{err}</p>}
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được danh sách.</LoadError>}
      <div className="space-y-2">
        {q.data?.map((t) => (
          <div key={t.id} className="rounded-card border border-stone-200 bg-stone-0 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words text-sm font-medium">{label(t)}</span>
              <span data-cashback-status className="text-xs text-stone-500">{CASHBACK_STATUS_LABELS[t.status] ?? t.status}</span>
            </div>
            <div className="mt-1 text-xs text-stone-500">
              Khách: {t.user?.fullName ?? 'Khách hàng'}
              {t.user?.phone ? ` · ${t.user.phone}` : ''}
            </div>
            <div className="mt-1 text-xs text-stone-600">
              Đơn {formatVnd(t.orderAmount)} · hoa hồng {formatVnd(t.commission)} · khách nhận{' '}
              <b>{formatVnd(t.userReward)}</b>
            </div>
            {t.status !== 'PAID' && (
              <div className="mt-2 flex flex-wrap gap-2">
                {t.status !== 'CONFIRMED' && (
                  <button
                    onClick={() => void approve(t)}
                    disabled={review.isPending}
                    className={BTN_XS_PRIMARY}
                  >
                    Duyệt hoàn tiền
                  </button>
                )}
                {t.status !== 'REJECTED' && (
                  <button
                    onClick={() => void reject(t)}
                    disabled={review.isPending}
                    className={BTN_XS_DANGER}
                  >
                    Từ chối
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {q.data?.length === 0 && <p className="text-sm text-stone-500">Không có giao dịch nào.</p>}
      </div>
      {dialog}
    </div>
  );
}
