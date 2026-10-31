'use client';

// Nguồn: apps/miniapp/src/components/shop-page/shop-products-tab.tsx (thêm phân trang số từ lg)
import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
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
import type { ProductCard as ProductCardData } from '@/lib/api';
import { loadErrorText } from '@/lib/error-text';
import { fetchBrandProductsPage } from '@/lib/shop-brand-products';
import { useMediaQuery } from '@/lib/use-media-query';
import { Button } from '@/components/mini/button';
import { Chip } from '@/components/mini/chip';
import { EmptyState } from '@/components/mini/empty-state';
import { ProductGrid } from '@/components/mini/product-grid';
import { SortBar } from '@/components/mini/sort-bar';
import { ErrorState } from '@/components/ui/error-state';
import { ShopPager } from './shop-pager';

export type ShopProductsSource = { kind: 'local'; products: ProductCardData[] } | { kind: 'brand'; slug: string };

export interface ShopProductsTabProps {
  source: ShopProductsSource;
  /** Thương hiệu truyền false: mọi thẻ cùng một thương hiệu. */
  showBrand?: boolean;
  initialSort?: ShopSort;
  /** Đang xem riêng một bộ (từ tab Danh mục): chip tên bộ, bấm để về toàn bộ sản phẩm. */
  scope?: { label: string; onClear: () => void };
}

const WIDE = '(min-width: 1024px)';
const TABLET = '(min-width: 768px)';

function MoreButton({ loading, onPress }: { loading?: boolean; onPress: () => void }) {
  return (
    <div className="mt-4">
      <Button variant="secondary" fullWidth loading={loading} onPress={onPress}>
        {fillCopy('shop.loadMore')}
      </Button>
    </div>
  );
}

/** Gian hàng CTV chưa có endpoint sản phẩm theo gian hàng: sắp xếp và cắt trang ngay trên danh sách đã tải. `key` theo kiểu sắp xếp nên đổi kiểu thì về trang đầu. */
function LocalList({ products, sort, showBrand, wide, onPage }: { products: ProductCardData[]; sort: ShopSort; showBrand?: boolean; wide: boolean; onPage: () => void }) {
  const [shown, setShown] = useState(SHOP_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => sortShopProducts(uniqueShopProducts([{ items: products.map((product) => ({ product })) }]), sort), [products, sort]);
  if (wide) {
    const pages = Math.max(1, Math.ceil(sorted.length / SHOP_PAGE_SIZE));
    const cur = Math.min(page, pages);
    return (
      <>
        <ProductGrid items={sorted.slice((cur - 1) * SHOP_PAGE_SIZE, cur * SHOP_PAGE_SIZE)} variant="grid" showBrand={showBrand} />
        <ShopPager page={cur} pages={pages} onChange={(n) => { setPage(n); onPage(); }} />
      </>
    );
  }
  return (
    <>
      <ProductGrid items={sorted.slice(0, shown)} variant="grid" showBrand={showBrand} />
      {shown < sorted.length && <MoreButton onPress={() => setShown((n) => n + SHOP_PAGE_SIZE)} />}
    </>
  );
}

const brandQuery = (slug: string, sort: ShopSort, page: number) => fetchBrandProductsPage(slug, { page, limit: SHOP_PAGE_SIZE, sort: shopSortToCatalog(sort) });

