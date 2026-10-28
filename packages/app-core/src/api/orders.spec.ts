import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import {
  cancelOrder,
  chooseRefundDestination,
  customerOrderNote,
  estimateReturn,
  fetchActiveOrderCount,
  fetchMyRefunds,
  fetchMyReturns,
  fetchOrder,
  fetchOrders,
  fetchPurchasedItems,
  fetchRefundBank,
  isSubscriptionOrder,
  normalizeRepurchaseResponse,
  openProductSlug,
  repurchaseOrder,
  requestReturn,
  SUBSCRIPTION_ORDER_NOTE,
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

describe('openProductSlug — dòng đơn chỉ dẫn tới trang sản phẩm còn mở', () => {
  it('còn bán (hoặc API cũ chưa trả cờ) → slug', () => {
    expect(openProductSlug({ productSlug: 'tra-xanh', productPublic: true })).toBe('tra-xanh');
    expect(openProductSlug({ productSlug: 'tra-xanh' })).toBe('tra-xanh');
  });
  it('sản phẩm đã gỡ → null dù đơn còn lưu slug', () => {
    expect(openProductSlug({ productSlug: 'tra-xanh', productPublic: false })).toBeNull();
  });
  it('đơn cũ không có slug → null', () => {
    expect(openProductSlug({ productSlug: null })).toBeNull();
    expect(openProductSlug({})).toBeNull();
  });
});

describe('customerOrderNote — ghi chú cố định của đơn định kỳ không hiện như lời khách', () => {
  it('đơn định kỳ chỉ có ghi chú cố định → null', () => {
    expect(isSubscriptionOrder({ source: 'subscription' })).toBe(true);
    expect(customerOrderNote({ source: 'subscription', note: SUBSCRIPTION_ORDER_NOTE })).toBeNull();
  });
  it('đơn thường vẫn hiện ghi chú, kể cả khi trùng chữ', () => {
    expect(customerOrderNote({ source: 'checkout', note: 'Giao giờ hành chính' })).toBe('Giao giờ hành chính');
    expect(customerOrderNote({ source: 'checkout', note: SUBSCRIPTION_ORDER_NOTE })).toBe(SUBSCRIPTION_ORDER_NOTE);
  });
  it('đơn định kỳ có ghi chú khác (CSKH sửa) vẫn hiện', () => {
    expect(customerOrderNote({ source: 'subscription', note: 'Giao sau 17h' })).toBe('Giao sau 17h');
  });
  it('không ghi chú → null', () => {
    expect(customerOrderNote({ note: null })).toBeNull();
    expect(customerOrderNote({})).toBeNull();
  });
});
