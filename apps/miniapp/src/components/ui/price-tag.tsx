import type { CSSProperties } from 'react';
import { TILE_COPY } from '@tubutree/app-core/commerce/tile-copy';
import { formatVnd, formatVndShort, formatPoints } from '../../utils/format';
import { SR_ONLY } from './sr-only';

const SIZE_VARIANT = { sm: 'price-sm', md: 'price-md', lg: 'price-lg', xl: 'price-xl', tile: 'price-tile' } as const;

// Phần chữ đứng trước số trong mẫu chữ đọc ("Giá {price}" → "Giá "): số hiển thị nằm ở phần tử riêng nên chỉ cần phần dẫn.
const lead = (template: string) => template.replace('{price}', '');
const SPOKEN_PRICE = lead(TILE_COPY['price.spoken']);
const SPOKEN_FLASH = lead(TILE_COPY['price.flashSpoken']);
const SPOKEN_COMPARE = lead(TILE_COPY['price.compareSpoken']);

export interface PriceTagProps {
  value: number | null;
  compareAt?: number | null;
  flash?: { price: number } | null;
  size?: keyof typeof SIZE_VARIANT;
  /** `deal`: giá đang giảm (Giờ vàng hoặc giá sale) màu cam đậm; `flash` tự là `deal`. */
  tone?: 'default' | 'deal' | 'inverse';
  /** `stack`: giá gạch xuống dòng dưới (thẻ hẹp 128/148px). */
  layout?: 'inline' | 'stack';
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Giá — thay 60 kiểu trình bày / 134 lần render rải rác (audit A4-10). Giá giờ vàng LUÔN thắng
 * khi có (đúng quy tắc flash > sale > base BE đã dùng ở giỏ hàng — không tự tính lại ở đây).
 * Trình đọc màn hình không đọc gạch ngang, nên chữ đọc "Giá …, giá gốc …" nằm trong phần tử ẩn (a11y A1). */
export function PriceTag({ value, compareAt, flash, size = 'md', tone = 'default', layout = 'inline', style, ...rest }: PriceTagProps) {
  const displayValue = flash ? flash.price : value;
  const missing = displayValue === null;
  const showCompare = !missing && typeof compareAt === 'number' && compareAt > displayValue;
  const variant = SIZE_VARIANT[size];
  const deal = flash || tone === 'deal';
  const color = tone === 'inverse' ? 'var(--color-text-inverse)' : deal ? 'var(--color-text-price-deal)' : 'var(--color-text-price)';
  const stack = layout === 'stack';
  return (
    <span
      style={{
        display: 'inline-flex',
        ...(stack ? { flexDirection: 'column', alignItems: 'flex-start', gap: 0 } : { alignItems: 'baseline', gap: 6, minWidth: 0 }),
        ...style,
      }}
      {...rest}
    >
      {!missing && <span style={SR_ONLY}>{flash ? SPOKEN_FLASH : SPOKEN_PRICE}</span>}
      <span style={{ fontFamily: 'var(--font-ui)', color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...typeStyleFor(variant) }}>
        {formatVnd(displayValue)}
      </span>
      {showCompare && (
        <>
          <span style={SR_ONLY}>{SPOKEN_COMPARE}</span>
          <span
            style={{
              color: 'var(--color-text-price-compare)',
              textDecoration: 'line-through',
              whiteSpace: 'nowrap',
              // Hàng ngang: số lớn thì giá gạch cắt bớt thay vì đẩy giá thật xuống dòng.
              ...(stack ? { fontSize: 'var(--type-label-size)', lineHeight: '16px' } : { fontSize: 'var(--type-caption-size)', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }),
            }}
          >
            {formatVnd(compareAt)}
          </span>
        </>
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
