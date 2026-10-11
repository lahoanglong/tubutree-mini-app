import { Box, Text } from 'zmp-ui';
import type { CommunityState } from '../../services/game-api';
import { formatDrops, formatNumber } from '../../utils/format';
import { GameCard } from './game-card';

// Mốc cộng đồng cây thật (Phase 2) — hồ giọt nước toàn cộng đồng
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
    <GameCard title="🌍 Mục tiêu cộng đồng">
      <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
        {goal.title}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
        📍 {goal.region} · mục tiêu {goal.treesToPlant} cây thật
      </Text>
      <Box style={{ background: 'var(--neutral-100)', borderRadius: 99, height: 12, margin: '10px 0 6px', overflow: 'hidden' }}>
        <Box
          style={{
            width: `${pct}%`,
            height: 12,
            background: 'linear-gradient(90deg, var(--leaf-400), var(--leaf-600))',
            borderRadius: 99,
            transition: 'width var(--dur-slow) var(--ease-out)',
          }}
        />
      </Box>
      <Box flex justifyContent="space-between">
        <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
          {formatNumber(goal.currentDrops)}/{formatDrops(goal.targetDrops)} ({pct}%)
        </Text>
        <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
          Bạn đã góp {formatDrops(myDrops)}
        </Text>
      </Box>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 6 }}>
        Mỗi lần thu hoạch cây ảo, toàn bộ 💧 đã tưới sẽ góp vào hồ chung. Đủ mốc, Tubu trồng cây thật cùng PanNature 🌿
      </Text>
    </GameCard>
  );
}
