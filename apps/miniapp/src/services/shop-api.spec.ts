import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from './api';
import {
  addToCart,
  catalogParams,
  createReview,
  fetchActiveOrderCount,
  fetchCatalog,
  fetchCategories,
  fetchOrders,
  fetchPurchasedItems,
  normalizeRepurchaseResponse,
  repurchaseOrder,
  type CartSummary,
} from './shop-api';

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };

describe('shop-api — buy-flow 4a', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizeRepurchaseResponse: API v2 (giỏ top-level + results) → { cart, results }', () => {
    const results = [{ orderItemId: 'i1', status: 'added' as const, addedQuantity: 1 }];
    expect(normalizeRepurchaseResponse({ ...CART, results })).toEqual({ cart: CART, results, legacy: false });
  });

  it('normalizeRepurchaseResponse: API v2 thật ({...giỏ, cart, results}) → cart đúng bằng giỏ, không lồng khoá cart', () => {
    const results = [{ orderItemId: 'i1', status: 'added' as const, addedQuantity: 1 }];
    const r = normalizeRepurchaseResponse({ ...CART, cart: CART, results } as CartSummary & { results: typeof results });
    expect(r.cart).toEqual(CART);
    expect(r.cart).not.toHaveProperty('cart');
    expect(r).toEqual({ cart: CART, results, legacy: false });
  });

  it('normalizeRepurchaseResponse: API cũ (chỉ giỏ) → legacy=true, results rỗng', () => {
    expect(normalizeRepurchaseResponse(CART)).toEqual({ cart: CART, results: [], legacy: true });
  });

  it('repurchaseOrder gửi body items + addSource', async () => {
    post.mockResolvedValue({ data: { ...CART, cart: CART, results: [] } });
    const r = await repurchaseOrder('TUBU1', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
    expect(r).toEqual({ cart: CART, results: [], legacy: false });
    expect(post).toHaveBeenCalledWith('/orders/TUBU1/repurchase', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
  });

  it('addToCart chỉ gửi addSource khi có', async () => {
    post.mockResolvedValue({ data: CART });
    await addToCart('v1', 1);
    expect(post).toHaveBeenLastCalledWith('/cart/items', { variationId: 'v1', quantity: 1 });
    await addToCart('v1', 2, 'repurchase');
    expect(post).toHaveBeenLastCalledWith('/cart/items', { variationId: 'v1', quantity: 2, addSource: 'repurchase' });
  });

  it('fetchOrders: status thắng group; không lọc → chỉ page/limit', async () => {
    get.mockResolvedValue({ data: { data: [], meta: { page: 1, limit: 20, total: 0 } } });
    await fetchOrders({ group: 'processing' }, 1, 20);
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { group: 'processing', page: 1, limit: 20 } });
    await fetchOrders({ status: 'SHIPPING', group: 'closed' }, 2, 10);
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { status: 'SHIPPING', page: 2, limit: 10 } });
    await fetchOrders();
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { page: 1, limit: 20 } });
  });

  it('fetchActiveOrderCount ép về 0 khi dữ liệu lạ', async () => {
    get.mockResolvedValueOnce({ data: { count: 3 } });
    await expect(fetchActiveOrderCount()).resolves.toBe(3);
    get.mockResolvedValueOnce({ data: { code: 'active-count' } });
    await expect(fetchActiveOrderCount()).resolves.toBe(0);
  });

  it('fetchPurchasedItems chuyển params', async () => {
    get.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchPurchasedItems({ variationId: 'v1', limit: 1 });
    expect(get).toHaveBeenCalledWith('/me/purchased-items', { params: { variationId: 'v1', limit: 1 } });
  });
});

