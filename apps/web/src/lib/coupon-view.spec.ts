import { describe, expect, it } from 'vitest';
import { couponExpiryLabel, couponValueLabel, isCouponEligible, sortCouponsForCart } from './coupon-view';

const base = { code: 'X', type: 'AMOUNT' as const, value: 20000, minOrder: null, maxDiscount: null, endAt: '2030-01-01T00:00:00Z' };

describe('couponValueLabel — mã này cho khách lợi gì (R2-BUYERWEB-7)', () => {
  it('giảm tiền cố định', () => {
    expect(couponValueLabel(base)).toBe('Giảm 20.000đ');
  });
  it('giảm phần trăm, kèm mức giảm tối đa khi có', () => {
    expect(couponValueLabel({ ...base, type: 'PERCENT', value: 30 })).toBe('Giảm 30%');
    expect(couponValueLabel({ ...base, type: 'PERCENT', value: 30, maxDiscount: 50000 })).toBe('Giảm 30% (tối đa 50.000đ)');
  });
  it('miễn phí vận chuyển, value > 0 là mức phí ship tối đa được giảm', () => {
    expect(couponValueLabel({ ...base, type: 'FREESHIP', value: 0 })).toBe('Miễn phí vận chuyển');
    expect(couponValueLabel({ ...base, type: 'FREESHIP', value: 30000 })).toBe('Miễn phí vận chuyển (tối đa 30.000đ)');
  });
});

describe('couponExpiryLabel', () => {
  it('hạn dùng theo ngày Việt Nam; không có hạn thì nói không thời hạn', () => {
    expect(couponExpiryLabel('2030-01-01T00:00:00Z')).toBe('HSD 01/01/2030');
    expect(couponExpiryLabel(null)).toBe('Không thời hạn');
    expect(couponExpiryLabel('không phải ngày')).toBe('Không thời hạn');
  });
});

describe('isCouponEligible / sortCouponsForCart', () => {
  const a = { ...base, code: 'A', minOrder: 500000 };
  const b = { ...base, code: 'B', minOrder: 100000 };
  const c = { ...base, code: 'C', minOrder: null };
  it('đủ điều kiện khi không đòi tối thiểu hoặc tạm tính đạt mức tối thiểu', () => {
    expect(isCouponEligible(a, 300000)).toBe(false);
    expect(isCouponEligible(a, 500000)).toBe(true);
    expect(isCouponEligible(c, 0)).toBe(true);
  });
  it('mã dùng được xếp trước mã chưa đủ điều kiện, giữ thứ tự gốc trong từng nhóm', () => {
    expect(sortCouponsForCart([a, b, c], 300000).map((x) => x.code)).toEqual(['B', 'C', 'A']);
  });
});
