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
    const r = cardPricing({ ...product, salePrice: 70000 }, [flash()]);
    expect(r).toMatchObject({ price: 70000, isFlash: false });
  });

  it('đợt của sản phẩm khác không ảnh hưởng', () => {
    expect(cardPricing(product, [flash({ productSlug: 'khac' })])).toMatchObject({ price: 120000, isFlash: false });
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
});
