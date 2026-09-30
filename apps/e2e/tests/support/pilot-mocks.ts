import type { CartSummary, ProductDetail } from '../../../miniapp/src/services/shop-api';
import type { Storefront } from '../../../miniapp/src/services/storefront-api';
import { makeOrder, makeUser, mockSession, type MockApi } from './mock-api';

/**
 * Mock cho luồng "pilot" Design System v2 (design-system-pilot.miniapp.spec.ts):
 *   GET  /products/:slug (+ /related, /bought-together, /reviews)   catalog.controller
 *   GET  /flash-sales/active, /config/public
 *   GET  /cart, POST /cart/items                                    cart.controller
 *   GET  /storefront/public/:slug                                   storefront.controller
 *   GET  /orders/:code, POST /orders/:code/repurchase               orders.controller
 * Path phải khớp services/shop-api.ts + services/storefront-api.ts của miniapp.
 */

export const PILOT_SLUG = 'nuoc-rua-chen-tubu';
export const PILOT_PRODUCT_NAME = 'Nước Rửa Chén Sinh Học Tubu 500ml';

export const PILOT_PRODUCT: ProductDetail = {
  id: 'prod-1',
  slug: PILOT_SLUG,
  brand: 'Tubu',
  name: PILOT_PRODUCT_NAME,
  shortDesc: 'Sạch dầu mỡ, an toàn cho da tay',
  description: 'Nước rửa chén sinh học chiết xuất chanh gừng.',
  images: [],
  thumbnail: null,
  basePrice: 65000,
  salePrice: null,
  certifications: [],
  ingredients: null,
  sold: 12,
  variations: [
    {
      id: 'var-1',
      sku: 'TUBU-NRC-500',
      name: 'Hương Chanh Gừng',
      attributes: { scent: 'Chanh Gừng' },
      retailPrice: 65000,
      salePrice: null,
      stock: 50,
    },
  ],
};

export const PILOT_CART: CartSummary = {
  items: [
    {
      id: 'cart-item-1',
      variationId: 'var-1',
      slug: PILOT_SLUG,
      productName: PILOT_PRODUCT_NAME,
      variationName: 'Hương Chanh Gừng',
      thumbnail: null,
      unitPrice: 65000,
      quantity: 1,
      stock: 50,
      weight: 600,
      total: 65000,
    },
  ],
  couponCode: null,
  subtotal: 65000,
  discount: 0,
  freeship: false,
  freeshipThreshold: 200000,
  itemCount: 1,
};

export const PILOT_STOREFRONT_SLUG = 'ctv-pilot';
export const IN_STOCK_NAME = 'Nước Rửa Chén Tubu Còn Hàng';
export const IN_STOCK_NAME_2 = 'Nước Lau Sàn Tubu Còn Hàng';
export const OUT_OF_STOCK_NAME = 'Xà Phòng Tubu Đã Hết';

function sfProduct(id: string, slug: string, name: string, inStock: boolean) {
  return {
    id,
    name,
    slug,
    thumbnail: null,
    brand: 'Tubu',
    basePrice: 65000,
    salePrice: null,
    ratingAvg: 0,
    reviewCount: 0,
    sold: 0,
    inStock,
  };
}

export const PILOT_STOREFRONT: Storefront = {
  id: 'sf-1',
  slug: PILOT_STOREFRONT_SLUG,
  type: 'CTV',
  title: 'Gian hàng CTV Pilot',
  headerNote: null,
  ownerTier: null,
  avatarUrl: null,
  coverUrl: null,
  theme: 'default',
  collections: [
    {
      id: 'col-1',
      title: 'Bán chạy',
      kind: 'NORMAL',
      layout: 'GRID',
      comboDiscountPct: null,
      items: [
        { id: 'it-1', note: null, variationId: null, product: sfProduct('p-in-1', 'nuoc-rua-chen-con-hang', IN_STOCK_NAME, true) },
        { id: 'it-2', note: null, variationId: null, product: sfProduct('p-in-2', 'nuoc-lau-san-con-hang', IN_STOCK_NAME_2, true) },
        { id: 'it-3', note: null, variationId: null, product: sfProduct('p-out-1', 'xa-phong-het-hang', OUT_OF_STOCK_NAME, false) },
      ],
    },
  ],
};

export const PILOT_ORDER_CODE = 'TUBU-DELIVERED-777';

function mockPilotSession(api: MockApi): void {
  mockSession(api, makeUser({ id: 'user-pilot', fullName: 'Nguyễn Văn A' }));
  // WishlistHeart (trong ProductTile) đọc danh sách id yêu thích.
  api.get('/me/wishlist/ids', []);
  // Ghi nhận "chạm" CTV / analytics — fire-and-forget, không liên quan nội dung test.
  api.allowUnmocked('POST /affiliate/touch', 'POST /events');
}

/** PDP: sản phẩm còn hàng + cart rỗng. `addToCartDelayMs` giữ mutation "đang chạy" để bắt spinner. */
export function mockPilotProduct(api: MockApi, opts: { addToCartDelayMs?: number } = {}): void {
  mockPilotSession(api);
  api.get('/products/:slug', PILOT_PRODUCT);
  api.get('/products/:slug/related', []);
  api.get('/products/:slug/bought-together', []);
  api.get('/products/:slug/reviews', { average: 0, count: 0, items: [] });
  api.get('/flash-sales/active', []);
  api.get('/cart', { ...PILOT_CART, items: [], subtotal: 0, itemCount: 0 });
  api.post('/cart/items', async () => {
    if (opts.addToCartDelayMs) await new Promise((r) => setTimeout(r, opts.addToCartDelayMs));
    return PILOT_CART;
  });
  api.allowUnmocked('GET /me/coupons', 'GET /affiliate/me', 'GET /config/public', 'GET /products/:slug/reviews/can-review');
}

/** Cart có 1 dòng; trang đích (/product/:slug) cũng được mock để điều hướng không dính lỗi 404. */
export function mockPilotCart(api: MockApi): void {
  mockPilotProduct(api);
  api.get('/cart', PILOT_CART);
  api.allowUnmocked('GET /coupons/available', 'GET /me/vouchers');
}

export function mockPilotStorefront(api: MockApi): void {
  mockPilotSession(api);
  api.get('/storefront/public/:slug', PILOT_STOREFRONT);
  api.allowUnmocked('GET /config/public', 'GET /me/coupons');
}

/** Đơn ĐÃ GIAO (isDone → hiện nút "Mua lại đơn này"). Repurchase trả về giỏ mới sau `delayMs`. */
export function mockPilotDeliveredOrder(api: MockApi, opts: { repurchaseDelayMs?: number } = {}): void {
  mockPilotSession(api);
  api.get('/orders/:code', makeOrder({ code: PILOT_ORDER_CODE, status: 'DELIVERED', paymentStatus: 'PAID' }));
  api.get('/orders/me/returns', []);
  api.post('/orders/:code/repurchase', async () => {
    if (opts.repurchaseDelayMs) await new Promise((r) => setTimeout(r, opts.repurchaseDelayMs));
    return PILOT_CART;
  });
  api.get('/cart', PILOT_CART);
  api.allowUnmocked('GET /config/public', 'GET /me/coupons');
}
