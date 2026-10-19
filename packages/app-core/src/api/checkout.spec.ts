import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { checkoutQuote, createAddress, getAddresses, getCouponPreviews, placeOrder } from './checkout';

describe('checkout — hợp đồng gọi API', () => {
  it('địa chỉ', async () => {
    const { http, calls } = fakeHttp();
    const addr = { recipient: 'A', phone: '0900000000', province: 'p', district: 'd', ward: 'w', street: 's', provinceCode: 'pc', districtCode: 'dc', wardCode: 'wc' };
    await getAddresses(http);
    await createAddress(http, addr);
    expect(calls).toEqual([
      { method: 'get', path: '/me/addresses' },
      { method: 'post', path: '/me/addresses', body: addr },
    ]);
  });

  it('checkoutQuote gửi đúng 4 trường body', async () => {
    const { http, calls } = fakeHttp();
    await checkoutQuote(http, 'a1', 50, 'ctv-a', ['i1']);
    expect(calls).toEqual([{ method: 'post', path: '/checkout/quote', body: { addressId: 'a1', pointsToUse: 50, storefrontSlug: 'ctv-a', itemIds: ['i1'] } }]);
  });

  it('getCouponPreviews trả mảng coupons', async () => {
    const { http, calls } = fakeHttp(() => ({ coupons: [{ code: 'X' }] }));
    const req = { addressId: 'a1' } as never;
    expect(await getCouponPreviews(http, req)).toEqual([{ code: 'X' }]);
    expect(calls).toEqual([{ method: 'post', path: '/checkout/coupon-previews', body: req }]);
  });

  it('placeOrder: cùng endpoint, nguyên body, Idempotency-Key trong header', async () => {
    const { http, calls } = fakeHttp();
    const body = { addressId: 'a1', paymentMethod: 'COD', pointsToUse: 10, expectedTotal: 99000, referralCode: 'R', storefrontSlug: 's', itemIds: ['i1'] };
    await placeOrder(http, body, 'key-123');
    expect(calls).toEqual([{ method: 'post', path: '/checkout/place-order', body, opts: { headers: { 'Idempotency-Key': 'key-123' } } }]);
  });
});
