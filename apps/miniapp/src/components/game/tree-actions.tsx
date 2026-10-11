import { ShowerHead, TreePine } from 'lucide-react';
import { formatXu } from '../../utils/format';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Button size="lg" fullWidth icon={ShowerHead} disabled={waterPending} loading={waterPending} onPress={() => onWater()}>
        Tưới cây (20💧)
      </Button>
      <Button fullWidth variant="secondary" icon={TreePine} disabled={buyPending} loading={buyPending} onPress={() => onBuy()}>
        Góp quỹ trồng cây
        {treeXuPrice != null && ` (${formatXu(treeXuPrice)})`}
      </Button>
      <Text variant="caption" tone="tertiary" as="div" style={{ textAlign: 'center' }}>
        Góp bằng TubuXu — đổi từ Ví trong mục Ví của tôi.
      </Text>
    </div>
  );
}
