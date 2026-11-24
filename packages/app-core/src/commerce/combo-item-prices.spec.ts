import { describe, expect, it } from 'vitest';
import { comboItemPrices } from './combo-item-prices';
import { comboTotals } from './shop-page';

describe('comboItemPrices', () => {
  it('chia đúng phép giỏ: giá lẻ trừ phần giảm làm tròn xuống từng món, tổng bằng comboTotal', () => {
    const prices = [89_000, 125_500, 45_999];
    const { total, comboTotal } = comboTotals(prices, 10);
    const rows = comboItemPrices(prices, 10, total, comboTotal);
    expect(rows).toEqual([
      { price: 89_000, comboPrice: 80_100 },
      { price: 125_500, comboPrice: 112_950 },
      { price: 45_999, comboPrice: 41_400 },
    ]);
    expect(rows!.reduce((s, r) => s + r.comboPrice!, 0)).toBe(comboTotal);
  });

  it('máy chủ kẹp mức giảm (comboTotal khác phép chia %): từng món chỉ có giá lẻ, không bịa giá trong bộ', () => {
    expect(comboItemPrices([100_000, 200_000], 20, 300_000, 280_000)).toEqual([
      { price: 100_000, comboPrice: null },
      { price: 200_000, comboPrice: null },
    ]);
  });

  it('dữ liệu lệch hay bộ không giảm thì null (thẻ giữ danh sách tên)', () => {
    expect(comboItemPrices([], 10, 0, 0)).toBeNull();
    expect(comboItemPrices([100_000, 50_000], 10, 160_000, 135_000)).toBeNull();
    expect(comboItemPrices([100_000, 50_000], 10, 150_000, 150_000)).toBeNull();
    expect(comboItemPrices([100_000, 50_000], 10, 150_000, 160_000)).toBeNull();
    expect(comboItemPrices([100_000, Number.NaN], 10, 150_000, 135_000)).toBeNull();
    expect(comboItemPrices([100_000, -5], 10, 99_995, 90_000)).toBeNull();
    expect(comboItemPrices([100_000.5, 50_000], 10, 150_000.5, 135_000)).toBeNull();
  });

  it('% hỏng hay không dương: không chia được tới từng món', () => {
    expect(comboItemPrices([100_000, 50_000], Number.NaN, 150_000, 135_000)!.every((r) => r.comboPrice === null)).toBe(true);
    expect(comboItemPrices([100_000, 50_000], 0, 150_000, 135_000)!.every((r) => r.comboPrice === null)).toBe(true);
  });
});
