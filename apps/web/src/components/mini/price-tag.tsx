'use client';

// Nguồn: apps/miniapp/src/components/ui/price-tag.tsx
import type { CSSProperties } from 'react';
import { formatVndShort } from '@/lib/browse-text';

// Giá thiếu hiện "—", không phải "0đ" (0đ nghĩa là miễn phí); khớp formatVnd của Mini App.
const MISSING_AMOUNT = '—';
const toAmount = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const formatVnd = (v: number | null | undefined): string => {
  const n = toAmount(v);
  return n === null ? MISSING_AMOUNT : `${n.toLocaleString('vi-VN')}đ`;
};

const SIZE_VARIANT = { sm: 'price-sm', md: 'price-md', lg: 'price-lg', xl: 'price-xl' } as const;

export interface PriceTagProps {
  value: number | null | undefined;
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
  const shown = toAmount(displayValue);
  const showCompare = typeof compareAt === 'number' && shown !== null && compareAt > shown;
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
export function Money({ amount, short }: { amount: number | null | undefined; short?: boolean }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{short && toAmount(amount) !== null ? formatVndShort(amount as number) : formatVnd(amount)}</span>;
}

const POINTS_FORMAT = new Intl.NumberFormat('vi-VN');

export function Points({ value }: { value: number | null | undefined }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{`${POINTS_FORMAT.format(toAmount(value) ?? 0)} điểm`}</span>;
}
