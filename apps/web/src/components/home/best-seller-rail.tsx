'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import type { PageResponse, ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { coreHttp } from '@/lib/core-http';
import ProductCard from '@/components/product-card';
import { ProductCardSkeleton } from '@/components/ui/skeleton';
import { Heading, ScrollRow, Text } from '@/components/mini';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

export const BEST_SELLER_LIMIT = 6;
const TILE_WIDTH = 156;

/** "Bán chạy" một hàng cuộn ngang cho khách mới (bản web của `best-seller-rail.tsx`); khách cũ có tab "Bán chạy" trong lưới gợi ý cuối trang. */
export function BestSellerRail({ initial }: { initial?: PageResponse<ProductCardData> }) {
  const router = useRouter();
  const q = useBlockQuery(useQuery({ ...homeBestSellerQuery(coreHttp), ...(initial ? { initialData: initial, staleTime: 60_000 } : {}) }));
  const items = q.data?.data ?? [];
  if (!q.isLoading && items.length === 0) {
    return q.isError ? <HomeBlockError title={homeCopy.bestSellers.title} error={q.error} onRetry={q.refetch} retrying={q.isFetching} /> : null;
  }
  return (
    <section aria-label={homeCopy.bestSellers.title} style={{ padding: '8px 0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <Heading variant="title-sm" as="h2">
          {homeCopy.bestSellers.title}
        </Heading>
        <button
          type="button"
          aria-label={`${homeCopy.bestSellers.seeAll} ${homeCopy.bestSellers.title}`}
          className="tubu-press"
          onClick={() => router.push(browseHref({ ...EMPTY_SEARCH_STATE, sort: 'best_seller' }))}
          style={{ minHeight: 44, padding: '0 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Text variant="label" tone="brand">
            {homeCopy.bestSellers.seeAll}
          </Text>
        </button>
      </div>
      <ScrollRow arrows label="Sản phẩm bán chạy" style={{ gap: 10, padding: '4px 16px 12px', margin: '0 -16px', maxWidth: 'none' }}>
        {q.isLoading
          ? Array.from({ length: BEST_SELLER_LIMIT }, (_, i) => (
              <div key={i} data-testid="catalog-tile-skeleton" aria-hidden="true" style={{ flex: `0 0 ${TILE_WIDTH}px`, width: TILE_WIDTH }}>
                <ProductCardSkeleton />
              </div>
            ))
          : items.map((p, i) => (
              <div key={p.id} style={{ flex: `0 0 ${TILE_WIDTH}px`, width: TILE_WIDTH }}>
                <ProductCard product={p} priority={i < 2} />
              </div>
            ))}
      </ScrollRow>
    </section>
  );
}
