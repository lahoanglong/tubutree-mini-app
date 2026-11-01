import { makeUser, mockSession, reply, type MockApi } from './mock-api';
import { EMPTY_CART } from './shop-page-mocks';

type Rec = Record<string, unknown>;
export type BuilderCollection = {
  id: string;
  title: string;
  kind: 'NORMAL' | 'COMBO';
  layout: 'GRID' | 'CAROUSEL' | 'STACK';
  comboDiscountPct: number | null;
  sortOrder: number;
  items: Rec[];
};

export const BUILDER_TITLE = 'Cửa hàng Xanh';

const product = (n: number): Rec => ({
  id: `p${n}`,
  name: `Món ${String(n).padStart(2, '0')}`,
  slug: `mon-${n}`,
  thumbnail: null,
  brand: 'Tubu',
  basePrice: 50_000 + n * 1_000,
  salePrice: null,
  ratingAvg: 0,
  reviewCount: 0,
  sold: n,
  inStock: true,
  createdAt: new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString(),
  repVariationId: `v${n}`,
});

/** Món trong một khối; `hiddenAt` là số thứ tự (từ 1) của món CTV đã ẩn, khách không thấy. */
const items = (col: string, from: number, count: number, hiddenAt?: number): Rec[] =>
  Array.from({ length: count }, (_, k) => ({
    id: `${col}-i${k + 1}`,
    productId: `p${from + k}`,
    note: null,
    variationId: null,
    isPinned: false,
    isHidden: hiddenAt === k + 1,
    hiddenReason: null,
    sortOrder: k,
    product: product(from + k),
  }));

/** Ba khối đủ ba kiểu: lưới 12 món, kệ ngang 4 món, combo 3 món giảm 10% (một món đã ẩn nên khách thấy 2). */
export function defaultCollections(): BuilderCollection[] {
  return [
    { id: 'c-grid', title: 'Bếp xanh', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: items('c-grid', 1, 12) },
    { id: 'c-rail', title: 'Chăm sóc nhà cửa', kind: 'NORMAL', layout: 'CAROUSEL', comboDiscountPct: null, sortOrder: 1, items: items('c-rail', 13, 4) },
    { id: 'c-combo', title: 'Combo giặt sạch', kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 10, sortOrder: 2, items: items('c-combo', 17, 3, 3) },
  ];
}

export interface BuilderOptions {
  collections?: BuilderCollection[];
  storefront?: Rec;
  /** Trần `%` giảm của máy chủ (`storefront.max_combo_pct`); mặc định 30. */
  maxComboPct?: number;
}

/**
 * Màn dựng gian hàng CTV (`/storefront`) với dữ liệu có trạng thái. Mặc định là gian hàng nháp đã duyệt từ trước và đã có sản phẩm: vào thẳng trình dựng,
 * không qua luồng 4 bước (xem `shouldStartSignupWizard`), nút chính là "Đăng lại". Dữ liệu có trạng thái: PATCH/POST khối, đổi thứ tự đều cập nhật rồi trả lại ở lần tải sau. */
