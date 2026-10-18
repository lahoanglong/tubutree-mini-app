import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { addWishlist, getWishlist, getWishlistIds, removeWishlist } from './wishlist';

describe('wishlist — hợp đồng gọi API', () => {
  it('đọc, thêm, bỏ yêu thích', async () => {
    const { http, calls } = fakeHttp();
    await getWishlist(http);
    await getWishlistIds(http);
    await addWishlist(http, 'p1');
    await removeWishlist(http, 'p1');
    expect(calls).toEqual([
      { method: 'get', path: '/me/wishlist' },
      { method: 'get', path: '/me/wishlist/ids' },
      { method: 'post', path: '/me/wishlist', body: { productId: 'p1' } },
      { method: 'delete', path: '/me/wishlist/p1' },
    ]);
  });
});
