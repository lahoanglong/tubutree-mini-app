import { Check, Lock, Star, Ticket } from 'lucide-react';
import type { SeasonPassReward, SeasonPassState, SeasonPassTier } from '@tubutree/app-core/api/game';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { formatDrops, formatNumber, formatPoints } from './format';
import { GameCard } from './game-card';

type Track = 'free' | 'premium';

const xpText = (n: number) => `${formatNumber(n)} điểm kinh nghiệm`;
const rewardText = (r: SeasonPassReward) => (r.type === 'SEEDS' ? formatDrops(r.amount) : formatPoints(r.amount));

function ClaimedMark() {
  return (
    <div className="mt-1 flex items-center justify-center gap-1 text-xs text-stone-600">
      <Check className="h-4 w-4" aria-hidden="true" />
      Đã nhận
    </div>
  );
}

// Chặng Mùa (Season Pass) — ladder bậc XP theo điểm danh
export function SeasonPass({
  pass,
  claimPending,
  claimVariables,
  onClaim,
}: {
  pass: SeasonPassState;
  claimPending: boolean;
  claimVariables: { tier: number; track: Track } | undefined;
  onClaim: (tier: number, track: Track) => void;
}) {
  const tiers = pass.tiers ?? [];
  const xp = pass.xp ?? 0;
  const maxXp = tiers[tiers.length - 1]?.xpRequired ?? 1;
  const ppct = maxXp > 0 ? Math.min(100, Math.round((xp / maxXp) * 100)) : 0;
  return (
    <GameCard title="Chặng Mùa" icon={Ticket}>
      <p className="text-xs text-stone-700">{`Điểm danh mỗi ngày để lên bậc mùa "${pass.seasonTitle ?? ''}"`}</p>
      <div className="mb-1 mt-2.5 flex justify-between text-xs">
        <span className="font-semibold text-forest-700">{xpText(xp)}</span>
        <span className="text-stone-600">{xpText(maxXp)}</span>
      </div>
      <ProgressBar value={ppct} max={100} />

      {!pass.premiumEligible && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-promo-fg">
          <Lock className="h-4 w-4 flex-none" aria-hidden="true" />
          Cần đăng ký định kỳ để mở phần thưởng Cao cấp.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {tiers.map((t: SeasonPassTier) => {
          const busy = (track: Track) => claimPending && claimVariables?.tier === t.tier && claimVariables?.track === track;
          const premiumLocked = !t.unlocked || !pass.premiumEligible;
          return (
            // Bậc khoá khác bậc mở bằng nền trắng + viền nét đứt, không làm mờ: chữ phải giữ ≥ 4,5:1.
            <div
              key={t.tier}
              className={`rounded-control border p-3 ${t.unlocked ? 'border-transparent bg-stone-50' : 'border-dashed border-[color:var(--color-border-strong)] bg-stone-0'}`}
            >
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-semibold text-stone-900">{`Bậc ${t.tier + 1}`}</span>
                <span className="text-stone-600">{xpText(t.xpRequired)}</span>
              </div>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1 text-center">
                  <div className="text-xs text-stone-700">Miễn phí</div>
                  <div className="text-xs font-semibold text-forest-700">{rewardText(t.free)}</div>
                  {t.claimedFree ? (
                    <ClaimedMark />
                  ) : (
                    <button
                      type="button"
                      disabled={!t.unlocked || busy('free')}
                      onClick={() => onClaim(t.tier, 'free')}
                      className={`${ui.btnPrimary} mt-1 w-full gap-1`}
                    >
                      {!t.unlocked && <Lock className="h-4 w-4" aria-hidden="true" />}
                      {t.unlocked ? 'Nhận' : 'Chưa mở'}
                    </button>
                  )}
                </div>
                <div className="min-w-0 flex-1 text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-honey-600">
                    <Star className="h-4 w-4" aria-hidden="true" />
                    Cao cấp
                  </div>
                  <div className="text-xs font-semibold text-honey-600">{rewardText(t.premium)}</div>
                  {t.claimedPremium ? (
                    <ClaimedMark />
                  ) : (
                    <button
                      type="button"
                      disabled={premiumLocked || busy('premium')}
                      onClick={() => onClaim(t.tier, 'premium')}
                      className={`${miniBtnSecondary} mt-1 w-full gap-1`}
                    >
                      {premiumLocked && <Lock className="h-4 w-4" aria-hidden="true" />}
                      {premiumLocked ? 'Chưa mở' : 'Nhận'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </GameCard>
  );
}
