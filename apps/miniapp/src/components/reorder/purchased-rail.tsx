import { useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { vi } from '../../i18n/vi';
import { usePurchasedItems } from '../../hooks/use-purchased-items';
import { getErrorMessage } from '../../services/api';
import type { PurchasedItem } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { useBlockQuery } from '../home/use-block-query';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ProductTile, type ProductTileProduct } from '../ui/product-tile';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, type ReorderTarget } from './reorder-types';

const TILE_WIDTH = 148;
// Đo trên trình duyệt thật ở 320/375/390px (đều cho cùng số vì tile cố định 148px): tile 337px, tiêu đề 24px.
// Đổi ProductTile "rail" thì đo lại — e2e buy-flow-4a kiểm skeleton lệch kệ thật <= 16px.
const TILE_HEIGHT = 337;
const HEADING_HEIGHT = 24;
const HEADING_PAD_TOP = 4;
const HEADING_PAD_BOTTOM = 8;
const RAIL_PADDING_BOTTOM = 12;
/** Export để Trang chủ dùng CHUNG query key ['purchased-items', 10] khi quyết định thứ tự khối (plan 4b). */
export const PURCHASED_RAIL_LIMIT = 10;

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
 * / API cũ (404) / lỗi ở lần tải đầu → không render gì (không ErrorState trên đầu trang; Trang chủ tự dựng khối lỗi
 * "Thử lại" cho lỗi thật). Làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện kệ cũ kèm một dòng báo nhẹ + "Thử lại", không
 * để kệ biến mất im lặng. Mua lại = 2 chạm rồi tự sang
 * giỏ (như thẻ đơn/chi tiết đơn): ở lại Home thì khách phải tự tìm giỏ và hay tưởng đã đặt xong.
 *
 * `target` là state (chỉ đổi khi chạm nút) nên danh tính ổn định — ReorderSheet khởi tạo lại lựa
 * chọn theo danh tính `target`, không được dựng target inline trong JSX.
 */
export function PurchasedRail({ source }: PurchasedRailProps) {
  const navigate = useNavigate();
  const q = useBlockQuery(usePurchasedItems(PURCHASED_RAIL_LIMIT));
  const [target, setTarget] = useState<ReorderTarget | null>(null);

  if (q.isLoading) {
    // Khớp đúng khung kệ thật (tiêu đề + hàng tile + đệm dưới) để dữ liệu về không đẩy nội dung bên dưới.
    return (
      <div data-testid="purchased-rail-loading" aria-hidden="true" style={{ paddingBottom: RAIL_PADDING_BOTTOM }}>
        <div style={{ padding: `${HEADING_PAD_TOP}px 16px ${HEADING_PAD_BOTTOM}px` }}>
          <Skeleton width={96} height={HEADING_HEIGHT} />
        </div>
        <div className="scroll-x" style={{ display: 'flex', gap: 10, padding: '0 16px' }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={TILE_WIDTH} height={TILE_HEIGHT} radius="var(--radius-card)" style={{ flex: '0 0 auto' }} />
          ))}
        </div>
      </div>
    );
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section aria-label={vi.reorder.railTitle} style={{ paddingBottom: RAIL_PADDING_BOTTOM }}>
      <div style={{ padding: `${HEADING_PAD_TOP}px 16px ${HEADING_PAD_BOTTOM}px` }}>
        <Heading variant="title-sm" as="h2">
          {vi.reorder.railTitle}
        </Heading>
      </div>
      {q.isError && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 16px 8px' }}>
          <Text variant="body-sm" tone="secondary" style={{ minWidth: 0 }}>
            {getErrorMessage(q.error)}
          </Text>
          <Button
            variant="secondary"
            loading={q.isFetching}
            aria-label={vi.home.retryLabel(vi.reorder.railTitle)}
            onPress={() => {
              haptic('light');
              return q.refetch();
            }}
            style={{ flex: '0 0 auto', minWidth: 0 }}
          >
            {vi.home.retry}
          </Button>
        </div>
      )}
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
      <ReorderSheet target={target} source={source} navigateToCart onClose={() => setTarget(null)} />
    </section>
  );
}
