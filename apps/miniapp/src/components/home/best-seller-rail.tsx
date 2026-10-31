import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { fetchProducts } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { CatalogTile, TILE_BODY_HEIGHT } from '../catalog/catalog-grid';
import { Skeleton } from '../ui/skeleton';
import { ScrollRow } from '../ui/scroll-row';
import { Heading, Text } from '../ui/text';
import { useBlockQuery } from './use-block-query';
import { HomeBlockError } from './home-block-error';

export const BEST_SELLER_LIMIT = 6;
const TILE_WIDTH = 156;
/** Thẻ hẹp hơn lưới 2 cột nên tên xuống dòng nhiều hơn: đo trên trình duyệt thật ở 375px, thẻ thật cao hơn khung chờ lưới ~20px. */
const RAIL_TILE_EXTRA = 20;

/** "Bán chạy" một hàng cuộn ngang cho khách mới (khách cũ đã có tab "Bán chạy" trong lưới gợi ý cuối trang). */
export function BestSellerRail() {
  const navigate = useNavigate();
  const q = useBlockQuery(
    useQuery({ queryKey: ['products', 'home-best-seller'], queryFn: () => fetchProducts({ limit: BEST_SELLER_LIMIT, sort: 'best_seller' }) }),
  );
  const items = q.data?.data ?? [];
  if (!q.isLoading && items.length === 0) {
    return q.isError ? <div style={{ padding: '0 16px' }}><HomeBlockError title={homeCopy.bestSellers.title} error={q.error} onRetry={q.refetch} retrying={q.isFetching} /></div> : null;
  }
  return (
    <section aria-label={homeCopy.bestSellers.title} style={{ padding: '8px 0 4px' }}>
      <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <Heading variant="title-sm" as="h2">
          {homeCopy.bestSellers.title}
        </Heading>
        <button
          type="button"
          className="tubu-press"
          aria-label={`${homeCopy.bestSellers.seeAll} ${homeCopy.bestSellers.title}`}
          onClick={() => {
            haptic('light');
            navigate('/browse?sort=best_seller');
          }}
          style={{ minHeight: 44, padding: '0 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Text variant="label" tone="brand">
            {homeCopy.bestSellers.seeAll}
          </Text>
        </button>
      </div>
      <ScrollRow label="Sản phẩm bán chạy" style={{ gap: 10, padding: '4px 16px 12px' }}>
        {q.isLoading
          ? Array.from({ length: BEST_SELLER_LIMIT }, (_, i) => (
              <div
                key={i}
                data-testid="catalog-tile-skeleton"
                aria-hidden="true"
                style={{ flex: `0 0 ${TILE_WIDTH}px`, width: TILE_WIDTH, background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)', overflow: 'hidden' }}
              >
                <Skeleton height="auto" radius="0" style={{ aspectRatio: '1 / 1' }} />
                <div style={{ height: TILE_BODY_HEIGHT + RAIL_TILE_EXTRA }} />
              </div>
            ))
          : items.map((p) => (
              <div key={p.id} style={{ flex: `0 0 ${TILE_WIDTH}px`, width: TILE_WIDTH }}>
                <CatalogTile product={p} listSource="home_best_seller" />
              </div>
            ))}
      </ScrollRow>
    </section>
  );
}
