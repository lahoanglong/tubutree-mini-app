'use client';

// Nguồn: apps/miniapp/src/components/ui/combo-card.tsx
import { Fragment, type CSSProperties } from 'react';
import type { ProductCardView } from '@tubutree/app-core/commerce/product-card-view';
import { vnd } from '@tubutree/app-core/commerce/money';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from './badge';
import { Button } from './button';
import { Card } from './card';
import { PriceTag } from './price-tag';
import { ProductThumb } from './product-thumb';

/** `ProductCardView` chưa mang ảnh (P4 có thể thêm); ảnh nhận riêng để hai bên không chờ nhau, giao nhau vẫn đúng khi P4 thêm trường. */
export type ComboCardItem = ProductCardView & { thumbnail?: string | null };

export interface ComboCardProps {
  title: string;
  items: ComboCardItem[];
  /** % giảm của cả bộ, từ API (đã kẹp `storefront.max_combo_pct`). */
  pct: number;
  /** Tổng giá lẻ của các món. */
  total: number;
  /** Tổng sau giảm do API tính; ComboCard chỉ trừ hai số này để ra "Tiết kiệm", không tự tính khoản giảm. */
  comboTotal: number;
  onAddAll: () => void;
  busy?: boolean;
  /** Có thì hiện nút phụ "Xem từng món". */
  onSeeItems?: () => void;
}

/** Tối đa 3 ảnh trong dải; món thứ 4 trở đi gộp thành một ô "+n" (critique-store 3.1b). */
const MAX_THUMBS = 3;
const PLUS: CSSProperties = { color: 'var(--color-text-tertiary)', fontWeight: 600, fontSize: 'var(--type-body-md-size)', lineHeight: 1 };
const THUMB = 56;
/** Nút "Combo tạm hết": nhìn như nút khoá nhưng vẫn là `aria-disabled` (Tab tới được, đọc được tên) thay vì `disabled`. */
const SOLD_OUT_BUTTON: CSSProperties = { background: 'var(--color-action-primary-bg-disabled)', color: 'var(--color-text-secondary)', cursor: 'default' };

/**
 * Khối "mua cả bộ" của gian hàng và thương hiệu: dải ảnh nối bằng dấu "+", danh sách tên món, giá cả bộ kèm giá gạch, một nút chính.
 * Không dùng `ProductTile`: món trong combo không phải thẻ để bấm vào từng cái, chỉ là thành phần của bộ. Dải ảnh chỉ trang trí
 * (`aria-hidden`), danh sách tên mới là thông tin. Giá combo ≥ tổng lẻ thì không có dòng "Tiết kiệm" (không bao giờ "0đ" hay số âm) và cũng không nhãn "Combo -n%": không quảng cáo mức giảm mà giá không có.
 * Có món `stock==='out'` thì không thể thêm cả bộ (API từ chối cả lô nếu thiếu một món): nút thành "Combo tạm hết", không gọi
 * `onAddAll`, bỏ dòng "Tiết kiệm" (khoản tiết kiệm không mua được). "Xem từng món" vẫn có để khách chọn món còn hàng.
 */
export function ComboCard({ title, items, pct, total, comboTotal, onAddAll, busy = false, onSeeItems }: ComboCardProps) {
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_THUMBS);
  const extra = items.length - shown.length;
  const saving = Number.isFinite(total) && Number.isFinite(comboTotal) && total > comboTotal ? total - comboTotal : 0;
  const pctShown = Number.isFinite(pct) ? Math.round(pct) : 0;
  const soldOut = items.some((it) => it.stock === 'out');
  return (
    <Card variant="outline" padding={12}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3
          style={{
            margin: 0,
            minWidth: 0,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--type-body-md-size)',
            lineHeight: 'var(--type-body-md-lh)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </h3>
        {pctShown > 0 && saving > 0 && (
          <span style={{ flex: '0 0 auto', display: 'inline-flex' }}>
            <Badge tone="promo" size="sm">{fillCopy('combo.badge', { pct: pctShown })}</Badge>
          </span>
        )}
      </div>

      <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0' }}>
        {shown.map((it, i) => (
          <Fragment key={it.id}>
            {i > 0 && <span style={PLUS}>+</span>}
            <span data-testid="combo-thumb" style={{ opacity: it.stock === 'out' ? 0.5 : 1, display: 'inline-flex' }}>
              <ProductThumb src={it.thumbnail} alt="" size={THUMB} />
            </span>
          </Fragment>
        ))}
        {extra > 0 && (
          <>
            <span style={PLUS}>+</span>
            <span
              data-testid="combo-more"
              style={{ flex: '0 0 auto', width: THUMB, height: THUMB, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-media)', background: 'var(--color-bg-chip)', color: 'var(--color-text-secondary)', fontWeight: 700, fontSize: 'var(--type-body-md-size)' }}
            >
              {fillCopy('combo.more', { n: extra })}
            </span>
          </>
        )}
      </div>

      <ul aria-label={fillCopy('combo.itemsLabel', { n: items.length })} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((it) => (
          <li
            key={it.id}
            style={{ fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: it.stock === 'out' ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {it.stockText ? `${it.name} · ${it.stockText}` : it.name}
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10, flexWrap: 'wrap', lineHeight: 'var(--type-caption-lh)' }}>
        <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--color-text-secondary)' }}>{fillCopy('combo.setLabel')}</span>
        <PriceTag value={comboTotal} compareAt={total} size="md" />
      </div>
      {saving > 0 && !soldOut && (
        <div style={{ marginTop: 2, fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', fontWeight: 600, color: 'var(--color-text-price-deal)' }}>
          {fillCopy('combo.save', { save: vnd(saving) })}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {soldOut ? (
          <Button fullWidth aria-disabled style={SOLD_OUT_BUTTON}>
            {fillCopy('combo.soldOut')}
          </Button>
        ) : (
          <Button fullWidth loading={busy} aria-label={fillCopy('combo.addSpoken', { title, n: items.length, price: vnd(comboTotal) })} onPress={onAddAll}>
            {fillCopy('combo.add')}
          </Button>
        )}
      </div>
      {onSeeItems && (
        <button
          type="button"
          className="tubu-press"
          onClick={onSeeItems}
          style={{ display: 'block', width: '100%', minHeight: 44, marginTop: 2, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--type-label-size)', fontWeight: 600, color: 'var(--color-text-brand)' }}
        >
          {fillCopy('combo.seeItems')}
        </button>
      )}
    </Card>
  );
}
