import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import {
  SHOP_PAGE_SIZE,
  SHOP_SORT_OPTIONS,
  nextShopSort,
  shopSortToCatalog,
  shopSortValue,
  sortShopProducts,
  uniqueShopProducts,
  type ShopSort,
} from '@tubutree/app-core/commerce/shop-page';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { fetchBrandProducts } from '../../services/brand-api';
import { getLoadErrorMessage } from '../../services/api';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { EmptyState, ErrorState } from '../ui/empty-state';
import { ProductGrid } from '../ui/product-grid';
import { SortBar } from '../ui/sort-bar';

export type ShopProductsSource = { kind: 'local'; products: ProductCardData[] } | { kind: 'brand'; slug: string };

export interface ShopProductsTabProps {
  source: ShopProductsSource;
  /** Thương hiệu truyền false: mọi thẻ cùng một thương hiệu. */
  showBrand?: boolean;
  initialSort?: ShopSort;
  /** Đang xem riêng một bộ (từ tab Danh mục): chip tên bộ, bấm để về toàn bộ sản phẩm. */
  scope?: { label: string; onClear: () => void };
}

function MoreButton({ loading, onPress }: { loading?: boolean; onPress: () => void }) {
  return (
    <div style={{ marginTop: 16 }}>
      <Button variant="secondary" fullWidth loading={loading} onPress={onPress}>
        {fillCopy('shop.loadMore')}
      </Button>
    </div>
  );
}

/** Gian hàng CTV chưa có endpoint sản phẩm theo gian hàng: sắp xếp và cắt trang ngay trên danh sách đã tải (đã bỏ trùng giữa các bộ). */
function LocalList({ products, sort, showBrand }: { products: ProductCardData[]; sort: ShopSort; showBrand?: boolean }) {
  const [shown, setShown] = useState(SHOP_PAGE_SIZE);
  const [lastSort, setLastSort] = useState(sort);
  if (lastSort !== sort) {
    setLastSort(sort);
    setShown(SHOP_PAGE_SIZE);
  }
  const sorted = useMemo(
    () => sortShopProducts(uniqueShopProducts([{ items: products.map((product) => ({ product })) }]), sort),
    [products, sort],
  );
  return (
    <>
      <ProductGrid items={sorted.slice(0, shown)} variant="grid" showBrand={showBrand} listSource="shop_products" />
      {shown < sorted.length && <MoreButton onPress={() => setShown((n) => n + SHOP_PAGE_SIZE)} />}
    </>
  );
}

function BrandList({ slug, sort, showBrand }: { slug: string; sort: ShopSort; showBrand?: boolean }) {
  const q = useInfiniteQuery({
    queryKey: ['brand-products', slug, sort],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchBrandProducts(slug, { page: pageParam, limit: SHOP_PAGE_SIZE, sort: shopSortToCatalog(sort) }),
    getNextPageParam: (last, all) => (all.length * SHOP_PAGE_SIZE < last.meta.total ? all.length + 1 : undefined),
    staleTime: 60_000,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  if (q.isPending) return <ProductGrid items={[]} variant="grid" loading showBrand={showBrand} />;
  if (q.isError && items.length === 0) return <ErrorState variant="inline" message={getLoadErrorMessage(q.error)} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  if (items.length === 0) return <EmptyState variant="inline" art="basket" heading={fillCopy('shop.emptyProducts')} />;
  return (
    <>
      <ProductGrid items={items} variant="grid" showBrand={showBrand} listSource="shop_products" />
      {q.isFetchNextPageError && <ErrorState variant="inline" message={getLoadErrorMessage(q.error)} onRetry={() => void q.fetchNextPage()} retrying={q.isFetchingNextPage} />}
      {q.hasNextPage && !q.isFetchNextPageError && <MoreButton loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} />}
    </>
  );
}

/**
 * Tab "Sản phẩm" của trang shop: SortBar dính (Phổ biến, Mới, Bán chạy, Giá tự đảo chiều) trên lưới 2 cột, mỗi lần 20 thẻ và "Xem thêm".
 * Thương hiệu phân trang thật qua `fetchBrandProducts`; gian hàng CTV sắp xếp trên danh sách đã có.
 */
export function ShopProductsTab({ source, showBrand, initialSort = 'popular', scope }: ShopProductsTabProps) {
  const [sort, setSort] = useState<ShopSort>(initialSort);
  const empty = source.kind === 'local' && source.products.length === 0;
  if (empty) return <EmptyState variant="inline" art="basket" heading={fillCopy('shop.emptyProducts')} />;
  return (
    <div>
      <SortBar sticky value={shopSortValue(sort)} options={SHOP_SORT_OPTIONS} onChange={(v) => setSort((cur) => nextShopSort(cur, v))} />
      {scope && (
        <div style={{ padding: '4px 16px 0' }}>
          <Chip selected size="sm" icon={X} ariaLabel={`${scope.label}, bỏ lọc`} onPress={scope.onClear}>
            {scope.label}
          </Chip>
        </div>
      )}
      <div style={{ padding: '12px 16px 0' }}>
        {source.kind === 'local' ? (
          <LocalList products={source.products} sort={sort} showBrand={showBrand} />
        ) : (
          <BrandList slug={source.slug} sort={sort} showBrand={showBrand} />
        )}
      </div>
    </div>
  );
}
