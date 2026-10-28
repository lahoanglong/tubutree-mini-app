import { describe, expect, it } from 'vitest';
import { pointsOfferText } from './points-offer';

describe('pointsOfferText', () => {
  it('chưa bật: ước theo số dùng được', () => {
    expect(pointsOfferText(1200, undefined)).toBe('Dùng 1.200 điểm, giảm 1.200đ');
  });
  it('chưa bật: kẹp theo trần của đơn', () => {
    expect(pointsOfferText(5000, { pointsMax: 800 })).toBe('Dùng 800 điểm, giảm 800đ');
  });
  it('đã bật: lấy số thật của báo giá', () => {
    expect(pointsOfferText(5000, { pointsMax: 800 }, { pointsUsed: 700, pointsDiscount: 700 })).toBe('Dùng 700 điểm, giảm 700đ');
  });
});
