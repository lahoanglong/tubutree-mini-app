import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('./client-api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { fetchProductReviews } from './reviews-client';

describe('fetchProductReviews', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ average: 0, count: 0, items: [] });
  });

  it('gửi bộ lọc của chip cho máy chủ và luôn hỏi lại máy chủ (no-cache) để đánh giá vừa viết hiện ngay', async () => {
    await fetchProductReviews('nuoc-rua-chen');
    await fetchProductReviews('nuoc-rua-chen', 2);
    await fetchProductReviews('nuoc-rua-chen', 'photo');
    await fetchProductReviews('nuoc-rua-chen', 2, 'MTc2|r99');
    await fetchProductReviews('nuoc-rua-chen', 'all', 'abc');
    expect(apiFetch.mock.calls).toEqual([
      ['/products/nuoc-rua-chen/reviews', { cache: 'no-cache' }],
      ['/products/nuoc-rua-chen/reviews?rating=2', { cache: 'no-cache' }],
      ['/products/nuoc-rua-chen/reviews?media=photo', { cache: 'no-cache' }],
      ['/products/nuoc-rua-chen/reviews?rating=2&cursor=MTc2%7Cr99', { cache: 'no-cache' }],
      ['/products/nuoc-rua-chen/reviews?cursor=abc', { cache: 'no-cache' }],
    ]);
  });
});
