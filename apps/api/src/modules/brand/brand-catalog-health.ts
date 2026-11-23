import { ingredientNames } from '../catalog/ingredient-names';

/** Số dòng tối đa của mỗi danh sách trả về (thiếu INCI, hết hàng); con số tổng vẫn đếm đủ. */
export const CATALOG_HEALTH_LIST_MAX = 50;

export interface CatalogHealthProduct {
  id: string;
  name: string;
  ingredients: unknown;
  /** Chỉ biến thể đang bật. */
  variations: { sku: string; name: string; stock: number }[];
}

/** Khớp `BrandCatalogHealth` của app-core (api/brand-owner.ts). */
export interface BrandCatalogHealthView {
  totalProducts: number;
  totalSkus: number;
  outOfStockSkus: number;
  /** SKU của sản phẩm nằm trong bảng cặp chai ↔ gói Refill. null: không đọc được bảng cặp lúc này. */
  refillPairedSkus: number | null;
  missingInciProducts: number;
  missingInci: { productId: string; name: string; skuCount: number }[];
  outOfStock: { productId: string; productName: string; sku: string; name: string }[];
  listMax: number;
}

/**
 * Sức khoẻ catalog của MỘT nhãn từ các sản phẩm đang bật của nhãn đó (nơi gọi đã lọc theo nhãn của chính người xem). SKU = biến thể đang bật;
 * hết hàng = tồn ≤ 0; thiếu INCI xét ở sản phẩm (thành phần khai theo sản phẩm, mọi SKU dùng chung), cùng luật đọc `ingredientNames` của Giờ G.
 */
export function brandCatalogHealth(products: readonly CatalogHealthProduct[], refillProductIds: ReadonlySet<string> | null): BrandCatalogHealthView {
  let totalSkus = 0;
  let refillPairedSkus = 0;
  const missingInci: BrandCatalogHealthView['missingInci'] = [];
  const outOfStock: BrandCatalogHealthView['outOfStock'] = [];
  for (const p of products) {
    totalSkus += p.variations.length;
    if (refillProductIds?.has(p.id)) refillPairedSkus += p.variations.length;
    if (ingredientNames(p.ingredients).length === 0) missingInci.push({ productId: p.id, name: p.name, skuCount: p.variations.length });
    for (const v of p.variations) {
      if (v.stock <= 0) outOfStock.push({ productId: p.id, productName: p.name, sku: v.sku, name: v.name });
    }
  }
  return {
    totalProducts: products.length,
    totalSkus,
    outOfStockSkus: outOfStock.length,
    refillPairedSkus: refillProductIds ? refillPairedSkus : null,
    missingInciProducts: missingInci.length,
    missingInci: missingInci.slice(0, CATALOG_HEALTH_LIST_MAX),
    outOfStock: outOfStock.slice(0, CATALOG_HEALTH_LIST_MAX),
    listMax: CATALOG_HEALTH_LIST_MAX,
  };
}
