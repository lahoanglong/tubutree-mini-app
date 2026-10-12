import { Droplets } from 'lucide-react';
import type { SeasonLeaderRow } from '../../services/game-api';
import { formatDrops } from '../../utils/format';
import { Text } from '../ui/text';
import { GameCard } from './game-card';

// Huy chương top 3 là nội dung xếp hạng của game.
export function SeasonLeaderboard({ rows }: { rows: SeasonLeaderRow[] }) {
  return (
    <GameCard title="Top góp nước mùa này" icon={Droplets}>
      {rows.map((r) => (
        <div
          key={r.rank}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 0',
            borderTop: r.rank > 1 ? '1px solid var(--color-border-subtle)' : 'none',
          }}
        >
          <Text variant="body-sm">
            {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`} {r.nickname}
          </Text>
          <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
            {formatDrops(r.drops)}
          </Text>
        </div>
      ))}
    </GameCard>
  );
}
