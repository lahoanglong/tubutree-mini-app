import { describe, expect, it } from 'vitest';
import { cardPricing, discountView, flashDisplay, pickDefaultVariation, variationPricing } from './flash-price';

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

  it('Giờ vàng không rẻ hơn giá đang bán thì bỏ qua, thẻ không mang phân loại Giờ vàng', () => {
    const p = cardPricing({ slug: 'hat-dieu', basePrice: 100_000, salePrice: 90_000 }, flash.map((f) => ({ ...f, flashPrice: 95_000 })));
    expect(p).toMatchObject({ price: 90_000, isFlash: false, compareAt: 100_000 });
    expect(p.flashVariationId).toBeUndefined();
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

describe('một món, một giá ở mọi màn (B-24)', () => {
  const caGaiLeo = { slug: 'cao-ca-gai-leo', basePrice: 220_000, salePrice: null };
  const flashCaGai = [{ productSlug: 'cao-ca-gai-leo', variationId: 'v-cg', flashPrice: 165_000 }];

  it('cao cà gai leo: thẻ, chi tiết và dải Giờ vàng cùng 165.000đ, gạch 220.000đ, -25%', () => {
    expect(cardPricing(caGaiLeo, flashCaGai)).toMatchObject({ price: 165_000, compareAt: 220_000, salePct: 25, isFlash: true });
    expect(variationPricing({ id: 'v-cg', retailPrice: 220_000, salePrice: null }, flashCaGai)).toMatchObject({ price: 165_000, compareAt: 220_000, salePct: 25 });
    expect(flashDisplay({ flashPrice: 165_000, retailPrice: 220_000, salePrice: null })).toEqual({ price: 165_000, was: 220_000, pct: 25 });
  });

  it('hạt điều: dải Giờ vàng và lưới cùng gạch 159.000đ và -25%, không có -34%', () => {
    const hatDieu = { slug: 'hat-dieu', basePrice: 180_000, salePrice: 159_000 };
    const card = cardPricing(hatDieu, flash);
    const strip = flashDisplay({ flashPrice: 119_000, retailPrice: 180_000, salePrice: 159_000 });
    expect(card).toMatchObject({ price: 119_000, compareAt: 159_000, salePct: 25 });
    expect(strip).toEqual({ price: card.price, was: card.compareAt, pct: card.salePct });
  });

  it('Giờ vàng không rẻ hơn giá đang bán: mọi nơi giữ giá đang bán, không phần trăm âm', () => {
    const p = { slug: 'hat-dieu', basePrice: 180_000, salePrice: 100_000 };
    expect(cardPricing(p, flash)).toMatchObject({ price: 100_000, isFlash: false, compareAt: 180_000 });
    expect(flashDisplay({ flashPrice: 119_000, retailPrice: 180_000, salePrice: 100_000 })).toEqual({ price: 100_000, was: 100_000, pct: 0 });
  });

  it('phần trăm dải Giờ vàng kẹp 1 đến 99 như thẻ', () => {
    expect(flashDisplay({ flashPrice: 99_600, retailPrice: 100_000 }).pct).toBe(1);
    expect(flashDisplay({ flashPrice: 100, retailPrice: 100_000 }).pct).toBe(99);
  });
});

describe('dữ liệu kiểu Pancake: Product.salePrice rỗng, giá nằm ở phân loại', () => {
  const v1 = { id: 'v1', sku: 'HD-1', retailPrice: 180_000, salePrice: 159_000, stock: 10 };
  const v2 = { id: 'v2', sku: 'HD-2', retailPrice: 300_000, salePrice: null, stock: 10 };
  const variations = [v1, v2];
  /** Thẻ nhận giá của phân loại đại diện (API: cardPrices), không phải cột Product. */
  const cardOf = (vs: typeof variations) => {
    const rep = pickDefaultVariation(vs)!;
    return { slug: 'hat-dieu', basePrice: rep.retailPrice, salePrice: rep.salePrice };
  };

  it('đang bán 159.000đ, Giờ vàng 119.000đ: thẻ giống trang chi tiết, gạch 159.000đ, -25%', () => {
    const flash = [{ productSlug: 'hat-dieu', variationId: 'v1', flashPrice: 119_000, retailPrice: 180_000, salePrice: 159_000 }];
    const card = cardPricing(cardOf(variations), flash);
    expect(card).toMatchObject({ price: 119_000, isFlash: true, compareAt: 159_000, salePct: 25 });
    expect(variationPricing(v1, flash)).toMatchObject({ price: card.price, compareAt: card.compareAt, salePct: card.salePct });
  });

  it('hết Giờ vàng: thẻ ghi 159.000đ như trang chi tiết và máy chủ, gạch 180.000đ', () => {
    const card = cardPricing(cardOf(variations), []);
    expect(card).toMatchObject({ price: 159_000, isFlash: false, compareAt: 180_000 });
    expect(variationPricing(v1, [])).toMatchObject({ price: card.price, compareAt: card.compareAt, salePct: card.salePct });
  });

  it('Giờ vàng ở phân loại thứ hai (niêm yết 300.000đ, Giờ vàng 150.000đ): thẻ như dải Giờ vàng, -50%, gạch 300.000đ', () => {
    const flash = [{ productSlug: 'hat-dieu', variationId: 'v2', flashPrice: 150_000, retailPrice: 300_000, salePrice: null }];
    const card = cardPricing(cardOf(variations), flash);
    const strip = flashDisplay({ flashPrice: 150_000, retailPrice: 300_000, salePrice: null });
    expect(card).toMatchObject({ price: 150_000, isFlash: true, compareAt: 300_000, salePct: 50, flashVariationId: 'v2' });
    expect(strip).toEqual({ price: card.price, was: card.compareAt, pct: card.salePct });
    expect(variationPricing(v2, flash)).toMatchObject({ price: card.price, compareAt: card.compareAt, salePct: card.salePct });
  });

  it('Giờ vàng ở phân loại hai không rẻ hơn giá đang bán của chính nó: thẻ giữ giá phân loại đại diện', () => {
    const flash = [{ productSlug: 'hat-dieu', variationId: 'v2', flashPrice: 320_000, retailPrice: 300_000, salePrice: null }];
    const card = cardPricing(cardOf(variations), flash);
    expect(card).toMatchObject({ price: 159_000, isFlash: false, compareAt: 180_000 });
    expect(card.flashVariationId).toBeUndefined();
  });

  it('Giờ vàng ở phân loại hai rẻ hơn phân loại hai nhưng đắt hơn giá thẻ (200.000đ so với 159.000đ): thẻ giữ giá thẻ, không nhãn, trang chi tiết mở phân loại mặc định', () => {
    const flash = [{ productSlug: 'hat-dieu', variationId: 'v2', flashPrice: 200_000, retailPrice: 300_000, salePrice: null }];
    const card = cardPricing(cardOf(variations), flash);
    expect(card).toMatchObject({ price: 159_000, isFlash: false, compareAt: 180_000, salePct: 12 });
    expect(card.flashVariationId).toBeUndefined();
  });

  it('Giờ vàng ở phân loại hai rẻ hơn giá thẻ: thẻ dùng giá Giờ vàng và mang phân loại đó', () => {
    const flash = [{ productSlug: 'hat-dieu', variationId: 'v2', flashPrice: 150_000, retailPrice: 300_000, salePrice: null }];
    expect(cardPricing(cardOf(variations), flash)).toMatchObject({ price: 150_000, isFlash: true, flashVariationId: 'v2' });
  });
});

describe('pickDefaultVariation', () => {
  const mk = (id: string, retailPrice: number, salePrice: number | null, stock: number, sku = id) => ({ id, sku, retailPrice, salePrice, stock });

  it('lấy phân loại còn hàng có giá đang bán thấp nhất, không phải phân loại đầu danh sách', () => {
    expect(pickDefaultVariation([mk('a', 500_000, null, 3), mk('b', 400_000, 250_000, 3), mk('c', 300_000, null, 3)])?.id).toBe('b');
  });
  it('bỏ qua phân loại hết hàng dù rẻ nhất', () => {
    expect(pickDefaultVariation([mk('a', 100_000, null, 0), mk('b', 200_000, null, 5)])?.id).toBe('b');
  });
  it('hết hàng cả: phân loại rẻ nhất', () => {
    expect(pickDefaultVariation([mk('a', 200_000, null, 0), mk('b', 100_000, null, 0)])?.id).toBe('b');
  });
  it('giá hoà: theo sku rồi id', () => {
    expect(pickDefaultVariation([mk('x', 100_000, null, 1, 'B'), mk('y', 100_000, null, 1, 'A')])?.id).toBe('y');
  });
  it('không có phân loại: undefined', () => {
    expect(pickDefaultVariation([])).toBeUndefined();
  });
});
