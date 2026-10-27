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

/** Giá niêm yết và giá đang bán của thẻ sản phẩm; không có phân loại nào thì giữ giá cột của sản phẩm. */
export function cardPrices(
  product: { basePrice: number; salePrice: number | null },
  variations: readonly PricedVariation[] | null | undefined,
): { basePrice: number; salePrice: number | null } {
  const rep = representativeVariation(variations ?? []);
  return rep ? { basePrice: rep.retailPrice, salePrice: rep.salePrice } : { basePrice: product.basePrice, salePrice: product.salePrice };
}
