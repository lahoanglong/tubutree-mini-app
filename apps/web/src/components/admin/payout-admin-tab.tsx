'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePayout,
  listPayouts,
  markPayoutPaid,
  rejectPayout,
  type AdminPayout,
  type AdminPayoutStatus,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { PAYOUT_STATUS_LABEL, PAYOUT_STATUS_ORDER, payoutActions, rejectPayoutReasonError } from '@/lib/payout-admin';
import { BTN_DANGER_OUTLINE, BTN_LINK, BTN_PRIMARY, BTN_SMALL, INPUT_CLASS, TOUCH_H, ToneBadge, chipClass } from './ui';
import { useConfirm } from './confirm-dialog';
import type { Tone } from '@/lib/recycling';
import { formatDateTime } from '@/lib/format-date';

const STATUS_TONE: Record<AdminPayoutStatus, Tone> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  PAID: 'success',
  REJECTED: 'danger',
};

/**
 * Duyệt yêu cầu rút tiền (hoa hồng CTV / Ví Tubu → ngân hàng). Trước đây (P0 A5-08 = A6-05) Payout
 * REQUESTED không có màn nào xử lý — tiền bị trừ khỏi số dư CTV (hoặc commission bị khoá) rồi
 * "biến mất" khỏi mọi hàng đợi. Từ chối BẮT BUỘC lý do và TỰ ĐỘNG hoàn tiền/commission (BE:
 * AffiliateService.rejectPayout) — không cần thao tác hoàn tiền thủ công nào thêm ở đây.
 */
