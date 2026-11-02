'use client';

// Nguồn: apps/miniapp/src/components/variation-sheet.tsx
import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { clampPickerQty, pickerStartId, pickerStockText } from '@tubutree/app-core/variation-picker';
import { variationLinePreview } from '@tubutree/app-core/commerce/flash-line';
import { fillTileCopy } from '@tubutree/app-core/commerce/tile-copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { variationPricing, type FlashPriceItem } from '@tubutree/app-core/flash-price';
import { formatVnd } from '@/lib/shop-client';
import { Badge } from '@/components/mini/badge';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { Button } from '@/components/mini/button';
import { PriceTag } from '@/components/mini/price-tag';
import { ProductThumb } from '@/components/mini/product-thumb';
import { QuantitySelector } from '@/components/mini/quantity-selector';
import { Text } from '@/components/mini/text';
import { VariationChip } from './variation-chip';

export interface VariationOption {
  id: string;
  sku?: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

export type VariationSheetMode = 'add' | 'buy';

/** Bảng chọn phân loại kiểu Shopee cho sản phẩm từ 2 phân loại ở khổ điện thoại, giống hệt bản Mini App. */
export function VariationSheet({
  open,
  onClose,
  mode,
  productName,
  thumbnail,
  variations,
  flash,
  initialId,
  initialQty,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  mode: VariationSheetMode;
  productName: string;
  thumbnail: string | null;
  variations: readonly VariationOption[];
  flash: readonly FlashPriceItem[];
  initialId: string | null;
  initialQty: number;
  onConfirm: (variation: VariationOption, qty: number) => void;
}) {
  const [id, setId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (!open) return;
    const start = pickerStartId(variations, initialId);
    setId(start);
    setQty(clampPickerQty(variations.find((v) => v.id === start), initialQty));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chốt lựa chọn một lần mỗi lần mở bảng
  }, [open]);

  const selected = variations.find((v) => v.id === id);
  const available = (selected?.stock ?? 0) > 0;
  const label = mode === 'buy' ? 'Mua ngay' : 'Thêm vào giỏ';
  const shownQty = clampPickerQty(selected, qty);
  // Tiền dòng theo luật máy chủ: quá giới hạn Giờ vàng mỗi khách thì cả dòng tính giá thường, nên nút ghi số đó chứ không phải qty × giá Giờ vàng.
  const line = selected ? variationLinePreview(selected, flash, shownQty) : null;
  const view = line?.pricing ?? null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Chọn phân loại"
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!selected || !available}
          onPress={() => selected && onConfirm(selected, clampPickerQty(selected, qty))}
        >
          {available && line ? `${label} · ${formatVnd(line.total)}` : fillTileCopy('stock.out')}
        </Button>
      }
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <ProductThumb src={thumbnail} alt={productName} size={80} />
        <div style={{ minWidth: 0, flex: 1 }}>
          {view && (
            <span data-testid="variation-sheet-price">
              <PriceTag value={view.price} compareAt={view.compareAt} size="lg" tone={view.isFlash ? 'deal' : 'default'} />
            </span>
          )}
          {view?.isFlash && (
            <div data-testid="variation-sheet-flash" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-inline-xs) var(--space-inline-sm)', marginTop: 'var(--space-stack-xs)' }}>
              <Badge tone="flash" size="sm" icon={Zap}>
                {fillCopy('flash.title')}
              </Badge>
              {line?.limit != null && (
                <>
                  <span aria-hidden="true">
                    <Text variant="caption" tone="secondary">
                      {fillCopy('flash.limitShort', { n: line.limit })}
                    </Text>
                  </span>
                  <span className="sr-only">{fillCopy('flash.limitSpoken', { n: line.limit })}</span>
                </>
              )}
            </div>
          )}
          <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 4 }}>
            {selected ? `${selected.name} · ${pickerStockText(selected.stock)}` : productName}
          </Text>
        </div>
      </div>

      <div role="group" aria-label="Phân loại" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
        {variations.map((v) => (
          <VariationChip
            key={v.id}
            variation={v}
            pricing={variationPricing(v, flash)}
            active={v.id === id}
            onClick={() => {
              setId(v.id);
              setQty((q) => clampPickerQty(v, q));
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
        <Text variant="body-sm" style={{ fontWeight: 600 }}>
          Số lượng
        </Text>
        <QuantitySelector value={qty} max={Math.max(1, selected?.stock ?? 1)} onChange={setQty} />
      </div>
      {line?.limit != null && (
        // Vùng thông báo có chỗ giữ cố định (2 dòng chữ nhỏ) từ lúc mở: chữ hiện ra không làm bảng cao thêm và đẩy ô Số lượng dưới ngón tay đang bấm "+".
        <div role="status" style={{ minHeight: 'calc(var(--type-caption-lh) * 2)', marginTop: 'var(--space-stack-xs)' }}>
          {line.overLimit && (
            <Text variant="caption" tone="secondary" as="p">
              {fillCopy('flash.sheetOverLimit', { n: line.limit, qty: shownQty })}
            </Text>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
