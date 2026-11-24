import { memo, useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { ProductCard, type ProductCardProps } from './product-card';
import { ProductTileReserve, ProductTileSkeleton } from './skeleton';

const GRID_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, listStyle: 'none', margin: 0, padding: 0 };

export interface ProductGridProps {
  /** Số cột: 2 (mặc định) cho thẻ dọc; 1 cho hàng thẻ `line` (khối STACK của gian hàng). */
  columns?: 1 | 2;
  items: readonly ProductCardData[];
  variant: CardVariant;
  /** Hạng của thẻ đầu; thẻ sau tăng dần (biến thể `rank`). */
  rankFrom?: number;
  /** Hạng của từng thẻ (cùng chỉ số với `items`), thắng `rankFrom`; null là thẻ không số (món ghim của Bán chạy nhất). */
  ranks?: readonly (number | null)[];
  listSource?: string;
  loading?: boolean;
  /** Cùng `loading`: lưới còn xa màn vẽ ô giữ chỗ một nút (`ProductTileReserve`) thay khung chờ đầy đủ, cùng cột và chiều cao. */
  reserve?: boolean;
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

type GridCardProps = Omit<ProductCardProps, 'onOpen'> & { index: number; onOpen?: (product: ProductCardData, index: number) => void };

/** `onOpen` của lưới đổi danh tính mỗi lần cha vẽ; ô tự bọc lại theo (sản phẩm, vị trí) để thẻ memo không phải vẽ lại. */
const GridCard = memo(function GridCard({ index, onOpen, ...rest }: GridCardProps) {
  const { product } = rest;
  const open = useCallback(() => onOpen?.(product, index), [onOpen, product, index]);
  return <ProductCard {...rest} position={index + 1} onOpen={onOpen ? open : undefined} />;
});

/** Lưới 2 cột; `loading` vẽ khung chờ cùng số đo với thẻ thật nên trang không nhảy khi dữ liệu về. */
export function ProductGrid({
  columns = 2,
  items,
  variant,
  rankFrom,
  ranks,
  listSource,
  loading = false,
  reserve = false,
  skeletonCount = 6,
  showBrand,
  showWishlist,
  renderImageOverlay,
  renderAfter,
  noteOf,
  onOpen,
}: ProductGridProps) {
  const onOpenRef = useRef(onOpen);
  useLayoutEffect(() => {
    onOpenRef.current = onOpen;
  });
  const stableOpen = useCallback((p: ProductCardData, i: number) => onOpenRef.current?.(p, i), []);
  if (loading && reserve) {
    return (
      <div data-testid="catalog-grid-reserve" aria-hidden="true" style={columns === 1 ? { ...GRID_STYLE, gridTemplateColumns: '1fr' } : GRID_STYLE}>
        {Array.from({ length: skeletonCount }, (_, i) => (
          <ProductTileReserve key={i} variant={variant} brand={showBrand === false ? false : undefined} />
        ))}
      </div>
    );
  }
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
            <GridCard
              product={p}
              index={i}
              variant={variant}
              rank={ranks ? (ranks[i] ?? undefined) : rankFrom === undefined ? undefined : rankFrom + i}
              listSource={listSource}
              showBrand={showBrand}
              showWishlist={showWishlist}
              note={notes?.[i] || (reserveNote ? '' : undefined)}
              imageOverlay={renderImageOverlay?.(p, i)}
              onOpen={onOpen ? stableOpen : undefined}
            />
          </div>
          {renderAfter?.(p, i)}
        </li>
      ))}
    </ul>
  );
}
