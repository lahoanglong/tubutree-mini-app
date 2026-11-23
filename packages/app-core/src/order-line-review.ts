/**
 * Ô đánh giá dưới từng món ở chi tiết đơn (Mini App `pages/order-detail.tsx`, web `/tai-khoan/don-hang/[code]`): hai app cùng một luật với nút
 * "Đánh giá (n SP)" của thẻ đơn (`order-review-cta.ts`, máy chủ đếm bằng `pendingReviewCounts`). Món đã có dòng trả được duyệt không còn lối
 * "Viết đánh giá" mà hiện một dòng trạng thái mờ (PO A5). Module không nhập gì.
 */

export interface ReviewLine {
  productSlug?: string | null;
  /** false = trang sản phẩm đã gỡ; API cũ không trả thì coi như còn. */
  productPublic?: boolean;
  reviewId?: string | null;
  /** API cũ chưa trả thì coi là viết được. */
  reviewable?: boolean;
  /** Số đã trả được duyệt của chính dòng này; API chỉ gửi khi lớn hơn 0. */
  returnedQty?: number | null;
  /** Mọi lần trả của dòng đã hoàn tiền xong (Ví đã cộng, chuyển khoản đã chuyển). */
  refundDone?: boolean | null;
  quantity: number;
}

export type OrderLineReviewSlot =
  | { kind: 'write'; slug: string }
  | { kind: 'edit'; slug: string }
  | { kind: 'returned'; label: string };

export const REFUNDED_LINE_LABEL = 'Đã hoàn tiền';
export const RETURN_APPROVED_LINE_LABEL = 'Đã duyệt trả';

/** Chữ trạng thái của món đã trả: "Đã hoàn tiền" chỉ khi tiền đã về thật; trả một phần thì ghi số đã trả trên số mua. */
function returnedLabel(returned: number, quantity: number, refundDone: boolean): string {
  const partial = returned < quantity;
  if (refundDone) return partial ? `${REFUNDED_LINE_LABEL} ${returned}/${quantity}` : REFUNDED_LINE_LABEL;
  // Chuyển khoản còn chờ, hay lần trả không có tiền để hoàn: chưa nói "hoàn tiền" (ô Thanh toán cùng màn có thể đang ghi "Đang hoàn tiền").
  return `${RETURN_APPROVED_LINE_LABEL} ${Math.min(returned, quantity)}/${quantity}`;
}

/**
 * Trả lối hay trạng thái dưới một món, hoặc null khi không có gì. Đánh giá đã viết luôn sửa được, kể cả khi món đã trả sau đó.
 */
export function orderLineReviewSlot(status: string, it: ReviewLine): OrderLineReviewSlot | null {
  if (status !== 'DELIVERED') return null;
  const slug = it.productPublic === false ? null : (it.productSlug ?? null);
  if (it.reviewId) return slug ? { kind: 'edit', slug } : null;
  const returned = it.returnedQty ?? 0;
  if (Number.isInteger(returned) && returned > 0) return { kind: 'returned', label: returnedLabel(returned, it.quantity, it.refundDone === true) };
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
