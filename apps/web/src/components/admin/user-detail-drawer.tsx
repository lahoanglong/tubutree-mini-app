'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatVnd } from '@/lib/shop-client';
import {
  getUserDetail,
  getWasteUserFlags,
  setStaffPermissions,
  setWasteUserFlags,
  STAFF_PERMISSION_LABELS,
  type AdminUserDetail,
  type AdminUserEvent,
  type StaffPermission,
} from '@/lib/admin-client';
import { ORDER_STATUS_LABELS } from '@/lib/export-csv';
import { formatDateTime } from '@/lib/format-date';
import { pointsDebtAmount, pointsReasonDetail, walletTxLabel } from '@/lib/ledger-labels';
import { pointsSummary } from '@/lib/checkout-points';
import { SideDrawer } from './side-drawer';
import { BTN_DANGER_OUTLINE, BTN_PRIMARY, BTN_SECONDARY, Notice, ToneBadge, LoadError } from './ui';
import { useConfirm } from './confirm-dialog';

const ROLE_LABELS: Record<string, string> = {
  CUSTOMER: 'Khách hàng',
  AFFILIATE: 'CTV',
  DEALER: 'Đại lý',
  STAFF: 'Nhân viên',
  ADMIN: 'Quản trị',
};
const roleLabel = (r: string | null) => (r ? (ROLE_LABELS[r] ?? r) : '—');
const onOff = (v: string | null) => (v === 'true' ? 'Bật' : v === 'false' ? 'Tắt' : '—');
const permLabel = (v: string | null) => (v ? v.split(',').join(' + ') : 'không có');

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
        {title}
        {count !== undefined && ` (${count})`}
      </h3>
      <div className="mt-2 text-sm">{children}</div>
    </section>
  );
}

// Dòng STOREFRONT_PARTNER lưu `<id gian hàng>` hoặc `<id gian hàng>:ADMIN_TOGGLE` (admin bật tay): chỉ phần sau đánh dấu là nội bộ.
const ADMIN_TOGGLE_SUFFIX = ':ADMIN_TOGGLE';
function partnerReasonLabel(reason: string): string {
  return reason.endsWith(ADMIN_TOGGLE_SUFFIX)
    ? `gian hàng ${reason.slice(0, -ADMIN_TOGGLE_SUFFIX.length)} · admin bật tay`
    : `gian hàng ${reason}`;
}

function EventLine({ e }: { e: AdminUserEvent }) {
  const what =
    e.kind === 'ROLE'
      ? `Vai trò ${roleLabel(e.fromValue)} → ${roleLabel(e.toValue)}`
      : e.kind === 'STAFF_PERMISSIONS'
        ? `Nhóm việc ${permLabel(e.fromValue)} → ${permLabel(e.toValue)}`
        : e.kind === 'STOREFRONT_PARTNER'
          ? `Gian hàng đối tác: ${onOff(e.fromValue)} → ${onOff(e.toValue)}`
          : e.kind === 'BLOCK'
            ? 'Khoá tài khoản'
            : 'Mở khoá';
  return (
    <li className="py-1.5">
      <div className="font-medium text-stone-900">{what}</div>
      <div className="text-xs text-stone-500">
        {formatDateTime(e.createdAt)} · {e.actorName ?? (e.actorId ? e.actorId : 'hệ thống')}
        {e.reason && ` · ${e.kind === 'STOREFRONT_PARTNER' ? partnerReasonLabel(e.reason) : e.reason}`}
      </div>
    </li>
  );
}

/** Chi tiết một người dùng (ADMINOPS-11): đơn, sổ ví, Điểm Xanh, lịch sử vai trò/khoá; ADMIN gán nhóm việc cho nhân viên. */
export function UserDetailDrawer({ userId, isAdmin, onClose }: { userId: string; isAdmin: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-user-detail', userId], queryFn: () => getUserDetail(userId) });
  const title = q.data ? (q.data.user.fullName ?? q.data.user.phone ?? 'Người dùng') : 'Người dùng';
  return (
    <SideDrawer title={title} onClose={onClose}>
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được chi tiết người dùng.</LoadError>}
      {q.data && <DetailBody d={q.data} isAdmin={isAdmin} />}
    </SideDrawer>
  );
}

