import { describe, expect, it } from 'vitest';
import { cardPricing } from './flash-price';

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
