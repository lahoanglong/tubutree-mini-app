import { Box, Text } from 'zmp-ui';
import type { Forest, GameProfile } from '../../services/game-api';
import { formatNumber } from '../../utils/format';
import { GameCard } from './game-card';

// Tác động xanh (§6.7.7 — phần khả thi từ treesPlanted)
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
    <GameCard title="🌍 Tác động xanh của bạn">
      <Box flex style={{ gap: 10 }}>
        <EcoStat icon="🌳" value={formatNumber(eco?.treesPlanted)} label="Cây thật đã trồng" />
        <EcoStat icon="💨" value={`~${formatNumber((eco?.treesPlanted ?? 0) * 21)}kg`} label="CO₂ hấp thụ/năm (ước tính)" />
        <EcoStat icon="💧" value={formatNumber(totalSeeds)} label="Giọt nước đã góp" />
      </Box>
      {(forest?.count ?? 0) > 0 ? (
        <>
          <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginTop: 8 }}>
            Cảm ơn bạn! Tubu đã cam kết góp {formatNumber(forest?.count)} cây thật vào "Rừng Xanh Lên" cùng PanNature 🌿
          </Text>
          {/* Khu rừng của tôi — chứng nhận từng cây (§6.7.7) */}
          <Box mt={3} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Text size="xSmall" bold>🌲 Khu rừng của tôi — chứng nhận</Text>
            {forest!.trees.slice(0, 5).map((t) => (
              <Box
                key={t.certificateCode}
                flex
                alignItems="center"
                justifyContent="space-between"
                p={2}
                style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-sm)' }}
              >
                <Box>
                  <Text size="xSmall" bold style={{ color: 'var(--leaf-700)', letterSpacing: 0.5 }}>
                    {t.certificateCode}
                  </Text>
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>{t.treeType}</Text>
                </Box>
                <Text size="xSmall" style={{ color: t.status === 'PLANTED' ? 'var(--leaf-700)' : 'var(--neutral-500)' }}>
                  {t.status === 'PLANTED' ? '✅ Đã trồng' : '🌱 Đã cam kết'}
                </Text>
              </Box>
            ))}
            {forest!.count > 5 && (
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>…và {formatNumber(forest!.count - 5)} cây khác</Text>
            )}
          </Box>
        </>
      ) : (
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
          Chăm cây ảo đến khi thu hoạch để Tubu góp 1 cây thật cho rừng Việt Nam.
        </Text>
      )}
    </GameCard>
  );
}

function EcoStat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <Box
      p={2}
      style={{ flex: 1, background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}
    >
      <Text style={{ fontSize: 20 }}>{icon}</Text>
      <Text bold size="small" style={{ color: 'var(--leaf-700)' }}>
        {value}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {label}
      </Text>
    </Box>
  );
}
