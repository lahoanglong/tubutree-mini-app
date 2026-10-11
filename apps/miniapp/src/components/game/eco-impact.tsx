import { Check, Droplets, Earth, Sprout, TreePine, Trees, Wind, type LucideIcon } from 'lucide-react';
import type { Forest, GameProfile } from '../../services/game-api';
import { formatNumber } from '../../utils/format';
import { Badge } from '../ui/badge';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { GameCard } from './game-card';

// Tác động xanh (§6.7.7 — phần khả thi từ treesPlanted). 🌿 trong lời cảm ơn là lời chúc (nội dung).
export function EcoImpact({
  eco,
  totalSeeds,
  forest,
}: {
  eco: GameProfile['ecoImpact'] | undefined;
  totalSeeds: number | undefined;
  forest: Forest | undefined;
}) {
  return (
    <GameCard title="Tác động xanh của bạn" icon={Earth}>
      <div style={{ display: 'flex', gap: 8 }}>
        <EcoStat icon={TreePine} value={formatNumber(eco?.treesPlanted)} label="Cây thật đã trồng" />
        <EcoStat icon={Wind} value={`~${formatNumber((eco?.treesPlanted ?? 0) * 21)}kg`} label="CO₂ hấp thụ/năm (ước tính)" />
        <EcoStat icon={Droplets} value={formatNumber(totalSeeds)} label="Giọt nước đã góp" />
      </div>
      {(forest?.count ?? 0) > 0 ? (
        <>
          <Text variant="caption" tone="brand" as="div" style={{ marginTop: 8 }}>
            Cảm ơn bạn! Tubu đã cam kết góp {formatNumber(forest?.count)} cây thật vào "Rừng Xanh Lên" cùng PanNature 🌿
          </Text>
          {/* Khu rừng của tôi — chứng nhận từng cây (§6.7.7) */}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Text variant="caption" as="div" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon icon={Trees} size="sm" tone="brand" />
              Khu rừng của tôi — chứng nhận
            </Text>
            {forest!.trees.slice(0, 5).map((t) => (
              <div
                key={t.certificateCode}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 12px',
                  background: 'var(--color-bg-subtle)',
                  borderRadius: 'var(--radius-control)',
                }}
              >
                <div>
                  <Text variant="caption" tone="brand" as="div" style={{ fontWeight: 600, letterSpacing: 0.5 }}>
                    {t.certificateCode}
                  </Text>
                  <Text variant="caption" tone="tertiary" as="div">
                    {t.treeType}
                  </Text>
                </div>
                {t.status === 'PLANTED' ? (
                  <Badge tone="success" size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon icon={Check} size="sm" style={{ stroke: 'currentColor' }} />
                    Đã trồng
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon icon={Sprout} size="sm" style={{ stroke: 'currentColor' }} />
                    Đã cam kết
                  </Badge>
                )}
              </div>
            ))}
            {forest!.count > 5 && (
              <Text variant="caption" tone="tertiary" as="div">
                …và {formatNumber(forest!.count - 5)} cây khác
              </Text>
            )}
          </div>
        </>
      ) : (
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
          Chăm cây ảo đến khi thu hoạch để Tubu góp 1 cây thật cho rừng Việt Nam.
        </Text>
      )}
    </GameCard>
  );
}

function EcoStat({ icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: 8,
        background: 'var(--color-bg-subtle)',
        borderRadius: 'var(--radius-control)',
        textAlign: 'center',
      }}
    >
      <Icon icon={icon} tone="brand" />
      <Text variant="body-sm" tone="brand" as="div" style={{ fontWeight: 700 }}>
        {value}
      </Text>
      <Text variant="label" tone="tertiary" as="div" style={{ fontWeight: 400 }}>
        {label}
      </Text>
    </div>
  );
}
