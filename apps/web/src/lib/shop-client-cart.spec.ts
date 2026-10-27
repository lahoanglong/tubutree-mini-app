// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('./client-api', () => ({ apiFetch }));

import { applyCoupon, cancelOrder, getCart, removeCartItem } from './shop-client';
import { cartKey } from './cart-key';
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

  it('khoá cache của giỏ kèm gian hàng: đổi gian hàng thì đổi khoá, vẫn khớp tiền tố ["cart"]', () => {
    expect(cartKey()).toEqual(['cart', null]);
    rememberStorefront('shop-a', 'CTV');
    expect(cartKey()).toEqual(['cart', 'shop-a']);
    rememberStorefront('shop-b', 'CTV');
    expect(cartKey()).toEqual(['cart', 'shop-b']);
    rememberStorefront('visante', 'BRAND');
    expect(cartKey()).toEqual(['cart', null]);
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

describe('cancelOrder — API cũ chưa nhận lý do huỷ', () => {
  beforeEach(() => apiFetch.mockReset());
  const reason = { cancelReasonCode: 'CHANGED_MIND' } as never;
  const rejected = (message: string, status = 400) => Object.assign(new Error(message), { status });

  it('400 «Không nhận trường cancelReasonCode» → gửi lại một lần không kèm lý do', async () => {
    apiFetch.mockRejectedValueOnce(rejected('Không nhận trường «cancelReasonCode».')).mockResolvedValueOnce({ code: 'T1' });
    await expect(cancelOrder('T1', { refundMethod: 'WALLET' }, reason)).resolves.toEqual({ code: 'T1' });
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/orders/T1/cancel', { method: 'POST', body: { refundMethod: 'WALLET', cancelReasonCode: 'CHANGED_MIND' } });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/orders/T1/cancel', { method: 'POST', body: { refundMethod: 'WALLET' } });
  });

  it('lỗi 400 khác → không gửi lại', async () => {
    apiFetch.mockRejectedValueOnce(rejected('Đơn đã giao.'));
    const other = await cancelOrder('T1', undefined, reason).catch((e: Error) => e.message);
    expect(other).toBe('Đơn đã giao.');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('không có lý do → không gửi lại dù API báo trường lạ', async () => {
    apiFetch.mockRejectedValueOnce(rejected('Không nhận trường «cancelReasonCode».'));
    const out = await cancelOrder('T1').catch((e: Error) => e.message);
    expect(out).toContain('cancelReasonCode');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
