import { BookOpen } from 'lucide-react';
import type { CodexEntry } from '@tubutree/app-core/api/game';
import { GameCard } from './game-card';
import { rarityBorder } from './game-utils';

// Sổ tay loài cây (Phase 3) — sưu tập khi thu hoạch. Emoji loài và ❔ (chưa gặp) là nội dung game.
export function SpeciesCodex({ codex }: { codex: CodexEntry[] }) {
  return (
    <GameCard title={`Sổ tay loài cây (${codex.filter((c) => c.owned).length}/${codex.length})`} icon={BookOpen}>
      <ul className="grid grid-cols-4 gap-2 md:grid-cols-6">
        {codex.map((c) => (
          <li
            key={c.id}
            className={`rounded-control border p-2 text-center ${c.owned ? `bg-stone-50 ${rarityBorder(c.rarity)}` : 'border-transparent bg-stone-100 opacity-60'}`}
          >
            <div className={`text-2xl leading-tight ${c.owned ? '' : 'grayscale'}`} aria-hidden="true">
              {c.owned ? c.emoji : '❔'}
            </div>
            <div className={`truncate text-xs font-semibold ${c.owned ? 'text-stone-900' : 'text-stone-600'}`}>{c.owned ? c.name : '???'}</div>
            {c.owned && c.count > 1 && <div className="text-xs font-semibold text-forest-700">×{c.count}</div>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-600">Thu hoạch cây để sưu tập đủ loài cây Việt Nam — loài hiếm khó gặp hơn!</p>
    </GameCard>
  );
}
