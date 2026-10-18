import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import {
  cancelOrder,
  chooseRefundDestination,
  estimateReturn,
  fetchActiveOrderCount,
  fetchMyRefunds,
  fetchMyReturns,
  fetchOrder,
  fetchOrders,
  fetchPurchasedItems,
  fetchRefundBank,
  normalizeRepurchaseResponse,
  repurchaseOrder,
  requestReturn,
} from './orders';
import type { CartSummary } from './cart';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 } as CartSummary;

describe('orders — hợp đồng gọi API', () => {
  it('fetchOrders: status thắng group; luôn kèm page/limit (mặc định 1/20)', async () => {
    const { http, calls } = fakeHttp();
    await fetchOrders(http);
    await fetchOrders(http, { status: 'SHIPPING', group: 'closed' }, 2, 5);
    await fetchOrders(http, { group: 'processing' }, 1, 20);
    expect(calls.map((c) => c.opts)).toEqual([
      { query: { page: 1, limit: 20 } },
      { query: { status: 'SHIPPING', page: 2, limit: 5 } },
      { query: { group: 'processing', page: 1, limit: 20 } },
    ]);
    expect(calls.every((c) => c.method === 'get' && c.path === '/orders')).toBe(true);
  });

  it('fetchOrder, fetchActiveOrderCount (dữ liệu lạ → 0), fetchPurchasedItems', async () => {
    const a = fakeHttp(() => ({ count: 3 }));
    expect(await fetchActiveOrderCount(a.http)).toBe(3);
    expect(a.calls).toEqual([{ method: 'get', path: '/orders/active-count' }]);
    expect(await fetchActiveOrderCount(fakeHttp(() => ({ count: 'x' })).http)).toBe(0);
    expect(await fetchActiveOrderCount(fakeHttp(() => null).http)).toBe(0);
    const { http, calls } = fakeHttp();
    await fetchOrder(http, 'TUBU1');
    await fetchPurchasedItems(http, { cursor: 'c', limit: 10 });
    await fetchPurchasedItems(http);
    expect(calls).toEqual([
      { method: 'get', path: '/orders/TUBU1' },
      { method: 'get', path: '/me/purchased-items', opts: { query: { cursor: 'c', limit: 10 } } },
      { method: 'get', path: '/me/purchased-items', opts: { query: {} } },
    ]);
  });

  it('cancelOrder: không chọn nơi nhận thì body rỗng; có thì gửi nguyên', async () => {
    const { http, calls } = fakeHttp();
    await cancelOrder(http, 'T1');
    const dest = { refundMethod: 'BANK', bankName: 'B', accountNumber: '1', accountName: 'N' } as const;
    await cancelOrder(http, 'T1', dest);
    expect(calls).toEqual([
      { method: 'post', path: '/orders/T1/cancel', body: {} },
      { method: 'post', path: '/orders/T1/cancel', body: dest },
    ]);
  });

  it('repurchaseOrder: body mặc định rỗng, chuẩn hoá phản hồi v2 và legacy', async () => {
    const results = [{ orderItemId: 'i1', status: 'added', addedQuantity: 1 }];
    const v2 = fakeHttp(() => ({ ...CART, cart: CART, results }));
    expect(await repurchaseOrder(v2.http, 'T1', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' })).toEqual({ cart: CART, results, legacy: false });
    expect(v2.calls).toEqual([{ method: 'post', path: '/orders/T1/repurchase', body: { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' } }]);
    const legacy = fakeHttp(() => CART);
    expect(await repurchaseOrder(legacy.http, 'T1')).toEqual({ cart: CART, results: [], legacy: true });
    expect(legacy.calls[0]!.body).toEqual({});
  });

  it('normalizeRepurchaseResponse: v2 top-level, v2 thật, legacy', () => {
    const results = [{ orderItemId: 'i1', status: 'added' as const, addedQuantity: 1 }];
    expect(normalizeRepurchaseResponse({ ...CART, results })).toEqual({ cart: CART, results, legacy: false });
    const r = normalizeRepurchaseResponse({ ...CART, cart: CART, results });
    expect(r.cart).not.toHaveProperty('cart');
    expect(normalizeRepurchaseResponse(CART)).toEqual({ cart: CART, results: [], legacy: true });
  });

  it('đổi/trả và hoàn tiền', async () => {
    const bank = { bank: { bankName: 'B', accountNumber: '1', accountName: 'N' } };
    const { http, calls } = fakeHttp((c) => (c.path === '/orders/me/refund-bank' ? bank : undefined));
    const ret = { reasonCode: 'DEFECTIVE' as const, items: [{ orderItemId: 'i1', quantity: 1 }], refundMethod: 'WALLET' as const };
    await requestReturn(http, 'T1', ret);
    await estimateReturn(http, 'T1', { items: ret.items });
    await fetchMyReturns(http);
    await fetchMyRefunds(http, 'o1');
    expect(await fetchRefundBank(http)).toEqual(bank.bank);
    await chooseRefundDestination(http, 'r1', { refundMethod: 'WALLET' });
    expect(calls).toEqual([
      { method: 'post', path: '/orders/T1/return-request', body: ret },
      { method: 'post', path: '/orders/T1/return-estimate', body: { items: ret.items } },
      { method: 'get', path: '/orders/me/returns' },
      { method: 'get', path: '/orders/me/refunds', opts: { query: { orderId: 'o1' } } },
      { method: 'get', path: '/orders/me/refund-bank' },
      { method: 'post', path: '/orders/me/refunds/r1/destination', body: { refundMethod: 'WALLET' } },
    ]);
  });
});
