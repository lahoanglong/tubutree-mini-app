import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from './api';
import {
  addToCart,
  fetchActiveOrderCount,
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
