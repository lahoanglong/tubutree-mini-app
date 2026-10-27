import type { GameProfile } from '@tubutree/app-core/api/game';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { formatNumber } from './format';
import { WaterTank } from './water-tank';

const t = gameNewbieCopy.hero;

// Mầm/cành/cây và 💧 🔥 🌳 là nội dung của game (giai đoạn cây, đơn vị giọt nước, chuỗi ngày).
export function GardenHero({
  eco,
  totalSeeds,
  streakDays,
  harvestReady = false,
  wilted = false,
  tankCapacity,
}: {
  eco: GameProfile['ecoImpact'] | undefined;
  totalSeeds: number | undefined;
  streakDays: number | undefined;
  harvestReady?: boolean;
  /** Cây quá hạn chưa tưới: héo nhưng giữ tiến độ. */
  wilted?: boolean;
  tankCapacity?: number;
}) {
  const progress = eco ? Math.min(eco.progress, eco.target) : 0;
  const pct = eco && eco.target > 0 ? Math.min(100, Math.round((progress / eco.target) * 100)) : 0;
  const left = eco ? Math.max(0, eco.target - progress) : 0;
  const stage = wilted ? '🥀' : pct >= 100 ? '🌳' : pct > 50 ? '🌿' : '🌱';
  return (
    <div className="rounded-card bg-gradient-to-br from-forest-600 to-forest-800 px-4 pb-3.5 pt-3.5 text-center shadow-card">
      <WaterTank seeds={totalSeeds} capacity={tankCapacity} />
      <div data-testid="garden-stage" className="mt-1 text-6xl leading-[1.1]" aria-hidden="true">
        <span key={stage} className={`tubu-grow ${wilted ? 'opacity-85 saturate-50' : ''}`}>
          <span className={wilted ? undefined : 'tubu-sway'}>{stage}</span>
        </span>
      </div>
      <div className="font-display text-lg font-semibold text-stone-0">{eco?.treeType ?? 'Vườn của bạn'}</div>
      <div
        role="progressbar"
        aria-label="Tiến độ cây"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mx-6 mb-1.5 mt-2.5 h-2.5 overflow-hidden rounded-full bg-forest-800"
      >
        <div className="h-2.5 rounded-full bg-stone-0 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm font-semibold text-stone-0">{wilted ? t.wilted : harvestReady || left === 0 ? t.ready : t.remaining(left)}</p>
      <p className="mt-0.5 text-xs text-stone-0">
        {formatNumber(progress)}/{formatNumber(eco?.target)}💧 · {t.streak(streakDays ?? 0)} · {t.harvested(eco?.treesPlanted ?? 0)}
      </p>
    </div>
  );
}
