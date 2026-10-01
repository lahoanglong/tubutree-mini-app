import { describe, it, expect } from 'vitest';
import { tilePricing } from './catalog-pricing';

const FLASH = { itemId: 'f1', variationId: 'v9', productSlug: 'nrc', productName: 'NRC', thumbnail: null, flashPrice: 50000, retailPrice: 100000, soldCount: 1, quota: 10, endAt: '2026-10-01T00:00:00.000Z' };

describe('tilePricing — quy tắc flash > sale > base (giống ProductCard cũ)', () => {
  it('không sale, không flash → giá gốc, 0%', () => {
    expect(tilePricing({ slug: 'x', basePrice: 100000, salePrice: null }, [])).toEqual({ price: 100000, isFlash: false, salePct: 0, flashVariationId: undefined });
  });

  it('có salePrice → giá sale, % giảm làm tròn', () => {
    expect(tilePricing({ slug: 'x', basePrice: 150000, salePrice: 120000 }, [])).toMatchObject({ price: 120000, isFlash: false, salePct: 20 });
  });

  it('flash rẻ hơn giá đang bán → thắng; mang variationId để PDP mở đúng phân loại', () => {
    expect(tilePricing({ slug: 'nrc', basePrice: 100000, salePrice: 80000 }, [FLASH])).toEqual({ price: 50000, isFlash: true, salePct: 50, flashVariationId: 'v9' });
  });

  it('flash KHÔNG rẻ hơn → giữ giá đang bán, nhưng vẫn mở đúng phân loại flash (như ProductCard cũ)', () => {
    expect(tilePricing({ slug: 'nrc', basePrice: 100000, salePrice: 40000 }, [FLASH])).toEqual({ price: 40000, isFlash: false, salePct: 60, flashVariationId: 'v9' });
  });

  it('flash của sản phẩm KHÁC không ảnh hưởng', () => {
    expect(tilePricing({ slug: 'khac', basePrice: 100000, salePrice: null }, [FLASH])).toEqual({ price: 100000, isFlash: false, salePct: 0, flashVariationId: undefined });
  });
});
