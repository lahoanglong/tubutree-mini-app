'use client';

import type { AdminUser } from '@/lib/admin-client';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { formatDate } from '@/lib/format-date';
import { BTN_DANGER_OUTLINE, BTN_LINK, BTN_SMALL, ScrollRegion, ToneBadge } from './ui';

export const USER_ROLE_LABELS: Record<string, string> = { CUSTOMER: 'Khách hàng', AFFILIATE: 'CTV', DEALER: 'Đại lý', STAFF: 'Nhân viên', ADMIN: 'Quản trị' };

/** Tổng Điểm Xanh khách thấy; phần quy đổi từ xu cũ (tiền trả trước, không hết hạn) ghi riêng để xử lý khiếu nại. */
function UserPointsCell({ user }: { user: { pointsBalance: number; pointsConvertedBalance?: number } }) {
  const pts = pointsSummary(user);
  return (
    <>
      {formatCount(pts.total)}
      {pts.convertedNote && <div className="text-xs text-stone-500">{pts.convertedNote}</div>}
    </>
  );
}

const labelOf = (u: AdminUser) => u.fullName ?? u.phone ?? u.id;

export interface UsersListProps {
  users: AdminUser[];
  isAdmin: boolean;
  /** Điện thoại: mỗi người dùng một thẻ thay vì bảng 6 cột phải vuốt ngang mới thấy nút khoá. */
  narrow: boolean;
  blockBusy: boolean;
  unblockBusy: boolean;
  onOpenDetail: (id: string) => void;
  onBlock: (u: AdminUser) => void;
  onUnblock: (u: AdminUser) => void;
}

function UserName({ user: u, onOpenDetail, card = false }: { user: AdminUser; onOpenDetail: (id: string) => void; card?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpenDetail(u.id)}
      aria-haspopup="dialog"
      className={`${BTN_LINK} text-left ${card ? '-ml-2 justify-start' : ''}`}
      aria-label={`Xem chi tiết ${labelOf(u)}`}
    >
      {u.fullName ?? (card ? 'Chưa đặt tên' : '—')}
    </button>
  );
}

/** Trạng thái khoá và nút Khoá / Mở khoá của một người dùng; nhân viên (không phải admin) chỉ xem. */
function UserStatus({ user: u, isAdmin, blockBusy, unblockBusy, onBlock, onUnblock }: Omit<UsersListProps, 'users' | 'narrow' | 'onOpenDetail'> & { user: AdminUser }) {
  if (!isAdmin) {
    return u.isBlocked ? (
      <ToneBadge tone="danger" title={u.blockedReason ?? undefined}>Đã khoá</ToneBadge>
    ) : (
      <span className="text-stone-500">Đang hoạt động</span>
    );
  }
  if (u.isBlocked) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone="danger" title={u.blockedReason ?? undefined}>Đã khoá</ToneBadge>
        <button type="button" onClick={() => onUnblock(u)} disabled={unblockBusy} className={BTN_SMALL} aria-label={`Mở khoá ${labelOf(u)}`}>
          Mở khoá
        </button>
        {u.blockedReason && <p className="w-full text-xs text-stone-500">Lý do: {u.blockedReason}</p>}
      </div>
    );
  }
  return (
    <button type="button" onClick={() => onBlock(u)} disabled={blockBusy} className={BTN_DANGER_OUTLINE} aria-label={`Khoá ${labelOf(u)}`}>
      Khoá
    </button>
  );
}

export function UsersList(props: UsersListProps) {
  const { users, narrow, onOpenDetail, ...status } = props;
  if (narrow) {
    return (
      <ul aria-label="Danh sách người dùng" className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className={`rounded-card border bg-stone-0 p-3 text-sm ${u.isBlocked ? 'border-danger-fg' : 'border-stone-200'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 font-medium break-words">
                <UserName user={u} onOpenDetail={onOpenDetail} card />
              </div>
              <span className="shrink-0 text-xs text-stone-600">{USER_ROLE_LABELS[u.role] ?? u.role}</span>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-stone-600">
              <dt className="text-stone-500">SĐT</dt>
              <dd>{u.phone ?? '—'}</dd>
              <dt className="text-stone-500">Điểm</dt>
              <dd>
                <UserPointsCell user={u} />
              </dd>
              <dt className="text-stone-500">Ngày</dt>
              <dd>{formatDate(u.createdAt)}</dd>
            </dl>
            <div className="mt-2 border-t border-stone-100 pt-2">
              <UserStatus user={u} {...status} />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ScrollRegion label="Danh sách người dùng" className="rounded-card border border-stone-200 bg-stone-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs text-stone-500">
          <tr>
            {['Tên', 'SĐT', 'Vai trò', 'Điểm', 'Ngày', 'Trạng thái'].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="px-3">
          {users.map((u) => (
            <tr key={u.id} className="border-t border-stone-100">
              <td className="px-3 py-2 font-medium">
                <UserName user={u} onOpenDetail={onOpenDetail} />
              </td>
              <td className="px-3 py-2">{u.phone ?? '—'}</td>
              <td className="px-3 py-2">{USER_ROLE_LABELS[u.role] ?? u.role}</td>
              <td className="px-3 py-2">
                <UserPointsCell user={u} />
              </td>
              <td className="px-3 py-2 text-stone-500">{formatDate(u.createdAt)}</td>
              <td className="min-w-[16rem] px-3 py-2">
                <UserStatus user={u} {...status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
