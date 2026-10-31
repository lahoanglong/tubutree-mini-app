import type { ProductCard } from '../../services/shop-api';
import { ProductGrid } from '../ui/product-grid';

export interface CatalogGridProps {
  products: ProductCard[];
  /** Ghi vào state điều hướng → `product_viewed.listSource` ở PDP. */
  listSource: string;
  onOpen?: (product: ProductCard, index: number) => void;
}

/** Lưới SP của Trang chủ/Danh mục: vỏ mỏng của `ProductGrid` biến thể `grid`. */
export function CatalogGrid({ products, listSource, onOpen }: CatalogGridProps) {
  return <ProductGrid items={products} variant="grid" listSource={listSource} onOpen={onOpen} />;
}

export function CatalogGridSkeleton({ count = 6 }: { count?: number }) {
  return <ProductGrid items={[]} variant="grid" loading skeletonCount={count} />;
}
