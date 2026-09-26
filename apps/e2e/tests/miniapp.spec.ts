import type { CartSummary, PageResponse, ProductCard, ProductDetail } from '../../miniapp/src/services/shop-api';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { publicConfig } from './support/checkout-mocks';

/**
 * Zalo Mini App E2E - Luồng mua hàng Guest
 *
 * Codebase thực tế (miniapp/src/services/shop-api.ts ↔ catalog.controller.ts / cart.controller.ts):
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
  const MOCK_PRODUCT: ProductCard = {
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

  const PRODUCT_DETAIL: ProductDetail = {
    id: 'prod-1',
    slug: 'nuoc-rua-chen-tubu',
    brand: 'Tubu',
    name: 'Nước Rửa Chén Sinh Học Tubu',
    shortDesc: 'Sạch bong, an toàn cho da tay',
    description: '<p>Nước rửa chén sinh học.</p>',
    images: [],
    thumbnail: null,
    basePrice: 50000,
    salePrice: 45000,
    certifications: [],
    variations: [
      {
        id: 'var-1',
        sku: 'NRC-500',
        name: '500ml',
        attributes: {},
        retailPrice: 50000,
        salePrice: 45000,
        stock: 30,
      },
    ],
  };

  const EMPTY_CART: CartSummary = {
    items: [],
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    freeshipThreshold: 300000,
    itemCount: 0,
  };

  test.beforeEach(async ({ api }) => {
    mockSession(api, makeUser({ id: 'guest-1', role: 'CUSTOMER', fullName: null, phone: null }));
    const page1: PageResponse<ProductCard> = { data: [MOCK_PRODUCT], meta: { page: 1, limit: 6, total: 1 } };
    api.get('/products', page1);
    api.get('/products/:slug', PRODUCT_DETAIL);
    api.get('/brands', [{ brand: 'Tubu', count: 10 }]);
    api.get('/cart', EMPTY_CART);
    // Các khối phụ của trang chủ / trang sản phẩm (flash sale, gợi ý, yêu thích, thông báo,
    // đánh giá…) — trả rỗng đúng shape để không có lời gọi nào rơi vào 404 E2E_UNMOCKED.
    api.get('/flash-sales/active', []);
    api.get('/flash-sales/upcoming', []);
    api.get('/products/for-you', []);
    api.get('/me/notifications', []);
    api.get('/me/wishlist/ids', []);
    api.get('/me/coupons', []);
    api.get('/affiliate/me', { isAffiliate: false, referralCode: '', walletBalance: 0 });
    api.get('/products/:slug/related', []);
    api.get('/products/:slug/bought-together', []);
    api.get('/products/:slug/reviews', { average: 0, count: 0, items: [] });
    api.get('/products/:slug/reviews/can-review', { canReview: false, reason: 'NOT_PURCHASED' });
    api.get('/config/public', publicConfig());
  });

  test('Trang chủ hiển thị sản phẩm và điều hướng', async ({ page }) => {
    await page.goto('/');

    // ProductCard render với aria-label = product.name
    const card = page.locator('[aria-label="Nước Rửa Chén Sinh Học Tubu"]').first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Bấm vào sản phẩm → navigate /product/:slug
    await card.click();
    await expect(page).toHaveURL(/\/product\/nuoc-rua-chen-tubu/, { timeout: 5_000 });
    // Trang chi tiết render từ GET /products/:slug (catalog.controller.ts).
    await expect(page.getByText(PRODUCT_DETAIL.shortDesc ?? '')).toBeVisible({ timeout: 10_000 });
  });

  test('Icon Giỏ hàng điều hướng đến /cart', async ({ page }) => {
    await page.goto('/');

    const cartIcon = page.locator('[aria-label="Giỏ hàng"]');
    await expect(cartIcon).toBeVisible({ timeout: 15_000 });
    await cartIcon.click();
    await expect(page).toHaveURL(/\/cart/, { timeout: 5_000 });
  });
});
