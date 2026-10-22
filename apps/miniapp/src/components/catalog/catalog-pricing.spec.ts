import { describe, it, expect } from 'vitest';
import { flashDisplay, tilePricing } from './catalog-pricing';

const FLASH = { itemId: 'f1', variationId: 'v9', productSlug: 'nrc', productName: 'NRC', thumbnail: null, flashPrice: 50000, retailPrice: 100000, soldCount: 1, quota: 10, endAt: '2026-10-01T00:00:00.000Z' };

describe('tilePricing — quy tắc flash > sale > base (giống ProductCard cũ)', () => {
  it('không sale, không flash → giá gốc, 0%', () => {
    expect(tilePricing({ slug: 'x', basePrice: 100000, salePrice: null }, [])).toEqual({ price: 100000, isFlash: false, salePct: 0, compareAt: null, flashVariationId: undefined });
  });

  it('có salePrice → giá sale, % giảm làm tròn', () => {
    expect(tilePricing({ slug: 'x', basePrice: 150000, salePrice: 120000 }, [])).toMatchObject({ price: 120000, isFlash: false, salePct: 20, compareAt: 150000 });
  });

  it('flash rẻ hơn giá đang bán → thắng; mang variationId để PDP mở đúng phân loại', () => {
    expect(tilePricing({ slug: 'nrc', basePrice: 100000, salePrice: 80000 }, [FLASH])).toEqual({ price: 50000, isFlash: true, salePct: 38, compareAt: 80000, flashVariationId: 'v9' });
  });

  it('flash KHÔNG rẻ hơn → giữ giá đang bán, nhưng vẫn mở đúng phân loại flash (như ProductCard cũ)', () => {
    expect(tilePricing({ slug: 'nrc', basePrice: 100000, salePrice: 40000 }, [FLASH])).toEqual({ price: 40000, isFlash: false, salePct: 60, compareAt: 100000, flashVariationId: 'v9' });
  });

  it('flash của sản phẩm KHÁC không ảnh hưởng', () => {
    expect(tilePricing({ slug: 'khac', basePrice: 100000, salePrice: null }, [FLASH])).toEqual({ price: 100000, isFlash: false, salePct: 0, compareAt: null, flashVariationId: undefined });
  });
});

describe('giờ vàng: thẻ SP và dải trang chủ cùng một mốc so sánh (U1-B05)', () => {
  // Hạt điều: giá niêm yết 180.000đ, đang bán 159.000đ, giờ vàng 119.000đ.
  const product = { slug: 'hat-dieu', basePrice: 180000, salePrice: 159000 };
  const strip = { flashPrice: 119000, retailPrice: 180000, salePrice: 159000 };
  const flash = [{ ...FLASH, productSlug: 'hat-dieu', variationId: 'v1', ...strip }];

  it('cùng dữ liệu → cùng giá, cùng giá gạch (giá đang bán trước giờ vàng) và cùng %', () => {
    const tile = tilePricing(product, flash);
    const row = flashDisplay(strip);
    expect(row).toEqual({ price: 119000, was: 159000, pct: 25 });
    expect({ price: tile.price, was: tile.compareAt, pct: tile.salePct }).toEqual(row);
  });

  it('không có salePrice → mốc so sánh là giá niêm yết ở cả hai nơi', () => {
    const tile = tilePricing({ slug: 'hat-dieu', basePrice: 180000, salePrice: null }, [{ ...flash[0]!, salePrice: null }]);
    const row = flashDisplay({ ...strip, salePrice: null });
    expect({ price: tile.price, was: tile.compareAt, pct: tile.salePct }).toEqual(row);
    expect(row.was).toBe(180000);
  });

  it('flash không rẻ hơn giá đang bán → hai nơi cùng hiện giá đang bán, không % âm', () => {
    const tile = tilePricing(product, [{ ...flash[0]!, flashPrice: 170000 }]);
    const row = flashDisplay({ ...strip, flashPrice: 170000 });
    expect(tile).toMatchObject({ price: 159000, isFlash: false, compareAt: 180000, salePct: 12 });
    expect(row).toEqual({ price: 159000, was: 159000, pct: 0 });
  });
});
