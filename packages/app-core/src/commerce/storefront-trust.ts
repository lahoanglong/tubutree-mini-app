import { returnsPromise } from '../returns-copy';

/**
 * Dải cam kết của trang gian hàng (Mini `/s/:slug`, web `/s/[slug]`). Chỉ nói điều luôn đúng với mọi gian hàng: hàng đã qua duyệt, theo dõi đơn và thanh toán đều
 * qua Tubu Tree, đổi trả theo cấu hình `returns.window_days`. Điện thoại (Mini và web dưới md) in chữ ngắn để bốn chip nằm trong hai hàng ở 375px; web từ md in chữ đủ.
 */
export type StorefrontTrustKey = 'reviewed' | 'tracking' | 'payment' | 'returns';

export interface StorefrontTrustChip {
  key: StorefrontTrustKey;
  short: string;
  full: string;
}

/** Chữ ngắn tối đa 19 ký tự: hai chip mỗi hàng ở 375px (đệm trang 16, khe 6). */
export const STOREFRONT_TRUST_SHORT_MAX = 19;

export const STOREFRONT_TRUST_TITLE = 'Cam kết của gian hàng';

const FIXED: readonly StorefrontTrustChip[] = [
  { key: 'reviewed', short: 'Hàng đã qua duyệt', full: 'Sản phẩm đã qua duyệt của Tubu Tree' },
  { key: 'tracking', short: 'Theo dõi đơn', full: 'Theo dõi đơn trên Tubu Tree' },
  { key: 'payment', short: 'Thanh toán qua Tubu', full: 'Thanh toán qua Tubu Tree' },
];

/**
 * Các chip theo thứ tự hiển thị. Số ngày đổi trả bằng 0 thì bỏ chip đổi trả (API từ chối mọi yêu cầu); chưa biết số ngày thì hứa chung, không điền số mặc định
 * (cùng luật `returnsPromise` của trang sản phẩm).
 */
export function storefrontTrustChips(returnWindowDays: unknown): StorefrontTrustChip[] {
  const returns = returnsPromise(returnWindowDays);
  return returns ? [...FIXED, { key: 'returns', short: 'Đổi trả nếu lỗi', full: returns }] : [...FIXED];
}
