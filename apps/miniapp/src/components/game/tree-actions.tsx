import { useRef, useState } from 'react';
import { ShowerHead, TreePine } from 'lucide-react';
import { formatPoints } from '../../utils/format';
import { BottomSheet } from '../ui/bottom-sheet';
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Sheet còn mounted trong lúc trượt xuống, nên chạm lần hai vẫn tới được nút; ref chặn gửi đôi
  // ngay cả khi buyPending chưa kịp cập nhật.
  const submitted = useRef(false);

  const confirm = () => {
    if (submitted.current || buyPending) return;
    submitted.current = true;
    onBuy();
    setConfirmOpen(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Button size="lg" fullWidth icon={ShowerHead} disabled={waterPending} loading={waterPending} onPress={() => onWater()}>
        Tưới cây (20💧)
      </Button>
      <Button fullWidth variant="secondary" icon={TreePine} disabled={buyPending} loading={buyPending} onPress={() => {
          submitted.current = false;
          setConfirmOpen(true);
        }}
      >
        Góp quỹ trồng cây
        {treePointsPrice != null && ` (${formatPoints(treePointsPrice)})`}
      </Button>
      <Text variant="caption" tone="tertiary" as="div" style={{ textAlign: 'center' }}>
        Góp bằng Điểm Xanh — dùng điểm thường trước, thiếu mới dùng điểm không hết hạn.
      </Text>
      <BottomSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Góp quỹ trồng cây?"
        footer={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button fullWidth variant="secondary" disabled={buyPending} onPress={() => setConfirmOpen(false)}>
              Huỷ
            </Button>
            <Button fullWidth disabled={buyPending} loading={buyPending} onPress={confirm}>
              Xác nhận
            </Button>
          </div>
        }
      >
        <Text variant="body-sm" as="div">
          {treePointsPrice != null ? `Góp quỹ trồng cây sẽ trừ ${formatPoints(treePointsPrice)} từ Điểm Xanh của bạn.` : 'Góp quỹ trồng cây sẽ trừ Điểm Xanh của bạn.'}
        </Text>
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
          Điểm thường trừ trước, rồi điểm quy đổi không hết hạn. Không hoàn lại sau khi góp.
        </Text>
      </BottomSheet>
    </div>
  );
}
