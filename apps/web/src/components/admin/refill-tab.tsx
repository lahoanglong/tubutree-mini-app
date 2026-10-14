'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveRefill, listPendingRefills, rejectRefill, type PendingRefill } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, FIELD_XS, Notice } from './ui';

/**
 * Đổi vỏ chai chờ duyệt trên web admin (trước đây chỉ duyệt được trong mini app). Cùng route với nhân viên quầy:
 * nhập số vỏ thực nhận nếu ít hơn khách khai, bỏ trống = nhận đủ.
 */
export function RefillTab() {
  const q = useQuery({ queryKey: ['admin-refill-pending'], queryFn: listPendingRefills });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Đổi vỏ chai chờ duyệt</h2>
        {q.data && <span className="text-xs text-stone-500">{q.data.length} yêu cầu · cũ nhất trước</span>}
      </div>
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <p className="text-sm text-danger-fg">Không tải được danh sách đổi vỏ.</p>}
      {q.data?.length === 0 && <p className="text-sm text-stone-500">Không có yêu cầu nào đang chờ.</p>}
      <ul className="space-y-2">
        {q.data?.map((r) => (
          <RefillRow key={r.id} item={r} />
        ))}
      </ul>
    </div>
  );
}

function RefillRow({ item: r }: { item: PendingRefill }) {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [received, setReceived] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-refill-pending'] });
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
  };
  const n = received.trim() === '' ? undefined : Number(received);
  const invalid = n !== undefined && (!Number.isInteger(n) || n < 1 || n > r.quantity);
  const approve = useMutation({
    mutationFn: () => approveRefill(r.id, n),
    onSuccess: refresh,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không duyệt được.'),
  });
  const reject = useMutation({
    mutationFn: (reason: string) => rejectRefill(r.id, reason || undefined),
    onSuccess: refresh,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không từ chối được.'),
  });
  const askReject = async () => {
    const reason = await ask({
      title: 'Từ chối đổi vỏ?',
      message: `Khách không nhận nước tưới cho ${r.quantity} vỏ này.`,
      confirmLabel: 'Từ chối',
      tone: 'danger',
      input: { label: 'Lý do (khách thấy)', placeholder: 'VD: vỏ không đúng loại' },
    });
    if (reason !== null) reject.mutate(reason);
  };
  const busy = approve.isPending || reject.isPending;
  return (
    <li className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div className="min-w-0">
          <div className="font-medium text-stone-900">
            {r.user.fullName ?? 'Khách'} {r.user.phone && <span className="text-stone-500">· {r.user.phone}</span>}
          </div>
          <div className="text-xs text-stone-600">
            Khai <b>{r.quantity}</b> vỏ · thưởng {r.seedsAwarded} giọt nước · gửi {formatDateTime(r.createdAt)}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-stone-700">
          Số vỏ thực nhận
          <input
            inputMode="numeric"
            value={received}
            placeholder={String(r.quantity)}
            onChange={(e) => setReceived(e.target.value.replace(/\D/g, ''))}
            className={`${FIELD_XS} w-20`}
          />
        </label>
        <button type="button" disabled={busy || invalid} onClick={() => approve.mutate()} className={BTN_PRIMARY}>
          Duyệt
        </button>
        <button type="button" disabled={busy} onClick={() => void askReject()} className={BTN_DANGER_OUTLINE}>
          Từ chối
        </button>
      </div>
      {invalid && <p className="mt-1 text-xs text-danger-fg">Số vỏ thực nhận từ 1 tới {r.quantity}.</p>}
      {err && (
        <div className="mt-2">
          <Notice tone="danger" role="alert">
            {err}
          </Notice>
        </div>
      )}
    </li>
  );
}
