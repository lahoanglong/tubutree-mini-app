import { Zap } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { fillTileCopy } from '@tubutree/app-core/commerce/tile-copy';
import { formatVnd } from '../../utils/format';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { SR_ONLY } from '../ui/sr-only';
import { Text } from '../ui/text';

export interface VariationChipProps {
  variation: { name: string; stock: number };
  /** Giá khách thật sự trả cho một đơn vị (đã áp Giờ vàng), từ `variationPricing`. */
  pricing: { price: number; isFlash: boolean; salePct?: number };
  active: boolean;
  onClick: () => void;
}

/**
 * Chip phân loại 2 dòng: tên + giá khách thật sự trả (đã áp Giờ vàng). Dùng chung ở trang chi tiết và bảng chọn phân loại để hai nơi ghi
 * cùng giá, cùng dấu Giờ vàng và cùng chữ hết hàng ("Tạm hết hàng", không chỉ gạch ngang). Hết hàng = mờ + gạch nhưng vẫn xem được, không chọn được.
 */
export function VariationChip({ variation, pricing, active, onClick }: VariationChipProps) {
  const out = variation.stock <= 0;
  // Giờ vàng đã có dấu riêng; ở đây chỉ phân loại đang giảm giá thường (giá gạch cao hơn giá bán) mới ghi phần trăm tiết kiệm.
  const savePct = !out && !pricing.isFlash && (pricing.salePct ?? 0) > 0 ? pricing.salePct! : 0;
  return (
    <div
      role="button"
      aria-pressed={active}
      aria-disabled={out}
      {...(out ? null : rowKeyboardProps())}
      className={out ? 'tubu-var-chip' : 'tubu-var-chip tubu-press'}
      onClick={out ? undefined : onClick}
      style={{ opacity: out ? 0.55 : 1 }}
    >
      <Text
        variant="body-sm"
        as="div"
        style={{
          color: active ? 'var(--color-text-brand)' : 'var(--color-text-primary)',
          textDecoration: out ? 'line-through' : 'none',
          fontWeight: active ? 600 : 400,
        }}
      >
        {variation.name}
      </Text>
      <Text
        variant="caption"
        as="div"
        numeric
        style={{
          color: out ? 'var(--color-text-disabled)' : pricing.isFlash ? 'var(--color-text-price-deal)' : active ? 'var(--color-text-brand)' : 'var(--color-text-secondary)',
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
    </div>
  );
}
