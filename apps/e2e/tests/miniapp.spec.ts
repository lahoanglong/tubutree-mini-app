import { test, expect } from '@playwright/test';

/**
 * Zalo Mini App E2E - Luồng mua hàng Guest
 *
 * Codebase thực tế (miniapp/src/services/):
 *   - GET /api/products?limit=...       → fetchProducts()
 *   - GET /api/products/:slug           → fetchProduct()
 *   - GET /api/brands                   → fetchBrands()
 *   - GET /api/cart                     → getCart()
 *   - POST /api/auth/guest              → loginGuest()
 *
 * ProductCard renders: role="button" aria-label={product.name}
 * Nút giỏ hàng trên TopBar:  aria-label="Giỏ hàng"
 */
test.describe('Zalo Mini App E2E - Luồng Đặt hàng Guest', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  });

  const MOCK_PRODUCT = {
    id: 'prod-1',
    slug: 'nuoc-rua-chen-tubu',
    brand: 'Tubu',
    name: 'Nước Rửa Chén Sinh Học Tubu',
    thumbnail: null,
    basePrice: 50000,
    salePrice: 45000,
    isFeatured: true,
    inStock: true,
    sold: 120,
  };

  test.beforeEach(async ({ page }) => {
    // 1. Mock Guest Login → trả access token
    await page.route('**/api/auth/guest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'mock-guest-token',
          refreshToken: 'mock-guest-refresh',
          user: { id: 'guest-1', role: 'GUEST', fullName: null, pointsBalance: 0 },
        }),
      });
    });

    // 2. Mock GET /api/products (tất cả variant query) → danh sách sản phẩm
    await page.route('**/api/products*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [MOCK_PRODUCT],
            meta: { page: 1, limit: 6, total: 1 },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // 3. Mock GET /api/brands
    await page.route('**/api/brands*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ brand: 'Tubu', count: 10 }]),
      });
    });

    // 4. Mock GET /api/cart → giỏ trống
    await page.route('**/api/cart*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [],
            couponCode: null,
            subtotal: 0,
            discount: 0,
            freeship: false,
            freeshipThreshold: 300000,
            itemCount: 0,
          }),
        });
      } else {
        await route.continue();
      }
    });
  });

  test('Trang chủ hiển thị sản phẩm và điều hướng', async ({ page }) => {
    await page.goto('/');

    // ProductCard render với aria-label = product.name
    await expect(page.locator('[aria-label="Nước Rửa Chén Sinh Học Tubu"]').first()).toBeVisible({
      timeout: 10000,
    });

    // Bấm vào sản phẩm → navigate /product/:slug
    await page.click('[aria-label="Nước Rửa Chén Sinh Học Tubu"]');
    await expect(page).toHaveURL(/\/product\/nuoc-rua-chen-tubu/, { timeout: 5000 });
  });

  test('Icon Giỏ hàng điều hướng đến /cart', async ({ page }) => {
    await page.goto('/');

    // Chờ trang load xong (có logo hoặc icon)
    await page.waitForLoadState('networkidle');

    // Bấm icon Giỏ hàng trên TopBar (aria-label="Giỏ hàng")
    await page.click('[aria-label="Giỏ hàng"]');
    await expect(page).toHaveURL(/\/cart/, { timeout: 5000 });
  });
});
