import { useState } from 'react';
import { Check, Target } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DailyMissionId, DailyMissionsResponse } from '@tubutree/shared-types';
import type { MissionItem } from '@tubutree/app-core/api/game';
import { gameNewbieCopy, missionTarget, type MissionTarget } from '@tubutree/app-core/game-newbie';
import { collapseMissions, gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import { DAILY_MISSIONS_KEY, claimDailyMission, classifyDailyClaimError, dailyClaimErrorCopy, dailyMissionsQuery } from '@tubutree/app-core/engagement/api';
import { dailyBonusLine, dailyClaimToast, dailyProgress, dailyRows } from '@tubutree/app-core/engagement/view';
import { miniDeviceId } from '@tubutree/app-core/game-mini/api';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ui, uiBar } from '@/lib/guest-ui';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { browserStorage } from '@/lib/recently-viewed';
import { settleWithin } from '@/lib/settle-within';
import { GuestPointsNote } from '@/components/loyalty/guest-points-note';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { formatNumber } from './format';
import { GameCard } from './game-card';
import { GameNoticeBar, useGameNotice } from './game-notice';

const DEFAULT_GOALS: Record<string, number> = { CHECKIN_7: 7, REVIEW_3: 3, INVITE_3: 3, FIRST_ORDER: 1 };

export function MissionsCard({
  missions,
  streakDays,
  claimPending,
  claimVariables,
  onClaim,
  onGo,
}: {
  missions: MissionItem[] | undefined;
  streakDays: number | undefined;
  claimPending: boolean;
  claimVariables: string | undefined;
  onClaim: (code: string) => void;
  /** Bấm "Làm ngay" trên nhiệm vụ chưa xong; thiếu thì không hiện nút. */
  onGo?: (target: MissionTarget) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showOneTime, setShowOneTime] = useState(false);
  const { items, collapsible } = collapseMissions(missions ?? [], showAll);
  const authed = useAuthPhase() === 'authenticated';
  const dailyQ = useQuery({ ...dailyMissionsQuery(coreHttp), enabled: authed });
  const daily = dailyQ.data?.enabled ? dailyQ.data : undefined;
  // Khách vãng lai: tiến độ vẫn tính nhưng không hứa điểm và không có nút nhận thưởng; một câu mời đăng nhập cho cả thẻ.
  const guest = (missions ?? []).some((m) => m.pointsBlocked) || daily?.pointsBlocked === true;
  // Nhiệm vụ hằng ngày bật: phần Hôm nay đứng đầu, nhiệm vụ một lần thu lại sau một nút để thẻ không dài thêm; có thưởng đang chờ nhận thì
  // để mở sẵn, không giấu nút Nhận thưởng sau nút gập.
  const oneTimeClaimable = (missions ?? []).some((m) => m.completed && !m.claimed && !m.pointsBlocked);
  const oneTimeOpen = !daily || showOneTime || oneTimeClaimable;
  return (
    <GameCard title="Nhiệm vụ" icon={Target}>
      {guest && <GuestPointsNote margin="0 0 4px" />}
      {daily && <DailySection data={daily} onGo={onGo} />}
      {daily && missions && missions.length > 0 && !oneTimeClaimable && (
        <button type="button" aria-expanded={showOneTime} onClick={() => setShowOneTime((v) => !v)} className={`${miniBtnSecondary} mt-1 w-full`}>
          {showOneTime ? fillCopy('daily.oneTimeHide') : fillCopy('daily.oneTimeShow', { n: missions.length })}
        </button>
      )}
      {!oneTimeOpen ? null : missions && missions.length > 0 ? (
        items.map((m, idx) => {
          // BE Mission.goal mặc định = 1: "> 1" từng loại bỏ nhầm mọi nhiệm vụ cấu hình goal=1 hợp lệ.
          const goal = m.goal && m.goal > 0 ? m.goal : (DEFAULT_GOALS[m.code] ?? 1);
          const rawProgress = m.code === 'CHECKIN_7' ? Math.min(goal, streakDays ?? m.progress ?? 0) : (m.progress ?? 0);
          const progress = Math.min(goal, rawProgress);
          const isDone = m.completed || progress >= goal;
          // "Đạt điều kiện" và "đã nhận thưởng" là hai việc: dấu ✓ chỉ khi đã nhận (thưởng thật đã vào Điểm Xanh),
          // đạt mà chưa nhận thì hiện nút "Nhận thưởng".
          const canClaim = isDone && !m.claimed && !m.pointsBlocked;
          const claiming = claimPending && claimVariables === m.code;
          const target = !isDone && onGo ? missionTarget(m.code, m.kind) : null;

          return (
            <div key={m.code} className={`py-3 ${idx > 0 ? 'border-t border-stone-200' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1 text-sm ${m.claimed ? 'text-stone-600' : 'font-semibold text-stone-900'}`}>
                  {m.claimed && <Check className="h-4 w-4 text-forest-600" aria-hidden="true" />}
                  {m.title}
                  {m.claimed && <span className="sr-only"> (đã nhận thưởng)</span>}
                </span>
                {!m.pointsBlocked && <span className="whitespace-nowrap text-caption text-forest-700">+{formatNumber(m.rewardPoints)} Điểm Xanh</span>}
              </div>
              {m.description && <div className="text-caption text-stone-600">{m.description}</div>}
              <div className="mt-2">
                <ProgressBar
                  value={Math.round((progress / Math.max(1, goal)) * 100)}
                  max={100}
                  ariaLabel={gameNewbieCopy.missions.progressLabel(m.title, progress, goal)}
                />
              </div>
              <div className="mt-0.5 text-caption tabular-nums text-stone-600">
                {progress}/{goal}
              </div>
              {target && (
                <button
                  type="button"
                  aria-label={gameNewbieCopy.missions.doNowFor(m.title)}
                  onClick={() => onGo?.(target)}
                  className={`${miniBtnSecondary} mt-2 w-full`}
                >
                  {gameNewbieCopy.missions.doNow}
                </button>
              )}
              {canClaim && (
                <button
                  type="button"
                  aria-busy={claiming || undefined}
                  aria-disabled={claiming || undefined}
                  onClick={() => {
                    if (claiming) return;
                    onClaim(m.code);
                  }}
                  className={`${ui.btnPrimary} mt-2 w-full`}
                >
                  Nhận thưởng
                </button>
              )}
            </div>
          );
        })
      ) : daily ? null : (
        <p className="text-sm text-stone-600">Chưa có nhiệm vụ.</p>
      )}
      {oneTimeOpen && (collapsible || showAll) && missions && missions.length > 0 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className={`${miniBtnSecondary} mt-1 w-full`}>
          {showAll ? gameMoreCopy.missionsShowLess : gameMoreCopy.missionsShowAll(missions.length)}
        </button>
      )}
    </GameCard>
  );
}

