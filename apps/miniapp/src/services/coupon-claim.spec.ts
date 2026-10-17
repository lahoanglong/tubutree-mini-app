import { describe, expect, it, vi } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(), getStorage: vi.fn(), removeStorage: vi.fn() }));

import { claimOfferLabel, readClaimParam } from './coupon-claim';

describe('readClaimParam — mã từ link thẻ QR hộp hàng (D2-03)', () => {
  it('đọc ?claim= ở search hoặc hash, chuẩn hoá chữ HOA', () => {
    expect(readClaimParam('?claim=shopee-ab12cd34', '')).toBe('SHOPEE-AB12CD34');
    expect(readClaimParam('', '#/?claim=TIKI10')).toBe('TIKI10');
    expect(readClaimParam('?utm_source=box', '#/product/a?claim=LAZ-X2Y3')).toBe('LAZ-X2Y3');
  });

  it('không có hoặc sai dạng (khoảng trắng, ký tự lạ, quá dài) → null', () => {
    expect(readClaimParam('?s=shop', '#/')).toBeNull();
    expect(readClaimParam('?claim=', '')).toBeNull();
    expect(readClaimParam('?claim=AB', '')).toBeNull();
    expect(readClaimParam('?claim=A%20B%20C', '')).toBeNull();
    expect(readClaimParam(`?claim=${'A'.repeat(65)}`, '')).toBeNull();
    expect(readClaimParam('?claim=%3Cscript%3E', '')).toBeNull();
  });
});

describe('claimOfferLabel — câu ưu đãi trên sheet', () => {
  it('giảm tiền kèm đơn tối thiểu', () => {
    expect(claimOfferLabel({ type: 'AMOUNT', value: 30000, minOrder: 99000, maxDiscount: null })).toBe('Giảm 30.000đ cho đơn từ 99.000đ');
  });
  it('giảm % kèm trần', () => {
    expect(claimOfferLabel({ type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50000 })).toBe('Giảm 10% (tối đa 50.000đ)');
  });
  it('freeship', () => {
    expect(claimOfferLabel({ type: 'FREESHIP', value: 0, minOrder: 150000, maxDiscount: null })).toBe('Miễn phí giao hàng cho đơn từ 150.000đ');
  });
});
