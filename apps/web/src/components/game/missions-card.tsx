import { Check, Target } from 'lucide-react';
import type { MissionItem } from '@tubutree/app-core/api/game';
import { gameNewbieCopy, missionTarget, type MissionTarget } from '@tubutree/app-core/game-newbie';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { formatNumber } from './format';
import { GameCard } from './game-card';

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
  return (
    <GameCard title="Nhiệm vụ" icon={Target}>
      {missions && missions.length > 0 ? (
        missions.map((m, idx) => {
          // BE Mission.goal mặc định = 1: "> 1" từng loại bỏ nhầm mọi nhiệm vụ cấu hình goal=1 hợp lệ.
          const goal = m.goal && m.goal > 0 ? m.goal : (DEFAULT_GOALS[m.code] ?? 1);
          const rawProgress = m.code === 'CHECKIN_7' ? Math.min(goal, streakDays ?? m.progress ?? 0) : (m.progress ?? 0);
          const progress = Math.min(goal, rawProgress);
          const isDone = m.completed || progress >= goal;
          // "Đạt điều kiện" và "đã nhận thưởng" là hai việc: dấu ✓ chỉ khi đã nhận (thưởng thật đã vào Điểm Xanh),
          // đạt mà chưa nhận thì hiện nút "Nhận thưởng".
          const canClaim = isDone && !m.claimed;
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
                <span className="whitespace-nowrap text-caption text-forest-700">+{formatNumber(m.rewardPoints)} Điểm Xanh</span>
              </div>
              {m.description && <div className="text-caption text-stone-600">{m.description}</div>}
              <div className="mt-2">
                <ProgressBar
                  value={Math.round((progress / Math.max(1, goal)) * 100)}
                  max={100}
                  ariaLabel={gameNewbieCopy.missions.progressLabel(m.title, progress, goal)}
                />
              </div>
              <div className="mt-0.5 text-caption text-stone-600">
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
                <button type="button" disabled={claiming} onClick={() => onClaim(m.code)} className={`${ui.btnPrimary} mt-2 w-full`}>
                  Nhận thưởng
                </button>
              )}
            </div>
          );
        })
      ) : (
        <p className="text-sm text-stone-600">Chưa có nhiệm vụ.</p>
      )}
    </GameCard>
  );
}
