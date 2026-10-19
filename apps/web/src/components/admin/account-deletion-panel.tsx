'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/client-api';
import { formatVnd } from '@/lib/shop-client';
import { BTN_LINK, INPUT_CLASS, Notice, ToneBadge, chipClass } from './ui';
import { useConfirm } from './confirm-dialog';
import { USER_ROLE_LABELS } from './users-list';
import { formatDateTime } from '@/lib/format-date';

export type DeletionStatusFilter = 'PENDING' | 'RESOLVED' | 'ALL';

export interface AdminDeletionRequest {
  id: string;
  userId: string;
  reason: string | null;
  status: 'PENDING' | 'RESOLVED';
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    fullName: string | null;
    phone: string | null;
    role: string;
    walletBalance: number;
    pointsConvertedBalance: number;
    cashbackPending: number;
    createdAt: string;
  } | null;
  blockers: { code: string; message: string }[];
}

export const listDeletionRequests = (status: DeletionStatusFilter) =>
  apiFetch<AdminDeletionRequest[]>(`/admin/account-deletion-requests?status=${status}`);

export const processDeletionRequest = (id: string, note?: string) =>
  apiFetch<{ alreadyProcessed: boolean }>(`/admin/account-deletion-requests/${encodeURIComponent(id)}/process`, {
    method: 'POST',
    body: note?.trim() ? { note: note.trim() } : {},
  });

const FILTERS: { k: DeletionStatusFilter; label: string }[] = [
  { k: 'PENDING', label: 'Chờ xử lý' },
  { k: 'RESOLVED', label: 'Đã xử lý' },
  { k: 'ALL', label: 'Tất cả' },
];

const QUERY_KEY = 'admin-account-deletions';

/**
 * C-016: khách gửi yêu cầu xoá tài khoản từ miniapp; trước đây không có màn nào xử lý. "Xử lý" ẩn danh
 * dữ liệu cá nhân (BE AccountDeletionService), giữ đơn và sổ tiền cho kế toán; BE kiểm lại điều kiện
 * chặn trong transaction nên danh sách lý do ở đây chỉ để admin biết trước.
 */
export function AccountDeletionPanel() {
  const [filter, setFilter] = useState<DeletionStatusFilter>('PENDING');
  const q = useQuery({ queryKey: [QUERY_KEY, filter], queryFn: () => listDeletionRequests(filter) });

  return (
    <section className="mt-6 space-y-3" aria-labelledby="account-deletion-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="account-deletion-heading" className="text-base font-semibold text-stone-900">
          Yêu cầu xoá tài khoản
        </h2>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc yêu cầu xoá tài khoản">
          {FILTERS.map((f) => (
            <button
              key={f.k}
              type="button"
              role="tab"
              aria-selected={filter === f.k}
              onClick={() => setFilter(f.k)}
              className={chipClass(filter === f.k)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && (
        <p className="text-sm text-danger-fg">
          Không tải được danh sách yêu cầu.{' '}
          <button type="button" className={`${BTN_LINK} text-sm`} onClick={() => void q.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      <div className="space-y-2">
        {q.data?.map((r) => <DeletionRow key={r.id} request={r} />)}
        {q.data?.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
            Không có yêu cầu nào.
          </p>
        )}
      </div>
    </section>
  );
}

function DeletionRow({ request: r }: { request: AdminDeletionRequest }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const pending = r.status === 'PENDING';
  const blocked = r.blockers.length > 0;
  const { confirm, dialog } = useConfirm();

  const mut = useMutation({
    mutationFn: () => processDeletionRequest(r.id, note),
    onSuccess: () => {
      setErr(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
    onError: (e) => {
      setErr(e instanceof Error ? e.message : 'Thao tác thất bại.');
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const run = async () => {
    setErr(null);
    const who = r.user?.fullName || r.user?.phone || r.userId;
    const ok = await confirm({
      title: 'Ẩn danh tài khoản?',
      message: `Ẩn danh tài khoản "${who}"? Tên, SĐT, địa chỉ, Zalo sẽ bị xoá vĩnh viễn và khách bị đăng xuất. Đơn hàng và sổ tiền vẫn được giữ. Không hoàn tác được.`,
      confirmLabel: 'Ẩn danh tài khoản',
      tone: 'danger',
    });
    if (ok) mut.mutate();
  };

  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-900">{r.user?.fullName || 'Không rõ tên'}</span>
            {r.user?.phone && <span className="text-sm text-stone-600">{r.user.phone}</span>}
            <ToneBadge tone={pending ? 'warning' : 'success'}>{pending ? 'Chờ xử lý' : 'Đã xử lý'}</ToneBadge>
            {r.user && r.user.role !== 'CUSTOMER' && <ToneBadge tone="info">{USER_ROLE_LABELS[r.user.role] ?? r.user.role}</ToneBadge>}
          </div>
          {r.user && pending && (
            <div className="mt-0.5 text-xs text-stone-600">
              Ví Tubu {formatVnd(r.user.walletBalance)} · {r.user.pointsConvertedBalance.toLocaleString('vi-VN')} Điểm Xanh không hết hạn
            </div>
          )}
          <div className="mt-0.5 text-sm text-stone-600">
            Lý do: <span className="text-stone-800">{r.reason || 'Không ghi lý do'}</span>
          </div>
        </div>
        <span className="text-xs text-stone-500">{formatDateTime(r.createdAt)}</span>
      </div>

      {!pending && (
        <div className="mt-2 space-y-0.5 text-xs text-stone-500">
          {r.reviewedAt && <div>Xử lý lúc: {formatDateTime(r.reviewedAt)}</div>}
          {r.adminNote && (
            <div>
              Ghi chú admin: <span className="text-stone-700">{r.adminNote}</span>
            </div>
          )}
        </div>
      )}

      {pending && blocked && (
        <div className="mt-3">
          <Notice tone="warning">
            <span className="font-medium">Chưa xử lý được, cần giải quyết trước:</span>
            <ul className="mt-1 list-disc pl-4">
              {r.blockers.map((b) => (
                <li key={b.code + b.message}>{b.message}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
          <input
            aria-label="Ghi chú xử lý"
            placeholder="Ghi chú (tuỳ chọn), vd đã gọi xác nhận với khách"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            className={`${INPUT_CLASS} min-w-[200px] flex-1`}
            disabled={mut.isPending}
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={mut.isPending || blocked}
            className="min-h-11 rounded-control bg-danger-fg px-3.5 py-1.5 text-sm font-medium text-stone-0 hover:brightness-90 disabled:bg-stone-200 disabled:text-stone-500"
          >
            Xử lý (ẩn danh)
          </button>
          {mut.isPending && <span className="text-xs text-stone-500">Đang xử lý…</span>}
        </div>
      )}
      {err && (
        <p role="alert" className="mt-2 text-sm text-danger-fg">
          {err}
        </p>
      )}
      {dialog}
    </div>
  );
}
