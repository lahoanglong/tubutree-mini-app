import type { CartSummary } from '../../../miniapp/src/services/shop-api';
import type { Storefront, StorefrontCollection } from '../../../miniapp/src/services/storefront-api';
import type { BrandView } from '../../../miniapp/src/services/brand-api';
import { makeUser, mockSession, type MockApi } from './mock-api';

/** Gian hàng CTV có 45 sản phẩm khác nhau trong 3 bộ: kệ ngang 20, lưới 22, combo 3 (giảm 10%). */
export const SHOP_SLUG = 'uatctv';
export const SHOP_TITLE = 'Gian hàng UAT CTV';
export const COMBO_TITLE = 'Combo giặt sạch';

const sfProduct = (n: number) => ({
  id: `p${n}`,
  name: `Sản phẩm ${String(n).padStart(2, '0')}`,
  slug: `sp-${n}`,
  thumbnail: null,
  brand: 'Tubu',
  basePrice: 50_000 + n * 1_000,
  salePrice: null,
  ratingAvg: 0,
  reviewCount: 0,
  sold: n,
  inStock: true,
  // Sản phẩm số lớn là hàng mới nhất: "Mới" đảo thứ tự so với "Phổ biến".
  createdAt: new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString(),
  repVariationId: `v${n}`,
});
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
const items = (col: string, ns: number[]) => ns.map((n) => ({ id: `${col}-${n}`, note: n === 1 ? 'Mình dùng mỗi ngày' : null, variationId: null, product: sfProduct(n) }));

const collections: StorefrontCollection[] = [
  { id: 'col-rail', title: 'Bếp xanh', kind: 'NORMAL', layout: 'CAROUSEL', comboDiscountPct: null, items: items('rail', range(1, 20)) },
  { id: 'col-grid', title: 'Chăm sóc nhà cửa', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, items: items('grid', range(21, 22)) },
  { id: 'col-combo', title: COMBO_TITLE, kind: 'COMBO', layout: 'GRID', comboDiscountPct: 10, items: items('combo', range(43, 3)) },
];

export const SHOP_STOREFRONT: Storefront = {
  id: 'sf-uat',
  slug: SHOP_SLUG,
  type: 'CTV',
  title: SHOP_TITLE,
  headerNote: 'Mình chọn đồ dùng xanh cho cả nhà.',
  referralCode: 'UATCTV01',
  ownerTier: { name: 'Tân binh', emoji: '🌱', publicBadge: false },
  avatarUrl: null,
  coverUrl: null,
  theme: 'default',
  collections,
};

export const EMPTY_CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };

/** Khách mở gian hàng: chỉ đọc. `POST /cart/items/batch` do từng test đăng ký. */
export function mockShopPage(api: MockApi): void {
  mockSession(api, makeUser({ id: 'user-shop', fullName: 'Khách xem shop' }));
  api.get('/storefront/public/:slug', SHOP_STOREFRONT);
  api.get('/flash-sales/active', []);
  api.get('/me/wishlist/ids', []);
  api.get('/cart', EMPTY_CART);
  api.allowUnmocked('POST /events', 'POST /affiliate/touch', 'GET /me/coupons', 'GET /affiliate/me');
}

export const BRAND_SLUG = 'fuwa';
const brandProduct = (n: number) => ({
  id: `b${n}`, name: `Hàng Fuwa ${String(n).padStart(2, '0')}`, slug: `fuwa-${n}`, brand: 'Fuwa', thumbnail: null,
  basePrice: 90_000, salePrice: null, isFeatured: false, inStock: true, ratingAvg: 0, reviewCount: 0, sold: n,
});

export const FUWA: BrandView = {
  id: 'brand-fuwa',
  slug: BRAND_SLUG,
  name: 'Fuwa',
  logoUrl: null,
  coverUrl: null,
  tagline: 'Sống xanh mỗi ngày',
  story: 'Fuwa bắt đầu từ một xưởng nhỏ ở Lâm Đồng.',
  storyImages: [],
  origin: null,
  isVerified: true,
  followerCount: 1200,
  certifications: [],
  promotions: [],
  productCount: 45,
  products: range(1, 30).map((n) => ({ id: `b${n}`, name: `Hàng Fuwa ${String(n).padStart(2, '0')}`, slug: `fuwa-${n}`, thumbnail: null, basePrice: 90_000, salePrice: null, ratingAvg: 0, reviewCount: 0, inStock: true })),
  dealerRewards: [],
};

/** Thương hiệu 45 sản phẩm, API phân trang thật 20 mỗi trang. */
export function mockBrandPage(api: MockApi): void {
  mockSession(api, makeUser({ id: 'user-brand', fullName: 'Khách xem thương hiệu' }));
  api.get('/brand/public/:slug', FUWA);
  api.get('/brand/public/:slug/products', ({ call }) => {
    const page = Number(call.query.get('page') ?? '1');
    const limit = Number(call.query.get('limit') ?? '20');
    const from = (page - 1) * limit + 1;
    const count = Math.max(0, Math.min(limit, 45 - (from - 1)));
    return { data: range(from, count).map(brandProduct), meta: { page, limit, total: 45 } };
  });
  api.get('/brand/:slug/follow-state', { following: false, followerCount: 1200 });
  api.get('/brand/:slug/share-to-earn', { eligible: false });
  api.get('/flash-sales/active', []);
  api.get('/me/wishlist/ids', []);
  api.get('/cart', EMPTY_CART);
  api.allowUnmocked('POST /events', 'POST /affiliate/touch', 'GET /me/coupons', 'GET /affiliate/me', 'GET /dealer/me');
}
