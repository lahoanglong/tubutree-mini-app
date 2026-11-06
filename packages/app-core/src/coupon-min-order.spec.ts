import { describe, expect, it } from 'vitest';
import { couponMinOrderCopy, couponNoticeText, heldCouponNotice, rememberRemovedCoupon, removedCouponNotice, type RemovedCouponMemory } from './coupon-min-order';

const fmt = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

describe('heldCouponNotice: mã giữ trong giỏ nhưng chưa áp vì thiếu đơn tối thiểu', () => {
  const held = {
    couponCode: 'MIN200',
    discount: 0,
    freeship: false,
    couponNotice: 'Mã chưa được áp dụng cho đơn này: Đơn tối thiểu 200.000đ để dùng mã này.',
    couponShortfall: 110_000,
  };

  it('nối số tiền cần mua thêm vào câu lý do của máy chủ', () => {
    expect(heldCouponNotice(held, fmt)).toBe(`${held.couponNotice} Mua thêm 110.000đ để áp mã MIN200.`);
  });

  it('không có số thiếu (lý do khác đơn tối thiểu, mã gắn sản phẩm, API cũ): giữ nguyên câu của máy chủ', () => {
    expect(heldCouponNotice({ ...held, couponShortfall: undefined }, fmt)).toBe(held.couponNotice);
    expect(heldCouponNotice({ ...held, couponShortfall: null }, fmt)).toBe(held.couponNotice);
    expect(heldCouponNotice({ ...held, couponShortfall: 0 }, fmt)).toBe(held.couponNotice);
  });

  it('mã đã giảm tiền hoặc đã miễn phí giao: không báo mã chưa áp, không nói mua thêm', () => {
    expect(heldCouponNotice({ ...held, discount: 20_000 }, fmt)).toBeNull();
    expect(heldCouponNotice({ ...held, freeship: true }, fmt)).toBeNull();
  });

  it('giỏ không giữ mã hoặc không có lời báo: không có gì để nói', () => {
    expect(heldCouponNotice({ ...held, couponCode: null }, fmt)).toBeNull();
    expect(heldCouponNotice({ ...held, couponNotice: null, couponShortfall: undefined }, fmt)).toBeNull();
    expect(heldCouponNotice(null, fmt)).toBeNull();
    expect(heldCouponNotice(undefined, fmt)).toBeNull();
  });

  it('lời báo mất nhưng còn số thiếu (không xảy ra với máy chủ hiện tại): vẫn nói mua thêm bao nhiêu', () => {
    expect(heldCouponNotice({ ...held, couponNotice: null }, fmt)).toBe('Mua thêm 110.000đ để áp mã MIN200.');
  });
});

describe('couponNoticeText: chữ lời báo mã ở giỏ và thanh toán', () => {
  it('mã đang giữ chưa áp: câu lý do kèm số cần mua thêm', () => {
    expect(
      couponNoticeText({ couponCode: 'MIN200', discount: 0, couponNotice: 'Mã chưa được áp dụng cho đơn này: Đơn tối thiểu 200.000đ để dùng mã này.', couponShortfall: 110_000 }, fmt),
    ).toBe('Mã chưa được áp dụng cho đơn này: Đơn tối thiểu 200.000đ để dùng mã này. Mua thêm 110.000đ để áp mã MIN200.');
  });

  it('mã đã giảm tiền mà máy chủ vẫn có lời báo (Giờ vàng không giảm thêm): giữ nguyên câu của máy chủ, không thêm gì', () => {
    const flash = 'Hàng Giờ vàng không được giảm thêm theo mã: mã chỉ tính trên 89.000đ hàng còn lại.';
    expect(couponNoticeText({ couponCode: 'GIAM10', discount: 8_900, couponNotice: flash }, fmt)).toBe(flash);
  });

  it('không có lời báo, hoặc không có giỏ: null', () => {
    expect(couponNoticeText({ couponCode: 'GIAM10', discount: 8_900, couponNotice: null }, fmt)).toBeNull();
    expect(couponNoticeText(undefined, fmt)).toBeNull();
    expect(couponNoticeText(null, fmt)).toBeNull();
  });

  it('API cũ (không có couponShortfall): giữ nguyên câu của máy chủ', () => {
    expect(couponNoticeText({ couponCode: 'MIN200', discount: 0, couponNotice: 'Mã chưa được áp dụng cho đơn này: x' }, fmt)).toBe('Mã chưa được áp dụng cho đơn này: x');
  });
});

