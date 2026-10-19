'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listLiveAttendance, manualCheckout, type LiveAttendance } from '@/lib/admin-client';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { BTN_DANGER_OUTLINE, Notice, ToneBadge, LoadError } from './ui';

/** Nhân viên đang trong ca + nút "Chốt ra ca" cho người quên ra ca (ADMINOPS-17). Lương ngày đó tự tính lại. */
export function AttendanceTab() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const q = useQuery({ queryKey: ['admin-attendance-live'], queryFn: listLiveAttendance, refetchInterval: 60_000 });
  const close = useMutation({
    mutationFn: (id: string) => manualCheckout(id),
    onSuccess: () => {
      setMsg({ tone: 'success', text: 'Đã chốt ra ca và tính lại lương ngày đó.' });
      void qc.invalidateQueries({ queryKey: ['admin-attendance-live'] });
    },
    onError: (e) => setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Không chốt được ca.' }),
  });

  const ask = async (s: LiveAttendance) => {
    const who = s.shift.staff?.fullName ?? s.shift.staff?.phone ?? 'nhân viên';
    const ok = await confirm({
      title: 'Chốt ra ca?',
      message: `Ghi giờ ra ca của ${who} là bây giờ (vào ca ${formatDateTime(s.checkinAt)}). Lương ngày ${formatDate(s.shift.workDate)} được tính lại; tháng đã chốt lương thì không chốt được.`,
      confirmLabel: 'Chốt ra ca',
      tone: 'danger',
    });
    if (ok) close.mutate(s.id);
  };

  return (
    <div className="space-y-3">
      {dialog}
      <h2 className="font-display text-lg font-semibold text-stone-900">Đang trong ca</h2>
      {msg && (
        <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </Notice>
      )}
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được danh sách chấm công.</LoadError>}
      {q.data?.length === 0 && <p className="text-sm text-stone-500">Không có ai đang trong ca.</p>}
      <ul className="space-y-2">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <div className="min-w-0 text-sm">
              <div className="font-medium text-stone-900">
                {s.shift.staff?.fullName ?? 'Nhân viên'} {s.shift.staff?.phone && <span className="text-stone-500">· {s.shift.staff.phone}</span>}
              </div>
              <div className="text-xs text-stone-600">
                Vào ca {formatDateTime(s.checkinAt)} · ca {formatDateTime(s.shift.approvedStart ?? s.shift.startAt).slice(0, 5)}–{formatDateTime(s.shift.approvedEnd ?? s.shift.endAt).slice(0, 5)} ngày{' '}
                {formatDate(s.shift.workDate)} · nhịp cuối{' '}
                {formatDateTime(s.lastHeartbeatAt)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {s.isLate && <ToneBadge tone="warning">Đi trễ</ToneBadge>}
                {s.outOfRangeCount > 0 && <ToneBadge tone="danger">Ngoài vùng {s.outOfRangeCount} nhịp</ToneBadge>}
              </div>
            </div>
            <button type="button" disabled={close.isPending} onClick={() => void ask(s)} className={BTN_DANGER_OUTLINE}>
              Chốt ra ca
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
