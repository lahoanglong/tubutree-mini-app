import type { Prisma } from '@prisma/client';

/**
 * Variation không có cột sortOrder do admin đặt, nên mọi nơi nạp phân loại để hiển thị/chọn mặc định phải có cùng một thứ tự
 * tất định (không để Postgres trả theo thứ tự vật lý, đổi sau mỗi UPDATE): giá niêm yết tăng dần, rồi sku, rồi id.
 * Prisma không orderBy được theo `salePrice ?? retailPrice`, nên nơi cần đúng giá đang bán dùng thêm `sortVariationsByPrice`.
 */
export const VARIATION_ORDER_BY = [{ retailPrice: 'asc' }, { sku: 'asc' }, { id: 'asc' }] satisfies Prisma.VariationOrderByWithRelationInput[];

const effectivePrice = (v: { retailPrice: number; salePrice: number | null }) => v.salePrice ?? v.retailPrice;

/** Giá đang bán tăng dần (phân loại rẻ nhất = giá "từ" của sản phẩm đứng đầu), hoà thì sku rồi id. */
export function sortVariationsByPrice<T extends { id: string; sku: string; retailPrice: number; salePrice: number | null }>(variations: T[]): T[] {
  return [...variations].sort(
    (a, b) => effectivePrice(a) - effectivePrice(b) || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

type PricedVariation = { id: string; sku: string; retailPrice: number; salePrice: number | null; stock: number };

/**
 * Phân loại đại diện của sản phẩm: đúng phân loại trang chi tiết mở sẵn (giá đang bán thấp nhất trong các phân loại còn hàng,
 * hết hàng cả thì phân loại đầu). Cùng quy tắc với `pickDefaultVariation` ở app-core; Pancake chỉ ghi giá bán vào phân loại
 * chứ không vào `Product.salePrice`, nên thẻ sản phẩm phải lấy giá từ đây.
 */
export function representativeVariation<T extends PricedVariation>(variations: readonly T[]): T | null {
  const sorted = sortVariationsByPrice([...variations]);
  return sorted.find((v) => v.stock > 0) ?? sorted[0] ?? null;
}

/**
 * Giá niêm yết và giá đang bán của thẻ sản phẩm, kèm `repVariationId` (phân loại đại diện) để thẻ và trang chi tiết chọn cùng một
 * phân loại khi nhiều phân loại cùng giá. Không có phân loại nào thì giữ giá cột của sản phẩm và không có `repVariationId`.
 */
export function cardPrices(
  product: { basePrice: number; salePrice: number | null },
  variations: readonly PricedVariation[] | null | undefined,
): { basePrice: number; salePrice: number | null; repVariationId?: string } {
  const rep = representativeVariation(variations ?? []);
  return rep
    ? { basePrice: rep.retailPrice, salePrice: rep.salePrice, repVariationId: rep.id }
    : { basePrice: product.basePrice, salePrice: product.salePrice };
}

/**
 * Giá thẻ của món gian hàng CTV có ghim phân loại: thẻ ghi giá của đúng phân loại đã ghim (và trang chi tiết mở phân loại đó), không phải
 * phân loại đại diện. Chỉ áp khi phân loại ghim còn bán và còn hàng; hết hàng hay đã tắt thì thẻ về phân loại đại diện như món không ghim,
 * khớp trang chi tiết (nó chỉ mở phân loại ghim khi còn hàng).
 */
export function pinnedCardPrices(
  product: { basePrice: number; salePrice: number | null },
  variations: readonly PricedVariation[] | null | undefined,
  pinnedVariationId: string | null | undefined,
): { basePrice: number; salePrice: number | null; repVariationId?: string; pinnedVariationId?: string } {
  const pinned = pinnedVariationId ? (variations ?? []).find((v) => v.id === pinnedVariationId && v.stock > 0) : undefined;
  return pinned
    ? { basePrice: pinned.retailPrice, salePrice: pinned.salePrice, repVariationId: pinned.id, pinnedVariationId: pinned.id }
    : cardPrices(product, variations);
}

/** Suất Giờ vàng đang chạy của một phân loại, cùng dạng với `FlashPriceItem` ở app-core. */
export type FlashOffer = { variationId: string; flashPrice: number; retailPrice: number; salePrice: number | null };

/**
 * Giá khách thấy trên thẻ gồm Giờ vàng, cùng luật với `cardPricing` ở app-core: một suất chỉ thắng khi rẻ hơn giá đang bán của
 * chính phân loại có suất lẫn giá đang bán của thẻ; nhiều suất thì lấy `flashPrice` thấp nhất (hoà thì cùng giá nên số không đổi).
 */
export function cardPriceWithFlash(
  product: { basePrice: number; salePrice: number | null },
  variations: readonly PricedVariation[] | null | undefined,
  offers: readonly FlashOffer[] | undefined,
): number {
  const card = cardPrices(product, variations);
  const standing = card.salePrice ?? card.basePrice;
  let best = standing;
  for (const o of offers ?? []) {
    if (o.flashPrice < (o.salePrice ?? o.retailPrice) && o.flashPrice < best) best = o.flashPrice;
  }
  return best;
}
