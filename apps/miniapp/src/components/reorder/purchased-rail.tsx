import { useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { vi } from '../../i18n/vi';
import { usePurchasedItems } from '../../hooks/use-purchased-items';
import type { PurchasedItem } from '../../services/shop-api';
import { Badge } from '../ui/badge';
import { ProductTile, type ProductTileProduct } from '../ui/product-tile';
import { Skeleton } from '../ui/skeleton';
import { Heading } from '../ui/text';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, type ReorderTarget } from './reorder-types';

const TILE_WIDTH = 148;
const RAIL_LIMIT = 10;

export function toTileProduct(p: PurchasedItem): ProductTileProduct {
  return {
    id: p.productId,
    slug: p.slug,
    name: p.variationName ? `${p.productName} · ${p.variationName}` : p.productName,
    brand: p.brand,
    thumbnail: p.thumbnail,
    basePrice: p.price,
    salePrice: p.salePrice,
    inStock: p.inStock,
  };
}

export interface PurchasedRailProps {
  source: 'home_rail' | 'orders_tab';
}

/**
 * Kệ "Mua lại" (spec 4a.2/4a.3): SP khách đã nhận hàng, mới mua trước. Khách mới / chưa đăng nhập
 * / API cũ (404) → không render gì (không ErrorState trên đầu trang). Mua lại = 2 chạm.
 *
 * `target` là state (chỉ đổi khi chạm nút) nên danh tính ổn định — ReorderSheet khởi tạo lại lựa
 * chọn theo danh tính `target`, không được dựng target inline trong JSX.
 */
export function PurchasedRail({ source }: PurchasedRailProps) {
  const navigate = useNavigate();
  const q = usePurchasedItems(RAIL_LIMIT);
  const [target, setTarget] = useState<ReorderTarget | null>(null);

  if (q.isLoading) {
    return (
      <div data-testid="purchased-rail-loading" aria-hidden="true" className="scroll-x" style={{ display: 'flex', gap: 10, padding: '4px 16px 12px' }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={TILE_WIDTH} height={236} radius="var(--radius-card)" style={{ flex: '0 0 auto' }} />
        ))}
      </div>
    );
  }
  const items = q.data?.items ?? [];
  if (q.isError || items.length === 0) return null;

  return (
    <section aria-label={vi.reorder.railTitle} style={{ paddingBottom: 12 }}>
      <div style={{ padding: '4px 16px 8px' }}>
        <Heading variant="title-sm" as="h2">
          {vi.reorder.railTitle}
        </Heading>
      </div>
      <div className="scroll-x" style={{ display: 'flex', gap: 10, padding: '0 16px', minWidth: 0, maxWidth: '100%' }}>
        {items.map((p) => (
          <div key={p.variationId} style={{ flex: `0 0 ${TILE_WIDTH}px`, width: TILE_WIDTH }}>
            <ProductTile
              product={toTileProduct(p)}
              variant="rail"
              showWishlist={false}
              action="rebuy"
              badge={p.timesBought > 1 ? <Badge tone="brand" size="sm">{vi.reorder.timesBought(p.timesBought)}</Badge> : undefined}
              onAction={() => setTarget(itemReorderTarget(p))}
              onPress={() => navigate(`/product/${encodeURIComponent(p.slug)}`)}
            />
          </div>
        ))}
      </div>
      <ReorderSheet target={target} source={source} onClose={() => setTarget(null)} />
    </section>
  );
}
