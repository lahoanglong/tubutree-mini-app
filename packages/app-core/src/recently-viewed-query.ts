import { PRODUCT_SLUGS_LIST_MAX, PRODUCT_SLUGS_QUERY_MAX_CHARS } from '@tubutree/shared-types';

/** Trần độ dài chuỗi `slugs` (đã nối bằng dấu phẩy) mà API nhận, cùng hằng với @MaxLength ở ProductQuery; vượt thì HTTP 400. */
export const PRODUCTS_SLUGS_MAX_CHARS = PRODUCT_SLUGS_QUERY_MAX_CHARS;

/**
 * Chọn slug để hỏi giá hiện hành cho dải "Đã xem gần đây": từ mới nhất tới cũ nhất, giữ tới khi chuỗi nối bằng dấu phẩy sắp vượt `maxChars`.
 * Slug đầu tiên không vừa thì dừng, kể cả slug dài hơn cả trần (không nhảy cóc sang món cũ hơn): kết quả luôn là phần đầu của danh sách, nên dải chỉ bớt thẻ ở cuối.
 */
export const recentlyViewedQuerySlugs = (slugs: readonly string[], maxChars = PRODUCTS_SLUGS_MAX_CHARS, maxItems = PRODUCT_SLUGS_LIST_MAX): string[] => {
  const out: string[] = [];
  let length = 0;
  for (const slug of slugs) {
    if (out.length >= maxItems) break;
    const next = length + (out.length > 0 ? 1 : 0) + slug.length;
    if (next > maxChars) break;
    out.push(slug);
    length = next;
  }
  return out;
};
