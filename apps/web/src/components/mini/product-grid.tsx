'use client';

// Nguồn: apps/miniapp/src/components/ui/product-grid.tsx
import type { ReactNode } from 'react';
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import type { ProductCard as ProductCardType } from '@/lib/api';
import { GRID_PRODUCTS } from '@/lib/product-grid';
import { ProductCard } from './product-card';
import { ProductTileSkeleton } from './skeleton';

export interface ProductGridProps {
  items: readonly ProductCardType[];
  variant: CardVariant;
  /** Hạng của thẻ đầu; thẻ sau tăng dần (biến thể `rank`). */
  rankFrom?: number;
  /** Lớp cột của lưới; mặc định `GRID_PRODUCTS`, trang có cột lọc dùng `GRID_PRODUCTS_WITH_FILTER`. */
  className?: string;
  loading?: boolean;
  skeletonCount?: number;
  showBrand?: boolean;
  showWishlist?: boolean;
  /** Số thẻ đầu tải ảnh ngay (ứng viên LCP: `PRIORITY_CARDS` cho lưới ở màn hình đầu); mặc định 0, lưới nằm dưới thì tải lười. */
  priorityCount?: number;
  /** Nút nổi trên ảnh của từng thẻ (giỏ nhanh ở Yêu thích). */
  renderImageOverlay?: (product: ProductCardType, index: number) => ReactNode;
  /** Phần ngoài thẻ, ngay dưới thẻ trong cùng ô lưới (ghi chú của chủ gian hàng). */
  renderAfter?: (product: ProductCardType, index: number) => ReactNode;
  /** Ghi chú trong thẻ (dưới giá). Có ít nhất một thẻ có ghi chú thì thẻ còn lại giữ chỗ dòng đó, cùng hàng vẫn thẳng giá. */
  noteOf?: (product: ProductCardType, index: number) => string | undefined;
  onOpen?: (product: ProductCardType, index: number) => void;
}

/** Lưới thẻ: 2 cột điện thoại, nhiều cột hơn từ md; `loading` vẽ khung chờ cùng số đo với thẻ thật nên trang không nhảy khi dữ liệu về. */
export function ProductGrid({
  items,
  variant,
  rankFrom,
  className = GRID_PRODUCTS,
  loading = false,
  skeletonCount = 6,
  showBrand,
  showWishlist,
  priorityCount = 0,
  renderImageOverlay,
  renderAfter,
  noteOf,
  onOpen,
}: ProductGridProps) {
  if (loading) {
    return (
      <div data-testid="catalog-grid-skeleton" aria-hidden="true" className={className}>
        {Array.from({ length: skeletonCount }, (_, i) => (
          <ProductTileSkeleton key={i} variant={variant} brand={showBrand === false ? false : undefined} />
        ))}
      </div>
    );
  }
  const notes = noteOf ? items.map((p, i) => noteOf(p, i)) : null;
  const reserveNote = notes?.some((n) => !!n) ?? false;
  return (
    <ul role="list" data-testid="catalog-grid" className={className} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((p, i) => (
        <li key={`${p.id}:${i}`} style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <ProductCard
              product={p}
              variant={variant}
              rank={rankFrom === undefined ? undefined : rankFrom + i}
              priority={i < priorityCount}
              showBrand={showBrand}
              showWishlist={showWishlist}
              note={notes?.[i] || (reserveNote ? '' : undefined)}
              imageOverlay={renderImageOverlay?.(p, i)}
              onOpen={onOpen ? () => onOpen(p, i) : undefined}
            />
          </div>
          {renderAfter?.(p, i)}
        </li>
      ))}
    </ul>
  );
}
