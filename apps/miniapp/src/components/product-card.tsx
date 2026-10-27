import type { CSSProperties } from 'react';
import { useNavigate } from 'zmp-ui';
import { Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveFlashSales } from '../services/shop-api';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { tilePricing } from './catalog/catalog-pricing';
import { Badge } from './ui/badge';
import { ProductTile, type ProductTileProduct } from './ui/product-tile';

const FLASH_BADGE_STYLE: CSSProperties = { background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' };

/** Thẻ SP của danh sách yêu thích: cùng ProductTile + quy tắc giá với lưới Trang chủ/Danh mục. */
export default function ProductCard({ product }: { product: ProductTileProduct }) {
  const navigate = useNavigate();
  // Giá giờ vàng phải hiện ở ĐÂY nữa, không chỉ ở dải "Ưu đãi giờ vàng": trước đây trang chủ
  // hiện SP X giá flash 99.000đ ở dải trên, rồi chính SP X giá 165.000đ ở lưới bên dưới —
  // cùng một màn hình, hai giá, khách không biết giá nào thật (P1-4 audit mạch lạc).
  // Dùng chung queryKey với dải flash nên không phát sinh request mới.
  const flashQ = useQuery({
    queryKey: ['flash-sales', 'active'],
    queryFn: fetchActiveFlashSales,
    staleTime: 30_000,
  });
  const pricing = tilePricing(product, flashQ.data ?? []);

  return (
    <ProductTile
      product={product}
      variant="grid"
      priceOverride={{ price: pricing.price, compareAt: pricing.compareAt }}
      badge={
        // Hết hàng: lớp phủ của ProductTile trong suốt 72% — không để badge % lộ ra bên dưới.
        pricing.salePct > 0 && product.inStock !== false ? (
          <Badge tone="promo" size="sm" icon={pricing.isFlash ? Zap : undefined} style={pricing.isFlash ? FLASH_BADGE_STYLE : undefined}>
            {pricing.isFlash ? `${vi.flashSale.badge} -${pricing.salePct}%` : `-${pricing.salePct}%`}
          </Badge>
        ) : undefined
      }
      onPress={() => {
        haptic('light');
        // Mở đúng phân loại đang giảm giờ vàng (SP nhiều phân loại: flash chỉ gắn vào một).
        const state = pricing.flashVariationId
          ? { variationId: pricing.flashVariationId }
          : product.pinnedVariationId
            ? { pinnedVariationId: product.pinnedVariationId }
            : undefined;
        navigate(`/product/${product.slug}`, state ? { state } : undefined);
      }}
    />
  );
}
