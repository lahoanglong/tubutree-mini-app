import { Zap } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { fillTileCopy } from '@tubutree/app-core/commerce/tile-copy';
import { formatVnd } from '../../utils/format';
import { variationLabel } from '../../utils/variation-label';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { SR_ONLY } from '../ui/sr-only';
import { Text } from '../ui/text';

export interface VariationChipProps {
  variation: { name: string; stock: number };
  /** Số phân loại của sản phẩm (kể cả phân loại này): tên trống thì "Mặc định" khi có anh em, không có anh em thì chip chỉ còn giá. Chip chỉ vẽ trong bộ chọn từ 2 phân loại nên mặc định là 2. */
  siblingCount?: number;
  /** Giá khách thật sự trả cho một đơn vị (đã áp Giờ vàng), từ `variationPricing`. */
  pricing: { price: number; isFlash: boolean; salePct?: number };
  active: boolean;
  onClick: () => void;
  /** Hết hàng mà vẫn chọn được: cờ báo hàng về bật, khách chọn đúng phân loại rồi bấm "Báo tôi khi có hàng". Mặc định khoá như trước. */
  outSelectable?: boolean;
  /** Giá theo đơn vị của phân loại này ("≈ 9.900đ / 100ml", `commerce/unit-price.ts`); không truyền thì chip giữ hai dòng như cũ. */
  unit?: string | null;
  /** Nhãn "Lợi hơn 37% mỗi 100ml" nếu đây là phân loại được nhãn; nằm cùng dòng giá theo đơn vị để chip chỉ thêm một dòng. */
  better?: string | null;
}

/**
 * Chip phân loại 2 dòng: tên + giá khách thật sự trả (đã áp Giờ vàng). Dùng chung ở trang chi tiết và bảng chọn phân loại để hai nơi ghi
 * cùng giá, cùng dấu Giờ vàng và cùng chữ hết hàng ("Tạm hết hàng", không chỉ gạch ngang). Hết hàng = mờ + gạch nhưng vẫn xem được, không chọn được (trừ khi `outSelectable`).
 */
export function VariationChip({ variation, siblingCount = 2, pricing, active, onClick, outSelectable = false, unit, better }: VariationChipProps) {
  const out = variation.stock <= 0;
  const locked = out && !outSelectable;
  const label = variationLabel(variation.name, siblingCount);
  // Giờ vàng đã có dấu riêng; ở đây chỉ phân loại đang giảm giá thường (giá gạch cao hơn giá bán) mới ghi phần trăm tiết kiệm.
  const savePct = !out && !pricing.isFlash && (pricing.salePct ?? 0) > 0 ? pricing.salePct! : 0;
  return (
    <div
      role="button"
      aria-pressed={active}
      aria-disabled={locked}
      {...(locked ? null : rowKeyboardProps())}
      className={locked ? 'tubu-var-chip' : 'tubu-var-chip tubu-press'}
      onClick={locked ? undefined : onClick}
      style={{ opacity: locked ? 0.55 : 1 }}
    >
      {label && (
        <Text
          variant="body-sm"
          as="div"
          style={{
            color: active ? 'var(--color-text-brand)' : 'var(--color-text-primary)',
            textDecoration: locked ? 'line-through' : 'none',
            fontWeight: active ? 600 : 400,
          }}
        >
          {label}
        </Text>
      )}
      <Text
        variant="caption"
        as="div"
        numeric
        style={{
          color: locked ? 'var(--color-text-disabled)' : out ? 'var(--color-text-secondary)' : pricing.isFlash ? 'var(--color-text-price-deal)' : active ? 'var(--color-text-brand)' : 'var(--color-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-inline-xs)',
        }}
      >
        {out ? (
          fillTileCopy('stock.out')
        ) : (
          <>
            {pricing.isFlash && <Zap size={12} strokeWidth={2} aria-hidden="true" />}
            {formatVnd(pricing.price)}
            {pricing.isFlash && <span style={SR_ONLY}>, {fillCopy('flash.title')}</span>}
            {savePct > 0 && (
              <>
                <span aria-hidden="true" style={{ color: 'var(--color-text-price-deal)', fontWeight: 600 }}>
                  {fillTileCopy('badge.discount', { pct: savePct })}
                </span>
                <span style={SR_ONLY}>, {fillTileCopy('badge.discountSpoken', { pct: savePct })}</span>
              </>
            )}
          </>
        )}
      </Text>
      {!out && unit && (
        <Text variant="caption" as="div" tone="secondary" numeric data-testid="variation-unit-price">
          {unit}
          {better && <span style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}> · {better}</span>}
        </Text>
      )}
    </div>
  );
}
