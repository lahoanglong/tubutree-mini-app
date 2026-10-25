import type { GameProfile } from '@tubutree/app-core/api/game';
import { formatDrops, formatNumber } from './format';

// Mầm/cành/cây và 💧 🔥 🌳 ở dòng tổng hợp là nội dung của game (giai đoạn cây, đơn vị giọt nước, chuỗi ngày).
export function GardenHero({
  eco,
  totalSeeds,
  streakDays,
}: {
  eco: GameProfile['ecoImpact'] | undefined;
  totalSeeds: number | undefined;
  streakDays: number | undefined;
}) {
  const pct = eco && eco.target > 0 ? Math.min(100, Math.round((eco.progress / eco.target) * 100)) : 0;
  return (
    <div className="rounded-card bg-gradient-to-br from-forest-600 to-forest-800 px-4 pb-3.5 pt-4 text-center shadow-card">
      <div data-testid="garden-stage" className="text-6xl leading-tight" aria-hidden="true">
        {pct >= 100 ? '🌳' : pct > 50 ? '🌿' : '🌱'}
      </div>
      <div className="font-display text-lg font-semibold text-stone-0">{eco?.treeType ?? 'Vườn của bạn'}</div>
      <div
        role="progressbar"
        aria-label="Tiến độ cây"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mx-6 my-2.5 h-2 overflow-hidden rounded-full bg-forest-900"
      >
        <div className="h-2 rounded-full bg-stone-0 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-stone-0">
        {formatNumber(eco?.progress)}/{formatDrops(eco?.target)} · 💧 {formatNumber(totalSeeds)} · 🔥 {formatNumber(streakDays)} ngày · 🌳 cây đã trồng:{' '}
        {formatNumber(eco?.treesPlanted)}
      </p>
    </div>
  );
}