function DetailBody({ d, isAdmin }: { d: AdminUserDetail; isAdmin: boolean }) {
  const u = d.user;
  const pts = pointsSummary(u);
  return (
    <div className="space-y-3">
      <Section title="Hồ sơ">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-stone-500">SĐT</dt>
          <dd className="break-words">{u.phone ?? '—'}</dd>
          <dt className="text-stone-500">Vai trò</dt>
          <dd>
            {roleLabel(u.role)}
            {u.tier && <span className="text-stone-500"> · {u.tier.name}</span>}
          </dd>
          <dt className="text-stone-500">Số dư ví</dt>
          <dd className="font-medium">{formatVnd(u.walletBalance)}</dd>
          <dt className="text-stone-500">Điểm Xanh</dt>
          <dd>
            {pts.total}
            {pts.convertedNote && <span className="text-xs text-stone-500"> ({pts.convertedNote})</span>}
          </dd>
          <dt className="text-stone-500">Tham gia</dt>
          <dd>{formatDateTime(u.createdAt)}</dd>
          {u.referralCode && (
            <>
              <dt className="text-stone-500">Mã giới thiệu</dt>
              <dd>{u.referralCode}</dd>
            </>
          )}
        </dl>
        {u.isBlocked && (
          <div className="mt-2">
            <ToneBadge tone="danger">Đã khoá {u.blockedAt ? formatDateTime(u.blockedAt) : ''}</ToneBadge>
            {u.blockedReason && <p className="mt-1 text-xs text-stone-600">Lý do: {u.blockedReason}</p>}
          </div>
        )}
      </Section>

      {isAdmin && u.role === 'STAFF' && <StaffPermissionsForm userId={u.id} current={u.staffPermissions} />}

      {isAdmin && <WasteFlagsSection userId={u.id} />}

      <Section title="Đơn hàng" count={d.orders.total}>
        {d.orders.items.length === 0 ? (
          <p className="text-stone-500">Chưa có đơn.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {d.orders.items.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-x-2 py-1.5">
                <span>
                  <b>{o.code}</b> <span className="text-xs text-stone-500">· {formatDateTime(o.createdAt)}</span>
                  {o.fulfiller === 'MERCHANT' && <span className="text-xs text-stone-500"> · gian hàng tự giao</span>}
                </span>
                <span className="text-right">
                  <span className="font-medium">{formatVnd(o.total)}</span>{' '}
                  <span className="text-xs text-stone-500">{ORDER_STATUS_LABELS[o.status] ?? o.status}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {d.orders.total > d.orders.items.length && (
          <p className="mt-1 text-xs text-stone-500">Hiện {d.orders.items.length} đơn mới nhất — tìm theo SĐT ở tab Đơn hàng để xem hết.</p>
        )}
      </Section>

      <Section title="Sổ ví" count={d.wallet.length}>
        {d.wallet.length === 0 ? (
          <p className="text-stone-500">Chưa có giao dịch ví.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {d.wallet.map((w) => (
              <li key={w.id} className="flex justify-between gap-x-2 py-1.5">
                <span className="min-w-0 flex-1 break-words">
                  {w.reason ?? walletTxLabel(w.type)}
                  <span className="block text-xs text-stone-500">{formatDateTime(w.createdAt)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={w.delta < 0 ? 'text-danger-fg' : 'text-success-fg'}>
                    {w.delta > 0 ? '+' : ''}
                    {formatVnd(w.delta)}
                  </span>
                  <span className="block text-xs text-stone-500">còn {formatVnd(w.balanceAfter)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Điểm Xanh" count={d.points.length}>
        {d.points.length === 0 ? (
          <p className="text-stone-500">Chưa có biến động điểm.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {d.points.map((p) => (
              <li key={p.id} className="flex justify-between gap-x-2 py-1.5">
                <span className="min-w-0 flex-1 break-words">
                  {pointsReasonDetail(p.reason)}
                  <span className="block text-xs text-stone-500">
                    {formatDateTime(p.createdAt)}
                    {p.expiresAt && ` · hết hạn ${formatDateTime(p.expiresAt)}`}
                  </span>
                </span>
                <span className={`shrink-0 ${p.delta < 0 || pointsDebtAmount(p.reason) !== null ? 'text-danger-fg' : 'text-success-fg'}`}>
                  {pointsDebtAmount(p.reason) !== null ? (
                    `nợ ${pointsDebtAmount(p.reason)}`
                  ) : (
                    <>
                      {p.delta > 0 ? '+' : ''}
                      {p.delta}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Lịch sử vai trò">
        {d.roleHistory.length === 0 && d.grants.length === 0 ? (
          <p className="text-stone-500">Chưa đổi vai trò.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {d.roleHistory.map((e) => (
              <EventLine key={e.id} e={e} />
            ))}
            {d.grants.map((g) => (
              <li key={g.id} className="py-1.5">
                <div className="font-medium text-stone-900">
                  Cấp quyền theo SĐT: {roleLabel(g.role)}
                  {g.revokedAt && <span className="text-danger-fg"> · đã thu hồi {formatDateTime(g.revokedAt)}</span>}
                </div>
                <div className="text-xs text-stone-500">
                  {formatDateTime(g.createdAt)} · {g.grantedByName ?? g.grantedBy}
                  {g.note && ` · ${g.note}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {(d.partnerHistory?.length ?? 0) > 0 && (
        <Section title="Gian hàng đối tác" count={d.partnerHistory!.length}>
          <ul className="divide-y divide-stone-100">
            {d.partnerHistory!.map((e) => (
              <EventLine key={e.id} e={e} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Lịch sử khoá">
        {d.blockHistory.length === 0 ? (
          <p className="text-stone-500">Chưa từng bị khoá.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {d.blockHistory.map((e) => (
              <EventLine key={e.id} e={e} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function StaffPermissionsForm({ userId, current }: { userId: string; current: StaffPermission[] }) {
  const qc = useQueryClient();
  const [perms, setPerms] = useState<StaffPermission[]>(current);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => setStaffPermissions(userId, perms),
    onSuccess: (r) => {
      setMsg({ tone: 'success', text: r.changed ? 'Đã lưu nhóm việc — có hiệu lực ở lần thao tác kế tiếp của nhân viên.' : 'Không có gì thay đổi.' });
      void qc.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
    },
    onError: (e) => setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Không lưu được.' }),
  });
  const dirty = [...perms].sort().join(',') !== [...current].sort().join(',');
  return (
    <Section title="Nhóm việc nhân viên">
      <p className="text-xs text-stone-500">Không chọn nhóm nào: nhân viên chỉ dùng quầy thu ngân, tab Đổi rác (hàng đợi kho, quà chờ nhận) và chấm công.</p>
      <div className="mt-2 space-y-1">
        {(Object.keys(STAFF_PERMISSION_LABELS) as StaffPermission[]).map((p) => (
          <label key={p} className="flex min-h-[44px] items-center gap-2 sm:min-h-[32px]">
            <input
              type="checkbox"
              checked={perms.includes(p)}
              onChange={(e) => setPerms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))}
              className="h-4 w-4 accent-forest-600"
            />
            <span>{STAFF_PERMISSION_LABELS[p]}</span>
          </label>
        ))}
      </div>
      <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className={`${BTN_PRIMARY} mt-2`}>
        {save.isPending ? 'Đang lưu…' : 'Lưu nhóm việc'}
      </button>
      {msg && (
        <div className="mt-2">
          <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
            {msg.text}
          </Notice>
        </div>
      )}
    </Section>
  );
}

type FlagChange = { blocked: boolean } | { shipLocked: boolean };

function WasteFlagsSection({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [err, setErr] = useState<string | null>(null);
  const flagsQ = useQuery({ queryKey: ['admin-waste-user-flags', userId], queryFn: () => getWasteUserFlags(userId) });
  const save = useMutation({
    mutationFn: (v: FlagChange & { reason: string }) => setWasteUserFlags(userId, v),
    onSuccess: () => {
      setErr(null);
      void qc.invalidateQueries({ queryKey: ['admin-waste-user-flags', userId] });
      void qc.invalidateQueries({ queryKey: ['admin-waste-requests'] });
      void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không lưu được.'),
  });
  const change = async (title: string, confirmLabel: string, locking: boolean, patch: FlagChange) => {
    const reason = await ask({
      title,
      message: 'Lý do được lưu kèm người thao tác.',
      confirmLabel,
      tone: locking ? 'danger' : 'default',
      input: { label: 'Lý do', required: true, maxLength: 500 },
    });
    if (reason) save.mutate({ ...patch, reason });
  };
  const f = flagsQ.data;
  return (
    <Section title="Đổi rác">
      {flagsQ.isLoading && <p className="text-stone-500">Đang tải…</p>}
      {flagsQ.isError && (
        <LoadError onRetry={() => void flagsQ.refetch()} retrying={flagsQ.isFetching}>
          Không tải được trạng thái khoá đổi rác.
        </LoadError>
      )}
      {f && !flagsQ.isError && (
        <div className="space-y-2">
          {(f.blockedAt || f.shipLockedAt) && (
            <div className="space-y-1">
              {f.blockedAt && <ToneBadge tone="danger" wrap>Đang khoá đổi rác từ {formatDateTime(f.blockedAt)}</ToneBadge>}
              {f.shipLockedAt && <ToneBadge tone="warning" wrap>Đang khoá gửi kho và thu kèm đơn từ {formatDateTime(f.shipLockedAt)}</ToneBadge>}
              {f.reason && <p className="text-xs text-stone-600">Lý do: {f.reason}</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {f.blockedAt ? (
              <button type="button" className={BTN_SECONDARY} disabled={save.isPending} onClick={() => void change('Mở khoá đổi rác', 'Mở khoá', false, { blocked: false })}>
                Mở khoá đổi rác
              </button>
            ) : (
              <button type="button" className={BTN_DANGER_OUTLINE} disabled={save.isPending} onClick={() => void change('Khoá đổi rác', 'Khoá', true, { blocked: true })}>
                Khoá đổi rác
              </button>
            )}
            {f.shipLockedAt ? (
              <button type="button" className={BTN_SECONDARY} disabled={save.isPending} onClick={() => void change('Mở khoá gửi kho', 'Mở khoá', false, { shipLocked: false })}>
                Mở khoá gửi kho
              </button>
            ) : (
              <button type="button" className={BTN_DANGER_OUTLINE} disabled={save.isPending} onClick={() => void change('Khoá gửi kho', 'Khoá', true, { shipLocked: true })}>
                Khoá gửi kho
              </button>
            )}
          </div>
        </div>
      )}
      {err && (
        <div className="mt-2">
          <Notice tone="danger" role="alert">{err}</Notice>
        </div>
      )}
      <a href={`/admin?tab=waste&wasteUser=${encodeURIComponent(userId)}`} className="mt-2 inline-block text-forest-700 underline">
        Xem yêu cầu đổi rác của khách
      </a>
      {dialog}
    </Section>
  );
}
