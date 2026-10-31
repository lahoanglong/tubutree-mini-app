'use client';

// Nguồn: apps/miniapp/src/components/ui/skeleton.tsx
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { tileBodyHeight, TILE_METRICS } from '@tubutree/app-core/commerce/tile-metrics';

/**
 * Skeleton loading theo spec §7.7: first-load dùng skeleton match đúng layout cuối,
 * KHÔNG spinner toàn màn hình. Shimmer 1.4s định nghĩa trong tokens.css.
 */
interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width = '100%', height = 16, radius, style }: SkeletonProps) {
  return (
    <div
      className="tubu-skeleton"
      aria-hidden
      style={{ width, height, borderRadius: radius ?? 'var(--radius-control)', ...style }}
    />
  );
}

export interface ProductTileSkeletonProps {
  variant?: CardVariant;
  /** Có dòng nhãn hiệu không (mặc định theo biến thể, như thẻ thật). */
  brand?: boolean;
  note?: boolean;
  footerHeight?: number;
}

/**
 * Khung chờ của ProductTile: thân cao đúng `tileBodyHeight` (cùng số đo app-core với thẻ thật và với Mini App; khung chờ lệch nội dung
 * thật làm trang nhảy) và ảnh giữ tỉ lệ 1:1. Từ md thẻ thật có viền nên khung chờ cũng thêm viền.
 */
export function ProductTileSkeleton({ variant = 'grid', brand, note = false, footerHeight }: ProductTileSkeletonProps) {
  const hasBrand = brand ?? (variant === 'grid' || variant === 'rail-md');
  const height = tileBodyHeight(variant, { brand: hasBrand, note, footer: footerHeight });
  const caption = variant === 'rail-sm' || variant === 'flash';
  const stacked = variant === 'rail-sm' || variant === 'rail-md' || variant === 'flash' || variant === 'rank';
  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface)',
    borderRadius: 'var(--radius-card)',
    overflow: 'hidden',
    boxShadow: 'var(--elevation-1)',
  };
  const cardClass = 'md:border md:border-stone-200 md:shadow-card';
  if (variant === 'line') {
    return (
      <div data-testid="catalog-tile-skeleton" aria-hidden="true" className={cardClass} style={cardStyle}>
        <div data-testid="catalog-tile-skeleton-body" style={{ height, padding: TILE_METRICS.inset, boxSizing: 'border-box', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Skeleton width={64} height={64} radius="var(--radius-media)" style={{ flex: '0 0 auto' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton width="75%" height={14} />
            <Skeleton width={80} height={TILE_METRICS.price} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="catalog-tile-skeleton" aria-hidden="true" className={cardClass} style={cardStyle}>
      <Skeleton height="auto" radius="0" style={{ aspectRatio: '1 / 1' }} />
      <div data-testid="catalog-tile-skeleton-body" style={{ height, padding: TILE_METRICS.inset, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {hasBrand && <Skeleton width={56} height={TILE_METRICS.brand - 4} style={{ marginBottom: 4 }} />}
        <Skeleton width="90%" height={caption ? TILE_METRICS.nameCaption : TILE_METRICS.name} />
        <div style={{ marginTop: 'auto', paddingTop: TILE_METRICS.gap }}>
          <Skeleton width={80} height={TILE_METRICS.price} />
          {stacked && <Skeleton width={48} height={TILE_METRICS.compare - 4} style={{ marginTop: 2, marginBottom: 2 }} />}
          {note && <Skeleton width="60%" height={TILE_METRICS.note - 4} style={{ marginTop: 2, marginBottom: 2 }} />}
          {(variant === 'grid' || variant === 'rail-md' || variant === 'rank') && (
            <Skeleton width="50%" height={TILE_METRICS.meta - 4} style={{ marginTop: TILE_METRICS.metaGap + 2, marginBottom: 2 }} />
          )}
        </div>
        {footerHeight ? <div style={{ height: footerHeight }} /> : null}
      </div>
    </div>
  );
}

/** Skeleton 1 thẻ sản phẩm lưới (tên cũ, giữ cho nơi đã gọi): chính là ProductTileSkeleton `grid`. */
export function ProductCardSkeleton() {
  return <ProductTileSkeleton variant="grid" />;
}

/** Grid skeleton 2 cột cho catalog/home. */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Skeleton 1 dòng item giỏ hàng / đơn hàng. */
export function LineItemSkeleton() {
  return (
    <div
      style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        padding: 12,
        display: 'flex',
        gap: 12,
      }}
    >
      <Skeleton width={64} height={64} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton width="75%" height={13} />
        <Skeleton width="40%" height={11} />
        <Skeleton width={90} height={15} />
      </div>
    </div>
  );
}
