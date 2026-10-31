'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import type { PageResponse, ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { coreHttp } from '@/lib/core-http';
import { Heading, ProductRail, Text } from '@/components/mini';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

export const BEST_SELLER_LIMIT = 6;

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
      <ProductRail label="Sản phẩm bán chạy" variant="rail-md" items={items} loading={q.isLoading} skeletonCount={BEST_SELLER_LIMIT} priorityCount={2} />
    </section>
  );
}
