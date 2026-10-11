import { Box, Text, Button } from 'zmp-ui';
import type { Garden } from '../../services/game-api';
import { formatDrops, formatNumber, formatXu } from '../../utils/format';
import { GameCard } from './game-card';

// Lô đất / mở rộng vườn (§6.7) — nhiều cây song song
export function GardenPlots({
  garden,
  waterPlotPending,
  waterPlotVariables,
  onWaterPlot,
  unlockPending,
  unlockVariables,
  onUnlock,
}: {
  garden: Garden;
  waterPlotPending: boolean;
  waterPlotVariables: string | undefined;
  onWaterPlot: (plotId: string) => void;
  unlockPending: boolean;
  unlockVariables: 'SEEDS' | 'XU' | undefined;
  onUnlock: (currency: 'SEEDS' | 'XU') => void;
}) {
  return (
    <GameCard title={`🪴 Lô đất của bạn (${garden.plots.length}/${garden.maxPlots})`}>
      {garden.plots.filter((p) => !p.isHome).length === 0 && (
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
          Mở thêm lô đất để trồng nhiều cây cùng lúc — mỗi lô thu hoạch cho coupon, cây thật & loài sưu tập riêng.
        </Text>
      )}
      {garden.plots
        .filter((p) => !p.isHome)
        .map((p) => {
          const ppct = p.target > 0 ? Math.min(100, Math.round((p.progress / p.target) * 100)) : 0;
          const stageEmoji = ppct >= 100 ? '🌳' : ppct > 50 ? '🌿' : '🌱';
          return (
            <Box key={p.id} p={2} mt={1} style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)' }}>
              <Box flex alignItems="center" justifyContent="space-between">
                <Box flex alignItems="center" style={{ gap: 8 }}>
                  <Text style={{ fontSize: 26, filter: p.treeHealth === 'DEAD' ? 'grayscale(1)' : 'none' }}>{stageEmoji}</Text>
                  <Box>
                    <Text size="small" bold>Lô {p.slot} · {p.treeType}</Text>
                    <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                      {formatNumber(p.progress)}/{formatDrops(p.target)} · 🌳 {formatNumber(p.treesPlanted)}
                      {p.treeHealth === 'WILTED' ? ' · 🥀 héo' : p.treeHealth === 'DEAD' ? ' · 🍂 chết' : ''}
                    </Text>
                  </Box>
                </Box>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={waterPlotPending && waterPlotVariables === p.id}
                  loading={waterPlotPending && waterPlotVariables === p.id}
                  onClick={() => p.id && onWaterPlot(p.id)}
                >
                  🚿 Tưới
                </Button>
              </Box>
              <Box style={{ background: 'var(--neutral-100)', borderRadius: 99, height: 6, marginTop: 6, overflow: 'hidden' }}>
                <Box style={{ width: `${ppct}%`, height: 6, background: 'var(--leaf-600)', borderRadius: 99, transition: 'width var(--dur-slow) var(--ease-out)' }} />
              </Box>
            </Box>
          );
        })}
      {garden.nextUnlock ? (
        <Box flex style={{ gap: 8, marginTop: 10 }}>
          <Button
            style={{ flex: 1 }}
            size="small"
            disabled={unlockPending}
            loading={unlockPending && unlockVariables === 'SEEDS'}
            onClick={() => onUnlock('SEEDS')}
          >
            🔓 Mở lô ({formatDrops(garden.nextUnlock.seedCost)})
          </Button>
          <Button
            style={{ flex: 1 }}
            size="small"
            variant="secondary"
            disabled={unlockPending}
            loading={unlockPending && unlockVariables === 'XU'}
            onClick={() => onUnlock('XU')}
          >
            🔓 Mở lô ({formatXu(garden.nextUnlock.xuCost)})
          </Button>
        </Box>
      ) : (
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
          Bạn đã mở tối đa số lô đất 🌳
        </Text>
      )}
    </GameCard>
  );
}