/**
 * Phần "Hôm nay" của thẻ Nhiệm vụ (cờ engagement.daily_missions_enabled): 3 dòng gọn, mỗi dòng một nút (Làm hoặc Nhận), dòng thưởng ngày
 * bên dưới. Nhận thưởng gửi mã thiết bị game; thưởng thật sau trần chung của game mini báo bằng thông báo ngắn (như snackbar Mini App).
 */
function DailySection({ data, onGo }: { data: DailyMissionsResponse; onGo?: (target: MissionTarget) => void }) {
  const qc = useQueryClient();
  const { notice, notify } = useGameNotice();
  const rows = dailyRows(data);
  const bonus = dailyBonusLine(data);
  const claim = useMutation({
    mutationFn: (id: DailyMissionId) =>
      claimDailyMission(coreHttp, id, miniDeviceId(browserStorage(), (n) => crypto.getRandomValues(new Uint8Array(n)))),
    onSuccess: (res) => {
      notify(dailyClaimToast(res), res.water > 0 || res.points > 0 ? 'success' : 'info');
      void qc.invalidateQueries({ queryKey: ['loyalty'] });
      void qc.invalidateQueries({ queryKey: ['points-txn'] });
      // Khoá nút giữ tới khi phần Hôm nay tải lại (dòng thành "đã nhận"), có trần chờ: bấm lại lúc dòng còn cũ chỉ ra 409.
      return settleWithin(qc.invalidateQueries({ queryKey: ['game'] }));
    },
    onError: (err) => {
      const kind = classifyDailyClaimError(err);
      notify(fillCopy(dailyClaimErrorCopy(kind)), kind === 'stale' ? 'info' : 'error');
      return settleWithin(qc.invalidateQueries({ queryKey: DAILY_MISSIONS_KEY }));
    },
  });
  return (
    <section aria-label={fillCopy('daily.today')} data-testid="daily-missions" className="mb-1">
      <div className="flex items-center justify-between">
        <h3 className="text-label text-stone-500">{fillCopy('daily.today')}</h3>
        <span className="text-caption tabular-nums text-stone-600">{dailyProgress(data)}</span>
      </div>
      {rows.map((r) => {
        const busy = claim.isPending && claim.variables === r.id;
        return (
          <div key={r.id} data-testid={`daily-row-${r.id}`} className="tubu-daily-row">
            <div className="min-w-0 flex-1">
              <div className={`flex items-center gap-1 text-sm ${r.state === 'claimed' ? 'text-stone-500' : 'font-semibold text-stone-900'}`}>
                {(r.state === 'claimed' || r.state === 'done') && <Check className="h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />}
                {r.title}
              </div>
              {r.reward && <div className="text-caption tabular-nums text-forest-700">{r.reward}</div>}
            </div>
            {r.state === 'claimable' && (
              <button
                type="button"
                aria-label={r.aria}
                aria-busy={busy || undefined}
                aria-disabled={claim.isPending || undefined}
                onClick={() => {
                  if (claim.isPending) return;
                  claim.mutate(r.id);
                }}
                className={uiBar.primary}
              >
                {fillCopy('daily.claim')}
              </button>
            )}
            {r.state === 'todo' && onGo && (
              <button type="button" aria-label={r.aria} onClick={() => onGo(r.target)} className={miniBtnSecondary.replace('px-5', 'px-3')}>
                {fillCopy('daily.go')}
              </button>
            )}
            {(r.state === 'claimed' || r.state === 'done') && <span className="sr-only">{r.aria}</span>}
          </div>
        );
      })}
      {bonus && <p className={`mt-1 text-caption ${data.bonusClaimed ? 'text-stone-500' : 'text-forest-700'}`}>{bonus}</p>}
      <GameNoticeBar notice={notice} />
    </section>
  );
}
