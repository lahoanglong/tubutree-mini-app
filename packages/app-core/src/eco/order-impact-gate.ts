/**
 * Cổng thẻ nhựa đã giảm của đơn (tubu-w11-03). Module không nhập gì như `referral/viral-flag.ts`: trang Chi tiết đơn nhập tĩnh, còn chữ, số
 * và lời gọi API (`./order-impact`, kéo theo `commerce/money`) chỉ nằm trong chunk tải lười.
 */
const ASKED_STATUSES = new Set(['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED']);

/** App chỉ hỏi khi cờ bật và đơn đã chốt; đơn COD chưa giao thì máy chủ trả số 0 và thẻ không vẽ. */
export function orderEcoImpactGate(order: { status: string }, viralOn: boolean): boolean {
  return viralOn && ASKED_STATUSES.has(order.status);
}

/** Khoá và nhịp chung của truy vấn; cờ tắt thì máy chủ 404, lỗi không thử lại, thẻ ẩn. */
export const orderEcoImpactBase = (code: string) => ({
  queryKey: ['eco-impact', 'order', code] as const,
  staleTime: 60_000,
  retry: false as const,
});

export function hasEcoImpact(i: { bottlesSaved: number; plasticGrams: number } | null | undefined): boolean {
  return !!i && (i.bottlesSaved > 0 || i.plasticGrams > 0);
}
