'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLiveAttendance, manualCheckout, type LiveAttendance } from '@/lib/admin-client';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { BTN_DANGER_OUTLINE, Notice, ToneBadge, LoadError } from './ui';
import { actionErrorText } from '@/lib/admin-error-text';
import { settleWithin } from '@/lib/settle-within';
import { reloadWhenStale } from '@/lib/stale-write-rejection';
import { useLockedMutation } from '@/components/game/use-locked-mutation';

/** Nhân viên đang trong ca + nút "Chốt ra ca" cho người quên ra ca (ADMINOPS-17). Lương ngày đó tự tính lại. */
export function AttendanceTab() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const q = useQuery({ queryKey: ['admin-attendance-live'], queryFn: listLiveAttendance, refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-attendance-live'] });
  // Chốt ra ca đổi giờ ra và lương ngày: một việc mỗi lúc (khoá ref, `isPending` chỉ đúng sau lần vẽ kế) và giữ khoá tới khi danh sách mới về
  // (tối đa `settleWithin`) để dòng vừa chốt không còn nút bấm lại được. Phiên đã đóng (400/404: nhân viên tự ra ca, tự đóng) thì tải lại rồi mới nhả.
  const close = useLockedMutation({
    mutationFn: (id: string) => manualCheckout(id),
    onSuccess: () => {
      setMsg({ tone: 'success', text: 'Đã chốt ra ca và tính lại lương ngày đó.' });
      return settleWithin(refresh());
    },
    onError: (e) => {
      setMsg({ tone: 'danger', text: actionErrorText(e) });
      return reloadWhenStale(e, refresh);
    },
  });

  const ask = async (s: LiveAttendance) => {
    if (close.isPending) return;
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
      {q.isError && <LoadError onRetry={() => q.refetch({ cancelRefetch: false })} retrying={q.isFetching}>Không tải được danh sách chấm công.</LoadError>}
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
            <button
              type="button"
              aria-busy={(close.isPending && close.variables === s.id) || undefined}
              aria-disabled={close.isPending || undefined}
              onClick={() => void ask(s)}
              className={`${BTN_DANGER_OUTLINE} aria-disabled:opacity-60`}
            >
              Chốt ra ca
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
