import { useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { vi } from '../../i18n/vi';
import { usePublicConfig } from '../../hooks/use-public-config';
import { usePurchasedItems } from '../../hooks/use-purchased-items';
import { getErrorMessage } from '../../services/api';
import type { PurchasedItem } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { SubscribeSheet } from '../subscribe-sheet';
import { isEndpointMissing } from '../home/home-blocks';
import { useBlockQuery } from '../home/use-block-query';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ProductThumb } from '../ui/product-thumb';
import { PriceTag } from '../ui/price-tag';
import { ProductTile, type ProductTileProduct } from '../ui/product-tile';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, type ReorderTarget } from './reorder-types';

const TILE_WIDTH = 148;
/** Từ chừng này món trở lên mới dùng kệ cuộn ngang; ít hơn thì thẻ ngang thấp để không để trống nửa màn hình. */
export const COMPACT_MAX_ITEMS = 2;
const COMPACT_CARD_HEIGHT = 168;
const HEADING_HEIGHT = 24;
const HEADING_PAD_TOP = 4;
const HEADING_PAD_BOTTOM = 8;
const RAIL_PADDING_BOTTOM = 12;
/** Export để Trang chủ dùng CHUNG query key ['purchased-items', 10] khi quyết định thứ tự khối (plan 4b). */
/** Hai nút hàng Mua lại chia đều chỗ; đệm ngang hẹp để nhãn "Định kỳ -17%" không bị cắt dấu ba chấm ở 320px. */
/** Tên luôn chiếm đủ 2 dòng (14px x 1.57) để thẻ cao như nhau với tên ngắn hay dài và khung chờ khớp thẻ thật. */
const NAME_MIN_HEIGHT = 44;
const ACTION_STYLE = { flex: '1 1 0', minWidth: 0, paddingInline: 12 } as const;

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
    repVariationId: p.variationId,
    inStock: p.inStock,
  };
}

export interface PurchasedRailProps {
  source: 'home_rail' | 'orders_tab';
  /** Đang khôi phục phiên: giữ chỗ kệ bằng khung chờ để khi phiên về nội dung bên dưới không bị đẩy. */
  restoring?: boolean;
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
export function PurchasedRail({ source, restoring = false }: PurchasedRailProps) {
  const navigate = useNavigate();
  const q = useBlockQuery(usePurchasedItems(PURCHASED_RAIL_LIMIT));
  const [target, setTarget] = useState<ReorderTarget | null>(null);
  const [subscribeFor, setSubscribeFor] = useState<PurchasedItem | null>(null);
  const discountPct = Math.round(usePublicConfig().subscribeDiscountPct * 100);

  if (restoring || q.isLoading) {
    // Khớp đúng khung kệ thật (tiêu đề + hàng tile + đệm dưới) để dữ liệu về không đẩy nội dung bên dưới.
    return (
      <div data-testid="purchased-rail-loading" aria-hidden="true" style={{ paddingBottom: RAIL_PADDING_BOTTOM }}>
        <div style={{ padding: `${HEADING_PAD_TOP}px 16px ${HEADING_PAD_BOTTOM}px` }}>
          <Skeleton width={96} height={HEADING_HEIGHT} />
        </div>
        <div style={{ padding: '0 16px' }}>
          <Skeleton height={COMPACT_CARD_HEIGHT} radius="var(--radius-card)" />
        </div>
      </div>
    );
  }
  const items = q.data?.items ?? [];
  // Chưa có món nào: lỗi thật (không phải API cũ 404) vẫn hiện khối lỗi kèm "Thử lại", khách cũ không thấy kệ biến mất im lặng.
  if (items.length === 0 && !(q.isError && !isEndpointMissing(q.error))) return null;

  return (
    <section aria-label={vi.reorder.railTitle} style={{ paddingBottom: RAIL_PADDING_BOTTOM }}>
      <div style={{ padding: `${HEADING_PAD_TOP}px 16px ${HEADING_PAD_BOTTOM}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Heading variant="title-sm" as="h2">
          {vi.reorder.railTitle}
        </Heading>
        {source === 'home_rail' && (
          <button
            type="button"
            className="tubu-press"
            onClick={() => {
              haptic('light');
              navigate('/orders?tab=delivered');
            }}
            style={{ minHeight: 44, margin: '-10px -4px', padding: '0 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Text variant="label" tone="brand">
              {vi.home.seeAll}
            </Text>
          </button>
        )}
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
      {items.length === 0 ? null : items.length <= COMPACT_MAX_ITEMS ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px' }}>
          {items.map((p) => (
            <CompactRebuyCard
              key={p.variationId}
              item={p}
              discountPct={discountPct}
              onRebuy={() => setTarget(itemReorderTarget(p))}
              onSubscribe={() => setSubscribeFor(p)}
              onOpen={() => navigate(`/product/${encodeURIComponent(p.slug)}`)}
            />
          ))}
        </div>
      ) : (
        <div className="scroll-x" style={{ display: 'flex', gap: 10, padding: '4px 16px 12px', margin: '-4px 0 -12px', minWidth: 0, maxWidth: '100%' }}>
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
      )}
      <ReorderSheet target={target} source={source} navigateToCart onClose={() => setTarget(null)} />
      {subscribeFor && (
        <SubscribeSheet visible onClose={() => setSubscribeFor(null)} variationId={subscribeFor.variationId} quantity={1} />
      )}
    </section>
  );
}

/** Thẻ ngang thấp cho kệ Mua lại khi chỉ có 1–2 món: ảnh nhỏ, tên, phân loại, giá, hai nút mua lại và đặt định kỳ. */
function CompactRebuyCard({
  item,
  discountPct,
  onRebuy,
  onSubscribe,
  onOpen,
}: {
  item: PurchasedItem;
  discountPct: number;
  onRebuy: () => void;
  onSubscribe: () => void;
  onOpen: () => void;
}) {
  const standing = item.salePrice ?? item.price;
  const hasSale = standing < item.price;
  const available = item.inStock !== false && item.stock > 0;
  // Chỉ mời "Định kỳ" khi API xác nhận hàng không chỉ bán lẻ; API cũ chưa trả `retailOnly` thì không mời (máy chủ có thể từ chối).
  const subscribable = item.retailOnly === false;
  return (
    <Card variant="raised" padding={12}>
      <button
        type="button"
        aria-label={item.productName}
        className="tubu-press"
        onClick={onOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 44, padding: 0, border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}
      >
        <ProductThumb src={item.thumbnail} alt="" size={64} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" as="span" style={{ fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: NAME_MIN_HEIGHT }}>
            {item.productName}
          </Text>
          {item.variationName && (
            <Text variant="caption" tone="secondary" as="span" style={{ display: 'block' }}>
              {item.variationName}
            </Text>
          )}
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            <PriceTag value={standing} compareAt={hasSale ? item.price : undefined} size="sm" />
            {item.timesBought > 1 && <Badge tone="brand" size="sm">{vi.reorder.timesBought(item.timesBought)}</Badge>}
          </span>
        </span>
      </button>
      {available ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button variant="secondary" onPress={onRebuy} style={ACTION_STYLE}>
            {homeCopy.reorder.buy}
          </Button>
          {subscribable && (
            <Button variant="ghost" onPress={onSubscribe} style={ACTION_STYLE}>
              {homeCopy.reorder.subscribe(discountPct)}
            </Button>
          )}
        </div>
      ) : (
        <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 10 }}>
          {vi.reorder.unavailable}
        </Text>
      )}
    </Card>
  );
}
