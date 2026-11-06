import {
  COUPON_FREESHIP_ALREADY_FREE_REASON,
  COUPON_FREESHIP_FIRST_ORDER_REASON,
  COUPON_FREESHIP_NOTHING_REASON,
  COUPON_PRODUCT_FLASH_REASON,
  couponFlashExcludedNotice,
  couponFreeshipThresholdReason,
  couponFreeshipTubuPartReason,
  couponNotAppliedNotice,
  couponRejectedWithFlash,
  couponShortfallOf,
} from './coupon-notice';
import { BadRequestException } from '@nestjs/common';
import { CouponMinOrderError, CouponProductScopeError } from './coupons.service';

// Chữ khách đọc: "Giờ vàng" hoa chữ G và "mã miễn phí giao hàng", đúng tên chip `coupon.freeship` của app (thiết kế §4 Q5); "mã FREESHIP" đọc như một mã khác tên FREESHIP (review/extra-critique-2 P1 #7).
const NOTICES: [name: string, text: string][] = [
  ['không có phí giao của Tubu', COUPON_FREESHIP_NOTHING_REASON],
  ['đơn đầu', COUPON_FREESHIP_FIRST_ORDER_REASON],
  ['đã miễn phí giao', COUPON_FREESHIP_ALREADY_FREE_REASON],
  ['đạt ngưỡng', couponFreeshipThresholdReason(199_000)],
  ['kiện Tubu, đơn đầu', couponFreeshipTubuPartReason('FIRST_ORDER')],
  ['kiện Tubu, ngưỡng', couponFreeshipTubuPartReason({ threshold: 199_000 })],
  ['kiện Tubu, không nêu lý do', couponFreeshipTubuPartReason(null)],
  ['chưa áp, có Giờ vàng và combo', couponNotAppliedNotice('Đơn tối thiểu 150.000đ để dùng mã này.', true, true)],
  ['đã áp, Giờ vàng không giảm thêm', couponFlashExcludedNotice(89_000)],
  ['bị từ chối, có Giờ vàng', couponRejectedWithFlash('Đơn tối thiểu 250.000đ để dùng mã này.', 165_000)],
  ['mã gắn sản phẩm đang Giờ vàng', COUPON_PRODUCT_FLASH_REASON],
];

describe('coupon-notice: chữ khách đọc', () => {
  it('câu mã miễn phí giao nói "mã miễn phí giao hàng", không nói "mã FREESHIP"', () => {
    expect(COUPON_FREESHIP_NOTHING_REASON).toBe('Mã miễn phí giao hàng chỉ áp cho phí giao của hàng Tubu Tree giao, và đơn này không có phí giao đó.');
    expect(COUPON_FREESHIP_FIRST_ORDER_REASON).toBe('Đơn đầu đã được miễn phí giao, mã miễn phí giao hàng được giữ cho đơn sau.');
    expect(COUPON_FREESHIP_ALREADY_FREE_REASON).toBe('Đơn này đã được miễn phí giao, mã miễn phí giao hàng được giữ cho đơn sau.');
    expect(couponFreeshipThresholdReason(199_000)).toBe('Đơn từ 199.000đ đã được miễn phí giao, mã miễn phí giao hàng được giữ cho đơn sau.');
    expect(couponFreeshipTubuPartReason({ threshold: 199_000 })).toBe(
      'Phần hàng Tubu Tree giao đã được miễn phí giao (đơn từ 199.000đ), mã miễn phí giao hàng chỉ áp cho hàng Tubu Tree nên được giữ cho đơn sau.',
    );
  });

  // Một loại mã, một tên: chip của app ghi "Miễn phí giao hàng" nên câu cũng gọi "mã miễn phí giao hàng", không "mã miễn phí vận chuyển" hay "mã miễn phí giao" cụt.
  it.each(NOTICES.filter(([, text]) => /miễn phí giao/i.test(text)))('%s: gọi mã bằng đúng một tên', (_name, text) => {
    expect(text).toMatch(/[Mm]ã miễn phí giao hàng/);
    expect(text).not.toMatch(/vận chuyển/i);
    expect(text).not.toMatch(/mã miễn phí giao(?! hàng)/i);
    expect(text).not.toMatch(/miễn phí giao hàng Tubu Tree/);
  });

  it('câu về Giờ vàng viết hoa chữ G', () => {
    expect(couponNotAppliedNotice('Đơn tối thiểu 150.000đ để dùng mã này.', true, true)).toBe(
      'Mã chưa được áp dụng cho đơn này (hàng Giờ vàng và phần giảm combo không được tính vào điều kiện của mã): Đơn tối thiểu 150.000đ để dùng mã này.',
    );
    expect(couponFlashExcludedNotice(89_000)).toBe('Hàng Giờ vàng không được giảm thêm theo mã: mã chỉ tính trên 89.000đ hàng còn lại.');
    expect(couponRejectedWithFlash('Đơn tối thiểu 250.000đ để dùng mã này.', 165_000)).toBe(
      'Đơn tối thiểu 250.000đ để dùng mã này. Hàng Giờ vàng không được tính vào điều kiện của mã, phần được tính là 165.000đ.',
    );
    expect(COUPON_PRODUCT_FLASH_REASON).toBe(
      'Sản phẩm áp dụng mã đang có giá Giờ vàng. Giá Giờ vàng là giá ưu đãi cuối nên không giảm thêm theo mã, bạn dùng được mã này khi Giờ vàng kết thúc.',
    );
  });

  it.each(NOTICES)('%s: không có "FREESHIP" và không có "giờ vàng" viết thường', (_name, text) => {
    expect(text).not.toMatch(/FREESHIP/i);
    expect(text).not.toMatch(/giờ vàng/);
  });
});

describe('couponShortfallOf: số tiền còn thiếu để đạt đơn tối thiểu (W28)', () => {
  it('thiếu đơn tối thiểu: minOrder trừ phần hàng được tính', () => {
    expect(couponShortfallOf(new CouponMinOrderError(300_000, 210_000))).toBe(90_000);
  });

  it('không bao giờ âm dù base lệch lên trên minOrder', () => {
    expect(couponShortfallOf(new CouponMinOrderError(100_000, 100_000))).toBe(0);
    expect(couponShortfallOf(new CouponMinOrderError(100_000, 130_000))).toBe(0);
  });

  it('mã gắn sản phẩm: không có số (mua thêm phải là đúng các sản phẩm đó, không phải món bất kỳ)', () => {
    expect(couponShortfallOf(new CouponMinOrderError(300_000, 210_000, true))).toBeUndefined();
  });

  it('lý do khác đơn tối thiểu: không có số', () => {
    expect(couponShortfallOf(new CouponProductScopeError(['p1']))).toBeUndefined();
    expect(couponShortfallOf(new BadRequestException('Mã giảm giá đã hết hạn hoặc chưa hiệu lực.'))).toBeUndefined();
  });
});
