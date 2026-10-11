import { Box, Text } from 'zmp-ui';
import type { GameProfile } from '../../services/game-api';
import { formatDrops, formatNumber } from '../../utils/format';

export function GardenHero({
  eco,
  totalSeeds,
  streakDays,
}: {
  eco: GameProfile['ecoImpact'] | undefined;
  totalSeeds: number | undefined;
  streakDays: number | undefined;
}) {
  const pct = eco && eco.target > 0 ? Math.min(100, Math.round((eco.progress / eco.target) * 100)) : 0;
  return (
    <Box
      p={5}
      style={{
        background: 'linear-gradient(160deg, var(--leaf-600), var(--leaf-700))',
        color: 'white',
        textAlign: 'center',
        borderRadius: '0 0 var(--radius-xl) var(--radius-xl)',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <Text style={{ fontSize: 72 }} className="tubu-sway">{pct >= 100 ? '🌳' : pct > 50 ? '🌿' : '🌱'}</Text>
      <Text style={{ color: 'white', fontFamily: 'var(--font-display)', fontSize: 19 }} bold>
        {eco?.treeType ?? 'Vườn của bạn'}
      </Text>
      <Box style={{ background: 'rgba(255,255,255,0.3)', borderRadius: 99, height: 8, margin: '10px 24px' }}>
        <Box style={{ width: `${pct}%`, height: 8, background: 'white', borderRadius: 99, transition: 'width var(--dur-slow) var(--ease-out)' }} />
      </Box>
      <Text size="xSmall" style={{ color: 'white' }}>
        {formatNumber(eco?.progress)}/{formatDrops(eco?.target)} · 💧 {formatNumber(totalSeeds)} · 🔥 {formatNumber(streakDays)} ngày · 🌳 thật: {formatNumber(eco?.treesPlanted)}
      </Text>
    </Box>
  );
}
