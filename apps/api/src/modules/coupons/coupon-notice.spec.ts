import {
  COUPON_FREESHIP_ALREADY_FREE_REASON,
  COUPON_FREESHIP_FIRST_ORDER_REASON,
  COUPON_PRODUCT_FLASH_REASON,
  couponFlashExcludedNotice,
  couponFreeshipThresholdReason,
  couponFreeshipTubuPartReason,
  couponNotAppliedNotice,
  couponRejectedWithFlash,
} from './coupon-notice';

// Chữ khách đọc: "Giờ vàng" hoa chữ G và "mã miễn phí giao" (thiết kế §4 Q5); "mã FREESHIP" đọc như một mã khác tên FREESHIP (review/extra-critique-2 P1 #7).
const NOTICES: [name: string, text: string][] = [
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
  it('câu mã miễn phí giao nói "mã miễn phí giao", không nói "mã FREESHIP"', () => {
    expect(COUPON_FREESHIP_FIRST_ORDER_REASON).toBe('Đơn đầu đã được miễn phí giao, mã miễn phí giao được giữ cho đơn sau.');
    expect(COUPON_FREESHIP_ALREADY_FREE_REASON).toBe('Đơn này đã được miễn phí giao, mã miễn phí giao được giữ cho đơn sau.');
    expect(couponFreeshipThresholdReason(199_000)).toBe('Đơn từ 199.000đ đã được miễn phí giao, mã miễn phí giao được giữ cho đơn sau.');
    expect(couponFreeshipTubuPartReason({ threshold: 199_000 })).toBe(
      'Phần hàng Tubu Tree giao đã được miễn phí giao (đơn từ 199.000đ), mã miễn phí giao chỉ miễn phí giao hàng Tubu Tree nên được giữ cho đơn sau.',
    );
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
