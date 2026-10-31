import { DEFAULT_LOVED_THRESHOLDS, isLoved, sanitizeLovedThreshold } from './catalog-loved';

describe('isLoved (nhãn "Được yêu thích")', () => {
  const ok = { ratingAvg: 4.8, reviewCount: 20, sold: 50 };

  it('đúng ngưỡng mặc định (4,8 sao, 20 đánh giá, 50 đã bán) là được yêu thích', () => {
    expect(isLoved(ok, DEFAULT_LOVED_THRESHOLDS)).toBe(true);
  });

  it('thiếu một trong ba điều kiện thì không', () => {
    expect(isLoved({ ...ok, ratingAvg: 4.7 }, DEFAULT_LOVED_THRESHOLDS)).toBe(false);
    expect(isLoved({ ...ok, reviewCount: 19 }, DEFAULT_LOVED_THRESHOLDS)).toBe(false);
    expect(isLoved({ ...ok, sold: 49 }, DEFAULT_LOVED_THRESHOLDS)).toBe(false);
  });

  it('ngưỡng cấu hình khác thì theo ngưỡng đó', () => {
    expect(isLoved({ ratingAvg: 4.5, reviewCount: 5, sold: 10 }, { minRating: 4.5, minReviews: 5, minSold: 10 })).toBe(true);
  });
});

describe('sanitizeLovedThreshold', () => {
  it('số hữu hạn trong [0, max] được giữ', () => {
    expect(sanitizeLovedThreshold(4.5, 4.8, 5)).toBe(4.5);
    expect(sanitizeLovedThreshold(0, 4.8, 5)).toBe(0);
  });

  it('chuỗi, âm, NaN, vô cực, vượt trần thì dùng mặc định (không biến mọi thẻ thành Được yêu thích)', () => {
    for (const bad of ['abc', '4.5', -1, Number.NaN, Number.POSITIVE_INFINITY, 99, null, undefined, true]) {
      expect(sanitizeLovedThreshold(bad, 4.8, 5)).toBe(4.8);
    }
  });
});
