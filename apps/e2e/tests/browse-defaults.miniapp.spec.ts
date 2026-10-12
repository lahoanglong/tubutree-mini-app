import { test, expect, makeUser, mockSession } from './support/mock-api';
import type { CartSummary } from '../../miniapp/src/services/shop-api';

/**
 * Dự án 4b — mọi endpoint mà trang Danh mục/Tìm kiếm gọi (`/categories`, `/search/suggest`, `/products`
 * với tham số lọc mới, `/brands`) có mock mặc định trong `mockSession`. Fixture của mock-api FAIL test
 * nếu có lời gọi chưa mock, nên chỉ cần mở trang với `mockSession` là đủ để chứng minh điều đó.
 * (Kịch bản đầy đủ của Danh mục nằm ở buy-flow-4b.miniapp.spec.ts.)
 */
const EMPTY_CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };

test.describe('Danh mục — mock mặc định của mockSession', () => {
  test.beforeEach(({ api }) => {
    mockSession(api, makeUser({ id: 'user-browse-defaults' }));
    api.get('/cart', EMPTY_CART);
    api.allowUnmocked('POST /events', 'POST /affiliate/touch', 'GET /config/public', 'GET /me/coupons', 'GET /affiliate/me');
  });

  test('/browse (gốc) mở được, đã gọi /categories và /products', async ({ page, api }) => {
    await page.goto('/browse');
    await expect(page.getByRole('searchbox', { name: 'Tìm sản phẩm' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/categories').length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => api.callsTo('GET', '/products').length, { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('/browse với đủ tham số lọc mới vẫn không có lời gọi chưa mock', async ({ page, api }) => {
    await page.goto('/browse?q=nuoc&sort=best_seller&inStock=1&rating=4&minPrice=100000&maxPrice=200000&brand=Tubu');
    await expect(page.getByRole('searchbox', { name: 'Tìm sản phẩm' })).toHaveValue('nuoc', { timeout: 15_000 });
    await expect
      .poll(() => api.callsTo('GET', '/products').some((c) => c.query.get('sort') === 'best_seller' && c.query.get('inStock') === 'true' && c.query.get('minRating') === '4' && c.query.get('brand') === 'Tubu'), { timeout: 15_000 })
      .toBe(true);
  });
});
