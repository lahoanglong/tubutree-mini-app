import { describe, expect, it } from 'vitest';
import { redemptionCouponLine } from './redemption-coupon';

const NOW = new Date('2026-10-28T10:00:00Z');

describe('redemptionCouponLine — dòng phụ mã giảm giá ở Quà của tôi', () => {
  it('còn hạn và chưa dùng: "Mã X · HSD dd/mm" theo giờ Việt Nam, bấm được', () => {
    expect(redemptionCouponLine({ couponCode: 'REWARD-A', couponEndAt: '2026-11-16T10:00:00Z', couponUsed: false }, NOW)).toEqual({
      text: 'Mã REWARD-A · HSD 16/11',
      usable: true,
    });
    // 20:00Z ngày 15 là 03:00 ngày 16 giờ Việt Nam
    expect(redemptionCouponLine({ couponCode: 'A', couponEndAt: '2026-11-15T20:00:00Z' }, NOW).text).toBe('Mã A · HSD 16/11');
  });

  it('đã dùng: "Đã dùng", không bấm được (đứng trước hết hạn)', () => {
    expect(redemptionCouponLine({ couponCode: 'REWARD-B', couponEndAt: '2026-09-01T00:00:00Z', couponUsed: true }, NOW)).toEqual({
      text: 'Mã REWARD-B · Đã dùng',
      usable: false,
    });
  });

  it('quá hạn chưa dùng: "Hết hạn", không bấm được', () => {
    expect(redemptionCouponLine({ couponCode: 'REWARD-C', couponEndAt: '2026-10-27T00:00:00Z', couponUsed: false }, NOW)).toEqual({
      text: 'Mã REWARD-C · Hết hạn',
      usable: false,
    });
  });

  it('mã đã bị dọn khỏi hệ thống: nói đã dùng hoặc hết hạn, không bấm được', () => {
    expect(redemptionCouponLine({ couponCode: null }, NOW)).toEqual({ text: 'Mã đã dùng hoặc hết hạn', usable: false });
  });

  it('bản API cũ chưa trả hạn: chỉ ghi mã, vẫn bấm được', () => {
    expect(redemptionCouponLine({ couponCode: 'OLD' }, NOW)).toEqual({ text: 'Mã OLD', usable: true });
  });
});
