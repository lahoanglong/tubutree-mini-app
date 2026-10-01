import type {
  CartSummary, CategoryDTO, PageResponse, ProductCard, ProductDetail, ProductSuggestion,
} from '../../../miniapp/src/services/shop-api';
import type { SubscriptionDTO } from '../../../miniapp/src/services/subscriptions-api';
import { makeOrder, makeUser, mockSession, reply, type MockApi, type MockCall } from './mock-api';
import { publicConfig } from './checkout-mocks';
import { PURCHASED_PAGE, THUMB } from './buy-flow-mocks';

/**
 * Mock cho dự án 4b (buy-flow-4b.miniapp.spec.ts): GET /products (lọc/sắp như catalog.service thật:
 * q không dấu, brand phẩy, category, segment, giá ĐANG BÁN, inStock, minRating, best_seller, phân trang),
 * GET /categories (+productCount), GET /search/suggest, PDP, dải đơn/định kỳ.
 * `legacy: true` = API trước 4b: 400 cho tham số lọc mới (forbidNonWhitelisted), best_seller bị bỏ qua,
 * /categories không có productCount.
 */
export interface CatalogItem extends ProductCard {
  categoryIds: string[];
  forSegment: string[];
  soldTotal: number;
}

function item(over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'slug' | 'name'>): CatalogItem {
  return {
    brand: 'Tubu', thumbnail: THUMB, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true,
    ratingAvg: 0, reviewCount: 0, sold: 0, categoryIds: [], forSegment: [], soldTotal: 0, ...over,
  };
}

export const NRC = item({
  id: 'p-nrc', slug: 'nuoc-rua-chen-tubu', name: 'Nước Rửa Chén Sinh Học Tubu 500ml', basePrice: 150_000, salePrice: 120_000,
  categoryIds: ['cat-cleaning'], forSegment: ['home_clean'], soldTotal: 50, sold: 50, ratingAvg: 4.6, reviewCount: 12,
});
export const BINH_SUA = item({
  id: 'p-bs', slug: 'nuoc-rua-binh-sua', name: 'Nước Rửa Bình Sữa Cho Bé', brand: 'Mộc An', basePrice: 180_000,
  categoryIds: ['cat-baby'], forSegment: ['mom_baby'], soldTotal: 80, sold: 80, ratingAvg: 4.2, reviewCount: 5,
});
export const XA_PHONG = item({
  id: 'p-xp', slug: 'xa-phong-thao-moc', name: 'Xà Phòng Thảo Mộc', basePrice: 45_000,
  categoryIds: ['cat-personal'], soldTotal: 120, sold: 120, ratingAvg: 3.5, reviewCount: 3,
});
export const KEM = item({
  id: 'p-kem', slug: 'kem-chong-nang-rau-ma', name: 'Kem Chống Nắng Rau Má', brand: 'Mộc An', basePrice: 345_000, inStock: false,
  categoryIds: ['cat-skincare'], forSegment: ['skincare'], soldTotal: 10, sold: 10, ratingAvg: 4.8, reviewCount: 9,
});
/** 26 SP "Sống xanh" để danh sách đủ dài cho kiểm tra khôi phục vị trí cuộn. */
const FILLER = Array.from({ length: 26 }, (_, i) =>
  item({ id: `p-tui-${String(i + 1).padStart(2, '0')}`, slug: `tui-vai-${i + 1}`, name: `Túi Vải Canvas Tubu số ${i + 1}`, basePrice: 600_000 + i * 1_000, forSegment: ['eco'] }),
);
export const CATALOG: CatalogItem[] = [NRC, BINH_SUA, XA_PHONG, KEM, ...FILLER];

export const CATEGORIES: CategoryDTO[] = [
  { id: 'cat-cleaning', parentId: null, name: 'Tẩy rửa sinh học', slug: 'tay-rua-sinh-hoc', image: null, sortOrder: 2, productCount: 1 },
  { id: 'cat-baby', parentId: null, name: 'Cho bé', slug: 'cho-be', image: null, sortOrder: 3, productCount: 1 },
  { id: 'cat-coffee', parentId: null, name: 'Cà phê & Đồ uống', slug: 'ca-phe-do-uong', image: null, sortOrder: 6, productCount: 0 },
];

export const SHIPPING_CODE = 'TUBU-SHIP-4B';
export const EXTENDED_PARAMS = ['minPrice', 'maxPrice', 'inStock', 'minRating'] as const;

/** Giữa trưa UTC: mọi múi giờ từ UTC-11 đến UTC+11 vẫn cùng ngày 15/10. */
const NEXT_RUN_AT = '2026-10-15T12:00:00.000Z';
const SUBSCRIPTION_4B: SubscriptionDTO = {
  id: 'sub-4b', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: NEXT_RUN_AT,
  productName: 'Nước Xả Vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nuoc-xa-vai', unitPrice: 80_000, effectiveDiscountPct: 0.12,
};
const EMPTY_CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 0 };

