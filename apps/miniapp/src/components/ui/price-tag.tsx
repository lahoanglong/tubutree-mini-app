import type { CSSProperties } from 'react';
import { formatVnd, formatVndShort, formatPoints, formatXu } from '../../utils/format';

const SIZE_VARIANT = { sm: 'price-sm', md: 'price-md', lg: 'price-lg', xl: 'price-xl' } as const;

export interface PriceTagProps {
  value: number;
  compareAt?: number | null;
  flash?: { price: number } | null;
  size?: keyof typeof SIZE_VARIANT;
  tone?: 'default' | 'inverse';
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Giá — thay 60 kiểu trình bày / 134 lần render rải rác (audit A4-10). Giá giờ vàng LUÔN thắng
 * khi có (đúng quy tắc flash > sale > base BE đã dùng ở giỏ hàng — không tự tính lại ở đây). */
export function PriceTag({ value, compareAt, flash, size = 'md', tone = 'default', style, ...rest }: PriceTagProps) {
  const displayValue = flash ? flash.price : value;
  const showCompare = typeof compareAt === 'number' && compareAt > displayValue;
  const variant = SIZE_VARIANT[size];
  const color = tone === 'inverse' ? 'var(--color-text-inverse)' : flash ? 'var(--color-flash-fg)' : 'var(--color-text-price)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, ...style }} {...rest}>
      <span style={{ fontFamily: 'var(--font-ui)', color, fontVariantNumeric: 'tabular-nums', ...typeStyleFor(variant) }}>
        {formatVnd(displayValue)}
      </span>
      {showCompare && (
        <span style={{ color: 'var(--color-text-price-compare)', textDecoration: 'line-through', fontSize: 'var(--type-caption-size)' }}>
          {formatVnd(compareAt)}
        </span>
      )}
    </span>
  );
}

function typeStyleFor(variant: string): CSSProperties {
  return {
    fontSize: `var(--type-${variant}-size)`,
    lineHeight: `var(--type-${variant}-lh)`,
    fontWeight: `var(--type-${variant}-weight)` as unknown as number,
  };
}

/** `short`: dùng `formatVndShort` (50000 → "50k") cho câu chữ marketing thay vì số đầy đủ. */
export function Money({ amount, short }: { amount: number; short?: boolean }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{short ? formatVndShort(amount) : formatVnd(amount)}</span>;
}

export function Points({ value }: { value: number }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPoints(value)}</span>;
}

export function Xu({ value }: { value: number }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatXu(value)}</span>;
}
