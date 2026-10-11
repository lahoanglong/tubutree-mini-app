import { Box, Text } from 'zmp-ui';
import type { CodexEntry } from '../../services/game-api';
import { GameCard } from './game-card';
import { rarityColor } from './game-utils';

// Sổ tay loài cây (Phase 3) — sưu tập khi thu hoạch
export function SpeciesCodex({ codex }: { codex: CodexEntry[] }) {
  return (
    <GameCard title={`📒 Sổ tay loài cây (${codex.filter((c) => c.owned).length}/${codex.length})`}>
      <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {codex.map((c: CodexEntry) => (
          <Box
            key={c.id}
            p={2}
            style={{
              textAlign: 'center',
              background: c.owned ? 'var(--leaf-50)' : 'var(--neutral-100)',
              borderRadius: 'var(--radius-md)',
              border: c.owned ? `1px solid ${rarityColor(c.rarity)}` : '1px solid transparent',
              opacity: c.owned ? 1 : 0.55,
            }}
          >
            <Text style={{ fontSize: 26, filter: c.owned ? 'none' : 'grayscale(1)' }}>
              {c.owned ? c.emoji : '❔'}
            </Text>
            <Text size="xSmall" bold style={{ color: c.owned ? 'var(--neutral-900)' : 'var(--neutral-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.owned ? c.name : '???'}
            </Text>
            {c.owned && c.count > 1 && (
              <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>×{c.count}</Text>
            )}
          </Box>
        ))}
      </Box>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
        Thu hoạch cây để sưu tập đủ loài cây Việt Nam — loài hiếm khó gặp hơn!
      </Text>
    </GameCard>
  );
}
