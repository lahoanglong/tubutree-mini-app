import type { GameProfile } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { formatNumber } from '../../utils/format';
import { Heading, Text } from '../ui/text';
import { WaterTank } from './water-tank';

const t = vi.game.newbie.hero;

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
    <div
      style={{
        background: 'linear-gradient(160deg, var(--forest-600), var(--forest-700))',
        textAlign: 'center',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elevation-2)',
        padding: '14px 16px 14px',
      }}
    >
      <WaterTank seeds={totalSeeds} capacity={tankCapacity} />
      <div style={{ fontSize: 56, lineHeight: 1.1, marginTop: 4 }}>
        <span key={stage} className="tubu-grow" style={wilted ? { filter: 'saturate(0.55)', opacity: 0.85 } : undefined}>
          <span className={wilted ? undefined : 'tubu-sway'}>{stage}</span>
        </span>
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
        style={{ background: 'var(--forest-800)', borderRadius: 'var(--radius-pill)', height: 10, margin: '10px 24px 6px', overflow: 'hidden' }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: 10,
            background: 'var(--color-text-inverse)',
            borderRadius: 'var(--radius-pill)',
            transition: 'width var(--motion-emphasize)',
          }}
        />
      </div>
      <Text variant="body-sm" tone="inverse" as="div" style={{ fontWeight: 600 }}>
        {wilted ? t.wilted : harvestReady || left === 0 ? t.ready : t.remaining(left)}
      </Text>
      <Text variant="caption" tone="inverse" as="div" style={{ marginTop: 2 }}>
        {formatNumber(progress)}/{formatNumber(eco?.target)}💧 · {t.streak(streakDays ?? 0)} · {t.harvested(eco?.treesPlanted ?? 0)}
      </Text>
    </div>
  );
}