export function PayoutAdminTab() {
  const [filter, setFilter] = useState<AdminPayoutStatus | ''>('REQUESTED');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['admin-payouts', filter, page],
    queryFn: () => listPayouts(filter || undefined, page),
  });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.meta.total / q.data.meta.limit)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Duyệt yêu cầu rút tiền</h2>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc theo trạng thái">
          {[...PAYOUT_STATUS_ORDER, ''].map((s) => (
            <button
              key={s || 'all'}
              type="button"
              role="tab"
              aria-selected={filter === s}
              onClick={() => {
                setFilter(s as AdminPayoutStatus | '');
                setPage(1);
              }}
              className={chipClass(filter === s)}
            >
              {s ? PAYOUT_STATUS_LABEL[s as AdminPayoutStatus] : 'Tất cả'}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && (
        <p className="text-sm text-danger-fg">
          Không tải được danh sách lệnh rút.{' '}
          <button type="button" className={`${BTN_LINK} text-sm`} onClick={() => void q.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      <div className="space-y-2">
        {q.data?.data.map((p) => <PayoutRow key={p.id} payout={p} />)}
        {q.data?.data.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
            Không có lệnh rút nào{filter ? ` ở trạng thái "${PAYOUT_STATUS_LABEL[filter]}"` : ''}.
          </p>
        )}
      </div>

      {q.data && totalPages > 1 && (
        <div className="flex items-center justify-between px-2 text-sm text-stone-600">
          <span>
            Tổng: <b className="text-stone-900">{q.data.meta.total}</b> lệnh rút
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

type Action = 'approve' | 'reject' | 'markPaid';

export function PayoutRow({ payout: p }: { payout: AdminPayout }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const acts = payoutActions(p.status);
  const { confirm, dialog } = useConfirm();

  const mut = useMutation({
    mutationFn: (a: Action) => {
      if (a === 'approve') return approvePayout(p.id, text);
      if (a === 'reject') return rejectPayout(p.id, text);
      return markPayoutPaid(p.id, bankRef, text);
    },
    onSuccess: () => {
      setErr(null);
      setText('');
      setBankRef('');
      void qc.invalidateQueries({ queryKey: ['admin-payouts'] });
    },
    onError: (e) => {
      setErr(e instanceof Error ? e.message : 'Thao tác thất bại.');
      // Trạng thái có thể vừa bị admin khác đổi — tải lại để thấy trạng thái thật.
      void qc.invalidateQueries({ queryKey: ['admin-payouts'] });
    },
  });

  const run = async (a: Action) => {
    setErr(null);
    if (a === 'reject') {
      const e = rejectPayoutReasonError(text);
      if (e) return setErr(e);
      const ok = await confirm({
        title: 'Từ chối lệnh rút tiền',
        message: `Từ chối lệnh rút ${formatVnd(p.amount)}? Tiền/hoa hồng sẽ được HOÀN LẠI cho CTV.`,
        confirmLabel: 'Từ chối',
        cancelLabel: 'Không từ chối',
        tone: 'danger',
      });
      if (!ok) return;
    }
    if (a === 'markPaid') {
      const ok = await confirm({
        title: 'Xác nhận đã chuyển khoản',
        message: `Xác nhận ĐÃ CHUYỂN KHOẢN ${formatVnd(p.amount)} cho CTV?`,
        confirmLabel: 'Đã chuyển khoản',
      });
      if (!ok) return;
    }
    mut.mutate(a);
  };

  const userLabel = p.user?.fullName || p.user?.phone || p.userId;
  const bank = p.bankInfo;
  const actionable = acts.approve || acts.reject || acts.markPaid;

  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-900">{formatVnd(p.amount)}</span>
            {p.fee > 0 && <span className="text-xs text-stone-500">(đã trừ phí {formatVnd(p.fee)})</span>}
            <ToneBadge tone={STATUS_TONE[p.status]}>{PAYOUT_STATUS_LABEL[p.status]}</ToneBadge>
          </div>
          <div className="mt-0.5 text-sm text-stone-600">
            CTV: <span className="font-medium text-stone-800">{userLabel}</span>
            {p.user?.referralCode ? ` · mã ${p.user.referralCode}` : ''}
          </div>
          {bank && (bank.bankName || bank.accountNumber) && (
            <div className="mt-0.5 text-xs text-stone-600">
              {bank.bankName} · STK {bank.accountNumber} · {bank.accountName}
            </div>
          )}
        </div>
        <span className="text-xs text-stone-500">{formatDateTime(p.requestedAt)}</span>
      </div>

      {(p.rejectionReason || p.adminNote || p.reviewedAt || p.paidAt || p.bankRef) && (
        <div className="mt-2 space-y-0.5 text-xs text-stone-500">
          {p.rejectionReason && (
            <div>
              Lý do từ chối: <span className="font-medium text-danger-fg">{p.rejectionReason}</span>
            </div>
          )}
          {p.adminNote && (
            <div>
              Ghi chú admin: <span className="text-stone-700">{p.adminNote}</span>
            </div>
          )}
          {p.reviewedAt && <div>Xử lý lúc: {formatDateTime(p.reviewedAt)}</div>}
          {p.bankRef && (
            <div>
              Mã giao dịch NH: <span className="font-medium text-stone-800">{p.bankRef}</span>
            </div>
          )}
          {p.paidAt && <div>Đã chuyển khoản lúc: {formatDateTime(p.paidAt)}</div>}
        </div>
      )}

      {actionable && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
          <input
            aria-label="Ghi chú / lý do"
            placeholder={acts.reject ? 'Ghi chú (tuỳ chọn) — BẮT BUỘC khi từ chối' : 'Ghi chú (tuỳ chọn)'}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            className={`${INPUT_CLASS} min-w-[200px] flex-1`}
            disabled={mut.isPending}
          />
          {acts.markPaid && (
            <input
              aria-label="Mã giao dịch ngân hàng"
              placeholder="Mã giao dịch NH (tuỳ chọn)"
              value={bankRef}
              maxLength={100}
              onChange={(e) => setBankRef(e.target.value)}
              className={`${INPUT_CLASS} min-w-[160px] flex-1`}
              disabled={mut.isPending}
            />
          )}
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
              Từ chối (hoàn tiền)
            </button>
          )}
          {acts.markPaid && (
            <button
              type="button"
              onClick={() => run('markPaid')}
              disabled={mut.isPending}
              className={`${TOUCH_H} rounded-control bg-info-fg px-3.5 py-1.5 text-sm font-medium text-stone-0 hover:brightness-90 disabled:bg-stone-200 disabled:text-stone-500`}
            >
              Đã chuyển khoản
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
