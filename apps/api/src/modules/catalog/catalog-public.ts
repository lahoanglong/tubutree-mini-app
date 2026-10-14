/**
 * Trường của Product trả cho GET /products/:slug (@Public). Whitelist, không blacklist: cột nội bộ thêm sau này (mã liên kết
 * Pancake, trạng thái duyệt, cờ đồng bộ, số bán tách nguồn...) mặc định không lộ ra ngoài.
 */
const PUBLIC_PRODUCT_DETAIL_KEYS = [
  'id',
  'slug',
  'name',
  'brand',
  'shortDesc',
  'description',
  'images',
  'thumbnail',
  'basePrice',
  'salePrice',
  'certifications',
  'ingredients',
  'ratingAvg',
  'reviewCount',
  'metaTitle',
  'metaDesc',
  'isCombo',
  'tags',
  'fulfilment',
  'fulfiller',
  'sold',
  'variations',
  'reviews',
] as const;

export function toPublicProductDetail<T extends object>(product: T): Partial<T> {
  const src = product as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_PRODUCT_DETAIL_KEYS) if (k in src) out[k] = src[k];
  return out as Partial<T>;
}
