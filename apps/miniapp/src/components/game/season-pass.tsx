import { Check, Lock, Star, Ticket } from 'lucide-react';
import type { SeasonPassState, SeasonPassTier } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { ProgressBar } from '../ui/progress-bar';
import { Text } from '../ui/text';
import { GameCard } from './game-card';

const INLINE_ICON_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 } as const;

function ClaimedMark() {
  return (
    <Text variant="caption" tone="tertiary" as="div" style={INLINE_ICON_STYLE}>
      <Icon icon={Check} size="sm" tone="current" />
      {vi.game.seasonPass.claimed}
    </Text>
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
  claimVariables: { tier: number; track: 'free' | 'premium' } | undefined;
  onClaim: (tier: number, track: 'free' | 'premium') => void;
}) {
  const tiers = pass.tiers ?? [];
  const xp = pass.xp ?? 0;
  const maxXp = tiers[tiers.length - 1]?.xpRequired ?? 1;
  const ppct = maxXp > 0 ? Math.min(100, Math.round((xp / maxXp) * 100)) : 0;
  return (
    <GameCard title={vi.game.seasonPass.title} icon={Ticket}>
      <Text variant="caption" tone="secondary" as="div">
        {vi.game.seasonPass.subtitle(pass.seasonTitle ?? '')}
      </Text>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 4px' }}>
        <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
          {vi.game.seasonPass.xp(xp)}
        </Text>
        <Text variant="caption" tone="tertiary">
          {vi.game.seasonPass.xp(maxXp)}
        </Text>
      </div>
      <ProgressBar value={ppct} max={100} />

      {!pass.premiumEligible && (
        <Text variant="caption" as="div" style={{ color: 'var(--color-promo-fg)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon icon={Lock} size="sm" tone="current" />
          {vi.game.seasonPass.premiumHint}
        </Text>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {tiers.map((t: SeasonPassTier) => {
          const busy = (track: 'free' | 'premium') =>
            claimPending && claimVariables?.tier === t.tier && claimVariables?.track === track;
          const premiumLocked = !t.unlocked || !pass.premiumEligible;
          return (
            <div
              key={t.tier}
              style={{
                padding: 12,
                background: t.unlocked ? 'var(--color-bg-subtle)' : 'var(--stone-100)',
                borderRadius: 'var(--radius-control)',
                opacity: t.unlocked ? 1 : 0.7,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text variant="caption" style={{ fontWeight: 600 }}>
                  {vi.game.seasonPass.tier(t.tier + 1)}
                </Text>
                <Text variant="caption" tone="tertiary">
                  {vi.game.seasonPass.xp(t.xpRequired)}
                </Text>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* Nhánh miễn phí */}
                <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                  <Text variant="caption" tone="secondary" as="div">
                    {vi.game.seasonPass.free}
                  </Text>
                  <Text variant="caption" tone="brand" as="div" style={{ fontWeight: 600 }}>
                    {vi.game.seasonPass.reward(t.free)}
                  </Text>
                  {t.claimedFree ? (
                    <ClaimedMark />
                  ) : (
                    <Button
                      fullWidth
                      disabled={!t.unlocked || busy('free')}
                      loading={busy('free')}
                      icon={t.unlocked ? undefined : Lock}
                      onPress={() => onClaim(t.tier, 'free')}
                      style={{ marginTop: 4 }}
                    >
                      {t.unlocked ? vi.game.seasonPass.claim : vi.game.seasonPass.locked}
                    </Button>
                  )}
                </div>
                {/* Nhánh premium */}
                <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                  <Text
                    variant="caption"
                    as="div"
                    style={{ color: 'var(--honey-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                  >
                    <Icon icon={Star} size="sm" style={{ stroke: 'var(--honey-600)' }} />
                    {vi.game.seasonPass.premium}
                  </Text>
                  <Text variant="caption" as="div" style={{ color: 'var(--honey-600)', fontWeight: 600 }}>
                    {vi.game.seasonPass.reward(t.premium)}
                  </Text>
                  {t.claimedPremium ? (
                    <ClaimedMark />
                  ) : (
                    <Button
                      fullWidth
                      variant="secondary"
                      disabled={premiumLocked || busy('premium')}
                      loading={busy('premium')}
                      icon={premiumLocked ? Lock : undefined}
                      onPress={() => onClaim(t.tier, 'premium')}
                      style={{ marginTop: 4 }}
                    >
                      {premiumLocked ? vi.game.seasonPass.locked : vi.game.seasonPass.claim}
                    </Button>
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
