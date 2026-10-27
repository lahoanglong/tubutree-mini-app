'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Trophy } from 'lucide-react';
import { claimCtvMilestone, type CtvMilestoneItem, type CtvMilestonesResponse } from '@tubutree/app-core/api/affiliate';
import { affiliateMilestonesQuery } from '@tubutree/app-core/queries/affiliate';
import { loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { coreHttp } from '@/lib/core-http';
import { invalidateBalances } from '@/lib/balances';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { phoneFlatCard } from '@/lib/phone-ui';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatPoints, milestoneStatusText, monthLabel, revenueRuleText } from './milestone-copy';
import { loadErrorText } from '@/lib/error-text';

interface ClaimTarget {
  id: string;
  month: string;
  title: string;
  points: number;
}

interface ClaimFailure {
  id: string;
  month: string;
  title: string;
  message: string;
}

const errText = loadErrorText;

const toTargets = (items: CtvMilestoneItem[], month: string): ClaimTarget[] =>
  items.filter((m) => m.canClaim).map((m) => ({ id: m.id, month, title: m.title, points: m.rewardPoints }));

/**
 * Thưởng mốc doanh số tháng (Điểm Xanh): mỗi mốc một dòng gọn, và "Nhận tất cả" khi có từ hai mốc nhận được.
 * Nhận tất cả chỉ gọi lần lượt API nhận từng mốc sẵn có (không có API gộp), tháng trước trước vì hết hạn sớm hơn;
 * mốc nào lỗi thì báo đúng tên mốc và tháng, các mốc còn lại vẫn được nhận.
 */
export function MilestoneRewards({ data }: { data: CtvMilestonesResponse }) {
  const qc = useQueryClient();
  const [failures, setFailures] = useState<ClaimFailure[]>([]);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' } | null>(null);

  const prev = data.previousMonth;
  const targets = [...(prev ? toTargets(prev.milestones, prev.monthKey) : []), ...toTargets(data.milestones, data.monthKey)];

  // Thưởng cộng Điểm Xanh (lô thường): làm mới số điểm ở thẻ tài khoản, Ví và trang Điểm Xanh.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: affiliateMilestonesQuery(coreHttp).queryKey });
    void qc.invalidateQueries({ queryKey: loyaltyQuery(coreHttp).queryKey });
    invalidateBalances(qc);
  };

  const claimOne = useMutation({
    mutationFn: (t: ClaimTarget) => claimCtvMilestone(coreHttp, t.id, t.month),
    onMutate: () => {
      setFailures([]);
      setNotice(null);
    },
    onSuccess: (res) => {
      setNotice({ text: res.message || 'Đã nhận thưởng mốc thành công!', tone: 'ok' });
      refresh();
    },
    onError: (e) => {
      setNotice({ text: errText(e), tone: 'error' });
      // Lỗi "đã nhận"/"chưa đạt" → trạng thái trên máy đã cũ, tải lại để nút khớp backend.
      void qc.invalidateQueries({ queryKey: affiliateMilestonesQuery(coreHttp).queryKey });
    },
  });

  const claimAll = useMutation({
    mutationFn: async (list: ClaimTarget[]) => {
      const failed: ClaimFailure[] = [];
      for (const t of list) {
        try {
          await claimCtvMilestone(coreHttp, t.id, t.month);
        } catch (e) {
          failed.push({ id: t.id, month: t.month, title: t.title, message: errText(e) });
        }
      }
      return { total: list.length, failed };
    },
    onMutate: () => {
      setFailures([]);
      setNotice(null);
    },
    onSuccess: ({ total, failed }) => {
      setFailures(failed);
      const done = total - failed.length;
      if (failed.length === 0) setNotice({ text: `Đã nhận ${done} mốc thưởng.`, tone: 'ok' });
      else if (done === 0) setNotice({ text: 'Chưa nhận được mốc nào. Xem lý do bên dưới.', tone: 'error' });
      else setNotice({ text: `Đã nhận ${done}/${total} mốc. Có ${failed.length} mốc chưa nhận được, xem bên dưới.`, tone: 'warn' });
      refresh();
    },
  });

  if (data.milestones.length === 0 && targets.length === 0) return null;

  const busy = claimOne.isPending || claimAll.isPending;
  const totalPoints = targets.reduce((s, t) => s + t.points, 0);

  const renderRow = (m: CtvMilestoneItem, month: string, revenue: number) => (
    <li key={`${month}:${m.id}`} className="flex min-h-14 items-center gap-2.5 border-b border-stone-200 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-stone-900">{m.title}</div>
        <div className="text-xs text-stone-600">{milestoneStatusText(m, revenue)}</div>
        {!m.achieved && (
          <div className="mt-1.5">
            <ProgressBar value={m.progressPct} max={100} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold text-forest-700">+{formatPoints(m.rewardPoints)}</span>
        {m.canClaim ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => claimOne.mutate({ id: m.id, month, title: m.title, points: m.rewardPoints })}
            className={`${ui.btnPrimary} gap-1`}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Nhận thưởng
          </button>
        ) : m.claimed ? (
          <Badge size="sm">Đã nhận</Badge>
        ) : null}
      </div>
    </li>
  );

  return (
    <section aria-label="Thưởng mốc doanh số tháng" className={`${ui.card} ${phoneFlatCard} p-4`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-forest-50">
          <Trophy className="h-5 w-5 text-forest-600" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-stone-900">Thưởng mốc doanh số tháng</h2>
          <div className="text-xs text-stone-600">
            {monthLabel(data.monthKey)} · Đã chốt {formatVnd(data.currentRevenue)}
          </div>
        </div>
      </div>

      <p className="mb-1 text-xs text-stone-600">{revenueRuleText(data.holdDays)}</p>
      {data.pendingRevenue > 0 && (
        <p className="mb-2 text-xs text-stone-700">
          Đang chờ chốt: <b>{formatVnd(data.pendingRevenue)}</b> (đơn chưa giao hoặc đang trong thời gian giữ đổi/trả — chưa tính vào mốc)
        </p>
      )}

      {targets.length >= 2 && (
        <button type="button" disabled={busy} aria-busy={claimAll.isPending} onClick={() => claimAll.mutate(targets)} className={`${ui.btnPrimary} mb-2 w-full gap-1`}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {`Nhận tất cả (${targets.length} mốc, +${formatPoints(totalPoints)})`}
        </button>
      )}

      <div role="status" aria-live="polite">
        {notice && (
          <p className={`mb-2 text-sm ${notice.tone === 'error' ? 'text-danger-fg' : notice.tone === 'warn' ? 'text-warning-fg' : 'font-medium text-success-fg'}`}>
            {notice.text}
          </p>
        )}
      </div>
      {failures.length > 0 && (
        <div role="alert" className="mb-2">
          {failures.map((f) => (
            <div key={`${f.month}:${f.id}`} className="text-xs text-danger-fg">
              {f.title} ({monthLabel(f.month)}): {f.message}
            </div>
          ))}
        </div>
      )}

      {prev && (
        <div>
          <div className="mt-2 text-xs font-semibold text-forest-700">
            Thưởng {monthLabel(prev.monthKey)} chưa nhận — nhận trước khi hết {monthLabel(data.monthKey)}
          </div>
          <ul>{prev.milestones.map((m) => renderRow(m, prev.monthKey, prev.revenue))}</ul>
        </div>
      )}
      <ul>{data.milestones.map((m) => renderRow(m, data.monthKey, data.currentRevenue))}</ul>
    </section>
  );
}
