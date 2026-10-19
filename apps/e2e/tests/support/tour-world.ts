import { readFileSync } from 'fs';
import path from 'path';
import type { AuthUser, UserRole } from '@tubutree/shared-types';
import type { OrderView, PageResponse, ProductCard } from '../../../miniapp/src/services/shop-api';
import { makeOrder, makeUser, publicConfig, reply, type MockApi, type MockCall } from './mock-api';

/**
 * Dữ liệu chung cho hai spec tham quan (visual-tour.miniapp / visual-tour.web): cùng một khách, cùng sản phẩm, đơn, điểm, số dư
 * để ảnh Mini App và web so được với nhau. Catalog đọc thẳng từ seed của API để khớp phần web render phía máy chủ từ DB e2e đã seed.
 */

export const PERSONA = {
  id: 'tour-user',
  fullName: 'Nguyễn Văn An',
  phone: '0912345678',
  referralCode: 'AN123',
  pointsBalance: 1681,
  pointsConvertedBalance: 119,
  walletBalance: 350_000,
} as const;

export function tourUser(role: UserRole = 'CUSTOMER'): AuthUser {
  return makeUser({ ...PERSONA, role });
}

/** Ảnh sản phẩm: SVG data URI màu theo thương hiệu để ảnh chụp không toàn ô trống (host ngoài bị chặn). */
export function swatch(label: string, hue = 140): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="hsl(${hue},35%,86%)"/><text x="200" y="215" font-size="42" text-anchor="middle" fill="hsl(${hue},40%,28%)" font-family="sans-serif">${label.slice(0, 14)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface SeedProduct extends ProductCard {
  categoryId: string;
  retailPrice: number;
  variationName: string;
}

let seedCache: SeedProduct[] | null = null;
export function seedCatalog(): SeedProduct[] {
  if (seedCache) return seedCache;
  const text = readFileSync(path.resolve(__dirname, '../../../api/prisma/seed.ts'), 'utf8');
  const block = text.slice(text.indexOf('const PRODUCTS: SeedProduct[]'));
  const out: SeedProduct[] = [];
  for (const seg of block.split(/\n  \{\n/).slice(1)) {
    const id = /id: '([^']+)'/.exec(seg)?.[1];
    const brand = /brand: '([^']+)'/.exec(seg)?.[1];
    const slug = /slug: '([^']+)'/.exec(seg)?.[1];
    const name = /name: '([^']+)'/.exec(seg)?.[1];
    const base = /\bbasePrice: (\d+)/.exec(seg)?.[1];
    const sale = /\bsalePrice: (\d+),\s*categoryIds/.exec(seg)?.[1];
    const cat = /categoryIds: \['([^']+)'/.exec(seg)?.[1];
    const variationName = /variations: \[\s*\{ sku: '[^']+', name: '([^']+)'/.exec(seg)?.[1];
    if (!id || !brand || !slug || !name || !base || !cat) continue;
    out.push({
      id, slug, brand, name, thumbnail: null, basePrice: Number(base), salePrice: sale ? Number(sale) : null,
      isFeatured: /isFeatured: true/.test(seg), inStock: true, ratingAvg: 4.5, reviewCount: 8, sold: 12, categoryId: cat, retailPrice: Number(base), variationName: variationName ?? 'Mặc định',
    });
  }
  // Cùng thứ tự API: nổi bật trước, rồi theo id (catalog.service orderBy isFeatured desc, id asc).
  out.sort((x, y) => Number(y.isFeatured) - Number(x.isFeatured) || x.id.localeCompare(y.id));
  seedCache = out;
  return out;
}

export function productCard(p: SeedProduct): ProductCard {
  const { categoryId: _c, retailPrice: _r, variationName: _v, ...card } = p;
  return card;
}

export const CATEGORIES = [
  { id: 'cat-skincare', parentId: null, name: 'Mỹ phẩm thiên nhiên', slug: 'my-pham-thien-nhien', image: null, sortOrder: 1 },
  { id: 'cat-cleaning', parentId: null, name: 'Tẩy rửa sinh học', slug: 'tay-rua-sinh-hoc', image: null, sortOrder: 2 },
  { id: 'cat-baby', parentId: null, name: 'Cho bé', slug: 'cho-be', image: null, sortOrder: 3 },
  { id: 'cat-mom', parentId: null, name: 'Cho mẹ bầu', slug: 'cho-me-bau', image: null, sortOrder: 4 },
  { id: 'cat-personal', parentId: null, name: 'Chăm sóc cá nhân', slug: 'cham-soc-ca-nhan', image: null, sortOrder: 5 },
  { id: 'cat-coffee', parentId: null, name: 'Cà phê & Đồ uống', slug: 'ca-phe-do-uong', image: null, sortOrder: 6 },
  { id: 'cat-food', parentId: null, name: 'Nông sản & Thực phẩm', slug: 'nong-san-thuc-pham', image: null, sortOrder: 7 },
];

function foldTour(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
}

function catalogList({ call }: { call: MockCall }): PageResponse<ProductCard> {
  const p = call.query;
  const q = foldTour(p.get('q') ?? '');
  const brands = (p.get('brand') ?? '').split(',').filter(Boolean);
  const slugs = p.has('slugs') ? (p.get('slugs') ?? '').split(',').filter(Boolean) : null;
  const category = p.get('category');
  let rows = seedCatalog().filter(
    (x) =>
      (!q || foldTour(x.name).includes(q)) &&
      (brands.length === 0 || brands.includes(x.brand)) &&
      (!category || x.categoryId === category) &&
      (slugs === null || slugs.includes(x.slug)),
  );
  if (p.get('sort') === 'price_asc') rows = [...rows].sort((a, b) => a.basePrice - b.basePrice);
  const page = Number(p.get('page') ?? 1);
  const limit = Number(p.get('limit') ?? 20);
  return { data: rows.slice((page - 1) * limit, page * limit).map(productCard), meta: { page, limit, total: rows.length } };
}

function productDetail(slug: string) {
  const x = seedCatalog().find((c) => c.slug === slug);
  if (!x) return undefined;
  return {
    id: x.id, slug: x.slug, brand: x.brand, name: x.name, shortDesc: `${x.name} — lành tính, nguồn gốc rõ ràng.`,
    description: '<p>Sản phẩm thiên nhiên được tuyển chọn bởi Tubu Tree.</p>', images: [], thumbnail: null, basePrice: x.basePrice,
    salePrice: x.salePrice, certifications: ['Vegan'], ingredients: null, sold: 12,
    variations: [{ id: `var-${x.id}`, sku: `SKU-${x.id}`, name: x.variationName, attributes: {}, retailPrice: x.retailPrice, salePrice: x.salePrice, stock: 40 }],
  };
}

export const TOUR_PRODUCT_SLUG = 'serum-duong-am-visante';
export const ORDER_DELIVERED = 'TUBU20261015001';
export const ORDER_SHIPPING = 'TUBU20261018002';

function orderItems(): NonNullable<OrderView['items']> {
  const cat = seedCatalog();
  const a = cat.find((c) => c.slug === TOUR_PRODUCT_SLUG) ?? cat[0]!;
  const b = cat.find((c) => c.slug === 'dau-goi-buoi-po-lang') ?? cat[1]!;
  return [
    {
      id: 'oi-1', variationId: `var-${a.id}`, productName: a.name, productSlug: a.slug, variationName: a.variationName,
      unitPrice: a.salePrice ?? a.basePrice, quantity: 1, total: a.salePrice ?? a.basePrice, backorderedQty: 0, reviewId: null, reviewable: true,
      thumbnail: null, stock: 40, available: true, currentPrice: a.salePrice ?? a.basePrice,
    },
    {
      id: 'oi-2', variationId: `var-${b.id}`, productName: b.name, productSlug: b.slug, variationName: b.variationName,
      unitPrice: b.basePrice, quantity: 2, total: b.basePrice * 2, backorderedQty: 0, reviewId: null, reviewable: true,
      thumbnail: null, stock: 40, available: true, currentPrice: b.basePrice,
    },
  ] as unknown as NonNullable<OrderView['items']>;
}

export function tourOrder(code: string, status: 'DELIVERED' | 'SHIPPING'): OrderView {
  const items = orderItems();
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  return {
    ...makeOrder({
      code, status, paymentStatus: 'PAID', subtotal, total: subtotal + 19_000, paymentMethod: 'COD',
      createdAt: status === 'SHIPPING' ? '2026-10-18T08:00:00.000Z' : '2026-10-15T08:00:00.000Z',
    }),
    items,
  } as unknown as OrderView;
}

export function tourCart() {
  const x = seedCatalog().find((c) => c.slug === TOUR_PRODUCT_SLUG) ?? seedCatalog()[0]!;
  const unit = x.salePrice ?? x.basePrice;
  return {
    items: [
      {
        id: 'cart-item-1', variationId: `var-${x.id}`, slug: x.slug, productName: x.name, variationName: x.variationName, thumbnail: null,
        unitPrice: unit, quantity: 2, stock: 40, weight: 90, total: unit * 2,
      },
    ],
    couponCode: null, subtotal: unit * 2, discount: 0, freeship: true, freeshipThreshold: 500_000, itemCount: 2,
  };
}

const ADDRESS = {
  id: 'addr-1', recipient: 'Nguyễn Văn An', phone: '0912345678', province: 'TP. Hồ Chí Minh', district: '', ward: 'Phường Sài Gòn',
  street: '123 Lê Lợi', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN79_26734', isDefault: true,
};

/** Phiên đăng nhập + dữ liệu cửa hàng/đơn/điểm dùng chung. Đăng ký SAU thắng nên các mock riêng của từng màn gọi sau hàm này. */
export function mockTourWorld(api: MockApi, user: AuthUser): void {
  const login = { accessToken: 'e2e-access-token', refreshToken: 'e2e-refresh-token', user };
  const me = { id: user.id, fullName: user.fullName, email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], phone: user.phone, role: user.role, referralCode: user.referralCode, pointsBalance: user.pointsBalance, pointsConvertedBalance: user.pointsConvertedBalance, walletBalance: user.walletBalance };
  api.post('/auth/guest', login);
  api.post('/auth/zalo-mini-app', login);
  api.post('/auth/refresh', login);
  api.get('/me', me);
  api.get('/config/public', publicConfig({ aiAdvisorEnabled: true, freeshipThreshold: 500_000 }));
  api.get('/products', catalogList);
  api.get('/products/for-you', []);
  api.get('/products/:slug', ({ params }) => productDetail(params.slug!) ?? reply(404, { message: 'Không tìm thấy sản phẩm.' }));
  api.get('/products/:slug/related', []);
  api.get('/products/:slug/bought-together', []);
  api.get('/products/:slug/reviews', { average: 4.6, count: 0, items: [] });
  api.get('/products/:slug/reviews/can-review', { canReview: false });
  api.get('/brands', [{ brand: 'Visante', count: 6 }, { brand: 'Pơ Lang', count: 5 }, { brand: 'Fuwa3e', count: 4 }]);
  api.get('/categories', CATEGORIES.map((c) => ({ ...c, productCount: seedCatalog().filter((p) => p.categoryId === c.id).length })));
  api.get('/search/suggest', []);
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get('/cart', tourCart());
  api.get('/me/addresses', [ADDRESS]);
  api.get('/me/coupons', [{ code: 'FREESHIP1', type: 'FREESHIP', value: 0, minOrder: 199000, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' }]);
  api.post('/checkout/coupon-previews', { coupons: [{ code: 'FREESHIP1', eligible: true, discount: 0, freeshipSaving: 19_000 }] });
  api.get('/me/new-customer-offer', { isNewCustomer: false, welcomeVoucher: null });
  api.get('/me/wishlist/ids', []);
  api.get('/me/purchased-items', { items: [], nextCursor: null });
  api.get('/me/subscriptions', []);
  api.get('/orders/active-count', { count: 1 });
  api.get('/orders', ({ call }): PageResponse<OrderView> => {
    const status = call.query.get('status');
    const all = [tourOrder(ORDER_SHIPPING, 'SHIPPING'), tourOrder(ORDER_DELIVERED, 'DELIVERED')];
    const data = status ? all.filter((o) => o.status === status) : all;
    return { data, meta: { page: 1, limit: 20, total: data.length } };
  });
  api.get('/orders/:code', ({ params }) => tourOrder(params.code!, params.code === ORDER_SHIPPING ? 'SHIPPING' : 'DELIVERED'));
  api.get('/orders/me/returns', []);
  api.get('/orders/me/refunds', []);
  api.get('/me/notifications', [
    { id: 'n1', templateCode: 'ORDER_SHIPPING', payload: { body: `Đơn ${ORDER_SHIPPING} đang trên đường giao đến bạn.`, data: {} }, status: 'SENT', sentAt: '2026-10-18T08:00:00.000Z' },
    { id: 'n2', templateCode: 'POINTS_EARNED', payload: { body: 'Bạn nhận +250 Điểm Xanh từ đơn hàng đã giao.', data: {} }, status: 'READ', sentAt: '2026-10-15T08:00:00.000Z' },
  ]);
  api.get('/me/notifications/prefs', { orderUpdates: true, promotions: true, reminders: true });
  api.get('/me/wallet', { walletBalance: 350_000, cashbackPending: 42_000, commissionApproved: 0, commissionPending: 0, withdrawMin: 100_000, withdrawFee: 3_000 });
  api.get('/me/wallet/transactions', {
    data: [
      { id: 'w1', delta: 42_000, balanceAfter: 350_000, type: 'CASHBACK', reason: 'Hoàn tiền mua sắm', orderId: null, createdAt: '2026-10-12T05:00:00Z' },
      { id: 'w2', delta: -149_000, balanceAfter: 308_000, type: 'ORDER_PAYMENT', reason: `Thanh toán đơn ${ORDER_DELIVERED}`, orderId: 'o1', createdAt: '2026-10-10T05:00:00Z' },
    ],
    meta: { page: 1, limit: 20, total: 2 },
  });
  api.get('/me/referral', { referralCode: 'AN123', successCount: 2, earnedPoints: 10, milestones: [{ count: 3, bonusPoints: 20 }], nextMilestone: { count: 3, bonusPoints: 20 } });
  api.get('/me/loyalty', {
    pointsBalance: 1681, pointsConvertedBalance: 119, tierPoints: 80,
    tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: ['Quà sinh nhật'] },
    nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, pointsToGo: 120, spendingToGo: 2_500_000 },
    tiers: [
      { id: 't1', name: 'Mầm Xanh', minPoints: 0, minSpending: 0, multiplier: 1 },
      { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, multiplier: 1.2 },
    ],
    spent12m: 1_500_000, rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 },
  });
  api.get('/me/points/transactions', [
    { id: 'p1', delta: 250, reason: `ORDER_DELIVERED:${ORDER_DELIVERED}`, expiresAt: null, createdAt: '2026-10-15T05:00:00Z' },
    { id: 'p2', delta: 3, reason: 'CHECK_IN', expiresAt: null, createdAt: '2026-10-14T05:00:00Z' },
  ]);
  api.get('/me/loyalty/check-in', {
    checkedInToday: false, streakDays: 2, currentCycleDay: 3, todayPoints: 3,
    rewards: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day === 7 ? 10 : day, claimed: day < 3, isToday: day === 3 })),
  });
  api.get('/me/loyalty/member-card', { memberCode: 'TUBUAN123', name: 'An', phone: null, tierName: 'Mầm Xanh', tierMultiplier: 1, pointsBalance: 1681, posCreditEnabled: true });
  api.get('/affiliate/me', { isAffiliate: false, referralCode: '', walletBalance: 0 });
  api.get('/brand/owner/me', () => reply(404, { message: 'Không tìm thấy' }));
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.post('/events', { accepted: 1 });
  api.allowUnmocked('POST /affiliate/touch', 'GET /home', 'GET /home/me');
}
