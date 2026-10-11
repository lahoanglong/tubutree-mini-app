'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveDealerRewardClaim,
  listDealerRewardClaims,
  markDealerRewardClaimPaid,
  rejectDealerRewardClaim,
  reopenDealerRewardClaim,
  type AdminDealerRewardClaim,
  type DealerRewardClaimStatus,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import {
  CLAIM_REWARD_TYPE_LABEL,
  CLAIM_STATUS_LABEL,
  CLAIM_STATUS_ORDER,
  claimActions,
  rejectReasonError,
} from '@/lib/dealer-claims';
import { BTN_DANGER_OUTLINE, BTN_LINK, BTN_PRIMARY, BTN_SMALL, INPUT_CLASS, TOUCH_H, ToneBadge, chipClass } from './ui';
import { useConfirm } from './confirm-dialog';
import type { Tone } from '@/lib/recycling';

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
export function DealerClaimsTab() {
  const [filter, setFilter] = useState<DealerRewardClaimStatus | ''>('PENDING');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['admin-dealer-claims', filter, page],
    queryFn: () => listDealerRewardClaims(filter || undefined, page),
  });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.meta.total / q.data.meta.limit)) : 1;

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
              }}
              className={chipClass(filter === s)}
            >
              {s ? CLAIM_STATUS_LABEL[s as DealerRewardClaimStatus] : 'Tất cả'}
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
        {q.data?.data.map((c) => <ClaimRow key={c.id} claim={c} />)}
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

export function ClaimRow({ claim: c }: { claim: AdminDealerRewardClaim }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const acts = claimActions(c.status);
  const { confirm, dialog } = useConfirm();

  const mut = useMutation({
    mutationFn: (a: Action) => {
      if (a === 'approve') return approveDealerRewardClaim(c.id, text);
      if (a === 'reject') return rejectDealerRewardClaim(c.id, text);
      if (a === 'reopen') return reopenDealerRewardClaim(c.id, text);
      return markDealerRewardClaimPaid(c.id, text);
    },
    onSuccess: () => {
      setErr(null);
      setText('');
      void qc.invalidateQueries({ queryKey: ['admin-dealer-claims'] });
    },
    onError: (e) => {
      setErr(e instanceof Error ? e.message : 'Thao tác thất bại.');
      // Trạng thái có thể vừa bị admin khác đổi — tải lại để thấy trạng thái thật.
      void qc.invalidateQueries({ queryKey: ['admin-dealer-claims'] });
    },
  });

  const run = async (a: Action) => {
    setErr(null);
    if (a === 'reject') {
      const e = rejectReasonError(text);
      if (e) return setErr(e);
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

  const dealerName = c.dealer?.businessName || c.dealer?.fullName || c.dealer?.phone || c.userId;
  const actionable = acts.approve || acts.reject || acts.markPaid || acts.reopen;

  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4">
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
        <span className="text-xs text-stone-500">{new Date(c.createdAt).toLocaleString('vi-VN')}</span>
      </div>

      {(c.rejectionReason || c.adminNote || c.reviewedAt || c.paidAt) && (
        <div className="mt-2 space-y-0.5 text-xs text-stone-500">
          {c.rejectionReason && (
            <div>
              Lý do từ chối: <span className="font-medium text-danger-fg">{c.rejectionReason}</span>
            </div>
          )}
          {c.adminNote && <div>Ghi chú admin: <span className="text-stone-700">{c.adminNote}</span></div>}
          {c.reviewedAt && <div>Xử lý lúc: {new Date(c.reviewedAt).toLocaleString('vi-VN')}</div>}
          {c.paidAt && <div>Trao thưởng lúc: {new Date(c.paidAt).toLocaleString('vi-VN')}</div>}
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
              disabled={mut.isPending}
              className={BTN_PRIMARY}
            >
              Duyệt
            </button>
          )}
          {acts.reject && (
            <button
              type="button"
              onClick={() => run('reject')}
              disabled={mut.isPending}
              className={BTN_DANGER_OUTLINE}
            >
              Từ chối
            </button>
          )}
          {acts.markPaid && (
            <button
              type="button"
              onClick={() => run('markPaid')}
              disabled={mut.isPending}
              className={`${TOUCH_H} rounded-control bg-info-fg px-3.5 py-1.5 text-sm font-medium text-stone-0 hover:brightness-90 disabled:bg-stone-200 disabled:text-stone-500`}
            >
              Đã trao thưởng
            </button>
          )}
          {acts.reopen && (
            <button
              type="button"
              onClick={() => run('reopen')}
              disabled={mut.isPending}
              className={`${TOUCH_H} rounded-control border border-forest-600 px-3.5 py-1.5 text-sm font-medium text-forest-700 hover:bg-forest-50 disabled:opacity-50`}
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
