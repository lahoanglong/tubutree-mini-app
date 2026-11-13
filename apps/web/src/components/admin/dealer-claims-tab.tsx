'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveDealerRewardClaim,
  listDealerRewardClaims,
  markDealerRewardClaimPaid,
  rejectDealerRewardClaim,
  reopenDealerRewardClaim,
  type AdminDealerRewardClaim,
  type DealerRewardClaimStatus,
  invalidateInbox,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import {
  CLAIM_REWARD_TYPE_LABEL,
  CLAIM_STATUS_LABEL,
  CLAIM_STATUS_ORDER,
  claimActions,
  rejectReasonError,
} from '@/lib/dealer-claims';
import { BTN_DANGER_OUTLINE, BTN_LINK, BTN_PRIMARY, BTN_SMALL, INPUT_CLASS, TOUCH_H, ToneBadge, chipClass, ListSkeleton } from './ui';
import { useConfirm } from './confirm-dialog';
import type { Tone } from '@/lib/recycling';
import { formatDateTime } from '@/lib/format-date';
import { actionErrorText } from '@/lib/admin-error-text';
import { settleWithin } from '@/lib/settle-within';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { peekDealerClaimSeed, seedDealerClaimFilter } from './inbox-filter-seeds';

const STATUS_TONE: Record<DealerRewardClaimStatus, Tone> = {
  PENDING: 'warning',
  APPROVED: 'info',
  PAID: 'success',
  REJECTED: 'danger',
};

/**
 * "Yêu cầu nhận thưởng đại lý": đại lý đạt mốc doanh số (tour/quà) gửi yêu cầu → admin duyệt / từ chối
 * (bắt buộc lý do) → xác nhận đã trao. Từ chối là cuối với đại lý; admin từ chối nhầm thì "Mở lại yêu cầu". Luồng + kiểm doanh số đã chốt nằm ở DealerService; lỗi (vd doanh
 * số tụt dưới mốc vì có đơn huỷ/trả sau khi gửi) hiện NGUYÊN VĂN.
 */
export { seedDealerClaimFilter };

/** Lời lỗi theo id yêu cầu: đặt hoặc thay lời của đúng yêu cầu đó, `null` thì gỡ; lời của yêu cầu khác giữ nguyên. */
function withNotice(all: Record<string, string>, id: string, message: string | null): Record<string, string> {
  if (message === null) {
    if (!(id in all)) return all;
    const next = { ...all };
    delete next[id];
    return next;
  }
  return { ...all, [id]: message };
}

