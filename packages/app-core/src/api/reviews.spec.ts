import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { canReviewProduct, createReview, fetchMyReview, fetchReviews } from './reviews';

describe('reviews — hợp đồng gọi API', () => {
  it('đọc và gửi đánh giá', async () => {
    const { http, calls } = fakeHttp(() => ({ id: 'r1', pointsEarned: 0 }));
    await fetchReviews(http, 'sp');
    await canReviewProduct(http, 'sp');
    await fetchMyReview(http, 'r1');
    const data = { rating: 5, comment: 'tốt', images: ['x'], orderId: 'o1' };
    expect(await createReview(http, 'sp', data)).toEqual({ id: 'r1', pointsEarned: 0 });
    expect(calls).toEqual([
      { method: 'get', path: '/products/sp/reviews' },
      { method: 'get', path: '/products/sp/reviews/can-review' },
      { method: 'get', path: '/reviews/r1' },
      { method: 'post', path: '/products/sp/reviews', body: data },
    ]);
  });
});
