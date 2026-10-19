import { Droplets } from 'lucide-react';
import type { SeasonLeaderRow } from '@tubutree/app-core/api/game';
import { formatDrops } from './format';
import { GameCard } from './game-card';

// Huy chương top 3 là nội dung xếp hạng của game.
export function SeasonLeaderboard({ rows }: { rows: SeasonLeaderRow[] }) {
  return (
    <GameCard title="Top góp nước mùa này" icon={Droplets}>
      {rows.map((r) => (
        <div key={r.rank} className={`flex justify-between gap-2 py-1.5 ${r.rank > 1 ? 'border-t border-stone-200' : ''}`}>
          <span className="min-w-0 truncate text-sm text-stone-900">
            {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`} {r.nickname}
          </span>
          <span className="flex-none text-xs font-semibold text-forest-700">{formatDrops(r.drops)}</span>
        </div>
      ))}
    </GameCard>
  );
}
