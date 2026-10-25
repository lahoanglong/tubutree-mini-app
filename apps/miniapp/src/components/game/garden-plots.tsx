import { LockOpen, ShowerHead, Sprout } from 'lucide-react';
import { WATER_STEP, missingDrops } from '@tubutree/app-core/game-newbie';
import { vi } from '../../i18n/vi';
import type { Garden } from '../../services/game-api';
import { formatDrops, formatNumber } from '../../utils/format';
import { Button } from '../ui/button';
import { ProgressBar } from '../ui/progress-bar';
import { Text } from '../ui/text';
import { GameCard } from './game-card';

// Lô đất / mở rộng vườn (§6.7) — nhiều cây song song
// Giai đoạn cây (🌱🌿🌳) và tình trạng héo/chết (🥀🍂) là nội dung game, không phải icon chức năng.
export function GardenPlots({
  garden,
  totalSeeds,
  onNeedWater,
  waterPlotPending,
  waterPlotVariables,
  onWaterPlot,
  unlockPending,
  onUnlock,
}: {
  garden: Garden;
  totalSeeds: number;
  /** Thiếu nước: mở sheet "Kiếm nước" với số giọt còn thiếu. */
  onNeedWater: (missing: number) => void;
  waterPlotPending: boolean;
  waterPlotVariables: string | undefined;
  onWaterPlot: (plotId: string) => void;
  unlockPending: boolean;
  onUnlock: (slot: number) => void;
}) {
  const extraPlots = garden.plots.filter((p) => !p.isHome);
  const waterShort = missingDrops(totalSeeds, WATER_STEP);
  const unlockShort = garden.nextUnlock ? missingDrops(totalSeeds, garden.nextUnlock.seedCost) : 0;
  return (
    <GameCard title={`Lô đất của bạn (${garden.plots.length}/${garden.maxPlots})`} icon={Sprout}>
      {extraPlots.length === 0 && (
        <Text variant="caption" tone="tertiary" as="div">
          Mở thêm lô đất để trồng nhiều cây cùng lúc — mỗi lô thu hoạch cho mã giảm giá, phần góp quỹ trồng cây & loài sưu tập riêng.
        </Text>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {extraPlots.map((p) => {
          const ppct = p.target > 0 ? Math.min(100, Math.round((p.progress / p.target) * 100)) : 0;
          const stageEmoji = ppct >= 100 ? '🌳' : ppct > 50 ? '🌿' : '🌱';
          const watering = waterPlotPending && waterPlotVariables === p.id;
          return (
            <div key={p.id} style={{ padding: 12, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 26, lineHeight: 1, filter: 'none' }}>{stageEmoji}</span>
                  <div style={{ minWidth: 0 }}>
                    <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                      Lô {p.slot} · {p.treeType}
                    </Text>
                    <Text variant="caption" tone="secondary" as="div">
                      {formatNumber(p.progress)}/{formatDrops(p.target)} · 🌳 {formatNumber(p.treesPlanted)}
                      {p.treeHealth === 'WILTED' || p.treeHealth === 'DEAD' ? ' · 🥀 héo' : ''}
                    </Text>
                  </div>
                </div>
                <Button variant="secondary" icon={ShowerHead} disabled={watering} loading={watering} onPress={() => p.id && (waterShort > 0 ? onNeedWater(waterShort) : onWaterPlot(p.id))}>
                  Tưới
                </Button>
              </div>
              <div style={{ marginTop: 8 }}>
                <ProgressBar value={ppct} max={100} />
              </div>
            </div>
          );
        })}
      </div>
      {garden.nextUnlock ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <Button fullWidth icon={LockOpen} disabled={unlockPending} loading={unlockPending} onPress={() => (unlockShort > 0 ? onNeedWater(unlockShort) : onUnlock(garden.nextUnlock!.slot))}>
            {unlockShort > 0 ? vi.game.newbie.short(unlockShort) : `Mở lô (${formatDrops(garden.nextUnlock.seedCost)})`}
          </Button>
        </div>
      ) : (
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
          Bạn đã mở tối đa số lô đất 🌳
        </Text>
      )}
    </GameCard>
  );
}
