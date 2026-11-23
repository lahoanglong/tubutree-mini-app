/**
 * Nút "Đánh giá (n SP)" trên thẻ đơn đã nhận (danh sách Đơn hàng của Mini App và web), mở chi tiết đơn nơi từng món có lối "Viết đánh giá".
 * Module không nhập gì: thẻ đơn nạp sẵn ở trang Đơn hàng, không kéo theo chữ của biểu mẫu đánh giá.
 *
 * Chỗ dùng: `apps/miniapp/src/components/orders/order-card.tsx`, `apps/web/src/components/orders/order-card.tsx`. Nhãn tối đa 18 ký tự (n ≤ 99)
 * để nằm cùng hàng với "Mua lại" ở khổ 360px.
 */
export interface OrderReviewCta {
  /** Chữ trên nút, gọn cho thẻ đơn. */
  label: string;
  /** Tên truy cập đầy đủ: trình đọc màn hình đọc "SP" thành hai chữ cái, nên nói rõ "sản phẩm" và mã đơn. */
  ariaLabel: string;
}

export function orderReviewCta(o: { code: string; status: string; pendingReviewCount?: number | null }): OrderReviewCta | null {
  const n = o.pendingReviewCount ?? 0;
  if (o.status !== 'DELIVERED' || !Number.isInteger(n) || n <= 0) return null;
  return { label: `Đánh giá (${n} SP)`, ariaLabel: `Đánh giá ${n} sản phẩm của đơn ${o.code}` };
}
