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
      style={{ width, height, borderRadius: radius ?? 'var(--radius-md)', ...style }}
    />
  );
}

/** Skeleton 1 thẻ sản phẩm — khớp layout ProductCard (ảnh 1:1 + 3 dòng). */
export function ProductCardSkeleton() {
  return (
    <div
      style={{
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <Skeleton height="auto" radius="0" style={{ aspectRatio: '1 / 1' }} />
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Skeleton width={56} height={11} />
        <Skeleton width="90%" height={13} />
        <Skeleton width="60%" height={13} />
        <Skeleton width={80} height={15} />
      </div>
    </div>
  );
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
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
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
