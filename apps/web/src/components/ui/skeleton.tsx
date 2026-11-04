import type { CSSProperties } from 'react';
import { ProductTileSkeleton } from '@/components/mini/skeleton';
import { GRID_PRODUCTS } from '@/lib/product-grid';

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

/** Một thẻ sản phẩm: cùng số đo với thẻ thật (`ProductTileSkeleton`), nên trang không nhảy khi dữ liệu về. */
export function ProductCardSkeleton() {
  return <ProductTileSkeleton variant="grid" />;
}

/**
 * Lưới khung chờ: 2 cột trên điện thoại, nhiều cột hơn từ md. Tự là vùng `status` bận kèm chữ đọc "Đang tải sản phẩm…" (thẻ khung chờ aria-hidden nên
 * trình đọc màn hình không biết gì đang tải); chỗ gọi đã nằm trong một vùng status khác thì truyền `status={false}` để không lồng hai vùng.
 * Không đặt aria-busy: luật chân trang gọn trong globals.css ẩn chân trang theo mọi khối aria-busy, mà lưới này là một phần của trang chứ không phải khung chờ cả trang.
 */
export function ProductGridSkeleton({ count = 6, className = GRID_PRODUCTS, status = true }: { count?: number; className?: string; status?: boolean }) {
  return (
    <div className={className} {...(status ? { role: 'status' } : null)}>
      {status && <span className="sr-only">Đang tải sản phẩm…</span>}
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
