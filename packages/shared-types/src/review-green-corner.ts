/**
 * Góc Sống Xanh (cờ `reviews.green_corner_enabled`): đánh giá ảnh thật của khách đã nhận hàng, admin duyệt rồi mới công khai.
 * API kiểm thẻ cảm nhận và số ảnh theo các hằng ở đây; hai app đọc chữ của từng thẻ ở `review.eco.<khoá>` trong shop-copy.
 * Lưu KHOÁ chứ không lưu chữ: đổi chữ hiển thị không làm hỏng dữ liệu cũ.
 */
export const REVIEW_ECO_TAGS = ['soft', 'dust_free', 'saving', 'baby_safe', 'gentle_scent', 'less_plastic'] as const;
export type ReviewEcoTag = (typeof REVIEW_ECO_TAGS)[number];

/** Số thẻ cảm nhận tối đa một đánh giá. */
export const REVIEW_ECO_TAG_MAX = 3;

/** Số ảnh tối đa của một đánh giá mới khi Góc Sống Xanh bật (đánh giá cũ đã có tới 5 ảnh vẫn sửa được). */
export const GREEN_CORNER_MAX_PHOTOS = 3;

/** Dải "Khách hàng sống xanh cùng TubuTree" ở Trang chủ chỉ hiện khi có ít nhất chừng này đánh giá ảnh đã duyệt. */
export const GREEN_CORNER_MIN_ITEMS = 3;

/** Số đánh giá tối đa API trả cho dải Trang chủ (mỗi sản phẩm một đánh giá). */
export const GREEN_CORNER_MAX_ITEMS = 8;

export function isReviewEcoTag(v: unknown): v is ReviewEcoTag {
  return typeof v === 'string' && (REVIEW_ECO_TAGS as readonly string[]).includes(v);
}

/** Giữ các khoá hợp lệ, bỏ trùng, đúng thứ tự khách chọn, tối đa REVIEW_ECO_TAG_MAX. Dữ liệu lạ từ API cũ hay DB thì bỏ qua. */
export function normalizeEcoTags(tags: readonly unknown[] | null | undefined): ReviewEcoTag[] {
  const out: ReviewEcoTag[] = [];
  for (const t of tags ?? []) {
    if (isReviewEcoTag(t) && !out.includes(t)) out.push(t);
    if (out.length >= REVIEW_ECO_TAG_MAX) break;
  }
  return out;
}

/** Một đánh giá trên dải Trang chủ (GET /green-corner). Ảnh là đường dẫn API tương đối hoặc URL https. */
export interface GreenCornerItem {
  id: string;
  rating: number;
  /** Tối đa 120 ký tự, đã cắt ở máy chủ; null khi khách không viết. */
  comment: string | null;
  image: string;
  author: string;
  ecoTags: ReviewEcoTag[];
  product: { slug: string; name: string };
}

export interface GreenCornerResponse {
  /** false khi cờ tắt: app ẩn dải, không vẽ khung chờ. */
  enabled: boolean;
  items: GreenCornerItem[];
}
