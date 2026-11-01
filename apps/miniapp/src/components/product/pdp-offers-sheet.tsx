import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { voucherView } from '@tubutree/app-core/commerce/voucher';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { serverNow } from '../../utils/server-clock';
import { BottomSheet } from '../ui/bottom-sheet';
import { Text } from '../ui/text';
import { VoucherTicket } from '../ui/voucher-ticket';

export interface PdpOffersSheetProps {
  open: boolean;
  onClose: () => void;
  coupons: readonly CouponDTO[];
  /** Chép mã (áp ở bước thanh toán): chỗ gọi lo thông báo. */
  onCopy: (code: string) => void;
}

/**
 * Ví mã của khách dùng được cho sản phẩm này, mở từ dòng "Ưu đãi ›". Mã đã nằm trong ví nên trạng thái `saved`, nút chính duy nhất là
 * "Sao chép". Một đơn một mã, ghi ngay chỗ chọn.
 */
export function PdpOffersSheet({ open, onClose, coupons, onCopy }: PdpOffersSheetProps) {
  const now = serverNow();
  return (
    <BottomSheet open={open} onClose={onClose} title={fillCopy('coupon.title')}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {coupons.map((c) => (
          <VoucherTicket key={c.code} variant="row" voucher={voucherView(c, now)} primary={{ label: fillCopy('coupon.copy'), onClick: () => onCopy(c.code) }} />
        ))}
      </div>
      <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 12 }}>
        {fillCopy('coupon.oneCodeHint')}
      </Text>
    </BottomSheet>
  );
}
