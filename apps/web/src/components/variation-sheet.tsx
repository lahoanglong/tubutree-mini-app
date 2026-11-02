'use client';

// Nguồn: apps/miniapp/src/components/variation-sheet.tsx
import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { clampPickerQty, pickerStartId, pickerStockText } from '@tubutree/app-core/variation-picker';
import { inCartQuantity, lineNote, variationLinePreview } from '@tubutree/app-core/commerce/flash-line';
import { fillTileCopy } from '@tubutree/app-core/commerce/tile-copy';
import { isLowStock } from '@tubutree/app-core/commerce/stock-text';
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
  cartLines,
  cartMayArrive = true,
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
  /**
   * Giỏ hiện tại (`GET /cart`): thêm giỏ cộng dồn và máy chủ giá cả dòng, nên số đã có của phân loại đang chọn đổi tiền hai nút. Bắt buộc ghi ra (chỗ gọi
   * quên truyền thì bảng âm thầm coi giỏ rỗng và nút ghi sai tiền); `undefined` chỉ khi giỏ chưa tải, lỗi hoặc khách chưa đăng nhập, khi đó coi là giỏ rỗng.
   */
  cartLines: readonly { variationId: string; quantity: number }[] | undefined;
  /**
   * `GET /cart` còn có thể về (đã đăng nhập, đang khôi phục phiên, mất mạng tạm thời) nên "Mua ngay" giữ sẵn chỗ cho câu về giỏ. Khách chắc chắn chưa đăng nhập truyền
   * `false`: giỏ không bao giờ về, không có gì để nhảy nên không giữ dải trống. Chỉ đọc ở chế độ "Mua ngay", và chốt theo giá trị lúc mở bảng; mặc định `true` (giữ chỗ, như trước).
   */
  cartMayArrive?: boolean;
  onConfirm: (variation: VariationOption, qty: number) => void;
}) {
  const [id, setId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  // `cartMayArrive` chốt một lần lúc mở bảng: trạng thái phiên đổi khi bảng còn mở (đăng nhập bấm từ chính bảng này đưa 'idle' sang 'loading', huỷ thì về lại) mà chạy theo thì dải ghi chú
  // hiện/ẩn ngay dưới ngón tay, bảng cao thêm hay co lại sau cú bấm. Cập nhật state ngay lúc vẽ (không dùng effect) để lần vẽ đầu của lượt mở đã có giá trị đúng.
  const [mayArriveAtOpen, setMayArriveAtOpen] = useState({ open, value: cartMayArrive });
  if (mayArriveAtOpen.open !== open) setMayArriveAtOpen({ open, value: open ? cartMayArrive : mayArriveAtOpen.value });
  const mayArrive = mayArriveAtOpen.value;

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
  // Tiền dòng theo luật máy chủ: quá giới hạn Giờ vàng mỗi khách thì cả dòng (số có sẵn trong giỏ + số thêm) tính giá thường. "Mua ngay" thanh toán cả dòng
  // giỏ của phân loại này (`lineTotal`); "Thêm vào giỏ" ghi phần giỏ tăng thật (`total`). Giỏ rỗng thì hai số bằng nhau.
  const line = selected ? variationLinePreview(selected, flash, shownQty, inCartQuantity(cartLines, selected.id)) : null;
  const view = line?.pricing ?? null;
  // Một vùng ghi chú một câu: mất giá Giờ vàng, hoặc ("Mua ngay") giỏ đã có sẵn nên thanh toán cả dòng.
  const note = line ? lineNote(line, shownQty, mode === 'buy') : null;
  // Chỗ ghi chú giữ từ lúc mở bảng: có Giờ vàng giới hạn (câu mất giá, không liên quan giỏ), hoặc "Mua ngay" khi giỏ còn có thể về hay đã có. Giữ theo nội dung giỏ thì bảng mở trước khi
  // GET /cart về sẽ cao thêm lúc giỏ về, và giỏ về rỗng lại co lại, cả hai dưới ngón tay đang bấm; đổi chip cũng không được làm bảng cao thêm. Khách chưa đăng nhập (`cartMayArrive`
  // = false) không bao giờ có giỏ nên không có gì để nhảy: không giữ dải trống 2 dòng. "Thêm vào giỏ" không có câu về giỏ nên không giữ.
  const reserveNote = line?.allowance != null || (mode === 'buy' && (mayArrive || cartLines !== undefined));

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
          {available && line ? `${label} · ${formatVnd(mode === 'buy' ? line.lineTotal : line.total)}` : fillTileCopy('stock.out')}
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
            {selected ? (
              <>
                {selected.name} ·{' '}
                {/* Tồn thấp chỉ đổi màu (token cảnh báo), chữ vẫn "Còn n sản phẩm" như mọi mức tồn. */}
                <span data-testid="variation-sheet-stock" style={isLowStock(selected.stock) ? { color: 'var(--color-status-warning-fg)' } : undefined}>
                  {pickerStockText(selected.stock)}
                </span>
              </>
            ) : (
              productName
            )}
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
      {reserveNote && (
        // Vùng thông báo có chỗ giữ cố định (2 dòng chữ caption, đủ cho cả câu mất giá lẫn câu giỏ có sẵn; `--type-caption-lh` là số không đơn vị nên nhân với cỡ chữ) từ lúc mở: chữ hiện ra không làm bảng cao thêm và đẩy ô Số lượng dưới ngón tay đang bấm "+".
        <div role="status" style={{ minHeight: 'calc(var(--type-caption-size) * var(--type-caption-lh) * 2)', marginTop: 'var(--space-stack-xs)' }}>
          {note && (
            <Text variant="caption" tone="secondary" as="p">
              {note}
            </Text>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
