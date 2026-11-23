/**
 * Nút "Đánh giá (n SP)" trên thẻ đơn đã nhận (danh sách Đơn hàng của Mini App và web), mở chi tiết đơn nơi từng món có lối "Viết đánh giá"
 * (kèm `?review=1` để màn chi tiết cuộn tới món đầu tiên còn chờ đánh giá).
 * Module không nhập gì: thẻ đơn nạp sẵn ở trang Đơn hàng, không kéo theo chữ của biểu mẫu đánh giá.
 *
 * Chỗ dùng: `apps/miniapp/src/components/orders/order-card.tsx`, `apps/web/src/components/orders/order-card.tsx`. Nhãn tối đa 18 ký tự (n ≤ 99)
 * để nằm cùng hàng với "Mua lại" ở khổ 360px.
 */
export interface OrderReviewCta {
  /** Chữ trên nút, gọn cho thẻ đơn. */
  label: string;
  /** Tên truy cập: bắt đầu bằng đúng nhãn hiện trên nút (người dùng điều khiển bằng giọng nói gọi theo chữ họ thấy), thêm mã đơn để phân biệt các thẻ. */
  ariaLabel: string;
}

export function orderReviewCta(o: { code: string; status: string; pendingReviewCount?: number | null }): OrderReviewCta | null {
  const n = o.pendingReviewCount ?? 0;
  if (o.status !== 'DELIVERED' || !Number.isInteger(n) || n <= 0) return null;
  return { label: `Đánh giá (${n} SP)`, ariaLabel: `Đánh giá (${n} SP) của đơn ${o.code}` };
}

/**
 * Tham số của chi tiết đơn khi mở từ nút "Đánh giá (n SP)": màn chi tiết cuộn tới và đặt focus vào món đầu tiên còn lối "Viết đánh giá"
 * (`reviewFocusIndex` trong `order-line-review.ts`). Web: `/tai-khoan/don-hang/<mã>?review=1`; Mini App: `/order/<mã>?review=1`.
 */
export const REVIEW_FOCUS_PARAM = 'review';

export const withReviewFocus = (href: string): string => `${href}${href.includes('?') ? '&' : '?'}${REVIEW_FOCUS_PARAM}=1`;

export const wantsReviewFocus = (search: string | null | undefined): boolean => new URLSearchParams(search ?? '').get(REVIEW_FOCUS_PARAM) === '1';
