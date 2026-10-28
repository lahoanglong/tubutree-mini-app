import { BookOpen } from 'lucide-react';
import type { CodexEntry } from '../../services/game-api';
import { Text } from '../ui/text';
import { GameCard } from './game-card';
import { rarityColor } from './game-utils';

// Sổ tay loài cây (Phase 3) — sưu tập khi thu hoạch. Emoji loài và ❔ (chưa gặp) là nội dung game.
export function SpeciesCodex({ codex }: { codex: CodexEntry[] }) {
  return (
    <GameCard title={`Sổ tay loài cây (${codex.filter((c) => c.owned).length}/${codex.length})`} icon={BookOpen}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {codex.map((c: CodexEntry) => (
          <div
            key={c.id}
            style={{
              padding: 8,
              textAlign: 'center',
              background: c.owned ? 'var(--color-bg-subtle)' : 'var(--stone-100)',
              borderRadius: 'var(--radius-control)',
              border: c.owned ? `1px solid ${rarityColor(c.rarity)}` : '1px solid transparent',
              opacity: c.owned ? 1 : 0.55,
            }}
          >
            <div style={{ fontSize: 26, lineHeight: 1.2, filter: c.owned ? 'none' : 'grayscale(1)' }}>{c.owned ? c.emoji : '❔'}</div>
            <Text
              variant="label"
              as="div"
              tone={c.owned ? 'primary' : 'tertiary'}
              style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {c.owned ? c.name : '???'}
            </Text>
            {c.owned && c.count > 1 && (
              <Text variant="label" tone="brand" as="div">
                ×{c.count}
              </Text>
            )}
          </div>
        ))}
      </div>
      <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
        Thu hoạch cây để sưu tập đủ loài cây Việt Nam — loài hiếm khó gặp hơn!
      </Text>
    </GameCard>
  );
}
