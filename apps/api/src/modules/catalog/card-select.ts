import type { Prisma } from '@prisma/client';
import { VARIATION_ORDER_BY } from './variation-order';

export const CARD_VARIATION_SELECT = { id: true, sku: true, retailPrice: true, salePrice: true, stock: true } satisfies Prisma.VariationSelect;

/**
 * Cột Product mà thẻ sản phẩm thật sự đọc. Không có `description`/`ingredients` (văn bản dài) và `images` (base64 tới ~1,5 triệu ký tự
 * mỗi ảnh khi chưa cấu hình Cloudinary): ảnh đầu chỉ cần khi thẻ không có `thumbnail`, nạp riêng bằng `withCoverImages`.
 */
export const CARD_SELECT = {
  id: true,
  slug: true,
  brand: true,
  name: true,
  thumbnail: true,
  basePrice: true,
  salePrice: true,
  isFeatured: true,
  ratingAvg: true,
  reviewCount: true,
  soldExternal: true,
  soldApp: true,
  createdAt: true,
  fulfilment: true,
  storefrontId: true,
} satisfies Prisma.ProductSelect;

/** Thẻ kèm phân loại đang bán (không có `dealerPrices` và cột nội bộ) theo thứ tự giá để chọn phân loại đại diện. */
export const CARD_PRODUCT_SELECT = {
  ...CARD_SELECT,
  variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY, select: CARD_VARIATION_SELECT },
} satisfies Prisma.ProductSelect;

type RawReader = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

/**
 * Bổ sung `images` (chỉ phần tử đầu) cho thẻ không có thumbnail, để `publicProductThumb` dự phòng bằng ảnh đầu. Một câu SQL đọc
 * đúng `images[1]` của các thẻ đó; thẻ đã có thumbnail (hay hàng đã mang sẵn `images`) không tốn truy vấn nào.
 */
export async function withCoverImages<T extends { id: string; thumbnail: string | null; images?: readonly string[] | null }>(
  db: RawReader,
  rows: readonly T[],
): Promise<(T & { images: readonly string[] })[]> {
  const missing = rows.filter((r) => !r.thumbnail && r.images === undefined).map((r) => r.id);
  const cover = new Map<string, string>();
  if (missing.length > 0) {
    const found = await db.$queryRaw<{ id: string; cover: string | null }[]>`
      SELECT "id", "images"[1] AS "cover" FROM "products" WHERE "id" = ANY(${missing}::text[])`;
    for (const f of found) if (f.cover) cover.set(f.id, f.cover);
  }
  return rows.map((r) => ({ ...r, images: r.images ?? (cover.has(r.id) ? [cover.get(r.id)!] : []) }));
}
