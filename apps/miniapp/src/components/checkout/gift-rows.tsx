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
  /** `receive=false` là để quà lại cho đơn sau; `receive=true` chọn quà này cho đơn hiện tại (hành vi radio khi có nhiều quà). */
  onToggle: (id: string, receive: boolean, pending?: readonly QuotePendingGiftDTO[]) => void;
  shortfallVnd?: number;
}

/**
 * Quà hiện vật 0đ đi kèm đơn: mỗi quà một dòng, từ 3 quà trở lên gộp một dòng mở tấm nhỏ. Mặc định quà đi cùng đơn;
 * ô "Để đơn sau" chỉ là lối bỏ, không phải nút hành động của màn.
 */
export function GiftRows({ gifts, excluded, onToggle, shortfallVnd = 0 }: GiftRowsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = giftSectionView(gifts, excluded, shortfallVnd);
  if (view.layout === 'none') return null;

  const rows = view.rows.map((row) => (
    <div key={row.id} className="tubu-gift-row" data-testid="checkout-gift-row">
      <div className="tubu-gift-col" data-dim={row.receive ? undefined : 'true'}>
        <Text variant="body-sm" tone={row.receive ? 'primary' : 'secondary'} as="span" numeric>
          {row.label}
        </Text>
        {row.reason && (
          <Text variant="caption" tone="secondary" as="span" numeric>
            {row.reason}
          </Text>
        )}
      </div>
      {row.canToggle && (
        <Checkbox
          checked={!row.receive}
          onChange={() => {
            haptic('light');
            onToggle(row.id, !row.receive, gifts);
          }}
          label={view.deferLabel}
        />
      )}
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
