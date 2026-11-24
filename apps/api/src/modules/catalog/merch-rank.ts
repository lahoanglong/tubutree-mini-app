import type { Prisma } from '@prisma/client';

/**
 * Tầng trưng bày của danh sách mặc định (kệ Nổi bật) và Gợi ý theo ngày: hàng có ảnh và còn hàng lên trước, hàng chưa có ảnh xếp sau,
 * hàng mà mọi phân loại đang bán đều hết xếp cuối. Chỉ đổi thứ tự (trong cùng tầng giữ nguyên cách xếp cũ), không ẩn sản phẩm nào.
 * Bán chạy chỉ dùng phần còn hàng (`stockTier`): hàng hết không chiếm đầu bảng, nhưng hàng chưa ảnh vẫn giữ đúng thứ hạng lượt bán.
 * Không chọn `images`/`thumbnail` (base64 tới ~1,5 triệu ký tự mỗi ảnh, luật D2 của đường khách): cờ có ảnh tính trong DB bằng `withImageFlags`.
 */
export const MERCH_RANK_SELECT = {
  variations: { where: { isActive: true }, select: { stock: true } },
} as const satisfies Prisma.ProductSelect;

export interface MerchRankFields {
  hasImage?: boolean;
  variations?: ReadonlyArray<{ stock: number }>;
}

export type MerchTier = 0 | 1 | 2;

/** Cùng luật "còn hàng" với thẻ (`cardInStock`): 0 khi còn ít nhất một phân loại đang bán có hàng, 1 khi hết sạch. */
export function stockTier(p: MerchRankFields): 0 | 1 {
  return (p.variations ?? []).some((v) => v.stock > 0) ? 0 : 1;
}

/** Còn hàng như `stockTier`; "có ảnh" là có ảnh đại diện hoặc ít nhất một ảnh trong `images` (thẻ lấy ảnh đầu khi thiếu ảnh đại diện). */
export function merchTier(p: MerchRankFields): MerchTier {
  if (stockTier(p) === 1) return 2;
  return p.hasImage ? 0 : 1;
}

/** Chia theo tầng rồi xếp từng tầng bằng `arrange` (mặc định giữ thứ tự vào): xoay theo ngày, giãn nhãn... chạy trong tầng của nó. */
export function arrangeByMerchTier<T extends MerchRankFields>(rows: readonly T[], arrange: (rows: T[]) => T[] = (r) => r): T[] {
  const tiers: [T[], T[], T[]] = [[], [], []];
  for (const r of rows) tiers[merchTier(r)].push(r);
  return tiers.flatMap((t) => (t.length > 0 ? arrange(t) : t));
}

/** Hàng có ảnh: có ảnh đại diện (khác rỗng) hoặc mảng ảnh không rỗng. Điều kiện chạy trong DB, không chọn cột ảnh. */
export const HAS_IMAGE_WHERE = {
  OR: [{ AND: [{ thumbnail: { not: null } }, { thumbnail: { not: '' } }] }, { images: { isEmpty: false } }],
} satisfies Prisma.ProductWhereInput;

type IdReader = { product: { findMany: (args: { where: Prisma.ProductWhereInput; select: { id: true } }) => Promise<Array<{ id: string }>> } };

/** Gắn `hasImage` cho các hàng: một truy vấn chỉ trả id của hàng có ảnh, không kéo nội dung ảnh về. */
export async function withImageFlags<T extends { id: string }>(db: IdReader, rows: readonly T[]): Promise<(T & { hasImage: boolean })[]> {
  if (rows.length === 0) return [];
  const found = await db.product.findMany({ where: { AND: [{ id: { in: rows.map((r) => r.id) } }, HAS_IMAGE_WHERE] }, select: { id: true } });
  const has = new Set(found.map((f) => f.id));
  return rows.map((r) => ({ ...r, hasImage: has.has(r.id) }));
}
