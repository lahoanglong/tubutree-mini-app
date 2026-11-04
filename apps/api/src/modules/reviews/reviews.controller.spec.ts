import 'reflect-metadata';
import { PUBLIC_CACHE_POLICY_KEY } from '../../common/decorators/public-cache.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ReviewsController } from './reviews.controller';

describe('ReviewsController — danh sách đánh giá công khai (L3-13)', () => {
  it('GET products/:slug/reviews công khai, cache USER_CONTENT (đánh giá mới duyệt hiện chậm tối đa 60 giây ở CDN)', () => {
    const fn = ReviewsController.prototype.list;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, fn)).toBe('USER_CONTENT');
    expect(Reflect.getMetadata('path', fn)).toBe('products/:slug/reviews');
  });

  it('các route theo người dùng (can-review, đánh giá của mình) không cache chung', () => {
    for (const name of ['canReview', 'findOwn', 'create', 'remove'] as const) {
      expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, ReviewsController.prototype[name])).toBeUndefined();
    }
  });
});
