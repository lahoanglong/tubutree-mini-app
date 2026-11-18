import {
  GREEN_CORNER_MIN_ITEMS,
  REVIEW_ECO_TAG_MAX,
  REVIEW_ECO_TAGS,
  normalizeEcoTags,
  type GreenCornerResponse,
  type ReviewEcoTag,
} from '@tubutree/shared-types';
import { fillCopy } from '../shop-copy';

/**
 * Góc Sống Xanh: thẻ cảm nhận ở form và dòng đánh giá, thẻ của dải "Khách hàng sống xanh" ở Trang chủ. Hai app chỉ vẽ.
 * Thẻ lưu bằng khoá (`soft`, `baby_safe`…); chữ ở `review.eco.<khoá>` trong shop-copy.
 */
export const ECO_TAG_OPTIONS: readonly ReviewEcoTag[] = REVIEW_ECO_TAGS;

export const ecoTagLabel = (tag: ReviewEcoTag): string => fillCopy(`review.eco.${tag}`);

/** "Mềm mịn · An toàn cho bé" dưới một đánh giá; null khi không có thẻ hợp lệ (API cũ, khoá lạ). */
export function ecoTagLine(tags: readonly unknown[] | null | undefined): string | null {
  const valid = normalizeEcoTags(tags);
  return valid.length > 0 ? valid.map(ecoTagLabel).join(' · ') : null;
}

/** Bấm một thẻ: đang chọn thì bỏ; chưa chọn thì thêm khi còn chỗ (tối đa REVIEW_ECO_TAG_MAX), hết chỗ thì giữ nguyên. */
export function toggleEcoTag(selected: readonly ReviewEcoTag[], tag: ReviewEcoTag): ReviewEcoTag[] {
  if (selected.includes(tag)) return selected.filter((t) => t !== tag);
  return selected.length >= REVIEW_ECO_TAG_MAX ? [...selected] : [...selected, tag];
}

/** Thẻ chưa chọn mà đã đủ số thẻ thì mờ (aria-disabled), để khách biết vì sao bấm không ăn. */
export const ecoTagLocked = (selected: readonly ReviewEcoTag[], tag: ReviewEcoTag): boolean =>
  !selected.includes(tag) && selected.length >= REVIEW_ECO_TAG_MAX;

export interface GreenCornerCard {
  id: string;
  /** Đường dẫn API tương đối hoặc URL https: app đưa qua hàm dựng URL ảnh API của mình. */
  image: string;
  author: string;
  rating: number;
  comment: string | null;
  tagLine: string | null;
  productSlug: string;
  productName: string;
  /** Nhãn đọc của cả thẻ (thẻ là một liên kết tới trang sản phẩm, khối đánh giá). */
  label: string;
}

/**
 * Thẻ của dải Trang chủ. Rỗng (app không vẽ gì, kể cả tiêu đề) khi cờ tắt, API cũ/lỗi, hoặc chưa đủ GREEN_CORNER_MIN_ITEMS đánh giá ảnh đã duyệt:
 * một hai thẻ lẻ loi trông như góc bỏ hoang, không làm được việc "nhiều người đang dùng".
 */
export function greenCornerCards(data: GreenCornerResponse | null | undefined): GreenCornerCard[] {
  if (!data?.enabled || !Array.isArray(data.items)) return [];
  const cards = data.items
    .filter((it) => typeof it?.image === 'string' && it.image !== '' && typeof it.product?.slug === 'string')
    .map((it) => ({
      id: it.id,
      image: it.image,
      author: it.author,
      rating: it.rating,
      comment: it.comment,
      tagLine: ecoTagLine(it.ecoTags),
      productSlug: it.product.slug,
      productName: it.product.name,
      label: fillCopy('home.greenCorner.cardLabel', { product: it.product.name, rating: it.rating, author: it.author }),
    }));
  return cards.length >= GREEN_CORNER_MIN_ITEMS ? cards : [];
}
