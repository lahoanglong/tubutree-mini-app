import { describe, expect, it } from 'vitest';
import { checkoutMarketplacePoints, convertedPointsNote, gardenPoints, lockedPointsLabel, marketplaceExcludedNote, marketplacePointsNote, pointsSummary, usableShopPoints } from './points-lots';

describe('pointsSummary / convertedPointsNote / lockedPointsLabel (R-163: một luật cho web và Mini)', () => {
  it('tổng = lô thường + lô quy đổi', () => {
    expect(pointsSummary({ pointsBalance: 120, pointsConvertedBalance: 40 })).toEqual({ standard: 120, converted: 40, marketplace: 0, total: 160 });
  });
  it('thiếu lô quy đổi → 0; số âm, NaN, vô cực → 0', () => {
    expect(pointsSummary({ pointsBalance: 120 })).toEqual({ standard: 120, converted: 0, marketplace: 0, total: 120 });
    expect(pointsSummary({ pointsBalance: -5, pointsConvertedBalance: -1 })).toEqual({ standard: 0, converted: 0, marketplace: 0, total: 0 });
    expect(pointsSummary({ pointsBalance: Number.NaN, pointsConvertedBalance: Number.POSITIVE_INFINITY })).toEqual({ standard: 0, converted: 0, marketplace: 0, total: 0 });
  });
  it('W42: tổng gồm lô điểm sàn; lô sàn âm hoặc rác → 0', () => {
    expect(pointsSummary({ pointsBalance: 120, pointsConvertedBalance: 40, pointsMarketplaceBalance: 10_000 })).toEqual({
      standard: 120,
      converted: 40,
      marketplace: 10_000,
      total: 10_160,
    });
    expect(pointsSummary({ pointsBalance: 1, pointsMarketplaceBalance: -3 })).toEqual({ standard: 1, converted: 0, marketplace: 0, total: 1 });
    expect(pointsSummary({ pointsBalance: 1, pointsMarketplaceBalance: Number.NaN })).toEqual({ standard: 1, converted: 0, marketplace: 0, total: 1 });
  });
  it('W42: ghi chú điểm sàn chỉ dùng khi mua hàng; không có điểm sàn thì null', () => {
    expect(marketplacePointsNote(10_000)).toBe('trong đó 10.000 điểm từ đơn sàn chỉ dùng khi mua hàng');
    expect(marketplacePointsNote(0)).toBeNull();
    expect(marketplacePointsNote(undefined)).toBeNull();
    expect(marketplacePointsNote(null)).toBeNull();
  });
  it('câu dưới vòng quay / quỹ trồng cây: số điểm sàn không dùng ở đó, có dấu nghìn; không có thì null', () => {
    expect(marketplaceExcludedNote(1_250)).toBe('1.250 điểm từ đơn sàn chỉ dùng khi mua hàng');
    expect(marketplaceExcludedNote(0)).toBeNull();
    expect(marketplaceExcludedNote(-1)).toBeNull();
    expect(marketplaceExcludedNote(undefined)).toBeNull();
  });
  it('gardenPoints: số máy chủ thắng; API cũ thì vòng quay = lô thường, quỹ = thường + quy đổi, không bao giờ gồm điểm sàn', () => {
    expect(gardenPoints(null)).toEqual({ wheel: null, fund: null, marketplaceNote: null });
    expect(gardenPoints({ pointsBalance: 500, pointsConvertedBalance: 100, pointsMarketplaceBalance: 1_250 })).toEqual({
      wheel: 500,
      fund: 600,
      marketplaceNote: '1.250 điểm từ đơn sàn chỉ dùng khi mua hàng',
    });
    expect(gardenPoints({ pointsBalance: 500, redeemablePoints: 200, redeemableTotal: 300, pointsMarketplaceBalance: 0 })).toEqual({
      wheel: 200,
      fund: 300,
      marketplaceNote: null,
    });
  });
  it('ghi chú phần không hết hạn có dấu nghìn; không có điểm quy đổi thì null', () => {
    expect(convertedPointsNote(1_250)).toBe('trong đó 1.250 điểm không hết hạn');
    expect(convertedPointsNote(0)).toBeNull();
    expect(convertedPointsNote(undefined)).toBeNull();
    expect(convertedPointsNote(null)).toBeNull();
  });
  it('nhãn ô khoá chỉ ghi tổng số dư', () => {
    expect(lockedPointsLabel(500)).toBe('Bạn đang có 500 điểm');
    expect(lockedPointsLabel(1800)).toBe('Bạn đang có 1.800 điểm');
    expect(lockedPointsLabel(0)).toBe('Bạn đang có 0 điểm');
  });
});

