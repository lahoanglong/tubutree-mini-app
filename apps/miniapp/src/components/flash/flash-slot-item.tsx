import type { CSSProperties } from 'react';
import type { FlashSlotItem as FlashSlotItemData, FlashSlotStatus } from '@tubutree/app-core/api/flash-sale';
import { productCardView } from '@tubutree/app-core/commerce/product-card-view';
import { slotBuyLabel, slotItemNote, slotRemindLabel } from '@tubutree/app-core/commerce/flash-slots';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { flashCardProduct, soldPercent } from '../../utils/flash-display';
import { haptic } from '../../utils/haptic';
import { serverNow } from '../../utils/server-clock';
import { Button } from '../ui/button';
import { FlashSoldBar } from '../ui/flash-sold-bar';
import { ProductTile } from '../ui/product-tile';

/** Chỗ thanh đã bán dưới giá: 4 (cách giá) + 16 (thanh có chữ). */
const SOLD_FOOTER_HEIGHT = 20;
/** Nút ở cuối hàng: cao 44 (vùng chạm), rộng tối đa 96 để cột tên và giá còn đủ chỗ ở màn 375px; nhãn cỡ `label` cho "Đã đặt nhắc" vừa trong 96. */
const ACTION_STYLE: CSSProperties = { minWidth: 0, maxWidth: 96, padding: '0 8px', fontSize: 'var(--type-label-size)', whiteSpace: 'nowrap' };

export interface FlashSlotItemProps {
  item: FlashSlotItemData;
  /** Khung của món: đang diễn ra thì có Mua ngay, sắp diễn ra thì có Nhắc tôi. */
  slotStatus: FlashSlotStatus;
  reminded: boolean;
  remindPending: boolean;
  onBuy: () => void;
  onToggleRemind: () => void;
}

/**
 * Một dòng món của trang Giờ vàng: thẻ `line` chung + thanh đã bán có chữ ở cuối thân + một nút ở cuối hàng. Món hết suất vẫn hiện nhưng mờ và nút
 * khoá (aria-disabled, không `disabled` thật để vẫn nằm trong thứ tự Tab và đọc được lý do qua thanh "Đã bán hết"). Chạm nút không mở sản phẩm.
 */
export function FlashSlotItem({ item, slotStatus, reminded, remindPending, onBuy, onToggleRemind }: FlashSlotItemProps) {
  const view = productCardView({ product: flashCardProduct(item), flash: item, variant: 'line', now: serverNow() });
  const upcoming = slotStatus === 'UPCOMING';
  const action = upcoming ? (
    <Button
      size="md"
      variant={reminded ? 'secondary' : 'primary'}
      loading={remindPending}
      aria-pressed={reminded}
      aria-label={slotRemindLabel(item.productName, reminded)}
      style={ACTION_STYLE}
      onPress={() => {
        haptic('light');
        onToggleRemind();
      }}
    >
      {fillCopy(reminded ? 'flash.reminded' : 'flash.remind')}
    </Button>
  ) : (
    <Button
      size="md"
      variant="flash"
      aria-label={slotBuyLabel(item.productName)}
      aria-disabled={item.soldOut || undefined}
      style={ACTION_STYLE}
      onPress={() => {
        if (item.soldOut) return;
        haptic('light');
        onBuy();
      }}
    >
      {fillCopy('flash.buy')}
    </Button>
  );
  return (
    <div style={item.soldOut ? { opacity: 0.55 } : undefined}>
      <ProductTile
        view={view}
        variant="line"
        href={`/product/${encodeURIComponent(item.productSlug)}`}
        // Sản phẩm nhiều phân loại thì Giờ vàng chỉ gắn vào MỘT phân loại: mở trang chi tiết đúng phân loại đó, không ra giá thường.
        navState={{ variationId: item.variationId }}
        note={slotItemNote(item)}
        footerHeight={SOLD_FOOTER_HEIGHT}
        footer={
          <div style={{ height: SOLD_FOOTER_HEIGHT, paddingTop: 4, boxSizing: 'border-box' }}>
            <FlashSoldBar soldPct={soldPercent(item.soldCount, item.quota)} soldOut={item.soldOut} />
          </div>
        }
        action={action}
      />
    </div>
  );
}
