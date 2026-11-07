/**
 * Phản hồi khi thêm vào giỏ: chấm nhỏ bay từ nút thêm tới biểu tượng giỏ, huy hiệu số lượng nảy một nhịp.
 * Phần tính (đường bay, thời lượng) ở đây; vẽ bằng DOM do từng app làm, và bỏ hẳn chuyển động khi khách bật giảm chuyển động.
 */
export const CART_BUMP_MS = 220;
export const CART_FLY_MS = 420;
export const CART_FEEDBACK_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** Sự kiện trên `window` báo "vừa thêm vào giỏ"; huy hiệu giỏ nghe để nảy. */
export const CART_ADDED_EVENT = 'tubu:cart-added';
/** Tên thuộc tính đánh dấu biểu tượng giỏ mà chấm bay tới. */
export const CART_TARGET_ATTR = 'data-cart-target';
/** Đường kính chấm bay (px). */
export const FLY_DOT_SIZE = 20;
/** Chấm bay vòng lên cao thêm tối đa chừng này (px) giữa đường đi để thành cung thay vì đường thẳng. */
export const FLY_ARC_MAX = 28;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FlyDelta {
  dx: number;
  dy: number;
}

/** Hộp có diện tích: phần tử bị ẩn (display:none, ngoài cây) đo ra 0 và không dùng làm đích. */
export function isMeasurable(box: Box | null | undefined): box is Box {
  return !!box && box.width > 0 && box.height > 0;
}

/** Quãng dịch từ tâm hộp nguồn tới tâm hộp đích. */
export function flyDelta(from: Box, to: Box): FlyDelta {
  return {
    dx: to.left + to.width / 2 - (from.left + from.width / 2),
    dy: to.top + to.height / 2 - (from.top + from.height / 2),
  };
}

/** Ba khung hình: xuất phát, giữa đường (nâng lên tạo cung), tới giỏ (nhỏ dần). */
export function flyKeyframes({ dx, dy }: FlyDelta): { transform: string; opacity: number; offset: number }[] {
  const lift = Math.min(FLY_ARC_MAX, Math.abs(dy) * 0.25);
  return [
    { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, offset: 0 },
    { transform: `translate3d(${dx * 0.55}px, ${dy * 0.55 - lift}px, 0) scale(0.7)`, opacity: 1, offset: 0.55 },
    { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.3)`, opacity: 0.6, offset: 1 },
  ];
}
