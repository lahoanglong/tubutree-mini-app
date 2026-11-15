import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { checkoutQuote, createAddress, getAddresses, getCheckoutPickupOptions, getCouponPreviews, placeOrder, RECYCLE_PICKUP } from './checkout';

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

  it('checkoutQuote không chọn thu rác: thân yêu cầu không có trường thu rác nào (app cũ cùng hợp đồng)', async () => {
    const { http, calls } = fakeHttp();
    await checkoutQuote(http, 'a1', 50, 'ctv-a', ['i1']);
    await checkoutQuote(http, 'a1', undefined, undefined, undefined, {});
    expect(Object.keys(calls[0]!.body as object).sort()).toEqual(['addressId', 'itemIds', 'pointsToUse', 'storefrontSlug']);
    expect(Object.keys(calls[1]!.body as object).sort()).toEqual(['addressId', 'itemIds', 'pointsToUse', 'storefrontSlug']);
  });

  it('checkoutQuote kèm thu rác: chỉ gửi trường khách chọn, đúng tên trường của máy chủ', async () => {
    const { http, calls } = fakeHttp();
    const inlinePickup = { lines: [{ itemId: 'w1', qty: 2 }], returnWeightGrams: 2000 };
    await checkoutQuote(http, 'a1', 0, undefined, ['i1'], { inlinePickup, excludeGiftRedemptionIds: ['g1'] });
    await checkoutQuote(http, 'a1', 0, undefined, ['i1'], { wasteRequestId: 'r1', returnWeightGrams: 1500 });
    expect(calls[0]!.body).toMatchObject({ addressId: 'a1', itemIds: ['i1'], inlinePickup, excludeGiftRedemptionIds: ['g1'] });
    expect(Object.keys(calls[0]!.body as object)).not.toContain('wasteRequestId');
    expect(Object.keys(calls[0]!.body as object)).not.toContain('returnWeightGrams');
    expect(calls[1]!.body).toMatchObject({ wasteRequestId: 'r1', returnWeightGrams: 1500 });
    expect(Object.keys(calls[1]!.body as object)).not.toContain('inlinePickup');
  });

  it('getCheckoutPickupOptions: GET /checkout/pickup-options, itemIds nối dấu phẩy, bỏ itemIds khi rỗng', async () => {
    const { http, calls } = fakeHttp();
    await getCheckoutPickupOptions(http, { addressId: 'a1', itemIds: ['i1', 'i2'] });
    await getCheckoutPickupOptions(http, { addressId: 'a1' });
    await getCheckoutPickupOptions(http, { addressId: 'a1', itemIds: [] });
    expect(calls).toEqual([
      { method: 'get', path: '/checkout/pickup-options', opts: { query: { addressId: 'a1', itemIds: 'i1,i2' } } },
      { method: 'get', path: '/checkout/pickup-options', opts: { query: { addressId: 'a1' } } },
      { method: 'get', path: '/checkout/pickup-options', opts: { query: { addressId: 'a1' } } },
    ]);
  });

  it('mã lý do miễn phí giao vì thu rác kèm đơn là RECYCLE_PICKUP', () => {
    expect(RECYCLE_PICKUP).toBe('RECYCLE_PICKUP');
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

  it('placeOrder giữ nguyên trường thu rác kèm đơn và quà bỏ ra', async () => {
    const { http, calls } = fakeHttp();
    const body = {
      addressId: 'a1',
      paymentMethod: 'COD',
      inlinePickup: { lines: [{ itemId: 'w1', qty: 3 }], returnWeightGrams: 2000 },
      excludeGiftRedemptionIds: ['g1'],
    };
    await placeOrder(http, body, 'key-456');
    expect(calls[0]!.body).toEqual(body);
  });
});
