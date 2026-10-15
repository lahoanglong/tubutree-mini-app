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
