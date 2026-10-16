// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('./client-api', () => ({ apiFetch }));

import { applyCoupon, getCart, removeCartItem } from './shop-client';
import { rememberStorefront } from './storefront-context';

describe('giỏ gửi gian hàng CTV đang ghi công để máy chủ trừ combo', () => {
  beforeEach(() => {
    sessionStorage.clear();
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
  });

  it('gian hàng CTV: getCart và đường trả giỏ kèm storefrontSlug', async () => {
    rememberStorefront('shop-a', 'CTV');
    await getCart();
    expect(apiFetch).toHaveBeenLastCalledWith('/cart?storefrontSlug=shop-a');
    await removeCartItem('i1');
    expect(apiFetch).toHaveBeenLastCalledWith('/cart/items/i1?storefrontSlug=shop-a', { method: 'DELETE' });
    await applyCoupon('XANH10');
    expect(apiFetch).toHaveBeenLastCalledWith('/cart/coupon?storefrontSlug=shop-a', { method: 'POST', body: { code: 'XANH10' } });
  });

  it('trang nhãn hàng hoặc không có gian hàng: không gửi slug (như cũ)', async () => {
    rememberStorefront('visante', 'BRAND');
    await getCart();
    expect(apiFetch).toHaveBeenLastCalledWith('/cart');
    sessionStorage.clear();
    await getCart();
    expect(apiFetch).toHaveBeenLastCalledWith('/cart');
  });
});
