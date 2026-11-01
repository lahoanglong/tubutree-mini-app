'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateInbox } from '@/lib/admin-client';
import { apiFetch } from '@/lib/client-api';
import { formatVnd } from '@/lib/shop-client';
import { BTN_DANGER_OUTLINE, BTN_LINK, INPUT_CLASS, Notice, ToneBadge, chipClass, Field } from './ui';
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
  walletForfeitAmount?: number | null;
  walletForfeitConsentAt?: string | null;
  walletOverrideBy?: string | null;
  walletOverrideByName?: string | null;
  walletOverrideAt?: string | null;
  walletOverrideReason?: string | null;
  walletOverrideAmount?: number | null;
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

export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 500;
const PHONE_LIKE = /(?<![\p{L}\d])(?:\+?84|0)[\s.\-]*[35789](?:[\s.\-]*\d){8}(?!\d)/u;
const codePoints = (t: string) => [...t].length;

export interface WalletOverrideInput {
  reason: string;
  expectedWalletBalance: number;
}

export const processDeletionRequest = (id: string, note?: string, override?: WalletOverrideInput) =>
  apiFetch<{ alreadyProcessed: boolean }>(`/admin/account-deletion-requests/${encodeURIComponent(id)}/process`, {
    method: 'POST',
    body: {
      ...(note?.trim() ? { note: note.trim() } : {}),
      ...(override ? { overrideWalletBalance: { reason: override.reason.trim(), expectedWalletBalance: override.expectedWalletBalance } } : {}),
    },
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
export function AccountDeletionPanel({ seed = 0 }: { seed?: number }) {
  const [filter, setFilter] = useState<DeletionStatusFilter>('PENDING');
  const q = useQuery({ queryKey: [QUERY_KEY, filter], queryFn: () => listDeletionRequests(filter) });
  const sectionRef = useRef<HTMLElement>(null);
  // Thẻ "Hôm nay" mở tab Người dùng: trang đặt khối này lên đầu (seed > 0); cuộn tới để khỏi nằm dưới phần đã cuộn của trang, và mở lại hàng chờ xử lý.
  useEffect(() => {
    if (seed <= 0) return;
    setFilter('PENDING');
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [seed]);

  return (
    <section id="account-deletions" ref={sectionRef} className={`${seed > 0 ? 'mb-6' : 'mt-6'} scroll-mt-20 space-y-3 lg:scroll-mt-4`} aria-labelledby="account-deletion-heading">
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
  const { confirm, ask, dialog } = useConfirm();
  // Chỉ bỏ qua được số dư Ví DƯƠNG; Ví âm hay vướng mắc khác vẫn phải giải quyết trước.
  const walletBlocked = r.blockers.some((b) => b.code === 'WALLET_BALANCE');
  const walletBalance = r.user?.walletBalance ?? 0;
  const otherBlockers = r.blockers.filter((b) => b.code !== 'WALLET_BALANCE');
  const onlyWalletBlocked = walletBlocked && otherBlockers.length === 0;
  const canOverrideWallet = pending && walletBlocked && walletBalance > 0;

  const mut = useMutation({
    mutationFn: (override?: WalletOverrideInput) => processDeletionRequest(r.id, note, override),
    onSuccess: () => {
      setErr(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      void invalidateInbox(qc);
    },
    onError: (e) => {
      setErr(e instanceof Error ? e.message : 'Thao tác thất bại.');
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      void invalidateInbox(qc);
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
    if (ok) mut.mutate(undefined);
  };

  const runOverride = async () => {
    setErr(null);
    const who = r.user?.fullName || r.user?.phone || r.userId;
    const amount = formatVnd(walletBalance);
    const reason = await ask({
      title: 'Xoá dù còn tiền Ví?',
      message: `Ví Tubu của "${who}" còn ${amount} và khách chưa đồng ý bỏ số dư. Xác nhận sẽ trừ ${amount} về 0, ẩn danh tài khoản và không hoàn tác được. Số tiền, lý do và người thao tác được ghi lại.`,
      confirmLabel: `Trừ ${amount} và ẩn danh`,
      tone: 'danger',
      input: {
        label: 'Lý do xoá dù còn tiền Ví (bắt buộc, không ghi tên hay số điện thoại khách)',
        placeholder: 'vd khách đã thu hồi đồng ý trên Zalo, CSKH đã xác nhận',
        maxLength: OVERRIDE_REASON_MAX,
        required: true,
        validate: (t) => {
          const n = codePoints(t.trim());
          if (n < OVERRIDE_REASON_MIN) return `Lý do cần ít nhất ${OVERRIDE_REASON_MIN} ký tự.`;
          if (n > OVERRIDE_REASON_MAX) return `Lý do tối đa ${OVERRIDE_REASON_MAX} ký tự.`;
          if (PHONE_LIKE.test(t)) return 'Lý do không được chứa số điện thoại hay dãy số dài của khách.';
          return null;
        },
      },
    });
    if (reason) mut.mutate({ reason, expectedWalletBalance: walletBalance });
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
          {r.walletForfeitAmount != null && (
            <div className="mt-0.5 text-xs text-stone-600">
              Khách đã đồng ý bỏ số dư Ví {formatVnd(r.walletForfeitAmount)}
              {r.walletForfeitConsentAt && ` (lúc ${formatDateTime(r.walletForfeitConsentAt)})`}
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
          {r.walletOverrideAmount != null && (
            <div>
              Xoá dù còn tiền Ví: đã trừ {formatVnd(r.walletOverrideAmount)}
              {r.walletOverrideAt && ` lúc ${formatDateTime(r.walletOverrideAt)}`}
              {r.walletOverrideBy && ` bởi ${r.walletOverrideByName || r.walletOverrideBy}`}. Lý do: <span className="text-stone-700">{r.walletOverrideReason}</span>
            </div>
          )}
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
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-3">
          <Field label="Ghi chú xử lý (tuỳ chọn)" className="min-w-[200px] flex-1">
            <input
              placeholder="vd đã gọi xác nhận với khách"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT_CLASS}
              disabled={mut.isPending}
            />
          </Field>
          <button
            type="button"
            onClick={() => void run()}
            disabled={mut.isPending || blocked}
            className="min-h-11 rounded-control bg-danger-fg px-3.5 py-1.5 text-sm font-medium text-stone-0 hover:brightness-90 disabled:bg-stone-200 disabled:text-stone-500"
          >
            Xử lý (ẩn danh)
          </button>
          {canOverrideWallet && (
            <button
              type="button"
              onClick={() => void runOverride()}
              disabled={mut.isPending || !onlyWalletBlocked}
              className={BTN_DANGER_OUTLINE}
            >
              Xoá dù còn tiền Ví
            </button>
          )}
          {canOverrideWallet && !onlyWalletBlocked && (
            <p className="basis-full text-xs text-stone-600">
              Chỉ xoá dù còn tiền Ví được khi không còn vướng mắc nào khác. Cần giải quyết trước: {otherBlockers.map((b) => b.message).join('; ')}.
            </p>
          )}
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
