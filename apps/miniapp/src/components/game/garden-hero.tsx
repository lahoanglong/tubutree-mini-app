import type { GameProfile } from '../../services/game-api';
import { formatDrops, formatNumber } from '../../utils/format';
import { Heading, Text } from '../ui/text';

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
    <div
      style={{
        background: 'linear-gradient(160deg, var(--forest-600), var(--forest-700))',
        textAlign: 'center',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elevation-2)',
        padding: '16px 16px 14px',
      }}
    >
      <div className="tubu-sway" style={{ fontSize: 56, lineHeight: 1.1 }}>
        {pct >= 100 ? '🌳' : pct > 50 ? '🌿' : '🌱'}
      </div>
      <Heading variant="title-md" as="div" tone="inverse">
        {eco?.treeType ?? 'Vườn của bạn'}
      </Heading>
      <div
        role="progressbar"
        aria-label="Tiến độ cây"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        style={{ background: 'var(--forest-800)', borderRadius: 'var(--radius-pill)', height: 8, margin: '10px 24px', overflow: 'hidden' }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: 8,
            background: 'var(--color-text-inverse)',
            borderRadius: 'var(--radius-pill)',
            transition: 'width var(--motion-emphasize)',
          }}
        />
      </div>
      <Text variant="caption" tone="inverse">
        {formatNumber(eco?.progress)}/{formatDrops(eco?.target)} · 💧 {formatNumber(totalSeeds)} · 🔥 {formatNumber(streakDays)} ngày · 🌳 thật: {formatNumber(eco?.treesPlanted)}
      </Text>
    </div>
  );
}
