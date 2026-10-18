import type { HttpClient } from '../http';

export interface ReviewItem {
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
export interface ReviewSummary {
  average: number;
  count: number;
  videoCount?: number;
  distribution?: Record<string, number>;
  items: ReviewItem[];
}
export const fetchReviews = (http: HttpClient, slug: string) => http.get<ReviewSummary>(`/products/${slug}/reviews`);

/** Một đánh giá khách đã viết cho sản phẩm, gắn với lần mua (đơn) của nó — để gắn nút sửa đúng dòng. */
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
 * Hỏi TRƯỚC khi mở ô soạn đánh giá — tránh để khách chưa mua upload ảnh/video rồi mới bị từ chối. Mỗi lần mua một đánh
 * giá: `canReview` là còn đơn để viết đánh giá MỚI (`reviewableOrders`), `ALL_REVIEWED` là mọi lần mua đã có đánh giá
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
export const canReviewProduct = (http: HttpClient, slug: string) =>
  http.get<CanReview>(`/products/${slug}/reviews/can-review`);

/** Nguyên nội dung một đánh giá của chính mình (ảnh base64 không đổi thành đường dẫn) để điền sẵn form sửa. */
export interface MyReview {
  id: string;
  orderId: string;
  rating: number;
  comment: string | null;
  images: string[];
  videoUrl: string | null;
  isVisible: boolean;
}
export const fetchMyReview = (http: HttpClient, id: string) => http.get<MyReview>(`/reviews/${id}`);

/**
 * POST /products/:slug/reviews trả nguyên dòng Review (không có author/avatar như mục của danh sách công khai) kèm
 * `updated`. Hai trường dưới là optional để chịu được API cũ chưa trả.
 * - `updated`: true khi đơn đó đã có đánh giá và lần gọi này SỬA nó (không cộng Điểm Xanh), false khi tạo mới.
 * - `pointsEarned`: cột của dòng Review. 5/10/15 khi được thưởng; 0 khi khách đã nhận thưởng cho đánh giá đầu tiên của
 *   sản phẩm này. Khi `updated` là true nó là phần thưởng của lần tạo gốc, không phải của lần gọi này.
 */
export type CreatedReview = Pick<ReviewItem, 'id' | 'rating' | 'comment' | 'images' | 'videoUrl' | 'createdAt'> & {
  pointsEarned?: number;
  updated?: boolean;
  /** false khi admin đang ẩn đánh giá này: lưu/sửa không làm nó hiện lại. Thiếu (API cũ) coi là đang hiện. */
  isVisible?: boolean;
};
/**
 * `orderId`: lần mua được đánh giá; đơn đã có đánh giá thì lần gửi này sửa nó. Bắt buộc: máy chủ hiểu lần gửi không kèm đơn
 * (bản app cũ) là sửa đánh giá mới nhất khi mọi lần mua đã có đánh giá.
 */
export const createReview = (
  http: HttpClient,
  slug: string,
  data: { rating: number; comment?: string; images?: string[]; videoUrl?: string; orderId: string },
) => http.post<CreatedReview>(`/products/${slug}/reviews`, data);
