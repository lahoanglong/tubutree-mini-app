import { describe, expect, it } from 'vitest';
import { cardPricing, discountView, variationPricing } from './flash-price';

const flash = [{ productSlug: 'hat-dieu', variationId: 'v1', flashPrice: 119_000 }];

describe('cardPricing', () => {
  it('Giờ vàng thắng: gạch giá đang bán, không gạch giá niêm yết (một mức giảm cho cả web và Mini App)', () => {
    const p = cardPricing({ slug: 'hat-dieu', basePrice: 180_000, salePrice: 159_000 }, flash);
    expect(p).toMatchObject({ price: 119_000, isFlash: true, compareAt: 159_000, salePct: 25, flashVariationId: 'v1' });
  });

  it('không có giá giảm: không gạch', () => {
    expect(cardPricing({ slug: 'khac', basePrice: 100_000 }, flash)).toMatchObject({ price: 100_000, isFlash: false, compareAt: null, salePct: 0 });
  });

  it('giá khuyến mãi thường: gạch giá niêm yết', () => {
    expect(cardPricing({ slug: 'khac', basePrice: 100_000, salePrice: 80_000 }, [])).toMatchObject({ price: 80_000, compareAt: 100_000, salePct: 20 });
  });

  it('Giờ vàng không rẻ hơn giá đang bán thì bỏ qua nhưng vẫn nhớ phân loại', () => {
    const p = cardPricing({ slug: 'hat-dieu', basePrice: 100_000, salePrice: 90_000 }, flash.map((f) => ({ ...f, flashPrice: 95_000 })));
    expect(p).toMatchObject({ price: 90_000, isFlash: false, compareAt: 100_000, flashVariationId: 'v1' });
  });
});

describe('discountView (giá biên)', () => {
  it.each([
    ['giá 0', 0, 100_000, null, 0],
    ['giá âm', -5, 100_000, null, 0],
    ['giá NaN', NaN, 100_000, null, 0],
    ['giá gạch NaN', 50_000, NaN, null, 0],
    ['giá gạch Infinity', 50_000, Infinity, null, 0],
    ['không có giá gạch', 50_000, null, null, 0],
    ['giá gạch bằng giá bán', 50_000, 50_000, null, 0],
    ['giá gạch thấp hơn giá bán', 50_000, 40_000, null, 0],
    ['giảm 0,4% kẹp lên 1%', 99_600, 100_000, 100_000, 1],
    ['giảm 99,9% kẹp xuống 99%', 100, 100_000, 100_000, 99],
    ['giảm thường', 75_000, 100_000, 100_000, 25],
  ])('%s', (_name, price, compareAt, wantCompare, wantPct) => {
    expect(discountView(price, compareAt)).toEqual({ compareAt: wantCompare, salePct: wantPct });
  });
});

describe('variationPricing (trang chi tiết gạch giống thẻ)', () => {
  const v = { id: 'v1', retailPrice: 180_000, salePrice: 159_000 };
  it('Giờ vàng thắng: gạch giá đang bán, không gạch giá niêm yết', () => {
    expect(variationPricing(v, [{ productSlug: 'x', variationId: 'v1', flashPrice: 119_000, endAt: '2026-10-14T16:00:00.000Z' }])).toEqual({
      price: 119_000, isFlash: true, compareAt: 159_000, salePct: 25, endAt: '2026-10-14T16:00:00.000Z',
    });
  });
  it('không Giờ vàng: gạch giá niêm yết khi có khuyến mãi', () => {
    expect(variationPricing(v, [])).toMatchObject({ price: 159_000, isFlash: false, compareAt: 180_000, salePct: 12 });
  });
  it('giá bán 0: không gạch, không phần trăm', () => {
    expect(variationPricing({ id: 'v1', retailPrice: 100_000, salePrice: 0 }, [])).toMatchObject({ price: 0, compareAt: null, salePct: 0 });
  });
});