/** dd/MM của `iso` theo giờ máy (cùng cách OrderStrip tính; không dùng toLocaleDateString — Node 24 trả "15-10"). */
export function dayMonthLocal(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** Ngày kỳ định kỳ kế tiếp mà dải đơn phải in ra (cùng ISO với mock). */
export const SUBSCRIPTION_DAY_MONTH = dayMonthLocal(NEXT_RUN_AT);

/** Gấp dấu như API (đủ cho dữ liệu mẫu). */
export function foldE2E(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function toCard(x: CatalogItem): ProductCard {
  const { categoryIds: _c, forSegment: _f, soldTotal: _s, ...card } = x;
  return card;
}

export function catalogHandler(opts: { legacy?: boolean } = {}) {
  return ({ call }: { call: MockCall }) => {
    const p = call.query;
    if (opts.legacy && EXTENDED_PARAMS.some((k) => p.has(k))) {
      return reply(400, { statusCode: 400, message: ['property minPrice should not exist'], error: 'Bad Request' });
    }
    const num = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined);
    const q = foldE2E(p.get('q') ?? '');
    const brands = (p.get('brand') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const [min, max, rating] = [num('minPrice'), num('maxPrice'), num('minRating')];
    const category = p.get('category');
    const segment = p.get('segment');
    let rows = CATALOG.filter((x) => {
      const price = x.salePrice ?? x.basePrice;
      return (
        (!q || foldE2E(x.name).includes(q)) &&
        (brands.length === 0 || brands.includes(x.brand)) &&
        (!category || x.categoryIds.includes(category)) &&
        (!segment || x.forSegment.includes(segment)) &&
        (min == null || price >= min) &&
        (max == null || price <= max) &&
        (p.get('inStock') !== 'true' || x.inStock) &&
        (rating == null || (x.ratingAvg ?? 0) >= rating)
      );
    });
    const sort = p.get('sort');
    if (sort === 'best_seller' && !opts.legacy) rows = [...rows].sort((a, b) => b.soldTotal - a.soldTotal || a.id.localeCompare(b.id));
    if (sort === 'price_asc') rows = [...rows].sort((a, b) => a.basePrice - b.basePrice || a.id.localeCompare(b.id));
    if (sort === 'price_desc') rows = [...rows].sort((a, b) => b.basePrice - a.basePrice || a.id.localeCompare(b.id));
    const page = Number(p.get('page') ?? 1);
    const limit = Number(p.get('limit') ?? 20);
    const body: PageResponse<ProductCard> = {
      data: rows.slice((page - 1) * limit, page * limit).map(toCard),
      meta: { page, limit, total: rows.length },
    };
    return body;
  };
}

function suggestFor(q: string): ProductSuggestion[] {
  const f = foldE2E(q);
  return f ? CATALOG.filter((x) => foldE2E(x.name).includes(f)).slice(0, 8).map((x) => ({ slug: x.slug, name: x.name, thumbnail: x.thumbnail, basePrice: x.basePrice })) : [];
}

function productDetail(slug: string): ProductDetail | undefined {
  const x = CATALOG.find((c) => c.slug === slug);
  if (!x) return undefined;
  return {
    id: x.id, slug: x.slug, brand: x.brand, name: x.name, shortDesc: `Mô tả ngắn ${x.name}`, description: '<p>IT</p>',
    images: [], thumbnail: x.thumbnail, basePrice: x.basePrice, salePrice: x.salePrice, certifications: [],
    variations: [{ id: `var-${x.id}`, sku: `SKU-${x.id}`, name: 'Mặc định', attributes: {}, retailPrice: x.basePrice, salePrice: x.salePrice, stock: x.inStock ? 20 : 0 }],
  };
}

export function mockDiscovery(
  api: MockApi,
  opts: { legacy?: boolean; returning?: boolean; shipping?: boolean; subscription?: boolean; forYou?: ProductCard[] } = {},
): void {
  mockSession(api, makeUser({ id: 'user-4b', fullName: 'Khách Khám Phá' }));
  api.get('/products', catalogHandler(opts));
  api.get('/products/for-you', opts.forYou ?? []);
  api.get('/products/:slug', ({ params }) => productDetail(params.slug!) ?? reply(404, { statusCode: 404, message: 'Không tìm thấy sản phẩm.' }));
  api.get('/products/:slug/related', []);
  api.get('/products/:slug/bought-together', []);
  api.get('/products/:slug/reviews', { average: 0, count: 0, items: [] });
  api.get('/brands', [{ brand: 'Tubu', count: 28 }, { brand: 'Mộc An', count: 2 }]);
  api.get('/categories', opts.legacy ? CATEGORIES.map(({ productCount: _p, ...c }) => c) : CATEGORIES);
  api.get('/search/suggest', ({ call }) => suggestFor(call.query.get('q') ?? ''));
  api.get('/cart', EMPTY_CART);
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get('/me/notifications', []);
  api.get('/me/wishlist/ids', []);
  api.get('/me/coupons', []);
  api.get('/affiliate/me', { isAffiliate: false, referralCode: '', walletBalance: 0 });
  api.get('/config/public', publicConfig());
  api.get('/me/purchased-items', opts.returning ? PURCHASED_PAGE : { items: [], nextCursor: null });
  api.get('/orders/active-count', { count: opts.shipping ? 1 : 0 });
  api.get('/orders', ({ call }) => {
    const data = opts.shipping && call.query.get('status') === 'SHIPPING' ? [makeOrder({ code: SHIPPING_CODE, status: 'SHIPPING', paymentStatus: 'PAID' })] : [];
    return { data, meta: { page: 1, limit: 1, total: data.length } };
  });
  api.get('/orders/:code', ({ params }) => makeOrder({ code: params.code!, status: 'SHIPPING', paymentStatus: 'PAID' }));
  api.get('/orders/me/returns', []);
  api.get('/me/subscriptions', opts.subscription ? [SUBSCRIPTION_4B] : []);
  api.post('/events', { accepted: 1 });
  // Fire-and-forget không liên quan nội dung test.
  api.allowUnmocked('POST /affiliate/touch', 'GET /products/:slug/reviews/can-review');
}
