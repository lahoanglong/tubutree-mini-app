import { describe, expect, it } from 'vitest';
import { couponHint, couponHintText, couponUseCopy, couponUseOutcome, couponUseTarget } from './coupon-use';

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

describe('couponHint', () => {
  const p = (code: string, over: Record<string, unknown> = {}) => ({ code, eligible: true, discount: 0, ...over });
  it('chưa có xem trước, rỗng hoặc không mã nào dùng được → null', () => {
    expect(couponHint(undefined)).toBeNull();
    expect(couponHint(null)).toBeNull();
    expect(couponHint([])).toBeNull();
    expect(couponHint([p('A', { eligible: false, reason: 'Chưa đủ đơn tối thiểu', discount: 50_000 })])).toBeNull();
  });
  it('một mã dùng được → đếm 1, tiết kiệm bằng giảm tiền hàng', () => {
    expect(couponHint([p('WELCOME30', { discount: 30_000 })])).toEqual({ count: 1, maxSaving: 30_000 });
  });
  it('nhiều mã → đếm mã dùng được, lấy mức tiết kiệm lớn nhất (giảm hàng cộng miễn phí giao), bỏ mã không dùng được', () => {
    expect(
      couponHint([
        p('A', { discount: 20_000 }),
        p('B', { discount: 15_000, freeshipSaving: 10_000 }),
        p('C', { discount: 0, freeshipSaving: 22_000 }),
        p('D', { eligible: false, discount: 999_000 }),
      ]),
    ).toEqual({ count: 3, maxSaving: 25_000 });
  });
  it('mã freeship chưa biết phí giao (giỏ, chưa có địa chỉ) → vẫn đếm, tiết kiệm 0', () => {
    expect(couponHint([p('SHIP')])).toEqual({ count: 1, maxSaving: 0 });
  });
});

describe('couponHintText', () => {
  const fmt = (n: number) => `${n}đ`;
  it('có mức tiết kiệm → "Bạn có N mã dùng được · giảm đến X"', () => {
    expect(couponHintText({ count: 2, maxSaving: 30_000 }, fmt)).toBe('Bạn có 2 mã dùng được · giảm đến 30000đ');
  });
  it('chưa biết mức tiết kiệm → chỉ nói số mã, không hứa số 0đ', () => {
    expect(couponHintText({ count: 1, maxSaving: 0 }, fmt)).toBe('Bạn có 1 mã dùng được');
  });
});
