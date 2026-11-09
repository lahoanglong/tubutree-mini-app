'use client';

import { useState } from 'react';
import { Award, Check, Gift, Plane, type LucideIcon } from 'lucide-react';
import { useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { claimDealerReward, type DealerRewardsView } from '@tubutree/app-core/api/dealer';
import { dealerRewardsQuery } from '@tubutree/app-core/queries/dealer';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { rewardClaimView, type RewardClaimTone } from '@/lib/dealer-view';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { errText } from './dealer-shell';

const REWARD_ICON: Record<string, LucideIcon> = { TOUR: Plane, GIFT: Gift };
const CLAIM_BADGE_TONE: Record<RewardClaimTone, BadgeTone> = { info: 'info', success: 'success', danger: 'danger', muted: 'neutral' };
const CLAIM_KEY = ['dealer-reward-claim'] as const;
type ClaimVars = { rewardId: string; periodKey: string };
const claimRowKey = (v: ClaimVars) => `${v.rewardId}|${v.periodKey}`;

/** Phần thưởng đại lý (tour/quà): điều kiện, tiến trình đạt mốc và yêu cầu nhận thưởng (admin duyệt). */
export function RewardsCard() {
  const qc = useQueryClient();
  const q = useQuery(dealerRewardsQuery(coreHttp));
  const rewards = q.data?.rewards ?? [];
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  // Lỗi nhớ theo từng dòng: `mutation.error` chỉ giữ lệnh sau cùng nên lệnh của dòng A lỗi sau khi dòng B đã chạy sẽ mất lời báo.
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const dropRowError = (key: string) => setRowErrors((prev) => (prev.has(key) ? new Map([...prev].filter(([k]) => k !== key)) : prev));
  // Khoá theo (phần thưởng, kỳ): chạm lặp vào cùng một dòng thì bỏ qua, hai dòng khác nhau vẫn độc lập.
  const claimMut = useLockedMutation(
    {
      mutationKey: CLAIM_KEY,
      mutationFn: (v: ClaimVars) => claimDealerReward(coreHttp, v.rewardId, v.periodKey),
      onMutate: (v) => dropRowError(claimRowKey(v)),
      onSuccess: (res, v) => {
        setNotice({ text: res.message, error: false });
        // Cập nhật ngay dòng vừa gửi để nút không bật lại trong lúc chờ tải lại.
        qc.setQueryData<DealerRewardsView>(dealerRewardsQuery(coreHttp).queryKey, (old) =>
          old
            ? {
                ...old,
                rewards: old.rewards.map((r) =>
                  r.id === v.rewardId && r.periodKey === v.periodKey ? { ...r, claimStatus: res.claimStatus, claimId: res.claim.id, canClaim: false } : r,
                ),
              }
            : old,
        );
        // Trả lời hứa tải lại: khoá dòng giữ tới khi trạng thái thật của máy chủ về.
        return qc.invalidateQueries({ queryKey: dealerRewardsQuery(coreHttp).queryKey });
      },
      // Hết hạn, tụt doanh số... → tải lại để nút và trạng thái khớp máy chủ.
      onError: (e, v) => {
        setRowErrors((prev) => new Map(prev).set(claimRowKey(v), errText(e)));
        return qc.invalidateQueries({ queryKey: dealerRewardsQuery(coreHttp).queryKey });
      },
    },
    claimRowKey,
  );
  // Mọi dòng đang bay (không chỉ lệnh sau cùng): nút của đúng các dòng đó báo bận, vì khoá theo dòng nuốt cú chạm vào chúng.
  const claimingRows = new Set(useMutationState({ filters: { mutationKey: CLAIM_KEY, status: 'pending' }, select: (m) => claimRowKey(m.state.variables as ClaimVars) }));

  if (!rewards.length) return null;
  return (
    <section aria-label="Phần thưởng đại lý" className={`p-4 ${skin.card}`}>
      <h2 className="mb-2 text-base font-semibold text-stone-900">Phần thưởng đại lý</h2>
      <div role="status" aria-live="polite">
        {notice && <p className={`mb-2 text-sm ${notice.error ? 'text-danger-fg' : 'font-medium text-success-fg'}`}>{notice.text}</p>}
      </div>
      <ul>
        {rewards.map((r) => {
          // threshold=0 (admin cho phép) → 0/0 = NaN; đạt ngay thì 100%.
          const pct = r.threshold > 0 ? Math.min(100, Math.round((r.volume / r.threshold) * 100)) : 100;
          const view = rewardClaimView(r);
          const rowKey = `${r.id}|${r.periodKey}`;
          const RewardIcon = REWARD_ICON[r.type] ?? Award;
          const claiming = claimingRows.has(rowKey);
          const rowError = rowErrors.get(rowKey);
          return (
            <li key={rowKey} className="border-b border-stone-200 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <RewardIcon className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
                  {r.achieved && <Check className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />}
                  <span className={`text-sm ${r.achieved ? 'text-forest-700' : 'text-stone-900'}`}>{r.title}</span>
                </div>
                <span className="whitespace-nowrap text-xs tabular-nums text-stone-600">
                  {formatVnd(r.threshold)}/{r.period === 'YEAR' ? 'năm' : 'quý'}
                </span>
              </div>
              {!r.isCurrentPeriod && <div className="text-xs font-semibold text-stone-900 max-md:text-[var(--color-dealer-ink)]">Kỳ trước · {r.periodLabel}</div>}
              {r.description && <div className="text-xs text-stone-600">{r.description}</div>}
              <div className="mt-1.5">
                <ProgressBar value={pct} max={100} label={`Tiến trình ${r.title}`} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 basis-36 text-xs text-stone-600">{view.hint}</span>
                {view.badge && (
                  <Badge tone={CLAIM_BADGE_TONE[view.badge.tone]} size="sm">
                    {view.badge.label}
                  </Badge>
                )}
                {/* Đang gửi giữ aria-busy/aria-disabled chứ không `disabled`: nút đang giữ focus mà bị vô hiệu thì Chromium thả focus về body. */}
                {view.showClaimButton && (
                  <button
                    type="button"
                    aria-busy={claiming || undefined}
                    aria-disabled={claiming || undefined}
                    onClick={() => {
                      setNotice(null);
                      claimMut.mutate({ rewardId: r.id, periodKey: r.periodKey });
                    }}
                    className={`${ui.btnPrimary} ${skin.dealerInkBtn} flex-none`}
                  >
                    {claiming ? 'Đang gửi…' : 'Yêu cầu nhận thưởng'}
                  </button>
                )}
              </div>
              {rowError && (
                <p role="alert" className={`mt-1.5 ${ui.error}`}>
                  {rowError}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-stone-600">
        Chỉ tính đơn đã thanh toán/ghi công nợ và đã đóng gói. Mốc đạt trong kỳ vẫn gửi yêu cầu được trong {q.data?.claimGraceDays ?? 30} ngày sau khi kỳ kết thúc.
      </p>
    </section>
  );
}
