'use client';

// Nguồn: apps/miniapp/src/components/flash/flash-slot-item.tsx
import type { CSSProperties } from 'react';
import type { FlashSlotItem as FlashSlotItemData, FlashSlotStatus } from '@tubutree/app-core/api/flash-sale';
import { productCardView } from '@tubutree/app-core/commerce/product-card-view';
import { slotBuyLabel, slotItemNote, slotRemindLabel } from '@tubutree/app-core/commerce/flash-slots';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { serverNow } from '@tubutree/app-core/server-clock';
import { flashCardProduct, soldPercent } from '@/lib/flash-display';
import { productHref } from '@/lib/product-href';
import { Button } from '@/components/mini/button';
import { FlashSoldBar } from '@/components/mini/flash-sold-bar';
import { ProductTile } from '@/components/mini/product-tile';

/** Chỗ thanh đã bán dưới giá: 4 (cách giá) + 16 (thanh có chữ). */
const SOLD_FOOTER_HEIGHT = 20;
/** Nút ở cuối hàng: cao 44 (vùng chạm), rộng tối đa 96 để cột tên và giá còn đủ chỗ ở màn 375px; nhãn cỡ `label` cho "Đã đặt nhắc" vừa trong 96. */
const ACTION_STYLE: CSSProperties = { minWidth: 0, maxWidth: 96, padding: '0 8px', fontSize: 'var(--type-label-size)', whiteSpace: 'nowrap' };
/** Nút của món hết suất: mờ như ảnh (nút khoá bằng aria-disabled nên không tính tương phản chữ). */
const SOLD_OUT_ACTION_STYLE: CSSProperties = { ...ACTION_STYLE, opacity: 0.55 };

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
 * Một dòng món của trang Giờ vàng: thẻ `line` chung + thanh đã bán có chữ ở cuối thân + một nút ở cuối hàng. Thanh đã bán chỉ vẽ khi khung đang diễn ra:
 * khung chưa mở thì chưa có suất nào bán, chữ "Vừa mở bán" của thanh sẽ nói ngược lại với dòng "Bắt đầu sau ..." ngay trên đó (chỗ thanh để trống đúng
 * chiều cao nên thẻ không nhảy khi khung mở). Món hết suất vẫn hiện nhưng ảnh và nút mờ, nút khoá (aria-disabled, không `disabled` thật để vẫn nằm trong
 * thứ tự Tab và đọc được lý do qua thanh "Đã bán hết"); chữ giữ nguyên độ đậm vì chữ thông tin mờ đi thì tụt dưới tương phản 4,5:1. Chạm nút không mở sản phẩm.
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
      onPress={onToggleRemind}
    >
      {fillCopy(reminded ? 'flash.reminded' : 'flash.remind')}
    </Button>
  ) : (
    <Button
      size="md"
      variant="flash"
      aria-label={slotBuyLabel(item.productName)}
      aria-disabled={item.soldOut || undefined}
      style={item.soldOut ? SOLD_OUT_ACTION_STYLE : ACTION_STYLE}
      onPress={() => {
        if (item.soldOut) return;
        onBuy();
      }}
    >
      {fillCopy('flash.buy')}
    </Button>
  );
  return (
    <ProductTile
      view={view}
      variant="line"
      // Sản phẩm nhiều phân loại thì Giờ vàng chỉ gắn vào MỘT phân loại: `?v=` mở trang chi tiết đúng phân loại đó (chỉ khi suất thật sự rẻ hơn), không ra giá thường.
      href={productHref(encodeURIComponent(item.productSlug), view.isFlash ? item.variationId : null)}
      note={slotItemNote(item)}
      dimMedia={item.soldOut}
      footerHeight={SOLD_FOOTER_HEIGHT}
      footer={
        <div style={{ height: SOLD_FOOTER_HEIGHT, paddingTop: 4, boxSizing: 'border-box' }}>
          {!upcoming && <FlashSoldBar soldPct={soldPercent(item.soldCount, item.quota)} soldOut={item.soldOut} />}
        </div>
      }
      action={action}
    />
  );
}