describe('checkoutMarketplacePoints (W43: dòng điểm từ đơn sàn trong ô Điểm Xanh thanh toán)', () => {
  it('chưa tick: đúng pointsMaxMarketplace của báo giá (máy chủ đã kẹp trần chung với lô thường)', () => {
    // 100.000đ hàng, trần 20%, 30.000 điểm sàn, 50.000 điểm quy đổi: pointsMax 70.000 nhưng phần sàn chỉ 20.000.
    expect(checkoutMarketplacePoints({ quote: { pointsMaxMarketplace: 20_000, pointsUsedMarketplace: 0 }, applied: false })).toBe(20_000);
  });

  it('đã tick: đúng pointsUsedMarketplace', () => {
    expect(checkoutMarketplacePoints({ quote: { pointsMaxMarketplace: 20_000, pointsUsedMarketplace: 20_000 }, applied: true })).toBe(20_000);
    expect(checkoutMarketplacePoints({ quote: { pointsMaxMarketplace: 20_000, pointsUsedMarketplace: 0 }, applied: true })).toBeNull();
  });

  it('chưa có báo giá, API cũ chưa trả số, 0 hay số rác: null (không đoán từ số dư)', () => {
    expect(checkoutMarketplacePoints({ quote: undefined, applied: false })).toBeNull();
    expect(checkoutMarketplacePoints({ quote: null, applied: true })).toBeNull();
    expect(checkoutMarketplacePoints({ quote: {}, applied: false })).toBeNull();
    expect(checkoutMarketplacePoints({ quote: { pointsMaxMarketplace: 0 }, applied: false })).toBeNull();
    expect(checkoutMarketplacePoints({ quote: { pointsMaxMarketplace: Number.NaN }, applied: false })).toBeNull();
    expect(checkoutMarketplacePoints({ quote: { pointsMaxMarketplace: -3 }, applied: false })).toBeNull();
    expect(checkoutMarketplacePoints({ quote: { pointsMaxMarketplace: 1_250.7 }, applied: false })).toBe(1_250);
  });
});

describe('usableShopPoints (W44: nút "Dùng {n} Điểm Xanh đang có" của web /quet-ma, cùng luật checkoutPoints của Mini)', () => {
  it('chưa có số liệu: null', () => {
    expect(usableShopPoints(undefined)).toBeNull();
    expect(usableShopPoints(null)).toBeNull();
  });
  it('lô thường trừ phần khoá chờ đổi trả, cộng nguyên lô quy đổi và lô điểm sàn', () => {
    expect(usableShopPoints({ pointsBalance: 1000, pointsConvertedBalance: 200, pointsMarketplaceBalance: 300, redeemablePoints: 700 })).toBe(1200);
    expect(usableShopPoints({ pointsBalance: 1000, lockedPoints: 400 })).toBe(600);
    expect(usableShopPoints({ pointsBalance: 1200 })).toBe(1200);
  });
  it('số rác hay khoá vượt số dư: không âm', () => {
    expect(usableShopPoints({ pointsBalance: 100, lockedPoints: 500 })).toBe(0);
    expect(usableShopPoints({ pointsBalance: Number.NaN, pointsMarketplaceBalance: -5 })).toBe(0);
  });
});
