import type { CSSProperties, ReactNode } from 'react';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { ProductCard } from './product-card';
import { ProductTileSkeleton } from './skeleton';

const GRID_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, listStyle: 'none', margin: 0, padding: 0 };

export interface ProductGridProps {
  /** Số cột: 2 (mặc định) cho thẻ dọc; 1 cho hàng thẻ `line` (khối STACK của gian hàng). */
  columns?: 1 | 2;
  items: readonly ProductCardData[];
  variant: CardVariant;
  /** Hạng của thẻ đầu; thẻ sau tăng dần (biến thể `rank`). */
  rankFrom?: number;
  listSource?: string;
  loading?: boolean;
  skeletonCount?: number;
  showBrand?: boolean;
  showWishlist?: boolean;
  /** Nút nổi trên ảnh của từng thẻ (giỏ nhanh ở Yêu thích). */
  renderImageOverlay?: (product: ProductCardData, index: number) => ReactNode;
  /** Phần ngoài thẻ, ngay dưới thẻ trong cùng ô lưới (ghi chú của chủ gian hàng). */
  renderAfter?: (product: ProductCardData, index: number) => ReactNode;
  /** Ghi chú trong thẻ (dưới giá). Có ít nhất một thẻ có ghi chú thì thẻ còn lại giữ chỗ dòng đó, cùng hàng vẫn thẳng giá. */
  noteOf?: (product: ProductCardData, index: number) => string | undefined;
  onOpen?: (product: ProductCardData, index: number) => void;
}

/** Lưới 2 cột; `loading` vẽ khung chờ cùng số đo với thẻ thật nên trang không nhảy khi dữ liệu về. */
export function ProductGrid({
  columns = 2,
  items,
  variant,
  rankFrom,
  listSource,
  loading = false,
  skeletonCount = 6,
  showBrand,
  showWishlist,
  renderImageOverlay,
  renderAfter,
  noteOf,
  onOpen,
}: ProductGridProps) {
  if (loading) {
    return (
      <div data-testid="catalog-grid-skeleton" aria-hidden="true" style={columns === 1 ? { ...GRID_STYLE, gridTemplateColumns: '1fr' } : GRID_STYLE}>
        {Array.from({ length: skeletonCount }, (_, i) => (
          <ProductTileSkeleton key={i} variant={variant} brand={showBrand === false ? false : undefined} />
        ))}
      </div>
    );
  }
  const gridStyle = columns === 1 ? { ...GRID_STYLE, gridTemplateColumns: '1fr' } : GRID_STYLE;
  const notes = noteOf ? items.map((p, i) => noteOf(p, i)) : null;
  const reserveNote = notes?.some((n) => !!n) ?? false;
  return (
    <ul role="list" data-testid="catalog-grid" style={gridStyle}>
      {items.map((p, i) => (
        <li key={`${p.id}:${i}`} style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <ProductCard
              product={p}
              variant={variant}
              rank={rankFrom === undefined ? undefined : rankFrom + i}
              listSource={listSource}
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
