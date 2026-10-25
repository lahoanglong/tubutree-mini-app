import { LockOpen, ShowerHead, Sprout } from 'lucide-react';
import { WATER_STEP, gameNewbieCopy, missingDrops } from '@tubutree/app-core/game-newbie';
import type { Garden } from '@tubutree/app-core/api/game';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { formatDrops, formatNumber } from './format';
import { GameCard } from './game-card';

// Lô đất / mở rộng vườn (§6.7) — nhiều cây song song.
// Giai đoạn cây (🌱🌿🌳) và tình trạng héo (🥀) là nội dung game, không phải icon chức năng.
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
        <p className="text-xs text-stone-600">
          Mở thêm lô đất để trồng nhiều cây cùng lúc — mỗi lô thu hoạch cho mã giảm giá, phần góp quỹ trồng cây & loài sưu tập riêng.
        </p>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        {extraPlots.map((p) => {
          const ppct = p.target > 0 ? Math.min(100, Math.round((p.progress / p.target) * 100)) : 0;
          const stageEmoji = ppct >= 100 ? '🌳' : ppct > 50 ? '🌿' : '🌱';
          const watering = waterPlotPending && waterPlotVariables === p.id;
          return (
            <div key={p.id ?? p.slot} className="rounded-control bg-stone-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`text-2xl leading-none`} aria-hidden="true">
                    {stageEmoji}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-stone-900">
                      Lô {p.slot} · {p.treeType}
                    </div>
                    <div className="text-xs text-stone-700">
                      {formatNumber(p.progress)}/{formatDrops(p.target)} · 🌳 {formatNumber(p.treesPlanted)}
                      {p.treeHealth === 'WILTED' || p.treeHealth === 'DEAD' ? ' · 🥀 héo' : ''}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={watering}
                  onClick={() => p.id && (waterShort > 0 ? onNeedWater(waterShort) : onWaterPlot(p.id))}
                  className={`${miniBtnSecondary} flex-none gap-1.5`}
                >
                  <ShowerHead className="h-4 w-4" aria-hidden="true" />
                  Tưới
                </button>
              </div>
              <div className="mt-2">
                <ProgressBar value={ppct} max={100} />
              </div>
            </div>
          );
        })}
      </div>
      {garden.nextUnlock ? (
        <button type="button" disabled={unlockPending} onClick={() => (unlockShort > 0 ? onNeedWater(unlockShort) : onUnlock(garden.nextUnlock!.slot))} className={`${ui.btnPrimary} mt-3 w-full gap-2`}>
          <LockOpen className="h-4 w-4" aria-hidden="true" />
          {unlockShort > 0 ? gameNewbieCopy.short(unlockShort) : `Mở lô (${formatDrops(garden.nextUnlock.seedCost)})`}
        </button>
      ) : (
        <p className="mt-2 text-xs text-stone-600">Bạn đã mở tối đa số lô đất 🌳</p>
      )}
    </GameCard>
  );
}
