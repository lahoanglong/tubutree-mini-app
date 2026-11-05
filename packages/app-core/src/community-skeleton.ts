/**
 * Số đo (px) khung chờ thẻ bài đăng của bảng tin: `PostCardSkeleton` của Mini và web cùng đọc ở đây (như `TILE_METRICS` với thẻ sản phẩm).
 * Thẻ thật cao theo nội dung; đo ở 375px thì bài ngắn không ảnh cao ≈180px ở Mini và ≈176px ở web. Khung chờ dùng chung 180 để Mini và
 * web khổ điện thoại giống nhau: Mini không nhảy, web lệch ≈4px mỗi thẻ khi bài ngắn về (bài có ảnh cao hơn nhiều, lệch nào cũng có). Hai nhánh chờ cũ là khối xám 140px và 110px không giống thẻ nào.
 */
export const POST_CARD_SKELETON = {
  height: 180,
  /** Lề trong của thẻ, bằng `padding` của thẻ thật. */
  inset: 16,
  /** Khe giữa các dòng trong thẻ và giữa các thẻ (thẻ thật cách nhau 8px). */
  gap: 8,
  /** Khe giữa tên tác giả và dòng giờ đăng dưới nó. */
  tight: 4,
  /** Ảnh đại diện tác giả. */
  avatar: 32,
  /** Dòng tên tác giả, tiêu đề, dòng nội dung và dòng giờ đăng. */
  author: 14,
  title: 18,
  line: 14,
  meta: 12,
} as const;

/** Độ rộng các dòng nội dung của khung chờ, từ trên xuống: dòng cuối ngắn như đoạn văn thật. */
export const POST_CARD_SKELETON_LINES = ['100%', '90%', '55%'] as const;

export const POST_CARD_SKELETON_COUNT = 3;
