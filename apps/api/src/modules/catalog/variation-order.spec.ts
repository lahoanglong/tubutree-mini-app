import { cardPrices, representativeVariation } from './variation-order';

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
    expect(cardPrices(product, [v('v1', 180_000, 159_000, 4), v('v2', 300_000, null, 4)])).toEqual({ basePrice: 180_000, salePrice: 159_000 });
  });

  it('nhiều mức giá: thẻ lấy phân loại rẻ nhất còn hàng, khớp giá giỏ hàng tính cho phân loại mặc định', () => {
    const variations = [v('big', 300_000, null, 4), v('small', 200_000, 150_000, 4)];
    const rep = representativeVariation(variations)!;
    const card = cardPrices({ basePrice: 300_000, salePrice: null }, variations);
    expect(card).toEqual({ basePrice: 200_000, salePrice: 150_000 });
    expect(card.salePrice ?? card.basePrice).toBe(rep.salePrice ?? rep.retailPrice);
  });

  it('không có phân loại đang bán: giữ giá cột của sản phẩm', () => {
    expect(cardPrices({ basePrice: 100_000, salePrice: 90_000 }, [])).toEqual({ basePrice: 100_000, salePrice: 90_000 });
  });
});
