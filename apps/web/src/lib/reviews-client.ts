import { apiFetch } from './client-api';

/** Một dòng của danh sách đánh giá công khai (GET /products/:slug/reviews). Ảnh base64 đã thành đường dẫn API. */
export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  images: string[];
  videoUrl: string | null;
  createdAt: string;
  author: string;
  avatar: string | null;
  verifiedPurchase?: boolean;
}

/** Số đánh giá, điểm trung bình, phân bổ sao tính trên mọi đánh giá đang hiện; `items` mới nhất trước. */
export interface ProductReviews {
  average: number;
  count: number;
  videoCount?: number;
  distribution?: Record<string, number>;
  items: PublicReview[];
}

/** Đánh giá khách đã viết cho sản phẩm, gắn với lần mua (đơn) của nó, mới nhất trước. */
export interface MyReviewRef {
  id: string;
  orderId: string;
  orderCode: string | null;
  rating: number;
  createdAt: string;
  isVisible: boolean;
}

/** Lần mua (đơn đã nhận) còn viết được đánh giá; đơn nhận sớm nhất trước. */
export interface ReviewableOrder {
  orderId: string;
  code: string;
  deliveredAt: string | null;
}

/**
 * Mỗi lần mua một đánh giá: `canReview` là còn đơn để viết đánh giá MỚI, `ALL_REVIEWED` là mọi lần mua đã có đánh giá
 * (vẫn sửa được qua `myReviews`). `rewardAvailable`: đánh giá mới lúc này có được cộng Điểm Xanh không (chỉ đánh giá đầu
 * tiên của sản phẩm); chỉ để nói đúng về điểm, máy chủ vẫn quyết định thưởng lúc tạo.
 */
export interface CanReview {
  canReview: boolean;
  reason: 'NOT_PURCHASED' | 'ALL_REVIEWED' | null;
  rewardAvailable?: boolean;
  purchaseCount?: number;
  reviewableOrders?: ReviewableOrder[];
  myReviews?: MyReviewRef[];
}

/** Nguyên nội dung một đánh giá của chính mình (ảnh giữ nguyên dạng đã gửi) để điền sẵn form sửa. */
export interface MyReview {
  id: string;
  orderId: string;
  rating: number;
  comment: string | null;
  images: string[];
  videoUrl: string | null;
  isVisible: boolean;
}

export interface ReviewInput {
  rating: number;
  comment?: string;
  images?: string[];
  videoUrl?: string;
  /**
   * Lần mua được đánh giá; đơn đã có đánh giá thì lần gửi này sửa nó. Bắt buộc: máy chủ hiểu lần gửi không kèm đơn (bản app
   * cũ) là sửa đánh giá mới nhất khi mọi lần mua đã có đánh giá.
   */
  orderId: string;
}

/** `updated`: lần gửi này sửa đánh giá đã có (không cộng điểm). `pointsEarned`: điểm của dòng đánh giá, 0 khi không được thưởng. */
export interface SavedReview {
  id: string;
  pointsEarned?: number;
  updated?: boolean;
}

const productPath = (slug: string) => `/products/${encodeURIComponent(slug)}/reviews`;

export const fetchProductReviews = (slug: string) => apiFetch<ProductReviews>(productPath(slug));
export const fetchCanReview = (slug: string) => apiFetch<CanReview>(`${productPath(slug)}/can-review`);
export const fetchMyReview = (id: string) => apiFetch<MyReview>(`/reviews/${encodeURIComponent(id)}`);
export const saveReview = (slug: string, body: ReviewInput) => apiFetch<SavedReview>(productPath(slug), { method: 'POST', body });

/** Tham số trên trang sản phẩm mở sẵn form đánh giá cho một lần mua (từ chi tiết đơn). */
export const REVIEW_ORDER_PARAM = 'danh-gia';

/** Trang sản phẩm, cuộn tới khối đánh giá và mở form cho đúng đơn. */
export function reviewHref(slug: string, orderId?: string | null): string {
  const qs = orderId ? `?${REVIEW_ORDER_PARAM}=${encodeURIComponent(orderId)}` : '';
  return `/san-pham/${encodeURIComponent(slug)}${qs}#danh-gia`;
}

export const FIRST_REVIEW_ONLY = 'Lần đầu đánh giá sản phẩm này';
export const REWARD_ALREADY_GIVEN =
  'Bạn đã nhận Điểm Xanh cho đánh giá đầu tiên của sản phẩm này, đánh giá lần mua này không cộng thêm điểm.';
export const EDIT_HINT = 'Chỉ lần đánh giá đầu tiên của mỗi sản phẩm được cộng Điểm Xanh, sửa đánh giá không cộng thêm.';

/**
 * Câu về Điểm Xanh dưới form. Form không biết chắc khách đã nhận thưởng sản phẩm này chưa (máy chủ quyết định lúc tạo),
 * nên câu hứa điểm luôn nêu điều kiện "lần đầu"; can-review báo hết thưởng thì nói thẳng là không cộng thêm. Web chưa tải
 * video lên được nên không mời thêm video.
 */
export function rewardHint(o: { isEdit: boolean; rewardAvailable: boolean; hasImages: boolean; hasVideo: boolean }): string {
  if (o.isEdit) return EDIT_HINT;
  if (!o.rewardAvailable) return REWARD_ALREADY_GIVEN;
  if (o.hasVideo) return `${FIRST_REVIEW_ONLY}, đánh giá có video nhận +15 Điểm Xanh!`;
  if (o.hasImages) return `${FIRST_REVIEW_ONLY}, bạn nhận +10 Điểm Xanh cho đánh giá có ảnh!`;
  return `${FIRST_REVIEW_ONLY}: thêm ảnh +10 Điểm Xanh (chỉ chữ +5). Chỉ đánh giá sản phẩm đã mua và nhận.`;
}

/** Câu nói rõ đánh giá đang soạn thuộc lần mua nào; null khi chỉ mua một lần hoặc chưa biết đơn. */
export function purchaseNote(o: { isEdit: boolean; purchaseCount: number; orderCode?: string | null }): string | null {
  if (!o.orderCode) return null;
  if (o.isEdit) return `Bạn đang sửa đánh giá cho đơn ${o.orderCode}.`;
  if (o.purchaseCount > 1) {
    return `Bạn đã mua sản phẩm này ${o.purchaseCount} lần, mỗi lần mua được viết một đánh giá. Đánh giá này cho đơn ${o.orderCode}.`;
  }
  return null;
}

/** Lời báo sau khi gửi: theo máy chủ chứ không theo chế độ form; chỉ nhắc điểm khi lần gửi này thật sự được cộng. */
export function savedMessage(res: SavedReview): string {
  if (res.updated) return 'Đã cập nhật đánh giá của bạn';
  const earned = res.pointsEarned ?? 0;
  return earned > 0 ? `Cảm ơn đánh giá của bạn! Đã cộng ${earned} Điểm Xanh` : 'Đã gửi đánh giá của bạn';
}