export function DealerClaimsTab({ canReview = true }: { canReview?: boolean } = {}) {
  // Kế toán không duyệt được, chỉ chi: mặc định đứng ở hàng đã duyệt chờ chi.
  const [filter, setFilter] = useState<DealerRewardClaimStatus | ''>(peekDealerClaimSeed() ?? (canReview ? 'PENDING' : 'APPROVED'));
  useEffect(() => {
    seedDealerClaimFilter(null);
  }, []);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['admin-dealer-claims', filter, page],
    queryFn: () => listDealerRewardClaims(filter || undefined, page),
  });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.meta.total / q.data.meta.limit)) : 1;
  // Lời lỗi của lệnh ghi nằm ở đây, ngoài dòng: tải lại làm dòng rời bộ lọc (yêu cầu đã được xử lý ở máy khác) thì lời lỗi vẫn còn.
  // Mỗi yêu cầu một lời: lệnh ở dòng khác (thành công hay lỗi) không được xoá hay thay lời của yêu cầu vừa lỗi.
  const [notices, setNotices] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Yêu cầu nhận thưởng đại lý</h2>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc theo trạng thái">
          {[...CLAIM_STATUS_ORDER, ''].map((s) => (
            <button
              key={s || 'all'}
              type="button"
              role="tab"
              aria-selected={filter === s}
              onClick={() => {
                setFilter(s as DealerRewardClaimStatus | '');
                setPage(1);
                setNotices({});
              }}
              className={chipClass(filter === s)}
            >
              {s ? CLAIM_STATUS_LABEL[s as DealerRewardClaimStatus] : 'Tất cả'}
            </button>
          ))}
        </div>
      </div>

      {Object.entries(notices).map(([id, text]) => (
        <p key={id} role="alert" className="text-sm text-danger-fg">
          {text}
        </p>
      ))}
      {q.isLoading && <ListSkeleton label="Đang tải yêu cầu của đại lý" rows={3} className="h-20" />}
      {q.isError && (
        <p className="text-sm text-danger-fg">
          Không tải được danh sách yêu cầu.{' '}
          <button type="button" className={`${BTN_LINK} text-sm`} onClick={() => void q.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      <div className="space-y-2">
        {q.data?.data.map((c) => <ClaimRow key={c.id} claim={c} canReview={canReview} onError={(message) => setNotices((all) => withNotice(all, c.id, message))} />)}
        {q.data?.data.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
            Không có yêu cầu nào{filter ? ` ở trạng thái "${CLAIM_STATUS_LABEL[filter]}"` : ''}.
          </p>
        )}
      </div>

      {q.data && totalPages > 1 && (
        <div className="flex items-center justify-between px-2 text-sm text-stone-600">
          <span>
            Tổng: <b className="text-stone-900">{q.data.meta.total}</b> yêu cầu
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className={BTN_SMALL}
            >
              ← Trước
            </button>
            <span className="text-xs">
              Trang {page}/{totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className={BTN_SMALL}
            >
              Sau →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Action = 'approve' | 'reject' | 'markPaid' | 'reopen';

/**
 * `canReview=false` (KE_TOAN): chỉ chi thưởng đã được ADMIN duyệt; duyệt/từ chối/mở lại là việc của ADMIN.
 * `onError` có thì lời lỗi của lệnh ghi (máy chủ từ chối) đi lên danh sách thay vì nằm trong dòng, vì tải lại có thể gỡ dòng khỏi bộ lọc;
 * ở đó nó đứng riêng cho từng yêu cầu nên phải nêu phần thưởng, đại lý, kỳ và mã yêu cầu. Lỗi nhập liệu (thiếu lý do) luôn hiện ngay trên dòng.
 */
export function ClaimRow({ claim: c, canReview = true, onError }: { claim: AdminDealerRewardClaim; canReview?: boolean; onError?: (message: string | null) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const base = claimActions(c.status);
  const acts = { ...base, approve: base.approve && canReview, reject: base.reject && canReview, reopen: base.reopen && canReview };
  const { confirm, dialog } = useConfirm();

  const dealerName = c.dealer?.businessName || c.dealer?.fullName || c.dealer?.phone || c.userId;
  const reportServerError = (message: string | null) => {
    if (!onError) return setErr(message);
    onError(message === null ? null : `Yêu cầu "${c.rewardTitle}" của đại lý ${dealerName} (kỳ ${c.periodKey}, mã ${c.id.slice(-6)}): ${message}`);
  };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-dealer-claims'] }), invalidateInbox(qc)]);
  // Khoá giữ tới khi danh sách làm mới về (tối đa 4 giây): nhả sớm thì yêu cầu vừa xử lý còn nút của trạng thái cũ và bấm lại được.
  const mut = useLockedMutation({
    mutationFn: (a: Action) => {
      if (a === 'approve') return approveDealerRewardClaim(c.id, text);
      if (a === 'reject') return rejectDealerRewardClaim(c.id, text);
      if (a === 'reopen') return reopenDealerRewardClaim(c.id, text);
      return markDealerRewardClaimPaid(c.id, text);
    },
    onSuccess: () => {
      setErr(null);
      reportServerError(null);
      setText('');
      return settleWithin(refresh());
    },
    onError: (e) => {
      reportServerError(actionErrorText(e));
      // Khác quy tắc chung (chỉ 400/404/409 mới CHỜ tải lại trước khi nhả khoá): lệnh nào lỗi cũng chờ tải lại xong rồi mới nhả khoá, vì trạng thái có thể vừa bị admin khác đổi
      // hoặc lệnh đã ghi rồi mới lỗi mạng/5xx, và nhả sớm thì nút còn hiện với trạng thái cũ. Trên production MutationCache vẫn làm cũ khoá admin-* ở mọi lỗi, nhưng không chờ.
      return settleWithin(refresh());
    },
  });
  const acting = (a: Action) => mut.isPending && mut.variables === a;

  const run = async (a: Action) => {
    if (mut.isPending) return;
    setErr(null);
    reportServerError(null);
    if (a === 'reject') {
      const e = rejectReasonError(text);
      if (e) return setErr(e);
      const ok = await confirm({
        title: 'Từ chối yêu cầu nhận thưởng',
        message: `Từ chối yêu cầu "${c.rewardTitle}" của đại lý? Lý do bạn nhập sẽ hiện cho đại lý.`,
        confirmLabel: 'Từ chối',
        cancelLabel: 'Không từ chối',
        tone: 'danger',
      });
      if (!ok) return;
    }
    if (a === 'markPaid') {
      const ok = await confirm({
        title: 'Xác nhận đã trao thưởng',
        message: `Xác nhận ĐÃ TRAO "${c.rewardTitle}" cho đại lý?`,
        confirmLabel: 'Đã trao thưởng',
      });
      if (!ok) return;
    }
    if (a === 'reopen') {
      const ok = await confirm({
        title: 'Mở lại yêu cầu nhận thưởng',
        message:
          `Mở lại yêu cầu "${c.rewardTitle}" (kỳ ${c.periodKey}) của đại lý? Yêu cầu quay về "Đang chờ duyệt"; lý do từ chối cũ được giữ trong ghi chú admin. ` +
          'Doanh số đã chốt sẽ được kiểm lại khi bạn duyệt.',
        confirmLabel: 'Mở lại',
      });
      if (!ok) return;
    }
    mut.mutate(a);
  };

  const actionable = acts.approve || acts.reject || acts.markPaid || acts.reopen;

  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4 tabular-nums">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-900">{c.rewardTitle}</span>
            <span className="text-xs text-stone-500">
              {CLAIM_REWARD_TYPE_LABEL[c.rewardType] ?? c.rewardType} · kỳ {c.periodKey}
            </span>
            <ToneBadge tone={STATUS_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</ToneBadge>
          </div>
          <div className="mt-0.5 text-sm text-stone-600">
            Đại lý: <span className="font-medium text-stone-800">{dealerName}</span>
            {c.dealer?.phone && dealerName !== c.dealer.phone ? ` · ${c.dealer.phone}` : ''}
          </div>
          <div className="mt-0.5 text-xs text-stone-600">
            Mốc {formatVnd(c.threshold)} · doanh số đã chốt lúc gửi <b>{formatVnd(c.volumeAtClaim)}</b>
          </div>
          {c.note && <div className="mt-1 text-xs text-stone-600">Đại lý ghi chú: {c.note}</div>}
        </div>
        <span className="text-xs text-stone-500">{formatDateTime(c.createdAt)}</span>
      </div>

      {(c.rejectionReason || c.adminNote || c.reviewedAt || c.paidAt) && (
        <div className="mt-2 space-y-0.5 text-xs text-stone-500">
          {c.rejectionReason && (
            <div>
              Lý do từ chối: <span className="font-medium text-danger-fg">{c.rejectionReason}</span>
            </div>
          )}
          {c.adminNote && <div>Ghi chú admin: <span className="text-stone-700">{c.adminNote}</span></div>}
          {c.reviewedAt && <div>Xử lý lúc: {formatDateTime(c.reviewedAt)}</div>}
          {c.paidAt && <div>Trao thưởng lúc: {formatDateTime(c.paidAt)}</div>}
        </div>
      )}

      {actionable && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
          <input
            aria-label="Ghi chú / lý do"
            placeholder={
              acts.reject
                ? 'Ghi chú duyệt (tuỳ chọn) — BẮT BUỘC khi từ chối'
                : acts.reopen
                  ? 'Lý do mở lại (tuỳ chọn)'
                  : 'Ghi chú trao thưởng (tuỳ chọn)'
            }
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            className={`${INPUT_CLASS} min-w-[240px] flex-1`}
            disabled={mut.isPending}
          />
          {acts.approve && (
            <button
              type="button"
              onClick={() => run('approve')}
              aria-busy={acting('approve') || undefined}
              aria-disabled={mut.isPending || undefined}
              className={`${BTN_PRIMARY} aria-disabled:opacity-60`}
            >
              Duyệt
            </button>
          )}
          {acts.reject && (
            <button
              type="button"
              onClick={() => run('reject')}
              aria-busy={acting('reject') || undefined}
              aria-disabled={mut.isPending || undefined}
              className={`${BTN_DANGER_OUTLINE} aria-disabled:opacity-60`}
            >
              Từ chối
            </button>
          )}
          {acts.markPaid && (
            <button
              type="button"
              onClick={() => run('markPaid')}
              aria-busy={acting('markPaid') || undefined}
              aria-disabled={mut.isPending || undefined}
              className={`${TOUCH_H} rounded-control bg-info-fg px-3.5 py-1.5 text-sm font-medium text-stone-0 hover:brightness-90 aria-disabled:opacity-60`}
            >
              Đã trao thưởng
            </button>
          )}
          {acts.reopen && (
            <button
              type="button"
              onClick={() => run('reopen')}
              aria-busy={acting('reopen') || undefined}
              aria-disabled={mut.isPending || undefined}
              className={`${TOUCH_H} rounded-control border border-forest-600 px-3.5 py-1.5 text-sm font-medium text-forest-700 hover:bg-forest-50 aria-disabled:opacity-50`}
            >
              Mở lại yêu cầu
            </button>
          )}
          {mut.isPending && <span className="text-xs text-stone-500">Đang lưu…</span>}
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
