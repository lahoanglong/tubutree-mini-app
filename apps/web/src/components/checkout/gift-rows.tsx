'use client';

import { useState } from 'react';
import type { QuotePendingGiftDTO } from '@tubutree/shared-types';
import { giftSectionView } from '@tubutree/app-core/checkout-pickup-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Text } from '@/components/mini';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { CheckMark, miniCheckbox, miniCheckboxGutter, miniCheckboxWrap } from '@/components/order-mobile/mobile-ui';

interface GiftRowsProps {
  gifts: readonly QuotePendingGiftDTO[];
  excluded: readonly string[];
  /** `receive=false` là để quà lại cho đơn sau (mã quà vào `excludeGiftRedemptionIds`). */
  onToggle: (id: string, receive: boolean) => void;
  disabled?: boolean;
}

/**
 * Quà hiện vật 0đ đi kèm đơn: mỗi quà một dòng, từ 3 quà trở lên gộp một dòng mở tấm nhỏ. Mặc định quà đi cùng đơn;
 * ô "Để đơn sau" chỉ là lối bỏ, không phải nút hành động của màn. Cùng luật với Mini App.
 */
export function GiftRows({ gifts, excluded, onToggle, disabled = false }: GiftRowsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = giftSectionView(gifts, excluded);
  if (view.layout === 'none') return null;

  const rows = view.rows.map((row) => (
    <div key={row.id} data-testid="checkout-gift-row" className="mt-3 flex min-h-11 items-center justify-between gap-3 tabular-nums first:mt-0">
      <Text variant="body-sm" tone={row.receive ? 'primary' : 'secondary'} as="span" className={`min-w-0 flex-1 break-words ${row.receive ? '' : 'opacity-60'}`}>
        {row.label}
      </Text>
      <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-caption text-[color:var(--color-text-secondary)]">
        <span className={`${miniCheckboxWrap} ${miniCheckboxGutter}`}>
          <input type="checkbox" checked={!row.receive} onChange={() => onToggle(row.id, !row.receive)} disabled={disabled} className={miniCheckbox} />
          <CheckMark />
        </span>
        {view.deferLabel}
      </label>
    </div>
  ));
  if (view.layout === 'rows') return <div className="mt-3">{rows}</div>;

  return (
    <>
      <div className="mt-3 flex min-h-11 items-center tabular-nums">
        <button type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" className="min-h-11 min-w-0 flex-1 text-left">
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
    <p data-testid="cart-gift-note" className="mt-2 flex min-h-11 items-center tabular-nums">
      <Text variant="caption" tone="secondary">{fillCopy('cart.giftNote')}</Text>
    </p>
  );
}
