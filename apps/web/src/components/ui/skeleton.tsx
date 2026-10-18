import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  rounded?: string;
  style?: CSSProperties;
}

/** Khung chờ đúng bố cục cuối (không spinner toàn màn hình). Tắt hoạt ảnh khi khách chọn giảm chuyển động. */
export function Skeleton({ width = '100%', height = 16, rounded = 'rounded-control', style }: SkeletonProps) {
  return <div aria-hidden="true" data-skeleton className={`animate-pulse bg-stone-100 motion-reduce:animate-none ${rounded}`} style={{ width, height, ...style }} />;
}

/** Một thẻ sản phẩm: ảnh 1:1 và ba dòng chữ. */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card bg-stone-0 shadow-card">
      <Skeleton height="auto" rounded="rounded-none" style={{ aspectRatio: '1 / 1' }} />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton width={56} height={12} />
        <Skeleton width="90%" height={14} />
        <Skeleton width="60%" height={14} />
        <Skeleton width={80} height={16} />
      </div>
    </div>
  );
}

/** Lưới khung chờ: 2 cột trên điện thoại, nhiều cột hơn từ md. */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Một dòng sản phẩm của giỏ hàng / đơn hàng. */
export function LineItemSkeleton() {
  return (
    <div className="flex gap-3 rounded-card bg-stone-0 p-3 shadow-card">
      <Skeleton width={64} height={64} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton width="75%" height={14} />
        <Skeleton width="40%" height={12} />
        <Skeleton width={90} height={16} />
      </div>
    </div>
  );
}
