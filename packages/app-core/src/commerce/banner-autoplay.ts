/** WCAG 2.2.2 và a11y.md B1: mỗi slide phải hiện ít nhất 5 giây. */
export const BANNER_MIN_INTERVAL_MS = 5000;

/** Thiếu, rác hoặc dưới 5 giây thì lấy 5 giây; nhà thiết kế chỉ được kéo dài, không rút ngắn. */
export function bannerInterval(ms?: number): number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= BANNER_MIN_INTERVAL_MS ? ms : BANNER_MIN_INTERVAL_MS;
}

export interface BannerAutoplayState {
  slideCount: number;
  /** Khách bấm nút Dừng. */
  userPaused: boolean;
  /** Kết quả `matchMedia('(prefers-reduced-motion: reduce)')`; null = trình duyệt không trả lời được. */
  reducedMotion: boolean | null;
  /** Tab đang ẩn. */
  hidden: boolean;
  /** Focus bàn phím hoặc ngón tay/chuột đang nằm trong banner. */
  held: boolean;
}

/** Chỉ tự chạy khi chắc chắn được phép: chưa biết khách có bật giảm chuyển động hay không thì đứng yên (an toàn hơn đoán). */
export function bannerShouldAutoplay(s: BannerAutoplayState): boolean {
  return s.slideCount > 1 && !s.userPaused && !s.hidden && !s.held && s.reducedMotion === false;
}

/** Slide kế tiếp, vòng về đầu; chỉ số ngoài biên (danh sách vừa co lại) hoặc không có slide thì về 0. */
export function bannerNextIndex(i: number, n: number): number {
  if (n <= 0 || i < 0 || i >= n) return 0;
  return (i + 1) % n;
}
