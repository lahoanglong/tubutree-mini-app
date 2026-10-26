import { describe, expect, it } from 'vitest';
import { couponUseCopy, couponUseTarget } from './coupon-use';

describe('couponUseTarget', () => {
  it('giỏ có hàng → giỏ; giỏ trống hoặc chưa biết → sản phẩm', () => {
    expect(couponUseTarget(3)).toBe('cart');
    expect(couponUseTarget(1)).toBe('cart');
    expect(couponUseTarget(0)).toBe('products');
    expect(couponUseTarget(Number.NaN)).toBe('products');
  });
});

describe('couponUseCopy', () => {
  it('nhãn nút và câu báo theo đúng chữ chủ chốt', () => {
    expect(couponUseCopy.copy).toBe('Sao chép');
    expect(couponUseCopy.copied).toBe('Đã sao chép mã');
    expect(couponUseCopy.use).toBe('Dùng ngay');
    expect(couponUseCopy.copyAria('TUBU10')).toBe('Sao chép mã TUBU10');
    expect(couponUseCopy.useAria('TUBU10')).toBe('Dùng mã TUBU10 ngay');
  });
});
