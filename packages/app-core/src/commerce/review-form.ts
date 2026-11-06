import { formatVnNumber } from '../number-format';
import { fillCopy } from '../shop-copy';

/** Trần nhận xét: khớp `CreateReviewDto.comment` (`@MaxLength(2000)` sau `Trim`) và `INPUT_LIMITS.reviewComment` của Mini App. */
export const REVIEW_COMMENT_MAX = 2000;

export type ReviewFormField = 'rating' | 'comment';

export interface ReviewFormIssue {
  field: ReviewFormField;
  message: string;
}

/** Độ dài nhận xét như API đếm: bỏ khoảng trắng hai đầu, emoji (cặp surrogate) tính một ký tự như `isLength` của class-validator. */
export function reviewCommentLength(comment: string): number {
  return Array.from(comment.trim()).length;
}

const isStar = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;

/**
 * Lỗi đầu tiên của form đánh giá trước khi gửi, theo thứ tự trên màn: số sao rồi nhận xét. null là gửi được.
 * Số sao chỉ sai khi dữ liệu cũ lệch (đánh giá lưu ngoài 1–5); ô nhận xét có `maxLength` nhưng chữ dán vào hay bản nháp cũ vẫn có thể dài hơn.
 */
export function reviewFormIssue(input: { rating: number; comment: string }): ReviewFormIssue | null {
  if (!isStar(input.rating)) return { field: 'rating', message: fillCopy('review.ratingInvalid') };
  const n = reviewCommentLength(input.comment);
  if (n > REVIEW_COMMENT_MAX) {
    return { field: 'comment', message: fillCopy('review.commentTooLong', { max: formatVnNumber(REVIEW_COMMENT_MAX), n: formatVnNumber(n) }) };
  }
  return null;
}

/**
 * Phím trên hàng sao (mẫu radio group của WAI-ARIA APG): phải hoặc xuống tới sao kế, trái hoặc lên lùi một sao, đi vòng ở hai đầu;
 * Home là 1 sao, End là 5 sao. Phím khác trả null để Enter và Space giữ hành vi bấm nút sẵn có.
 */
export function ratingFromKey(key: string, rating: number): number | null {
  const at = isStar(rating) ? rating : 0;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return at >= 5 ? 1 : at + 1;
    case 'ArrowLeft':
    case 'ArrowUp':
      return at <= 1 ? 5 : at - 1;
    case 'Home':
      return 1;
    case 'End':
      return 5;
    default:
      return null;
  }
}