export function mockBuilder(api: MockApi, opts: BuilderOptions = {}): { collections: BuilderCollection[] } {
  const state = { collections: opts.collections ?? defaultCollections() };
  const maxPct = opts.maxComboPct ?? 30;
  const sf = () => ({
    id: 'sf1', slug: 'aff1', type: 'CTV', title: BUILDER_TITLE, headerNote: 'Mình chọn đồ dùng xanh.', avatarUrl: null, coverUrl: null, theme: 'default',
    themeColor: null, subdomain: null, isPublished: false, status: 'DRAFT', approved: true, needsApproval: false, referralCode: 'AFF1', subdomainEnabled: false, publicHiddenReason: null,
    ...opts.storefront,
    collections: state.collections,
  });
  const find = (id: string) => state.collections.find((c) => c.id === id);

  mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
  api.get('/affiliate/me', { isAffiliate: true, canRegister: true, canOpenStorefront: true, referralCode: 'AFF1', walletBalance: 0 });
  api.get('/storefront/me', () => sf());
  api.get('/storefront/me/stats', { orders7d: 2, orders30d: 9, revenue30d: 1_250_000, commission30d: 125_000, byProduct: [] });
  api.get('/storefront/me/quests', {
    level: 1, levelMax: 5, totalEarnedPoints: 4,
    quests: [
      { code: 'Q1', title: 'Thêm 3 sản phẩm', hint: 'Thêm vào bộ sưu tập', goal: 3, progress: 3, done: true, claimed: false, rewardPoints: 2 },
      { code: 'Q2', title: 'Đăng gian hàng', hint: 'Bấm Đăng lại', goal: 1, progress: 0, done: false, claimed: false, rewardPoints: 2 },
    ],
  });
  api.get('/storefront/me/products', [{ ...product(90), id: 'p90', name: 'Xà phòng', slug: 'xa-phong', maxAffiliateRate: 12 }]);
  api.get('/categories', []);
  // Xem trước dựng bằng ShopSection thật: thẻ sản phẩm đọc tim yêu thích và khung Giờ vàng.
  api.get('/flash-sales/active', []);
  api.get('/me/wishlist/ids', []);
  api.get('/cart', EMPTY_CART);
  api.allowUnmocked('POST /events', 'POST /affiliate/touch', 'GET /me/coupons');

  api.post('/storefront/me/collections', ({ call }) => {
    const dto = call.body as { title: string; kind?: 'NORMAL' | 'COMBO'; layout?: BuilderCollection['layout']; comboDiscountPct?: number };
    const col: BuilderCollection = {
      id: `c-new-${state.collections.length + 1}`,
      title: dto.title,
      kind: dto.kind ?? 'NORMAL',
      layout: dto.layout ?? 'GRID',
      comboDiscountPct: dto.kind === 'COMBO' ? Math.min(dto.comboDiscountPct ?? 10, maxPct) : null,
      sortOrder: state.collections.length,
      items: [],
    };
    state.collections.push(col);
    return { ...col, items: undefined };
  });
  api.post('/storefront/me/collections/reorder', ({ call }) => {
    const ids = (call.body as { orderedIds: string[] }).orderedIds;
    state.collections = ids.map((id) => find(id)!).map((c, k) => ({ ...c, sortOrder: k }));
    return { ok: true };
  });
  api.post('/storefront/me/collections/:id/items/reorder', ({ call, params }) => {
    const col = find(params.id!);
    if (!col) return reply(404, { message: 'Không có khối' });
    const ids = (call.body as { orderedIds: string[] }).orderedIds;
    col.items = ids.map((id) => col.items.find((i) => i.id === id)!);
    return { ok: true };
  });
  api.post('/storefront/me/collections/:id/items', ({ params }) => {
    const col = find(params.id!);
    if (!col) return reply(404, { message: 'Không có khối' });
    const next = { id: `${col.id}-i${col.items.length + 1}`, productId: 'p90', note: null, variationId: null, isPinned: false, isHidden: false, hiddenReason: null, sortOrder: col.items.length, product: product(90) };
    col.items.push(next);
    return next;
  });
  api.patch('/storefront/me/collections/:id', ({ call, params }) => {
    const col = find(params.id!);
    if (!col) return reply(404, { message: 'Không có khối' });
    const dto = call.body as { title?: string; layout?: BuilderCollection['layout']; comboDiscountPct?: number };
    if (dto.title !== undefined) col.title = dto.title;
    if (dto.layout) col.layout = dto.layout;
    if (typeof dto.comboDiscountPct === 'number') col.comboDiscountPct = Math.min(dto.comboDiscountPct, maxPct);
    // Máy chủ trả bộ sưu tập thuần, không kèm danh sách món.
    return { ...col, items: undefined };
  });
  return state;
}
