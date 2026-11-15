import { useState } from 'react';
import type { QuotePendingGiftDTO } from '@tubutree/shared-types';
import { giftSectionView } from '@tubutree/app-core/checkout-pickup-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { BottomSheet } from '../ui/bottom-sheet';
import { Checkbox } from '../ui/form';
import { Text } from '../ui/text';
import { haptic } from '../../utils/haptic';
import '../../css/checkout-pickup.css';

interface GiftRowsProps {
  gifts: readonly QuotePendingGiftDTO[];
  excluded: readonly string[];
  /** `receive=false` là để quà lại cho đơn sau (mã quà vào `excludeGiftRedemptionIds`). */
  onToggle: (id: string, receive: boolean) => void;
}

/**
 * Quà hiện vật 0đ đi kèm đơn: mỗi quà một dòng, từ 3 quà trở lên gộp một dòng mở tấm nhỏ. Mặc định quà đi cùng đơn;
 * ô "Để đơn sau" chỉ là lối bỏ, không phải nút hành động của màn.
 */
export function GiftRows({ gifts, excluded, onToggle }: GiftRowsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = giftSectionView(gifts, excluded);
  if (view.layout === 'none') return null;

  const rows = view.rows.map((row) => (
    <div key={row.id} className="tubu-gift-row" data-testid="checkout-gift-row">
      <Text variant="body-sm" tone={row.receive ? 'primary' : 'secondary'} as="span" style={row.receive ? undefined : { opacity: 0.6 }}>
        {row.label}
      </Text>
      <Checkbox
        checked={!row.receive}
        onChange={() => {
          haptic('light');
          onToggle(row.id, !row.receive);
        }}
        label={view.deferLabel}
      />
    </div>
  ));
  if (view.layout === 'rows') return <>{rows}</>;

  return (
    <>
      <div className="tubu-gift-row">
        <button type="button" className="tubu-gift-merged tubu-press" onClick={() => setSheetOpen(true)}>
          <Text variant="body-sm" as="span">{view.mergedLabel}</Text>
        </button>
      </div>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={view.sheetTitle}>
        {rows}
      </BottomSheet>
    </>
  );
}

/** Dòng chỉ đọc ở Giỏ: quà tự thêm ở bước thanh toán; chọn "Để đơn sau" chỉ có ở Thanh toán. */
export function GiftNote() {
  return (
    <div className="tubu-gift-note" data-testid="cart-gift-note">
      <Text variant="caption" tone="secondary">{fillCopy('cart.giftNote')}</Text>
    </div>
  );
}
