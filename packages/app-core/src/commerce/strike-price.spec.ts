import { afterEach, describe, expect, it, vi } from 'vitest';
import { strikePrice } from '@tubutree/shared-types';
import { cardPricing, flashDisplay, variationPricing, type FlashPriceItem } from '../flash-price';
import { lineCompareAt, lineSaving } from './pdp-view';

// Bọc strikePrice bằng vi.fn giữ nguyên hành vi thật: chỉ các ca "thẻ đọc strikePrice" bên dưới tạm đổi giá trị trả về một lần.
vi.mock('@tubutree/shared-types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tubutree/shared-types')>();
  return { ...actual, strikePrice: vi.fn(actual.strikePrice) };
});

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

// Sửa luật gạch ở MỘT chỗ (strikePrice) thì thẻ phải đổi theo: nếu thẻ tự tính (standingOf) thì sửa strikePrice mà thẻ không nhúc nhích, thẻ và giỏ
// lại hiện hai giá gạch khác nhau (P1 #6 quay lại). Ép strikePrice trả 99.000 một lần: giá khách trả của thẻ vẫn như cũ, chỉ giá gạch đổi.
describe('thẻ đọc strikePrice, không tự tính', () => {
  afterEach(() => vi.mocked(strikePrice).mockClear());

  const cases: { name: string; retail: number; sale: number | null; flash: number | null; flashHasRetail: boolean; price: number }[] = [
    { name: 'Giờ vàng thắng giá sale', retail: 59_000, sale: 50_000, flash: 33_000, flashHasRetail: true, price: 33_000 },
    { name: 'Giờ vàng thắng, không sale', retail: 59_000, sale: null, flash: 33_000, flashHasRetail: true, price: 33_000 },
    { name: 'suất Giờ vàng không mang giá niêm yết: rơi về giá của thẻ', retail: 59_000, sale: 50_000, flash: 33_000, flashHasRetail: false, price: 33_000 },
    { name: 'chỉ sale', retail: 59_000, sale: 50_000, flash: null, flashHasRetail: true, price: 50_000 },
    { name: 'không giảm gì', retail: 59_000, sale: null, flash: null, flashHasRetail: true, price: 59_000 },
    { name: 'Giờ vàng không rẻ hơn giá sale', retail: 59_000, sale: 50_000, flash: 55_000, flashHasRetail: true, price: 50_000 },
  ];

  it.each(cases)('$name', ({ retail, sale, flash, flashHasRetail, price }) => {
    const items: FlashPriceItem[] =
      flash == null
        ? []
        : [{ productSlug: 'sp', variationId: 'v1', flashPrice: flash, ...(flashHasRetail ? { retailPrice: retail, salePrice: sale } : {}), endAt: END }];
    const product = { slug: 'sp', basePrice: retail, salePrice: sale, repVariationId: 'v1' };
    const wins = flash != null && flash < (sale ?? retail);

    vi.mocked(strikePrice).mockReturnValueOnce(99_000);
    const card = cardPricing(product, items, NOW);

    expect(card.compareAt, 'giá gạch của thẻ phải là số strikePrice trả').toBe(99_000);
    expect(card.price, 'giá khách trả không đổi theo giá gạch').toBe(price);
    expect(card.isFlash).toBe(wins);
    expect(vi.mocked(strikePrice)).toHaveBeenCalledWith({ retailPrice: retail, salePrice: sale, flashPrice: wins ? flash : undefined });
  });

  it('PDP (variationPricing) cũng đọc strikePrice: cùng một nguồn với thẻ', () => {
    vi.mocked(strikePrice).mockReturnValueOnce(99_000);
    const pdp = variationPricing(
      { id: 'v1', retailPrice: 59_000, salePrice: 50_000 },
      [{ productSlug: 'sp', variationId: 'v1', flashPrice: 33_000, retailPrice: 59_000, salePrice: 50_000, endAt: END }],
    );
    expect(pdp.compareAt).toBe(99_000);
    expect(pdp.price).toBe(33_000);
  });
});
