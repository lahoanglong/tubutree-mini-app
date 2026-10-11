import type { SpinResult } from '../../services/game-api';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

/**
 * Hộp kết quả vòng quay. ZaUI Sheet dựng ngay tại chỗ (không portal), nên hộp này phải nằm ở cấp trang,
 * ngoài các khối tab: kết quả về sau 3,6 giây, lúc đó người chơi có thể đã sang tab khác và hộp nằm trong
 * khối `display: none` sẽ vừa vô hình vừa khoá cuộn trang. `prize` được giữ lại sau khi đóng để hoạt ảnh
 * đóng của BottomSheet còn nội dung để vẽ.
 */
export function WheelPrizeSheet({
  prize,
  open,
  onClose,
}: {
  prize: SpinResult['prize'] | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Chúc mừng!"
      footer={
        <Button fullWidth onPress={onClose}>
          Tuyệt vời!
        </Button>
      }
    >
      {prize && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, lineHeight: 1.2 }}>🎉</div>
          <Text variant="body-md" tone="brand" as="div" style={{ fontWeight: 600, marginTop: 4 }}>
            {prize.name}
          </Text>
          {prize.rewardType === 'POINTS' && prize.value > 0 && (
            <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
              +{prize.value} Điểm Xanh đã vào tài khoản
            </Text>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
