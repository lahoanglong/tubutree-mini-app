import { describe, expect, it } from 'vitest';
import { couponUseCopy, couponUseOutcome, couponUseTarget } from './coupon-use';

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

describe('couponUseOutcome', () => {
  const ok = { couponCode: 'TUBU10', discount: 10_000, freeship: false, couponNotice: null };
  it('giỏ chưa có mã, hoặc áp lại cùng mã (khác hoa thường) → không báo gì', () => {
    expect(couponUseOutcome(null, 'tubu10', ok)).toEqual({ kind: 'ok' });
    expect(couponUseOutcome('tubu10', 'TUBU10', ok)).toEqual({ kind: 'ok' });
  });
  it('giỏ đang giữ mã khác → "Đã đổi sang mã …"', () => {
    expect(couponUseOutcome('FREESHIP1', 'TUBU10', ok)).toEqual({ kind: 'switched', text: 'Đã đổi sang mã TUBU10' });
  });
  it('mã giữ nhưng chưa tính giảm → nói đúng lý do của máy chủ, ưu tiên hơn "đã đổi"', () => {
    const r = couponUseOutcome('FREESHIP1', 'TUBU10', { couponCode: 'TUBU10', discount: 0, couponNotice: 'Đơn tối thiểu 300.000đ' });
    expect(r).toEqual({ kind: 'notApplied', text: 'Chưa chọn sẵn được mã: Đơn tối thiểu 300.000đ' });
  });
  it('mã freeship 0đ giảm nhưng có freeship → không coi là chưa áp', () => {
    expect(couponUseOutcome(null, 'F', { couponCode: 'F', discount: 0, freeship: true, couponNotice: 'x' })).toEqual({ kind: 'ok' });
  });
});
