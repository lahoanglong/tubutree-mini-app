import type { HttpClient } from '../http';
import { canReviewProduct, fetchMyReview, fetchReviews } from '../api/reviews';

export const reviewsQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['reviews', slug] as const,
  queryFn: () => fetchReviews(http, slug),
});
export const canReviewQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['can-review', slug] as const,
  queryFn: () => canReviewProduct(http, slug),
});
export const myReviewQuery = (http: HttpClient, id: string) => ({
  queryKey: ['my-review', id] as const,
  queryFn: () => fetchMyReview(http, id),
});
