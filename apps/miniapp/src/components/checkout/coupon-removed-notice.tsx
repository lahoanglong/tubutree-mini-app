import { couponMinOrderCopy } from '@tubutree/app-core/coupon-min-order';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

/**
 * Lời báo máy chủ vừa gỡ mã khỏi giỏ (giỏ rơi dưới đơn tối thiểu, mã hết hạn hay bị tắt), dùng chung ở giỏ và thanh toán.
 * Khớp khối `coupon-removed-notice` trong CouponBox của web. Nút Đóng là DS Button nên vùng chạm 44 do DS lo.
 */
export function CouponRemovedNotice({ notice, onDismiss }: { notice: { code: string; text: string } | null; onDismiss: () => void }) {
  if (!notice) return null;
  return (
    <div
      role="status"
      data-testid="coupon-removed-notice"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-inline-sm)' }}
    >
      <Text variant="caption" tone="warning" as="p" style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
        {notice.text}
      </Text>
      <Button variant="ghost" onPress={onDismiss} aria-label={couponMinOrderCopy.dismissAria(notice.code)} style={{ flexShrink: 0 }}>
        {couponMinOrderCopy.dismiss}
      </Button>
    </div>
  );
}
