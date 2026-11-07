/**
 * Lightbox ảnh/video đánh giá (Mini App và web chỉ vẽ): danh sách tệp của một đánh giá, bước qua lại và cử chỉ vuốt.
 * Đường dẫn tệp giữ nguyên như API trả; mỗi app tự ghép địa chỉ gốc của máy chủ ảnh.
 */
export type ReviewMediaItem = { kind: 'image' | 'video'; src: string };

export interface ReviewMediaSource {
  images: readonly string[];
  videoUrl: string | null;
}

/** Thời gian và đường cong mở lightbox: cùng tấm đáy (220ms, ease-drawer). */
export const LIGHTBOX_OPEN_MS = 220;
export const LIGHTBOX_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** Quãng vuốt ngang tối thiểu (px) để tính là chuyển tệp, và tỉ lệ ngang/dọc để không nhầm với cuộn. */
export const SWIPE_MIN_PX = 48;
export const SWIPE_AXIS_RATIO = 1.5;

/** Ảnh theo thứ tự đăng, video (nếu có) ở cuối: khách xem ảnh trước, đúng thứ tự hiện trong danh sách. */
export function reviewMediaItems(review: ReviewMediaSource): ReviewMediaItem[] {
  const items: ReviewMediaItem[] = review.images.filter((src) => src.trim() !== '').map((src) => ({ kind: 'image', src }));
  if (review.videoUrl && review.videoUrl.trim() !== '') items.push({ kind: 'video', src: review.videoUrl });
  return items;
}

/** Vị trí kế tiếp (+1) hoặc trước đó (-1), quay vòng. Không có tệp thì 0. */
export function lightboxStep(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (((index + direction) % count) + count) % count;
}

/** "1 / 5"; số tệp 0 thì rỗng. Vị trí ngoài khoảng được kẹp về khoảng hợp lệ. */
export function lightboxCounter(index: number, count: number): string {
  if (count <= 0) return '';
  const at = Math.min(Math.max(index, 0), count - 1);
  return `${at + 1} / ${count}`;
}

/** Vuốt sang trái (dx < 0) là tệp kế tiếp, sang phải là tệp trước; vuốt ngắn hoặc nghiêng theo chiều dọc thì bỏ qua. */
export function swipeDirection(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < SWIPE_MIN_PX) return 0;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}
