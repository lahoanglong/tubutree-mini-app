import { Box, Text } from 'zmp-ui';
import type { SeasonLeaderRow } from '../../services/game-api';
import { formatDrops } from '../../utils/format';
import { GameCard } from './game-card';

export function SeasonLeaderboard({ rows }: { rows: SeasonLeaderRow[] }) {
  return (
    <GameCard title="💧 Top góp nước mùa này">
      {rows.map((r) => (
        <Box key={r.rank} flex justifyContent="space-between" style={{ padding: '4px 0', borderTop: r.rank > 1 ? '1px solid var(--neutral-100)' : 'none' }}>
          <Text size="small">
            {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`} {r.nickname}
          </Text>
          <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
            {formatDrops(r.drops)}
          </Text>
        </Box>
      ))}
    </GameCard>
  );
}
