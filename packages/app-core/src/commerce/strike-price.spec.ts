import { describe, expect, it } from 'vitest';
import { strikePrice } from '@tubutree/shared-types';
import { cardPricing, flashDisplay, variationPricing, type FlashPriceItem } from '../flash-price';
import { lineCompareAt, lineSaving } from './pdp-view';

const NOW = Date.parse('2026-11-01T06:00:00.000Z');
const END = '2026-11-01T09:00:00.000Z';

describe('strikePrice: một luật giá gạch cho thẻ, trang Giờ vàng, PDP và giỏ', () => {
  it.each([
    ['Giờ vàng thắng giá đang bán: gạch giá đang bán, không gạch giá niêm yết', 59_000, 50_000, 33_000, 50_000],
    ['Giờ vàng thắng, không có giá sale: gạch giá niêm yết (cũng là giá đang bán)', 59_000, null, 33_000, 59_000],
    ['không Giờ vàng, có giá sale: gạch giá niêm yết', 59_000, 50_000, null, 59_000],
    ['không Giờ vàng, không sale: giá niêm yết (không có gì để gạch)', 59_000, null, null, 59_000],
    ['Giờ vàng bằng giá đang bán (không thắng): gạch giá niêm yết', 59_000, 50_000, 50_000, 59_000],
    ['Giờ vàng cao hơn giá đang bán (không thắng): gạch giá niêm yết', 59_000, 50_000, 60_000, 59_000],
  ])('%s', (_name, retailPrice, salePrice, flashPrice, expected) => {
    expect(strikePrice({ retailPrice, salePrice, flashPrice })).toBe(expected);
  });

  it('thiếu salePrice/flashPrice (undefined) coi như không có', () => {
    expect(strikePrice({ retailPrice: 59_000 })).toBe(59_000);
  });
});

// Mọi nơi vẽ giá gạch của CÙNG một phân loại phải ra cùng một con số: thẻ (cardPricing), PDP (variationPricing), dải Giờ vàng
// (flashDisplay.was) và dòng giỏ (listUnitPrice = strikePrice, đọc qua lineCompareAt).
describe('thẻ = PDP = giỏ: cùng một giá gạch', () => {
  const cases: { name: string; retail: number; sale: number | null; flash: number | null }[] = [
    { name: 'Giờ vàng thắng giá sale', retail: 59_000, sale: 50_000, flash: 33_000 },
    { name: 'Giờ vàng thắng, không sale', retail: 59_000, sale: null, flash: 33_000 },
    { name: 'chỉ sale', retail: 59_000, sale: 50_000, flash: null },
    { name: 'không giảm gì', retail: 59_000, sale: null, flash: null },
    { name: 'Giờ vàng không rẻ hơn giá sale', retail: 59_000, sale: 50_000, flash: 55_000 },
  ];

  it.each(cases)('$name', ({ retail, sale, flash }) => {
    const flashItem: FlashPriceItem[] =
      flash == null ? [] : [{ productSlug: 'sp', variationId: 'v1', flashPrice: flash, retailPrice: retail, salePrice: sale, endAt: END }];
    const card = cardPricing({ slug: 'sp', basePrice: retail, salePrice: sale, repVariationId: 'v1' }, flashItem, NOW);
    const pdp = variationPricing({ id: 'v1', retailPrice: retail, salePrice: sale }, flashItem);
    const cartLine = {
      unitPrice: card.price,
      listUnitPrice: strikePrice({ retailPrice: retail, salePrice: sale, flashPrice: flash }),
      quantity: 2,
    };

    expect(pdp.price).toBe(card.price);
    expect(pdp.compareAt).toBe(card.compareAt);
    expect(lineCompareAt(cartLine)).toBe(card.compareAt);
    expect(lineSaving(cartLine)).toBe(card.compareAt == null ? 0 : (card.compareAt - card.price) * 2);
    if (flash != null) expect(flashDisplay({ flashPrice: flash, retailPrice: retail, salePrice: sale }).was).toBe(sale ?? retail);
  });
});
