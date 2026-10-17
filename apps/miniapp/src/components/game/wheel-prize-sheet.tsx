import type { SpinResult } from '../../services/game-api';
import { formatDate, formatDrops, formatNumber, formatVnd } from '../../utils/format';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

type Prize = SpinResult['prize'];

type Outcome = 'COUPON' | 'SEEDS' | 'POINTS' | 'MISS';

function outcomeOf(prize: Prize): Outcome {
  if (prize.rewardType === 'COUPON' && prize.coupon) return 'COUPON';
  if (prize.rewardType === 'SEEDS' && prize.value > 0) return 'SEEDS';
  if (prize.rewardType === 'POINTS' && prize.value > 0) return 'POINTS';
  return 'MISS';
}

/**
 * Hộp kết quả vòng quay. ZaUI Sheet dựng ngay tại chỗ (không portal), nên hộp này phải nằm ở cấp trang,
 * ngoài các khối tab: kết quả về sau 3,6 giây, lúc đó người chơi có thể đã sang tab khác và hộp nằm trong
 * khối `display: none` sẽ vừa vô hình vừa khoá cuộn trang. `prize` được giữ lại sau khi đóng để hoạt ảnh
 * đóng của BottomSheet còn nội dung để vẽ.
 *
 * Nội dung theo loại giải: chỉ giải có thật (voucher, giọt nước, điểm) mới chúc mừng kèm pháo hoa; lượt
 * không trúng gì chỉ động viên, để khách không đọc "Chúc mừng!" rồi mới thấy mình trắng tay.
 */
export function WheelPrizeSheet({
  prize,
  open,
  onClose,
  onUseCoupon,
}: {
  prize: Prize | null;
  open: boolean;
  onClose: () => void;
  onUseCoupon: () => void;
}) {
  const outcome = prize ? outcomeOf(prize) : 'POINTS';
  const won = outcome !== 'MISS';

  const useCoupon = () => {
    onClose();
    onUseCoupon();
  };

  const footer =
    outcome === 'COUPON' ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button fullWidth onPress={useCoupon}>
          Dùng ngay
        </Button>
        <Button fullWidth variant="ghost" onPress={onClose}>
          Để sau
        </Button>
      </div>
    ) : (
      <Button fullWidth onPress={onClose}>
        {won ? 'Tuyệt vời!' : 'Quay tiếp nhé'}
      </Button>
    );

  return (
    <BottomSheet open={open} onClose={onClose} title={won ? 'Chúc mừng!' : 'Tiếc quá!'} footer={footer}>
      {prize && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, lineHeight: 1.2 }}>{won ? '🎉' : '🍀'}</div>
          <Text variant="body-md" tone={won ? 'brand' : 'primary'} as="div" style={{ fontWeight: 600, marginTop: 4 }}>
            {prize.name}
          </Text>
          {outcome === 'POINTS' && (
            <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
              +{formatNumber(prize.value)} Điểm Xanh đã vào tài khoản
            </Text>
          )}
          {outcome === 'SEEDS' && (
            <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
              +{formatDrops(prize.value)} đã vào bình nước của bạn
            </Text>
          )}
          {outcome === 'MISS' && (
            <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
              Lần này chưa trúng quà, thử lại lần sau nhé!
            </Text>
          )}
          {outcome === 'COUPON' && prize.coupon && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 'var(--radius-control)',
                background: 'var(--color-bg-subtle)',
                border: '1px dashed var(--color-border-default)',
              }}
            >
              <Text variant="body-md" as="div" style={{ fontWeight: 700, letterSpacing: 0.5, wordBreak: 'break-all' }}>
                {prize.coupon.code}
              </Text>
              <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
                Đơn tối thiểu {formatVnd(prize.coupon.minOrder)}
              </Text>
              <Text variant="body-sm" tone="secondary" as="div">
                Hạn dùng {formatDate(prize.coupon.expiresAt)}
              </Text>
              <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 6 }}>
                Mã đã vào mục Mã giảm giá của tôi
              </Text>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