describe('shop-api — buy-flow 4b', () => {
  beforeEach(() => vi.clearAllMocks());
  const PAGE = { data: [], meta: { page: 1, limit: 30, total: 0 } };
  const badRequest = () => Object.assign(new Error('400'), { isAxiosError: true, response: { status: 400 } });

  it('catalogParams: chỉ gửi tham số có giá trị; q được trim; inStock=true; không gửi inStock=false', () => {
    expect(catalogParams({ page: 1, limit: 30 })).toEqual({ page: 1, limit: 30 });
    expect(catalogParams({ page: 2, limit: 30, q: '  nước ', sort: 'best_seller', brand: 'Tubu', category: 'cat-a', segment: 'eco', minPrice: 0, maxPrice: 200000, inStock: true, minRating: 4 })).toEqual({
      page: 2, limit: 30, q: 'nước', sort: 'best_seller', brand: 'Tubu', category: 'cat-a', segment: 'eco', minPrice: 0, maxPrice: 200000, inStock: 'true', minRating: 4,
    });
    expect(catalogParams({ page: 1, limit: 30, q: '   ', inStock: false })).toEqual({ page: 1, limit: 30 });
  });

  it('fetchCatalog: thành công → filtersIgnored=false', async () => {
    get.mockResolvedValue({ data: PAGE });
    await expect(fetchCatalog({ page: 1, limit: 30, minPrice: 100000 })).resolves.toEqual({ ...PAGE, filtersIgnored: false });
    expect(get).toHaveBeenCalledWith('/products', { params: { page: 1, limit: 30, minPrice: 100000 } });
  });

  it('fetchCatalog: API cũ trả 400 vì tham số mới → gọi lại KHÔNG có minPrice/maxPrice/inStock/minRating, filtersIgnored=true', async () => {
    get.mockRejectedValueOnce(badRequest()).mockResolvedValueOnce({ data: PAGE });
    const r = await fetchCatalog({ page: 1, limit: 30, q: 'nuoc', sort: 'best_seller', minPrice: 1, maxPrice: 2, inStock: true, minRating: 4 });
    expect(r.filtersIgnored).toBe(true);
    expect(get).toHaveBeenLastCalledWith('/products', { params: { page: 1, limit: 30, q: 'nuoc', sort: 'best_seller' } });
  });

  it('fetchCatalog: 400 khi KHÔNG có tham số mới → ném lỗi thật (không nuốt)', async () => {
    get.mockRejectedValueOnce(badRequest());
    await expect(fetchCatalog({ page: 1, limit: 30, q: 'nuoc' })).rejects.toThrow('400');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fetchCatalog: 500 khi có tham số mới → ném lỗi (chỉ 400 mới lùi)', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('500'), { isAxiosError: true, response: { status: 500 } }));
    await expect(fetchCatalog({ page: 1, limit: 30, inStock: true })).rejects.toThrow('500');
  });

  it('fetchCategories gọi GET /categories', async () => {
    get.mockResolvedValue({ data: [{ id: 'cat-a', parentId: null, name: 'A', slug: 'a', image: null, sortOrder: 1, productCount: 3 }] });
    await expect(fetchCategories()).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/categories');
  });
});

// PF-6b: POST /products/:slug/reviews trả `{ ...dòng Review, updated }`; pointsEarned là cột của dòng Review nên có thể là 0.
describe('shop-api — createReview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('kiểu trả về khai pointsEarned và updated, khớp response thật (kiểm bằng tsc, không cần ép kiểu ở nơi gọi)', () => {
    type Created = Awaited<ReturnType<typeof createReview>>;
    expectTypeOf<Created['pointsEarned']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Created['updated']>().toEqualTypeOf<boolean | undefined>();
  });

  it('đánh giá luôn gửi kèm đơn: thiếu orderId là lỗi kiểu (máy chủ hiểu lần gửi không kèm đơn là sửa đánh giá mới nhất)', () => {
    expectTypeOf<Parameters<typeof createReview>[1]['orderId']>().toEqualTypeOf<string>();
  });

  it('gửi POST tới /products/:slug/reviews và trả nguyên dữ liệu, pointsEarned = 0 không bị đổi thành thiếu', async () => {
    const data = { id: 'r1', rating: 4, comment: null, images: [], videoUrl: null, createdAt: '2026-10-01T00:00:00.000Z', pointsEarned: 0, updated: false };
    post.mockResolvedValue({ data });
    const r = await createReview('nuoc-rua-chen', { rating: 4, orderId: 'o1' });
    expect(post).toHaveBeenCalledWith('/products/nuoc-rua-chen/reviews', { rating: 4, orderId: 'o1' });
    expect(r.pointsEarned).toBe(0);
    expect(r.updated).toBe(false);
  });
});
