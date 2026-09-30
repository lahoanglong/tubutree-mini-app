import type { NotificationDTO } from '../../../miniapp/src/services/account-api';
import type {
  CartSummary, OrderView, PageResponse, ProductCard, PurchasedItem, PurchasedItemsPage,
} from '../../../miniapp/src/services/shop-api';
import type { SubscriptionDTO } from '../../../miniapp/src/services/subscriptions-api';
import { makeOrder, makeUser, mockSession, reply, type MockApi } from './mock-api';
import { publicConfig } from './checkout-mocks';

/**
 * Mock cho dự án 4a (buy-flow-4a.miniapp.spec.ts):
 *   GET /me/purchased-items (purchased-items.controller), GET /orders + /orders/active-count +
 *   POST /orders/:code/repurchase (orders.controller), POST /cart/items (cart.controller),
 *   GET /me/subscriptions, GET /me/notifications + POST /me/notifications/:id/read.
 * Ảnh dùng data: URI (host ngoài bị chặn trong mock-api.ts).
 */
export const THUMB = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

export const PURCHASED: PurchasedItem = {
  variationId: 'var-1',
  productId: 'prod-1',
  slug: 'nuoc-rua-chen-tubu',
  productName: 'Nước Rửa Chén Sinh Học Tubu 500ml',
  variationName: 'Hương Chanh Gừng',
  brand: 'Tubu',
  thumbnail: THUMB,
  price: 65000,
  salePrice: null,
  stock: 20,
  inStock: true,
  timesBought: 2,
  lastPurchasedAt: '2026-09-20T08:00:00.000Z',
};
export const PURCHASED_PAGE: PurchasedItemsPage = { items: [PURCHASED], nextCursor: null };

const EMPTY_CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };
export const CART_AFTER_ADD: CartSummary = {
  items: [
    {
      id: 'cart-item-1', variationId: 'var-1', slug: 'nuoc-rua-chen-tubu', productName: PURCHASED.productName,
      variationName: PURCHASED.variationName, thumbnail: THUMB, unitPrice: 65000, quantity: 2, stock: 20, weight: 600, total: 130000,
    },
  ],
  couponCode: null,
  subtotal: 130000,
  discount: 0,
  freeship: false,
  freeshipThreshold: 200000,
  itemCount: 2,
};

const HOME_PRODUCT: ProductCard = {
  id: 'prod-9', slug: 'xa-phong-tubu', brand: 'Tubu', name: 'Xà Phòng Thảo Mộc Tubu', thumbnail: null,
  basePrice: 45000, salePrice: null, isFeatured: true, inStock: true, sold: 10,
};

/** Phiên + mọi khối của trang chủ (như miniapp.spec.ts) + kệ Mua lại + badge. */
export function mockBuyFlowSession(
  api: MockApi,
  opts: { activeCount?: number; purchased?: PurchasedItemsPage | 'not-found' } = {},
): void {
  mockSession(api, makeUser({ id: 'user-4a', fullName: 'Khách Mua Lại' }));
  const page: PageResponse<ProductCard> = { data: [HOME_PRODUCT], meta: { page: 1, limit: 6, total: 1 } };
  api.get('/products', page);
  api.get('/brands', [{ brand: 'Tubu', count: 3 }]);
  api.get('/cart', EMPTY_CART);
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get('/products/for-you', []);
  api.get('/me/notifications', []);
  api.get('/me/wishlist/ids', []);
  api.get('/config/public', publicConfig());
  api.post('/cart/items', CART_AFTER_ADD);
  const purchased = opts.purchased ?? PURCHASED_PAGE;
  api.get('/me/purchased-items', purchased === 'not-found' ? reply(404, { statusCode: 404, message: 'Cannot GET' }) : purchased);
  api.get('/orders/active-count', { count: opts.activeCount ?? 0 });
  // Sự kiện analytics / chạm CTV — fire-and-forget, không liên quan nội dung test.
  api.allowUnmocked('POST /events', 'POST /affiliate/touch', 'GET /me/coupons', 'GET /affiliate/me');
}

export const DELIVERED_CODE = 'TUBU-DLV-4A';

/** Đơn đã giao 2 dòng: 1 dòng còn hàng (SL 2), 1 dòng đã hết (SL 1) → "3 món". */
export function deliveredOrder(): OrderView {
  const base = makeOrder({ code: DELIVERED_CODE, status: 'DELIVERED', paymentStatus: 'PAID' });
  return {
    ...base,
    items: [
      {
        id: 'oi-avail', variationId: 'var-1', productName: PURCHASED.productName, productSlug: PURCHASED.slug,
        variationName: PURCHASED.variationName, unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0,
        thumbnail: THUMB, stock: 10, available: true, currentPrice: 65000,
      },
      {
        id: 'oi-out', variationId: 'var-out', productName: 'Xà Phòng Tubu Đã Hết', productSlug: 'xa-phong-het',
        variationName: '', unitPrice: 19000, quantity: 1, total: 19000, backorderedQty: 0,
        thumbnail: null, stock: 0, available: false, currentPrice: 19000,
      },
    ],
  };
}

export const SUBSCRIPTION: SubscriptionDTO = {
  id: 'sub-1', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-10-15T00:00:00.000Z',
  productName: 'Nước Xả Vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nuoc-xa-vai', unitPrice: 80000, effectiveDiscountPct: 0.12,
};

/** Trang Đơn hàng + điều hướng sang giỏ sau khi mua lại cả đơn. */
export function mockOrdersTab(api: MockApi): void {
  // Lọc như API thật cho các tab: đơn mẫu là DELIVERED nên chỉ khớp không lọc / status=DELIVERED;
  // mọi group (processing, closed) và status khác → rỗng.
  api.get('/orders', ({ call }): PageResponse<OrderView> => {
    const status = call.query.get('status');
    const group = call.query.get('group');
    // API thật: `status` thắng `group` (orders.service statusWhere) — nên có status thì bỏ qua group.
    const match = status ? status === 'DELIVERED' : group === null;
    const data = match ? [deliveredOrder()] : [];
    return { data, meta: { page: 1, limit: 20, total: data.length } };
  });
  api.get('/me/subscriptions', [SUBSCRIPTION]);
  api.post('/orders/:code/repurchase', {
    ...CART_AFTER_ADD,
    cart: CART_AFTER_ADD,
    results: [{ orderItemId: 'oi-avail', status: 'added', addedQuantity: 2 }],
  });
  // Trang giỏ (sau khi mua lại) gọi thêm mã giảm giá / voucher — không liên quan nội dung test.
  api.allowUnmocked('GET /coupons/available', 'GET /me/vouchers');
}

export const REMINDER: NotificationDTO = {
  id: 'ntf-reorder-1',
  templateCode: 'REORDER_REMINDER',
  payload: {
    body: 'Nước Rửa Chén Sinh Học Tubu 500ml của bạn dự kiến sắp hết. Đặt lại ngay để không gián đoạn nhé!',
    data: { product: PURCHASED.productName, variation_id: 'var-1', product_slug: PURCHASED.slug },
  },
  status: 'SENT',
  sentAt: '2026-09-29T08:00:00.000Z',
};
