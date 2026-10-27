import { describe, expect, it } from 'vitest';
import { cardPricing, variationPricing, type FlashItem } from './flash-price';

const flash = (over: Partial<FlashItem> = {}): FlashItem => ({
  itemId: 'f1',
  variationId: 'v1',
  productSlug: 'nuoc-rua-chen',
  flashPrice: 79000,
  retailPrice: 120000,
  salePrice: null,
  soldCount: 3,
  quota: 20,
  endAt: '2026-10-14T16:00:00.000Z',
  ...over,
});

describe('cardPricing (giá thẻ sản phẩm: Giờ vàng thắng khi rẻ hơn giá đang bán, khớp giỏ và đơn)', () => {
  const product = { slug: 'nuoc-rua-chen', basePrice: 120000, salePrice: null };

  it('không có đợt Giờ vàng: giá đang bán như cũ, không nhãn', () => {
    expect(cardPricing(product, [])).toMatchObject({ price: 120000, isFlash: false, salePct: 0, hasSale: false });
    expect(cardPricing({ ...product, salePrice: 100000 }, [])).toMatchObject({ price: 100000, isFlash: false, salePct: 17, hasSale: true });
  });

  it('có đợt Giờ vàng rẻ hơn: giá Giờ vàng, giá gốc gạch, % tính trên giá gốc', () => {
    expect(cardPricing(product, [flash()])).toMatchObject({ price: 79000, isFlash: true, salePct: 34, hasSale: true, flashVariationId: 'v1' });
  });

  it('Giờ vàng chỉ thắng khi rẻ hơn giá đang bán (giá niêm yết đã hạ xuống thấp hơn thì không gắn nhãn)', () => {
    const r = cardPricing({ ...product, salePrice: 70000 }, [flash({ salePrice: 70000 })]);
    expect(r).toMatchObject({ price: 70000, isFlash: false });
  });

  it('Giờ vàng ở phân loại thứ hai (niêm yết 300.000đ, Giờ vàng 150.000đ): thẻ dùng giá của phân loại đó, như dải Giờ vàng', () => {
    const r = cardPricing({ slug: 'nuoc-rua-chen', basePrice: 180000, salePrice: null }, [flash({ variationId: 'v2', flashPrice: 150000, retailPrice: 300000, salePrice: null })]);
    expect(r).toMatchObject({ price: 150000, isFlash: true, compareAt: 300000, originalPrice: 300000, salePct: 50, flashVariationId: 'v2' });
  });

  it('đợt của sản phẩm khác không ảnh hưởng', () => {
    expect(cardPricing(product, [flash({ productSlug: 'khac' })])).toMatchObject({ price: 120000, isFlash: false });
  });

  it('Giờ vàng thắng trên sản phẩm đang giảm giá: gạch giá đang bán và % tính trên giá đó, cùng quy tắc Mini App', () => {
    const r = cardPricing({ ...product, salePrice: 100000 }, [flash({ salePrice: 100000 })]);
    expect(r).toMatchObject({ price: 79000, isFlash: true, compareAt: 100000, originalPrice: 100000, salePct: 21, hasSale: true });
  });
});

describe('variationPricing (giá từng phân loại ở trang chi tiết)', () => {
  const variation = { id: 'v1', retailPrice: 120000, salePrice: null };

  it('đúng phân loại đang giảm: giá Giờ vàng + hạn kết thúc', () => {
    expect(variationPricing(variation, [flash()])).toMatchObject({ price: 79000, isFlash: true, endAt: '2026-10-14T16:00:00.000Z' });
  });

  it('phân loại khác của cùng sản phẩm: giá thường', () => {
    expect(variationPricing({ ...variation, id: 'v2' }, [flash()])).toMatchObject({ price: 120000, isFlash: false });
  });

  it('Giờ vàng không bao giờ cao hơn giá đang niêm yết', () => {
    expect(variationPricing({ ...variation, salePrice: 60000 }, [flash()])).toMatchObject({ price: 60000, isFlash: false });
  });

  it('Giờ vàng thắng trên phân loại đang khuyến mãi: gạch giá đang bán như thẻ và Mini App', () => {
    expect(variationPricing({ ...variation, salePrice: 100000 }, [flash()])).toMatchObject({
      price: 79000, isFlash: true, originalPrice: 100000, hasSale: true, salePct: 21,
    });
  });

  it('giá biên: giá bán 0 hoặc NaN không gạch, không phần trăm', () => {
    expect(variationPricing({ ...variation, salePrice: 0 }, [])).toMatchObject({ hasSale: false, salePct: 0 });
    expect(variationPricing({ ...variation, retailPrice: NaN, salePrice: null }, [])).toMatchObject({ hasSale: false, salePct: 0 });
  });
});
