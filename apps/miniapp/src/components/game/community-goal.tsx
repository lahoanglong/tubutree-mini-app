import { Globe, MapPin } from 'lucide-react';
import type { CommunityState } from '../../services/game-api';
import { formatDrops, formatNumber } from '../../utils/format';
import { Icon } from '../ui/icon';
import { ProgressBar } from '../ui/progress-bar';
import { Text } from '../ui/text';
import { GameCard } from './game-card';

// Mốc cộng đồng góp quỹ trồng cây (Phase 2) — hồ giọt nước toàn cộng đồng
// 💧 và 🌿 ở lời giải thích là nội dung game (đơn vị giọt nước, lời chúc).
export function CommunityGoal({
  goal,
  myDrops,
  pct,
}: {
  goal: NonNullable<CommunityState['goal']>;
  myDrops: number;
  pct: number;
}) {
  return (
    <GameCard title="Mục tiêu cộng đồng" icon={Globe}>
      <Text variant="body-sm" tone="brand" as="div" style={{ fontWeight: 600 }}>
        {goal.title}
      </Text>
      <Text variant="caption" tone="tertiary" as="div" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Icon icon={MapPin} size="sm" tone="muted" />
        <span>
          {goal.region} · mục tiêu góp quỹ trồng {goal.treesToPlant} cây
        </span>
      </Text>
      <div style={{ margin: '10px 0 6px' }}>
        <ProgressBar value={pct} max={100} ariaLabel="Tiến độ mục tiêu cộng đồng" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="caption" tone="secondary">
          {formatNumber(goal.currentDrops)}/{formatDrops(goal.targetDrops)} ({pct}%)
        </Text>
        <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
          Bạn đã góp {formatDrops(myDrops)}
        </Text>
      </div>
      <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 6 }}>
        Mỗi lần thu hoạch cây ảo, toàn bộ 💧 đã tưới sẽ góp vào hồ chung. Đủ mốc, Tubu góp quỹ trồng cây 🌿
      </Text>
    </GameCard>
  );
}
