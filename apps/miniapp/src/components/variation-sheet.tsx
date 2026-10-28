import { useEffect, useState } from 'react';
import {
  clampPickerQty,
  pickerStartId,
  pickerStockText,
  pickerView,
} from '@tubutree/app-core/variation-picker';
import type { FlashPriceItem } from '@tubutree/app-core/flash-price';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { PriceTag } from './ui/price-tag';
import { ProductThumb } from './ui/product-thumb';
import { QuantitySelector } from './ui/quantity-selector';
import { Text } from './ui/text';
import { rowKeyboardProps } from './ui/row-keyboard';

export interface VariationOption {
  id: string;
  sku?: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

export type VariationSheetMode = 'add' | 'buy';

/**
 * Bảng chọn phân loại kiểu Shopee cho sản phẩm từ 2 phân loại: ảnh, tên, giá, tồn kho, số lượng và nút xác nhận.
 * Thêm giỏ và Mua ngay cùng mở bảng này; chỉ nhãn nút xác nhận khác nhau.
 */
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
  busy,
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
  busy: boolean;
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
  const view = selected ? pickerView(selected, flash) : null;
  const available = (selected?.stock ?? 0) > 0;
  const label = mode === 'buy' ? 'Mua ngay' : 'Thêm vào giỏ';

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
          loading={busy}
          disabled={!selected || !available}
          onPress={() => selected && onConfirm(selected, clampPickerQty(selected, qty))}
        >
          {available && view ? `${label} · ${formatVnd(view.price * clampPickerQty(selected, qty))}` : 'Hết hàng'}
        </Button>
      }
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <ProductThumb src={thumbnail} alt={productName} size={80} />
        <div style={{ minWidth: 0, flex: 1 }}>
          {view && <PriceTag value={view.price} compareAt={view.compareAt} size="lg" />}
          <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 4 }}>
            {selected ? `${selected.name} · ${pickerStockText(selected.stock)}` : productName}
          </Text>
        </div>
      </div>

      <div role="group" aria-label="Phân loại" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
        {variations.map((v) => {
          const out = v.stock <= 0;
          const active = v.id === id;
          return (
            <div
              key={v.id}
              role="button"
              aria-pressed={active}
              aria-disabled={out}
              {...(out ? null : rowKeyboardProps())}
              className={out ? undefined : 'tubu-press'}
              onClick={
                out
                  ? undefined
                  : () => {
                      haptic('light');
                      setId(v.id);
                      setQty((q) => clampPickerQty(v, q));
                    }
              }
              style={{
                padding: '8px 14px',
                minHeight: 44,
                boxSizing: 'border-box',
                borderRadius: 'var(--radius-control)',
                border: `1.5px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
                background: active ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
                opacity: out ? 0.55 : 1,
              }}
            >
              <Text
                variant="body-sm"
                style={{
                  color: active ? 'var(--color-text-brand)' : 'var(--color-text-primary)',
                  textDecoration: out ? 'line-through' : 'none',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {v.name}
              </Text>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
        <Text variant="body-sm" style={{ fontWeight: 600 }}>
          Số lượng
        </Text>
        <QuantitySelector
          value={qty}
          max={Math.max(1, selected?.stock ?? 1)}
          onChange={(n) => {
            haptic('light');
            setQty(n);
          }}
        />
      </div>
    </BottomSheet>
  );
}