describe('rememberRemovedCoupon: nhớ mã vừa bị máy chủ gỡ vì giỏ rơi dưới đơn tối thiểu', () => {
  const removed = { code: 'MIN300', reason: 'Đơn tối thiểu 300.000đ để dùng mã này.', shortfall: 90_000 };

  it('máy chủ báo vừa gỡ mã: ghi nhớ kèm tổng giỏ lúc gỡ', () => {
    expect(rememberRemovedCoupon(null, { couponCode: null, couponRemoved: removed, subtotal: 210_000 })).toEqual({ ...removed, subtotal: 210_000 });
  });

  it('lần đọc giỏ sau không còn couponRemoved (máy chủ chỉ báo một lần): giữ lời báo cũ', () => {
    const prev: RemovedCouponMemory = { ...removed, subtotal: 210_000 };
    expect(rememberRemovedCoupon(prev, { couponCode: null, couponRemoved: null, subtotal: 210_000 })).toBe(prev);
    expect(rememberRemovedCoupon(prev, { couponCode: null, subtotal: 260_000 })).toBe(prev);
  });

  it('giỏ lại có mã (khách áp lại hay áp mã khác): hết cần nhắc', () => {
    const prev: RemovedCouponMemory = { ...removed, subtotal: 210_000 };
    expect(rememberRemovedCoupon(prev, { couponCode: 'GIAM10', couponRemoved: null, subtotal: 310_000 })).toBeNull();
  });

  it('giỏ trống: hết cần nhắc', () => {
    const prev: RemovedCouponMemory = { ...removed, subtotal: 210_000 };
    expect(rememberRemovedCoupon(prev, { couponCode: null, couponRemoved: null, subtotal: 0 })).toBeNull();
    expect(rememberRemovedCoupon(null, { couponCode: null, couponRemoved: removed, subtotal: 0 })).toBeNull();
  });

  it('gỡ lần hai (mã khác): thay lời báo cũ', () => {
    const prev: RemovedCouponMemory = { ...removed, subtotal: 210_000 };
    const next = { code: 'MIN500', reason: 'Đơn tối thiểu 500.000đ để dùng mã này.', shortfall: 380_000 };
    expect(rememberRemovedCoupon(prev, { couponCode: null, couponRemoved: next, subtotal: 120_000 })).toEqual({ ...next, subtotal: 120_000 });
  });

  it('chưa nhớ gì và giỏ chưa có mã gỡ: vẫn không có gì', () => {
    expect(rememberRemovedCoupon(null, { couponCode: null, subtotal: 100_000 })).toBeNull();
  });
});

describe('removedCouponNotice: lời báo mã đã bị gỡ', () => {
  const mem: RemovedCouponMemory = { code: 'MIN300', reason: 'Đơn tối thiểu 300.000đ để dùng mã này.', shortfall: 90_000, subtotal: 210_000 };

  it('nói mã nào đã gỡ và còn thiếu bao nhiêu', () => {
    expect(removedCouponNotice(mem, 210_000, fmt)).toEqual({
      code: 'MIN300',
      text: 'Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 90.000đ để dùng lại.',
    });
  });

  it('khách mua thêm sau khi mã bị gỡ: số thiếu giảm theo tổng giỏ', () => {
    expect(removedCouponNotice(mem, 250_000, fmt)?.text).toBe('Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 50.000đ để dùng lại.');
  });

  it('khách bỏ bớt hàng sau khi mã bị gỡ: số thiếu tăng theo', () => {
    expect(removedCouponNotice(mem, 180_000, fmt)?.text).toBe('Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 120.000đ để dùng lại.');
  });

  it('giỏ đã đủ trở lại: mời chọn lại mã, không còn nói mua thêm', () => {
    expect(removedCouponNotice(mem, 300_000, fmt)?.text).toBe('Giỏ đã đủ đơn tối thiểu của mã MIN300. Bấm Chọn mã để dùng lại.');
    expect(removedCouponNotice(mem, 340_000, fmt)?.text).toBe('Giỏ đã đủ đơn tối thiểu của mã MIN300. Bấm Chọn mã để dùng lại.');
  });

  it('mã bị gỡ vì lý do khác đơn tối thiểu (hết hạn, bị tắt): nói đúng lý do của máy chủ', () => {
    const other: RemovedCouponMemory = { code: 'TAT50', reason: 'Mã giảm giá đã ngừng áp dụng.', subtotal: 210_000 };
    expect(removedCouponNotice(other, 210_000, fmt)).toEqual({ code: 'TAT50', text: 'Đã gỡ mã TAT50: Mã giảm giá đã ngừng áp dụng.' });
  });

  it('không nhớ gì thì không có lời báo', () => {
    expect(removedCouponNotice(null, 210_000, fmt)).toBeNull();
  });
});

describe('couponMinOrderCopy: chữ cố định', () => {
  it('nút đóng có nhãn đọc được', () => {
    expect(couponMinOrderCopy.dismiss).toBe('Đóng');
    expect(couponMinOrderCopy.dismissAria('MIN300')).toBe('Đóng lời báo mã MIN300 đã gỡ');
  });
});
