'use client';

import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Trophy } from 'lucide-react';
import { nextMilestoneRows } from '@tubutree/app-core/ctv-dashboard';
import { claimCtvMilestone, type CtvMilestoneItem, type CtvMilestonesResponse } from '@tubutree/app-core/api/affiliate';
import { affiliateMilestonesQuery } from '@tubutree/app-core/queries/affiliate';
import { loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { coreHttp } from '@/lib/core-http';
import { invalidateBalances } from '@/lib/balances';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { phoneBodySm, phoneCaption, phoneFlatCard } from '@/lib/phone-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/mini/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatPoints, milestoneStatusText, monthLabel, revenueRuleText } from './milestone-copy';
import { actionErrorText, loadErrorText } from '@/lib/error-text';

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
const actErrText = actionErrorText;

const toTargets = (items: CtvMilestoneItem[], month: string): ClaimTarget[] =>
  items.filter((m) => m.canClaim).map((m) => ({ id: m.id, month, title: m.title, points: m.rewardPoints }));

/**
 * Thưởng mốc doanh số tháng (Điểm Xanh): mỗi mốc một dòng gọn, và "Nhận tất cả" khi có từ hai mốc nhận được.
 * Nhận tất cả chỉ gọi lần lượt API nhận từng mốc sẵn có (không có API gộp), tháng trước trước vì hết hạn sớm hơn;
 * mốc nào lỗi thì báo đúng tên mốc và tháng, các mốc còn lại vẫn được nhận.
 */
export function MilestoneRewards({ data }: { data: CtvMilestonesResponse }) {
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [failures, setFailures] = useState<ClaimFailure[]>([]);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' } | null>(null);
  const listId = useId();
  // Khoá đồng bộ dùng chung cho "Nhận thưởng" và "Nhận tất cả": `busy` chỉ đổi sau lần vẽ kế, hai cú bấm trong cùng một nhịp sẽ gọi API hai lần.
  const claimingRef = useRef(false);
  const release = () => {
    claimingRef.current = false;
  };

  const prev = data.previousMonth;
  const targets = [...(prev ? toTargets(prev.milestones, prev.monthKey) : []), ...toTargets(data.milestones, data.monthKey)];

  const refreshMilestones = () => {
    void qc.invalidateQueries({ queryKey: affiliateMilestonesQuery(coreHttp).queryKey });
  };
  // Thưởng cộng Điểm Xanh (lô thường): làm mới số điểm ở thẻ tài khoản, Ví và trang Điểm Xanh.
  const refreshBalances = () => {
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
      refreshMilestones();
      refreshBalances();
    },
    onError: (e) => {
      setNotice({ text: actErrText(e), tone: 'error' });
      // Lỗi "đã nhận"/"chưa đạt" → trạng thái trên máy đã cũ, tải lại để nút khớp backend.
      refreshMilestones();
    },
    onSettled: release,
  });

  const claimAll = useMutation({
    mutationFn: async (list: ClaimTarget[]) => {
      const failed: ClaimFailure[] = [];
      for (const t of list) {
        try {
          await claimCtvMilestone(coreHttp, t.id, t.month);
        } catch (e) {
          failed.push({ id: t.id, month: t.month, title: t.title, message: actErrText(e) });
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
      refreshMilestones();
      // Không mốc nào nhận được thì điểm không đổi: khỏi tải lại Điểm Xanh và số dư vô ích.
      if (done > 0) refreshBalances();
    },
    onSettled: release,
  });

  if (data.milestones.length === 0 && targets.length === 0) return null;

  const busy = claimOne.isPending || claimAll.isPending;
  const totalPoints = targets.reduce((s, t) => s + t.points, 0);

  const startClaimOne = (t: ClaimTarget) => {
    if (busy || claimingRef.current) return;
    claimingRef.current = true;
    claimOne.mutate(t);
  };
  const startClaimAll = () => {
    if (busy || claimingRef.current) return;
    claimingRef.current = true;
    claimAll.mutate(targets);
  };

  const renderRow = (m: CtvMilestoneItem, month: string, revenue: number) => (
    <li key={`${month}:${m.id}`} data-testid="milestone-row" className="flex min-h-14 items-center gap-2.5 border-b border-stone-200 py-2">
      <div className="min-w-0 flex-1">
        <div data-testid="milestone-row-title" className={`text-sm font-semibold text-stone-900 ${phoneBodySm}`}>{m.title}</div>
        <div data-testid="milestone-row-meta" className={`text-xs text-[var(--color-text-tertiary)] ${phoneCaption}`}>{milestoneStatusText(m, revenue)}</div>
        {!m.achieved && (
          <div className="mt-1.5">
            <ProgressBar value={m.progressPct} max={100} ariaLabel={`${m.title}: tiến độ mốc thưởng`} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`text-sm font-semibold text-[var(--color-text-brand)] ${phoneBodySm}`}>+{formatPoints(m.rewardPoints)}</span>
        {m.canClaim ? (
          <Button
            icon={Check}
            disabled={busy}
            loading={claimOne.isPending && claimOne.variables?.id === m.id && claimOne.variables?.month === month}
            onPress={() => startClaimOne({ id: m.id, month, title: m.title, points: m.rewardPoints })}
          >
            Nhận thưởng
          </Button>
        ) : m.claimed ? (
          <Badge size="sm">Đã nhận</Badge>
        ) : null}
      </div>
    </li>
  );

  return (
    <section aria-label="Thưởng mốc doanh số tháng" data-testid="milestone-rewards" className={`${ui.card} ${phoneFlatCard} p-4`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-forest-50">
          <Trophy className="h-5 w-5 text-forest-600" aria-hidden="true" />
        </span>
        <div>
          <h2 data-testid="milestone-title" className={`text-sm font-semibold text-stone-900 ${phoneBodySm}`}>Thưởng mốc doanh số tháng</h2>
          <div data-testid="milestone-meta" className={`text-xs text-[var(--color-text-tertiary)] ${phoneCaption}`}>
            {monthLabel(data.monthKey)} · Đã chốt {formatVnd(data.currentRevenue)}
          </div>
        </div>
      </div>

      <p data-testid="milestone-note" className={`mb-1 text-xs text-[var(--color-text-tertiary)] ${phoneCaption}`}>{revenueRuleText(data.holdDays)}</p>
      {data.pendingRevenue > 0 && (
        <p className={`mb-2 text-xs text-[var(--color-text-secondary)] ${phoneCaption}`}>
          Đang chờ chốt: <b>{formatVnd(data.pendingRevenue)}</b> (đơn chưa giao hoặc đang trong thời gian giữ đổi/trả — chưa tính vào mốc)
        </p>
      )}

      {targets.length >= 2 && (
        <Button fullWidth icon={Check} disabled={claimOne.isPending} loading={claimAll.isPending} onPress={startClaimAll} className="mb-2">
          {`Nhận tất cả (${targets.length} mốc, +${formatPoints(totalPoints)})`}
        </Button>
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
            <div key={`${f.month}:${f.id}`} className={`text-xs text-danger-fg ${phoneCaption}`}>
              {f.title} ({monthLabel(f.month)}): {f.message}
            </div>
          ))}
        </div>
      )}

      {prev && (
        <div>
          <div className={`mt-2 text-xs font-semibold text-[var(--color-text-brand)] ${phoneCaption}`}>
            Thưởng {monthLabel(prev.monthKey)} chưa nhận — nhận trước khi hết {monthLabel(data.monthKey)}
          </div>
          <ul>{prev.milestones.map((m) => renderRow(m, prev.monthKey, prev.revenue))}</ul>
        </div>
      )}
      <ul id={listId}>{(showAll ? data.milestones : nextMilestoneRows(data.milestones)).map((m) => renderRow(m, data.monthKey, data.currentRevenue))}</ul>
      {data.milestones.length > nextMilestoneRows(data.milestones).length && (
        <button type="button" aria-expanded={showAll} aria-controls={listId} onClick={() => setShowAll((v) => !v)} className={`mt-1 min-h-11 w-full text-sm font-semibold text-[var(--color-text-brand)] ${phoneBodySm}`}>
          {showAll ? 'Thu gọn' : `Xem tất cả ${data.milestones.length} mốc`}
        </button>
      )}
    </section>
  );
}
