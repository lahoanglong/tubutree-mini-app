import { ShowerHead, TreePine } from 'lucide-react';
import { formatPoints } from '../../utils/format';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

export function TreeActions({
  treePointsPrice,
  waterPending,
  onWater,
  buyPending,
  onBuy,
}: {
  treePointsPrice: number | undefined;
  waterPending: boolean;
  onWater: () => void;
  buyPending: boolean;
  onBuy: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Button size="lg" fullWidth icon={ShowerHead} disabled={waterPending} loading={waterPending} onPress={() => onWater()}>
        Tưới cây (20💧)
      </Button>
      <Button fullWidth variant="secondary" icon={TreePine} disabled={buyPending} loading={buyPending} onPress={() => onBuy()}>
        Góp quỹ trồng cây
        {treePointsPrice != null && ` (${formatPoints(treePointsPrice)})`}
      </Button>
      <Text variant="caption" tone="tertiary" as="div" style={{ textAlign: 'center' }}>
        Góp bằng Điểm Xanh — dùng điểm thường trước, thiếu mới dùng điểm không hết hạn.
      </Text>
    </div>
  );
}
