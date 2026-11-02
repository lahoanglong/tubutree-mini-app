import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { offerRows } from '@tubutree/app-core/commerce/voucher-picker';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { autoCouponName } from '../../utils/coupon-name';
import { serverNow } from '../../utils/server-clock';
import { BottomSheet } from '../ui/bottom-sheet';
import { Text } from '../ui/text';
import { VoucherTicket } from '../ui/voucher-ticket';

export interface PdpOffersSheetProps {
  open: boolean;
  onClose: () => void;
  coupons: readonly CouponDTO[];
  /** Tiền hàng của món đang xem (giá × số lượng): mã xếp theo mức có lợi cho món này, mã chưa đủ đơn tối thiểu ghi "Mua thêm … để dùng". */
  amount: number;
  /** Chép mã (áp ở bước thanh toán): chỗ gọi lo thông báo. */
  onCopy: (code: string) => void;
}

/**
 * Ví mã của khách dùng được cho sản phẩm này, mở từ dòng "Ưu đãi ›". Mã đã nằm trong ví nên trạng thái `saved`, nút chính duy nhất là
 * "Sao chép" (mã chưa đủ đơn tối thiểu vẫn chép được: khách còn mua thêm món khác). Một đơn một mã, ghi ngay chỗ chọn.
 */
export function PdpOffersSheet({ open, onClose, coupons, amount, onCopy }: PdpOffersSheetProps) {
  const rows = offerRows(coupons, { amount, now: serverNow(), displayCode: autoCouponName });
  return (
    <BottomSheet open={open} onClose={onClose} title={fillCopy('coupon.title')}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r) => (
          <VoucherTicket
            key={r.coupon.code}
            variant="row"
            voucher={r.view}
            reason={r.reason ?? undefined}
            primary={{ label: fillCopy('coupon.copy'), onClick: () => onCopy(r.coupon.code) }}
          />
        ))}
      </div>
      <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 12 }}>
        {fillCopy('coupon.oneCodeHint')}
      </Text>
    </BottomSheet>
  );
}
