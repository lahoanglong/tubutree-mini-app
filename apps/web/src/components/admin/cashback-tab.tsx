'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listCashbackTxns, reviewCashbackTxn, type AdminCashbackTxn } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { useConfirm } from './confirm-dialog';

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
            className={`min-h-[44px] rounded px-3 py-1 text-sm ${filter === s ? 'bg-green-600 text-white' : 'bg-neutral-100'}`}
          >
            {s || 'Tất cả'}
          </button>
        ))}
      </div>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      {q.isLoading && <p className="text-sm text-neutral-500">Đang tải…</p>}
      {q.isError && <p className="text-sm text-red-600">Không tải được danh sách.</p>}
      <div className="space-y-2">
        {q.data?.map((t) => (
          <div key={t.id} className="rounded-lg border border-neutral-100 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{label(t)}</span>
              <span className="text-xs text-neutral-500">{t.status}</span>
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              Khách: {t.user?.fullName ?? 'Khách hàng'}
              {t.user?.phone ? ` · ${t.user.phone}` : ''}
            </div>
            <div className="mt-1 text-xs text-neutral-600">
              Đơn {formatVnd(t.orderAmount)} · hoa hồng {formatVnd(t.commission)} · khách nhận{' '}
              <b>{formatVnd(t.userReward)}</b>
            </div>
            {t.status !== 'PAID' && (
              <div className="mt-2 flex flex-wrap gap-2">
                {t.status !== 'CONFIRMED' && (
                  <button
                    onClick={() => void approve(t)}
                    disabled={review.isPending}
                    className="min-h-[44px] rounded bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:bg-neutral-300"
                  >
                    Duyệt hoàn tiền
                  </button>
                )}
                {t.status !== 'REJECTED' && (
                  <button
                    onClick={() => void reject(t)}
                    disabled={review.isPending}
                    className="min-h-[44px] rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 disabled:opacity-50"
                  >
                    Từ chối
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {q.data?.length === 0 && <p className="text-sm text-neutral-500">Không có giao dịch nào.</p>}
      </div>
      {dialog}
    </div>
  );
}
