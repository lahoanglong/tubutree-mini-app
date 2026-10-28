import { describe, expect, it } from 'vitest';
import { pointsOfferText } from './points-offer';

describe('pointsOfferText', () => {
  it('chưa có báo giá: chỉ nói số điểm dùng được (không phải số dư), không hứa số tiền giảm', () => {
    expect(pointsOfferText(1200, undefined)).toBe('Dùng được 1.200 điểm');
    expect(pointsOfferText(50000, {})).toBe('Dùng được 50.000 điểm');
  });
  it('chưa bật, có trần của đơn: ước theo số dùng được', () => {
    expect(pointsOfferText(1200, { pointsMax: 5000 })).toBe('Dùng 1.200 điểm, giảm 1.200đ');
  });
  it('chưa bật: kẹp theo trần của đơn', () => {
    expect(pointsOfferText(5000, { pointsMax: 800 })).toBe('Dùng 800 điểm, giảm 800đ');
  });
  it('đã bật: lấy số thật của báo giá', () => {
    expect(pointsOfferText(5000, { pointsMax: 800 }, { pointsUsed: 700, pointsDiscount: 700 })).toBe('Dùng 700 điểm, giảm 700đ');
  });
  it('tỉ giá quy đổi lấy từ cấu hình: 1 điểm = 1.000đ', () => {
    expect(pointsOfferText(1200, { pointsMax: 5000 }, null, 1000)).toBe('Dùng 1.200 điểm, giảm 1.200.000đ');
  });
});
