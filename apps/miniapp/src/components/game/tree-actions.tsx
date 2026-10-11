import { Box, Text, Button } from 'zmp-ui';
import { formatXu } from '../../utils/format';

export function TreeActions({
  treeXuPrice,
  waterPending,
  onWater,
  buyPending,
  onBuy,
}: {
  treeXuPrice: number | undefined;
  waterPending: boolean;
  onWater: () => void;
  buyPending: boolean;
  onBuy: () => void;
}) {
  return (
    <Box p={3}>
      <Button fullWidth disabled={waterPending} loading={waterPending} variant="secondary" onClick={() => onWater()}>
        🚿 Tưới cây (20💧)
      </Button>
      <Box flex style={{ gap: 8, marginTop: 8 }}>
        <Button style={{ flex: 1 }} size="small" disabled={buyPending} loading={buyPending} onClick={() => onBuy()}>
          🌳 Mua cây thật
          {treeXuPrice != null && ` (${formatXu(treeXuPrice)})`}
        </Button>
      </Box>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 6, textAlign: 'center' }}>
        Mua bằng TubuXu — đổi từ Ví trong mục Ví của tôi.
      </Text>
    </Box>
  );
}
