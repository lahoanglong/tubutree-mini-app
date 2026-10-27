import { cardPriceWithFlash, cardPrices, pinnedCardPrices, representativeVariation } from './variation-order';

const v = (id: string, retailPrice: number, salePrice: number | null, stock: number, sku = id) => ({ id, sku, retailPrice, salePrice, stock });

describe('representativeVariation', () => {
  it('còn hàng, giá đang bán thấp nhất, không phải phân loại đầu danh sách', () => {
    expect(representativeVariation([v('a', 500_000, null, 3), v('b', 400_000, 250_000, 3), v('c', 300_000, null, 3)])?.id).toBe('b');
  });
  it('bỏ phân loại hết hàng; hết hàng cả thì lấy rẻ nhất', () => {
    expect(representativeVariation([v('a', 100_000, null, 0), v('b', 200_000, null, 5)])?.id).toBe('b');
    expect(representativeVariation([v('a', 200_000, null, 0), v('b', 100_000, null, 0)])?.id).toBe('b');
  });
  it('giá hoà: theo sku rồi id', () => {
    expect(representativeVariation([v('x', 100_000, null, 1, 'B'), v('y', 100_000, null, 1, 'A')])?.id).toBe('y');
  });
  it('không có phân loại: null', () => {
    expect(representativeVariation([])).toBeNull();
  });
});

describe('cardPrices (dữ liệu kiểu Pancake: Product.salePrice rỗng)', () => {
  const product = { basePrice: 180_000, salePrice: null };

  it('giá bán nằm ở phân loại: thẻ nhận giá niêm yết và giá đang bán của phân loại đó', () => {
    expect(cardPrices(product, [v('v1', 180_000, 159_000, 4), v('v2', 300_000, null, 4)])).toEqual({ basePrice: 180_000, salePrice: 159_000, repVariationId: 'v1' });
  });

  it('nhiều mức giá: thẻ lấy phân loại rẻ nhất còn hàng, khớp giá giỏ hàng tính cho phân loại mặc định', () => {
    const variations = [v('big', 300_000, null, 4), v('small', 200_000, 150_000, 4)];
    const rep = representativeVariation(variations)!;
    const card = cardPrices({ basePrice: 300_000, salePrice: null }, variations);
    expect(card).toEqual({ basePrice: 200_000, salePrice: 150_000, repVariationId: 'small' });
    expect(card.salePrice ?? card.basePrice).toBe(rep.salePrice ?? rep.retailPrice);
  });

  it('không có phân loại đang bán: giữ giá cột của sản phẩm', () => {
    expect(cardPrices({ basePrice: 100_000, salePrice: 90_000 }, [])).toEqual({ basePrice: 100_000, salePrice: 90_000 });
  });
});

describe('pinnedCardPrices (món gian hàng CTV ghim phân loại, B-140)', () => {
  const product = { basePrice: 180_000, salePrice: null };
  const variations = [v('v1', 180_000, 159_000, 4), v('v2', 300_000, 270_000, 4), v('v3', 120_000, null, 0)];

  it('ghim phân loại còn hàng: thẻ ghi giá phân loại đó, kèm id ghim', () => {
    expect(pinnedCardPrices(product, variations, 'v2')).toEqual({ basePrice: 300_000, salePrice: 270_000, repVariationId: 'v2', pinnedVariationId: 'v2' });
  });
  it('không ghim, ghim phân loại hết hàng hoặc không còn bán: về phân loại đại diện như thẻ thường', () => {
    const rep = { basePrice: 180_000, salePrice: 159_000, repVariationId: 'v1' };
    expect(pinnedCardPrices(product, variations, null)).toEqual(rep);
    expect(pinnedCardPrices(product, variations, 'v3')).toEqual(rep);
    expect(pinnedCardPrices(product, variations, 'gone')).toEqual(rep);
  });
});

describe('cardPriceWithFlash (cùng bảng ca với cardPricing ở app-core: đại diện 500g 150.000đ, 1kg 300.000đ)', () => {
  const product = { basePrice: 300_000, salePrice: null };
  const variations = [v('v-1kg', 300_000, null, 5), v('v-500', 150_000, null, 5)];
  const offer = (variationId: string, flashPrice: number, retailPrice: number, salePrice: number | null = null) => ({ variationId, flashPrice, retailPrice, salePrice });
  const kg250 = offer('v-1kg', 250_000, 300_000);
  const g500 = offer('v-500', 120_000, 150_000);
  const kg100 = offer('v-1kg', 100_000, 300_000);

  it.each([
    ['1kg trước', [kg250, g500], 120_000],
    ['500g trước', [g500, kg250], 120_000],
  ])('suất 1kg 250.000đ đắt hơn thẻ không che suất 500g 120.000đ: %s', (_n, offers, expected) => {
    expect(cardPriceWithFlash(product, variations, offers)).toBe(expected);
  });

  it.each([
    ['1kg trước', [kg100, g500]],
    ['500g trước', [g500, kg100]],
  ])('suất rẻ nhất thắng dù ở phân loại khác: %s', (_n, offers) => {
    expect(cardPriceWithFlash(product, variations, offers)).toBe(100_000);
  });

  it('cùng giá thì cùng số; không suất nào thắng hoặc không có suất: giá thẻ', () => {
    expect(cardPriceWithFlash(product, variations, [offer('v-1kg', 120_000, 300_000), g500])).toBe(120_000);
    expect(cardPriceWithFlash(product, variations, [kg250])).toBe(150_000);
    expect(cardPriceWithFlash(product, variations, [])).toBe(150_000);
    expect(cardPriceWithFlash(product, variations, undefined)).toBe(150_000);
  });

  it('suất không còn rẻ hơn giá đang bán của chính phân loại đó thì bỏ qua', () => {
    expect(cardPriceWithFlash(product, variations, [offer('v-500', 120_000, 150_000, 100_000)])).toBe(150_000);
  });
});
