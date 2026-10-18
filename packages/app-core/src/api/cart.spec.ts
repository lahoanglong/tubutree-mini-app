import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { addToCart, applyCoupon, getCart, getCartSelection, removeCartItem, removeCoupon, updateCartItem } from './cart';

const withSlug = { query: { storefrontSlug: 'ctv-a' } };

describe('cart — hợp đồng gọi API', () => {
  it('không có gian hàng CTV: không gửi storefrontSlug', async () => {
    const { http, calls } = fakeHttp();
    await getCart(http);
    await addToCart(http, 'v1', 1);
    await addToCart(http, 'v1', 2, 'repurchase');
    await updateCartItem(http, 'i1', 3);
    await removeCartItem(http, 'i1');
    await applyCoupon(http, 'ABC');
    await removeCoupon(http);
    expect(calls).toEqual([
      { method: 'get', path: '/cart' },
      { method: 'post', path: '/cart/items', body: { variationId: 'v1', quantity: 1 } },
      { method: 'post', path: '/cart/items', body: { variationId: 'v1', quantity: 2, addSource: 'repurchase' } },
      { method: 'patch', path: '/cart/items/i1', body: { quantity: 3 } },
      { method: 'delete', path: '/cart/items/i1' },
      { method: 'post', path: '/cart/coupon', body: { code: 'ABC' } },
      { method: 'delete', path: '/cart/coupon' },
    ]);
  });

  it('gian hàng CTV: mọi đường giỏ kèm storefrontSlug', async () => {
    const { http, calls } = fakeHttp();
    await getCart(http, 'ctv-a');
    await addToCart(http, 'v1', 1, undefined, 'ctv-a');
    await updateCartItem(http, 'i1', 3, 'ctv-a');
    await removeCartItem(http, 'i1', 'ctv-a');
    await applyCoupon(http, 'ABC', 'ctv-a');
    await removeCoupon(http, 'ctv-a');
    expect(calls).toEqual([
      { method: 'get', path: '/cart', opts: withSlug },
      { method: 'post', path: '/cart/items', body: { variationId: 'v1', quantity: 1 }, opts: withSlug },
      { method: 'patch', path: '/cart/items/i1', body: { quantity: 3 }, opts: withSlug },
      { method: 'delete', path: '/cart/items/i1', opts: withSlug },
      { method: 'post', path: '/cart/coupon', body: { code: 'ABC' }, opts: withSlug },
      { method: 'delete', path: '/cart/coupon', opts: withSlug },
    ]);
  });

  it('getCartSelection: itemIds nối bằng dấu phẩy, slug đứng trước', async () => {
    const { http, calls } = fakeHttp();
    await getCartSelection(http, ['a', 'b']);
    await getCartSelection(http, ['a'], 'ctv-a');
    expect(calls).toEqual([
      { method: 'get', path: '/cart', opts: { query: { itemIds: 'a,b' } } },
      { method: 'get', path: '/cart', opts: { query: { storefrontSlug: 'ctv-a', itemIds: 'a' } } },
    ]);
  });
});
