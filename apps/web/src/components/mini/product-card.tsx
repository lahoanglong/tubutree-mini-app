'use client';

// Nguồn: apps/miniapp/src/components/product-card.tsx (ProductTile + quy tắc giá Giờ vàng, điều hướng bằng next/navigation)
import type { CSSProperties, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Zap } from 'lucide-react';
import type { ProductCard as ProductCardType } from '@/lib/api';
import { cardPricing } from '@/lib/flash-price';
import { productHref } from '@/lib/product-href';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { Badge } from './badge';
import { ProductTile } from './product-tile';

const FLASH_BADGE_STYLE: CSSProperties = { background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' };

/** Thẻ sản phẩm của danh sách: cùng ProductTile + quy tắc giá với lưới Trang chủ/Danh mục của Mini App. */
export default function ProductCard({ product, wishlist }: { product: ProductCardType; wishlist?: ReactNode }) {
  const router = useRouter();
  // Giá Giờ vàng hiện cả ở lưới, không chỉ ở dải "Ưu đãi giờ vàng": một sản phẩm không được hai giá trên cùng màn hình.
  const pricing = cardPricing(product, useActiveFlashSales());

  return (
    <ProductTile
      product={product}
      variant="grid"
      priceOverride={{ price: pricing.price, compareAt: pricing.compareAt }}
      wishlist={wishlist}
      badge={
        // Hết hàng: lớp phủ của ProductTile trong suốt 72% — không để badge % lộ ra bên dưới.
        pricing.salePct > 0 && product.inStock ? (
          <Badge tone="promo" size="sm" icon={pricing.isFlash ? Zap : undefined} style={pricing.isFlash ? FLASH_BADGE_STYLE : undefined}>
            {pricing.isFlash ? `Giờ vàng -${pricing.salePct}%` : `-${pricing.salePct}%`}
          </Badge>
        ) : undefined
      }
      onPress={() => router.push(productHref(product.slug, pricing.flashVariationId))}
    />
  );
}
