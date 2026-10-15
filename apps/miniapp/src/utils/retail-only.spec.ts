import { describe, expect, it } from 'vitest';
import type { ProductFulfiller } from '../services/shop-api';
import { isRetailOnly } from './retail-only';

describe('isRetailOnly — hàng không đặt định kỳ/mua chung (R5-CHECKOUT-8)', () => {
  const store = (kind: ProductFulfiller['kind']): ProductFulfiller => ({ kind, name: 'Mật ong Linh', shippingFee: 25_000, freeShipFrom: null });

  it.each([
    ['hàng Tubu (API cũ không trả gì)', {}, false],
    ['hàng Tubu', { fulfiller: store('TUBU'), partnerOwned: false }, false],
    ['hàng ký gửi Tubu giao hộ', { fulfiller: store('TUBU'), partnerOwned: true }, true],
    ['gian hàng tự giao', { fulfiller: store('MERCHANT') }, true],
    ['gian hàng tạm nghỉ', { fulfiller: store('UNAVAILABLE') }, true],
  ])('%s → %s', (_label, p, expected) => {
    expect(isRetailOnly(p)).toBe(expected);
  });
});
