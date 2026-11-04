/** Trần độ dài chuỗi `slugs` (đã nối bằng dấu phẩy) mà API nhận: `@MaxLength(2000)` ở apps/api/src/modules/catalog/dto/product-query.dto.ts:44; vượt thì HTTP 400. */
export const PRODUCTS_SLUGS_MAX_CHARS = 2000;

/**
 * Chọn slug để hỏi giá hiện hành cho dải "Đã xem gần đây": từ mới nhất tới cũ nhất, giữ tới khi chuỗi nối bằng dấu phẩy sắp vượt `maxChars`.
 * Slug dài hơn cả trần bị bỏ qua; slug đầu tiên không vừa thì dừng (không nhảy cóc sang món cũ hơn, kẻo dải thiếu món mới mà lại có món cũ).
 */
export const recentlyViewedQuerySlugs = (slugs: readonly string[], maxChars = PRODUCTS_SLUGS_MAX_CHARS): string[] => {
  const out: string[] = [];
  let length = 0;
  for (const slug of slugs) {
    if (slug.length > maxChars) continue;
    const next = length + (out.length > 0 ? 1 : 0) + slug.length;
    if (next > maxChars) break;
    out.push(slug);
    length = next;
  }
  return out;
};
