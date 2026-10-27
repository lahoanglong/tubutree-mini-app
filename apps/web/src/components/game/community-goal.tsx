import { Globe, MapPin } from 'lucide-react';
import type { CommunityState } from '@tubutree/app-core/api/game';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatDrops, formatNumber } from './format';
import { GameCard } from './game-card';

// Mốc cộng đồng góp quỹ trồng cây (Phase 2) — hồ giọt nước toàn cộng đồng.
// 💧 và 🌿 ở lời giải thích là nội dung game (đơn vị giọt nước, lời chúc).
export function CommunityGoal({ goal, myDrops, pct }: { goal: NonNullable<CommunityState['goal']>; myDrops: number; pct: number }) {
  return (
    <GameCard title="Mục tiêu cộng đồng" icon={Globe}>
      <div className="text-sm font-semibold text-forest-700">{goal.title}</div>
      <div className="flex items-center gap-1 text-caption text-stone-600">
        <MapPin className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
        <span>
          {goal.region} · mục tiêu góp quỹ trồng {goal.treesToPlant} cây
        </span>
      </div>
      <div className="my-2.5">
        <ProgressBar value={pct} max={100} />
      </div>
      <div className="flex justify-between gap-2 text-caption">
        <span className="text-stone-700">
          {formatNumber(goal.currentDrops)}/{formatDrops(goal.targetDrops)} ({pct}%)
        </span>
        <span className="font-semibold text-forest-700">Bạn đã góp {formatDrops(myDrops)}</span>
      </div>
      <p className="mt-1.5 text-caption text-stone-600">
        Mỗi lần thu hoạch cây ảo, toàn bộ 💧 đã tưới sẽ góp vào hồ chung. Đủ mốc, Tubu góp quỹ trồng cây 🌿
      </p>
    </GameCard>
  );
}
