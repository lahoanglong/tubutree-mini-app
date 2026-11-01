import type { ProductCard } from '@tubutree/app-core/api/catalog';

/** Phần trăm hiển thị: nguyên, kẹp 0–100; số lạ (NaN, Infinity) → 0. */
export function clampPercent(pct: number): number {
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0;
}

/** "Đã bán %" của một suất giờ vàng. Bán quá suất, suất 0 hoặc số lạ không được in ra 150%, NaN%. */
export function soldPercent(sold: number, quota: number): number {
  return quota > 0 ? clampPercent((sold / quota) * 100) : 0;
}

/** Thẻ sản phẩm của một suất Giờ vàng: giá của đúng phân loại có suất (ghim phân loại để thẻ chỉ xét suất này). */
export function flashCardProduct(item: {
  itemId: string;
  productSlug: string;
  productName: string;
  thumbnail: string | null;
  variationId: string;
  retailPrice: number;
  salePrice?: number | null;
}): ProductCard {
  return {
    id: item.itemId,
    slug: item.productSlug,
    name: item.productName,
    brand: '',
    thumbnail: item.thumbnail,
    basePrice: item.retailPrice,
    salePrice: item.salePrice ?? null,
    repVariationId: item.variationId,
    pinnedVariationId: item.variationId,
    isFeatured: false,
    inStock: true,
  };
}
