import { Box, Text, Button } from 'zmp-ui';
import type { SeasonPassState, SeasonPassTier } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { GameCard } from './game-card';

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
    <GameCard title={vi.game.seasonPass.title}>
      <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
        {vi.game.seasonPass.subtitle(pass.seasonTitle ?? '')}
      </Text>
      <Box flex justifyContent="space-between" style={{ margin: '10px 0 4px' }}>
        <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
          {vi.game.seasonPass.xp(xp)}
        </Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
          {vi.game.seasonPass.xp(maxXp)}
        </Text>
      </Box>
      <Box style={{ background: 'var(--neutral-100)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
        <Box style={{ width: `${ppct}%`, height: 8, background: 'linear-gradient(90deg, var(--leaf-400), var(--leaf-600))', borderRadius: 99, transition: 'width var(--dur-slow) var(--ease-out)' }} />
      </Box>

      {!pass.premiumEligible && (
        <Text size="xSmall" style={{ color: 'var(--clay-700)', marginTop: 8 }}>
          {vi.game.seasonPass.premiumHint}
        </Text>
      )}

      <Box style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {tiers.map((t: SeasonPassTier) => {
          const busy = (track: 'free' | 'premium') =>
            claimPending && claimVariables?.tier === t.tier && claimVariables?.track === track;
          return (
            <Box
              key={t.tier}
              p={2}
              style={{
                background: t.unlocked ? 'var(--leaf-50)' : 'var(--neutral-100)',
                borderRadius: 'var(--radius-md)',
                opacity: t.unlocked ? 1 : 0.7,
              }}
            >
              <Box flex alignItems="center" justifyContent="space-between" mb={1}>
                <Text size="xSmall" bold>
                  {vi.game.seasonPass.tier(t.tier + 1)}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  {vi.game.seasonPass.xp(t.xpRequired)}
                </Text>
              </Box>
              <Box flex style={{ gap: 8 }}>
                {/* Nhánh miễn phí */}
                <Box style={{ flex: 1, textAlign: 'center' }}>
                  <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                    {vi.game.seasonPass.free}
                  </Text>
                  <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
                    {vi.game.seasonPass.reward(t.free)}
                  </Text>
                  {t.claimedFree ? (
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                      {vi.game.seasonPass.claimed}
                    </Text>
                  ) : (
                    <Button
                      size="small"
                      fullWidth
                      disabled={!t.unlocked || busy('free')}
                      loading={busy('free')}
                      onClick={() => onClaim(t.tier, 'free')}
                      style={{ marginTop: 2, background: 'var(--leaf-600)' }}
                    >
                      {t.unlocked ? vi.game.seasonPass.claim : vi.game.seasonPass.locked}
                    </Button>
                  )}
                </Box>
                {/* Nhánh premium */}
                <Box style={{ flex: 1, textAlign: 'center' }}>
                  <Text size="xSmall" style={{ color: 'var(--sun-700)' }}>
                    ⭐ {vi.game.seasonPass.premium}
                  </Text>
                  <Text size="xSmall" bold style={{ color: 'var(--sun-700)' }}>
                    {vi.game.seasonPass.reward(t.premium)}
                  </Text>
                  {t.claimedPremium ? (
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                      {vi.game.seasonPass.claimed}
                    </Text>
                  ) : (
                    <Button
                      size="small"
                      fullWidth
                      variant="secondary"
                      disabled={!t.unlocked || !pass.premiumEligible || busy('premium')}
                      loading={busy('premium')}
                      onClick={() => onClaim(t.tier, 'premium')}
                      style={{ marginTop: 2 }}
                    >
                      {!t.unlocked
                        ? vi.game.seasonPass.locked
                        : !pass.premiumEligible
                          ? vi.game.seasonPass.locked
                          : vi.game.seasonPass.claim}
                    </Button>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </GameCard>
  );
}
