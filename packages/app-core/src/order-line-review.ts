/**
 * Ô đánh giá dưới từng món ở chi tiết đơn (Mini App `pages/order-detail.tsx`, web `/tai-khoan/don-hang/[code]`): hai app cùng một luật với nút
 * "Đánh giá (n SP)" của thẻ đơn (`order-review-cta.ts`, máy chủ đếm bằng `pendingReviewCounts`). Món đã có dòng trả được duyệt không còn lối
 * "Viết đánh giá" mà hiện trạng thái mờ "Đã hoàn tiền" (PO A5). Module không nhập gì.
 */

export interface ReviewLine {
  productSlug?: string | null;
  /** false = trang sản phẩm đã gỡ; API cũ không trả thì coi như còn. */
  productPublic?: boolean;
  reviewId?: string | null;
  /** API cũ chưa trả thì coi là viết được. */
  reviewable?: boolean;
  /** Số đã trả được duyệt của chính dòng này; API chỉ gửi khi lớn hơn 0. */
  refundedQty?: number | null;
  quantity: number;
}

export type OrderLineReviewSlot =
  | { kind: 'write'; slug: string }
  | { kind: 'edit'; slug: string }
  | { kind: 'refunded'; label: string };

export const REFUNDED_LINE_LABEL = 'Đã hoàn tiền';

/**
 * Trả lối hay trạng thái dưới một món, hoặc null khi không có gì. Đánh giá đã viết luôn sửa được, kể cả khi món đã trả sau đó. Món đã trả
 * một phần ghi rõ số đã hoàn ("Đã hoàn tiền 1/2") để khách không hiểu là cả dòng đã hoàn.
 */
export function orderLineReviewSlot(status: string, it: ReviewLine): OrderLineReviewSlot | null {
  if (status !== 'DELIVERED') return null;
  const slug = it.productPublic === false ? null : (it.productSlug ?? null);
  if (it.reviewId) return slug ? { kind: 'edit', slug } : null;
  const refunded = it.refundedQty ?? 0;
  if (Number.isInteger(refunded) && refunded > 0) {
    return { kind: 'refunded', label: refunded >= it.quantity ? REFUNDED_LINE_LABEL : `${REFUNDED_LINE_LABEL} ${refunded}/${it.quantity}` };
  }
  return slug && it.reviewable !== false ? { kind: 'write', slug } : null;
}

/** Vị trí món đầu tiên còn lối "Viết đánh giá" (đích cuộn khi mở từ "Đánh giá (n SP)"), -1 khi không còn món nào. */
export function reviewFocusIndex(o: { status: string; items: readonly ReviewLine[] }): number {
  return o.items.findIndex((it) => orderLineReviewSlot(o.status, it)?.kind === 'write');
}

/** Phần của phần tử DOM cần dùng: app-core không có kiểu DOM (chạy được ở cả Node lẫn trình duyệt). */
export interface RevealTarget {
  scrollIntoView?: (opts: { behavior: 'auto' | 'smooth'; block: 'center' }) => void;
  focus: (opts: { preventScroll: boolean }) => void;
}

/**
 * Cuộn món đích vào giữa màn và đặt focus vào nút "Viết đánh giá" của món đó (trình đọc màn hình đọc ngay tên nút). Người dùng bật
 * giảm chuyển động thì nhảy thẳng, không cuộn mượt.
 */
export function revealReviewTarget(row: RevealTarget, cta: RevealTarget | null): void {
  const w = (globalThis as { window?: { matchMedia?: (q: string) => { matches: boolean } } }).window;
  const reduce = typeof w?.matchMedia === 'function' && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  (cta ?? row).focus({ preventScroll: true });
}
