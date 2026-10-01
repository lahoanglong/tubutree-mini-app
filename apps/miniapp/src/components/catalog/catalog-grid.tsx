import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { fetchActiveFlashSales, type ProductCard } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Badge } from '../ui/badge';
import { ProductTile, TILE_NAME_MIN_HEIGHT } from '../ui/product-tile';
import { Skeleton } from '../ui/skeleton';
import { tilePricing } from './catalog-pricing';

const FLASH_BADGE_STYLE: CSSProperties = { background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' };
const GRID_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

export interface CatalogTileProps {
  product: ProductCard;
  /** Ghi vào state điều hướng → `product_viewed.listSource` ở PDP. */
  listSource: string;
  onOpen?: () => void;
}

/** Thẻ SP của Trang chủ/Danh mục (DS v2) — thay ProductCard cũ, giữ nguyên giá giờ vàng + badge. */
export function CatalogTile({ product, listSource, onOpen }: CatalogTileProps) {
  const navigate = useNavigate();
  // Cùng queryKey với dải giờ vàng → không thêm request.
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000 });
  const pricing = tilePricing(product, flashQ.data ?? []);
  return (
    <ProductTile
      product={product}
      variant="grid"
      priceOverride={{ price: pricing.price }}
      badge={
        // Hết hàng: lớp phủ của ProductTile trong suốt 72% — không để badge % lộ ra bên dưới.
        // `inStock === false` (không phải falsy): API cũ không trả field → coi là còn hàng, giống ProductTile.
        pricing.salePct > 0 && product.inStock !== false ? (
          <Badge tone="promo" size="sm" style={pricing.isFlash ? FLASH_BADGE_STYLE : undefined}>
            {pricing.isFlash ? `${vi.flashSale.badge} -${pricing.salePct}%` : `-${pricing.salePct}%`}
          </Badge>
        ) : undefined
      }
      onPress={() => {
        haptic('light');
        onOpen?.();
        navigate(`/product/${product.slug}`, {
          state: { listSource, ...(pricing.flashVariationId ? { variationId: pricing.flashVariationId } : {}) },
        });
      }}
    />
  );
}

export interface CatalogGridProps {
  products: ProductCard[];
  listSource: string;
  onOpen?: (product: ProductCard, index: number) => void;
}

export function CatalogGrid({ products, listSource, onOpen }: CatalogGridProps) {
  return (
    <div data-testid="catalog-grid" style={GRID_STYLE}>
      {products.map((p, i) => (
        <CatalogTile key={p.id} product={p} listSource={listSource} onOpen={onOpen ? () => onOpen(p, i) : undefined} />
      ))}
    </div>
  );
}

/**
 * Các khối của thân thẻ ProductTile dạng lưới (px). Skeleton dựng từ ĐÚNG các hằng số này (bài học 4a:
 * skeleton lệch nội dung thật làm trang nhảy). Dòng chữ `caption`/giá cao 20px theo line-height token;
 * ô tên lấy từ `TILE_NAME_MIN_HEIGHT` của chính ProductTile. Đổi ProductTile thì đo lại —
 * e2e buy-flow-4b kiểm lệch ≤ 16px.
 */
const BODY_PADDING = 10;
const LINE_HEIGHT = 20;
const NAME_GAP = 2;
const RATING_GAP = 3;
const PRICE_GAP = 4;

/** 10 + 20 (nhãn hiệu) + 2 + 44 (tên) + 3 + 20 (sao) + 4 + 20 (giá) + 10 = 133. */
export const TILE_BODY_HEIGHT =
  BODY_PADDING + LINE_HEIGHT + NAME_GAP + TILE_NAME_MIN_HEIGHT + RATING_GAP + LINE_HEIGHT + PRICE_GAP + LINE_HEIGHT + BODY_PADDING;

export function CatalogGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div data-testid="catalog-grid-skeleton" aria-hidden="true" style={GRID_STYLE}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-testid="catalog-tile-skeleton"
          style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)', overflow: 'hidden' }}
        >
          <Skeleton height="auto" radius="0" style={{ aspectRatio: '1 / 1' }} />
          <div data-testid="catalog-tile-skeleton-body" style={{ height: TILE_BODY_HEIGHT, padding: BODY_PADDING, boxSizing: 'border-box' }}>
            <Skeleton width={56} height={LINE_HEIGHT} />
            <Skeleton width="90%" height={TILE_NAME_MIN_HEIGHT} style={{ marginTop: NAME_GAP }} />
            <Skeleton width="50%" height={LINE_HEIGHT} style={{ marginTop: RATING_GAP }} />
            <Skeleton width={80} height={LINE_HEIGHT} style={{ marginTop: PRICE_GAP }} />
          </div>
        </div>
      ))}
    </div>
  );
}
