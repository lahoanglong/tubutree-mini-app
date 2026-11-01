import { describe, expect, it } from 'vitest';
import { autoCouponMemory, couponAutoCopy, couponHint, pickBestCoupon, couponHintShort, couponHintText, couponUseCopy, couponUseOutcome, couponUseTarget } from './coupon-use';

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

describe('couponHintShort', () => {
  it('có mức tiết kiệm → "N mã · giảm đến X" với X rút gọn (60k), vừa một dòng ở 375px', () => {
    expect(couponHintShort({ count: 6, maxSaving: 60_000 })).toBe('6 mã · giảm đến 60k');
    expect(couponHintShort({ count: 12, maxSaving: 1_500_000 })).toBe('12 mã · giảm đến 1,5tr');
  });
  it('số tiền lẻ không tròn nghìn thì ghi đủ, không làm tròn nói sai con số', () => {
    expect(couponHintShort({ count: 9, maxSaving: 123_456 })).toBe('9 mã · giảm đến 123.456đ');
  });
  it('chưa biết mức tiết kiệm → chỉ nói số mã, không hứa 0đ', () => {
    expect(couponHintShort({ count: 1, maxSaving: 0 })).toBe('1 mã dùng được');
  });
  it('luôn ngắn hơn câu đầy đủ của couponHintText', () => {
    const hint = { count: 6, maxSaving: 60_000 };
    expect(couponHintShort(hint).length).toBeLessThan(couponHintText(hint, (n) => `${n}đ`).length);
  });
});

describe('pickBestCoupon', () => {
  const pv = (code: string, discount: number, extra: Partial<{ eligible: boolean; freeshipSaving: number }> = {}) => ({
    code,
    eligible: true,
    discount,
    ...extra,
  });

  it('chọn mã tiết kiệm nhiều nhất, tính cả phí giao được miễn', () => {
    expect(pickBestCoupon([pv('A', 20_000), pv('B', 10_000, { freeshipSaving: 25_000 }), pv('C', 30_000)], [])).toBe('B');
  });

  it('hoà mức tiết kiệm thì mã hết hạn sớm hơn; không biết hạn xếp sau', () => {
    const wallet = [
      { code: 'A', endAt: '2026-12-31T00:00:00Z' },
      { code: 'B', endAt: '2026-11-30T00:00:00Z' },
    ];
    expect(pickBestCoupon([pv('A', 20_000), pv('B', 20_000), pv('Z', 20_000)], wallet)).toBe('B');
    expect(pickBestCoupon([pv('Z', 20_000), pv('A', 20_000)], wallet)).toBe('A');
  });

  it('hoà cả hạn thì theo mã để kết quả ổn định', () => {
    expect(pickBestCoupon([pv('B', 5_000), pv('A', 5_000)], [])).toBe('A');
  });

  it('bỏ mã không dùng được và mã không giảm gì', () => {
    expect(pickBestCoupon([pv('A', 50_000, { eligible: false }), pv('B', 0), pv('C', 1_000)], [])).toBe('C');
  });

  it('không mã nào dùng được, rỗng hoặc chưa có số → null', () => {
    expect(pickBestCoupon([pv('A', 50_000, { eligible: false }), pv('B', 0)], [])).toBeNull();
    expect(pickBestCoupon([], [])).toBeNull();
    expect(pickBestCoupon(null, null)).toBeNull();
  });
});

describe('couponAutoCopy', () => {
  it('nhãn theo chữ chủ chốt', () => {
    expect(couponAutoCopy.applied).toBe('Đã tự áp');
    expect(couponAutoCopy.remove).toBe('Gỡ');
  });
});

describe('autoCouponMemory', () => {
  const fake = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('nhớ mã đã tự áp và cờ đã gỡ, tách theo khách, xoá khi đặt đơn xong', () => {
    const st = fake();
    const a = autoCouponMemory(st, 'u1');
    expect(a.applied()).toBeNull();
    expect(a.off()).toBe(false);
    a.markApplied('giam30');
    expect(autoCouponMemory(st, 'u1').applied()).toBe('GIAM30');
    expect(autoCouponMemory(st, 'u2').applied()).toBeNull();
    a.markOff();
    expect(a.applied()).toBeNull();
    expect(autoCouponMemory(st, 'u1').off()).toBe(true);
    expect(autoCouponMemory(st, 'u2').off()).toBe(false);
    a.markApplied('X');
    a.clear();
    expect(a.applied()).toBeNull();
    expect(a.off()).toBe(false);
  });

  it('không có hoặc hỏng bộ nhớ → không ném lỗi, coi như chưa nhớ gì', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    for (const st of [null, undefined, broken]) {
      const a = autoCouponMemory(st, 'u1');
      expect(() => { a.markApplied('A'); a.markOff(); a.clear(); }).not.toThrow();
      expect(a.applied()).toBeNull();
      expect(a.off()).toBe(false);
    }
  });
});