function BrandInfinite({ slug, sort, showBrand }: { slug: string; sort: ShopSort; showBrand?: boolean }) {
  const q = useInfiniteQuery({
    queryKey: ['brand-products', slug, sort],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => brandQuery(slug, sort, pageParam),
    getNextPageParam: (last, all) => (all.length * SHOP_PAGE_SIZE < last.meta.total ? all.length + 1 : undefined),
    staleTime: 60_000,
  });
  const items = useMemo(() => (q.data?.pages.flatMap((p) => p.data) ?? []) as ProductCardData[], [q.data]);
  if (q.isPending) return <ProductGrid items={[]} variant="grid" loading showBrand={showBrand} />;
  if (q.isError && items.length === 0) return <ErrorState variant="inline" message={loadErrorText(q.error)} onRetry={() => void q.refetch()} />;
  if (items.length === 0) return <EmptyState variant="inline" art="basket" heading={fillCopy('shop.emptyProducts')} />;
  return (
    <>
      <ProductGrid items={items} variant="grid" showBrand={showBrand} />
      {q.isFetchNextPageError && <ErrorState variant="inline" message={loadErrorText(q.error)} onRetry={() => void q.fetchNextPage()} />}
      {q.hasNextPage && !q.isFetchNextPageError && <MoreButton loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} />}
    </>
  );
}

function BrandPaged({ slug, sort, showBrand, onPage }: { slug: string; sort: ShopSort; showBrand?: boolean; onPage: () => void }) {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['brand-products-page', slug, sort, page], queryFn: () => brandQuery(slug, sort, page), placeholderData: keepPreviousData, staleTime: 60_000 });
  if (q.isPending) return <ProductGrid items={[]} variant="grid" loading showBrand={showBrand} />;
  if (q.isError) return <ErrorState variant="inline" message={loadErrorText(q.error)} onRetry={() => void q.refetch()} />;
  const items = q.data.data as ProductCardData[];
  if (items.length === 0 && page === 1) return <EmptyState variant="inline" art="basket" heading={fillCopy('shop.emptyProducts')} />;
  return (
    <>
      <ProductGrid items={items} variant="grid" showBrand={showBrand} />
      <ShopPager page={page} pages={Math.ceil(q.data.meta.total / SHOP_PAGE_SIZE)} onChange={(n) => { setPage(n); onPage(); }} />
    </>
  );
}

/**
 * Tab "Sản phẩm" của trang shop: SortBar (Phổ biến, Mới, Bán chạy, Giá tự đảo chiều) trên lưới, mỗi lần 20 thẻ. Điện thoại "Xem thêm" nối
 * dài như Mini App; từ lg phân trang số và đổi trang thì cuộn về đầu lưới. SortBar chỉ dính ở khổ điện thoại (dưới nút lùi cố định); từ md web có thanh đầu trang riêng nên để trôi theo trang.
 */
export function ShopProductsTab({ source, showBrand, initialSort = 'popular', scope }: ShopProductsTabProps) {
  const wide = useMediaQuery(WIDE);
  const tablet = useMediaQuery(TABLET);
  const [sort, setSort] = useState<ShopSort>(initialSort);
  const gridRef = useRef<HTMLDivElement>(null);
  if (source.kind === 'local' && source.products.length === 0) return <EmptyState variant="inline" art="basket" heading={fillCopy('shop.emptyProducts')} />;
  const toTop = () => gridRef.current?.scrollIntoView?.({ block: 'start' });
  return (
    <div>
      <SortBar sticky={!tablet} value={shopSortValue(sort)} options={SHOP_SORT_OPTIONS} onChange={(v) => setSort((cur) => nextShopSort(cur, v))} />
      {scope && (
        <div className="px-4 pt-1 md:px-0">
          <Chip selected size="sm" icon={X} ariaLabel={`${scope.label}, bỏ lọc`} onPress={scope.onClear}>
            {scope.label}
          </Chip>
        </div>
      )}
      <div ref={gridRef} className="px-4 pt-3 md:px-0 lg:scroll-mt-24">
        {source.kind === 'local' ? (
          <LocalList key={sort} products={source.products} sort={sort} showBrand={showBrand} wide={wide} onPage={toTop} />
        ) : wide ? (
          <BrandPaged key={sort} slug={source.slug} sort={sort} showBrand={showBrand} onPage={toTop} />
        ) : (
          <BrandInfinite slug={source.slug} sort={sort} showBrand={showBrand} />
        )}
      </div>
    </div>
  );
}
