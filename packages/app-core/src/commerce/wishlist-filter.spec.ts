import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { isInStock, isOnSale, wishlistFilterView, type WishlistFilterItem } from './wishlist-filter';

const item = (basePrice: number, salePrice: number | null, inStock: boolean | undefined, id = 'p'): WishlistFilterItem & { id: string } => ({
  id,
  basePrice,
  salePrice,
  inStock: inStock as boolean,
});

const MIXED = [
  item(100_000, 80_000, true, 'sale-in'),
  item(100_000, null, true, 'full-in'),
  item(100_000, 70_000, false, 'sale-out'),
  item(100_000, null, false, 'full-out'),
];

describe('isOnSale', () => {
  it('chỉ khi giá khuyến mãi dương và thấp hơn giá gốc', () => {
    expect(isOnSale({ basePrice: 100_000, salePrice: 99_000 })).toBe(true);
  });
  it.each([
    ['không có giá khuyến mãi', null],
    ['giá khuyến mãi 0', 0],
    ['giá khuyến mãi âm', -5],
    ['bằng giá gốc', 100_000],
    ['cao hơn giá gốc', 120_000],
    ['không phải số hữu hạn', Number.NaN],
  ])('không tính khi %s', (_name, salePrice) => {
    expect(isOnSale({ basePrice: 100_000, salePrice })).toBe(false);
  });
  it('giá gốc hỏng thì không tính là giảm', () => {
    expect(isOnSale({ basePrice: Number.NaN, salePrice: 50_000 })).toBe(false);
  });
});

describe('isInStock', () => {
  it('chỉ false rõ ràng mới là hết hàng; thiếu cờ coi như còn', () => {
    expect(isInStock({ inStock: true })).toBe(true);
    expect(isInStock({ inStock: false })).toBe(false);
    expect(isInStock({ inStock: undefined as unknown as boolean })).toBe(true);
  });
});

describe('wishlistFilterView', () => {
  it('ba chip theo thứ tự Tất cả, Đang giảm, Còn hàng, số đếm trên toàn danh sách, chip đang chọn đánh dấu', () => {
    const v = wishlistFilterView(MIXED, 'all');
    expect(v.chips.map((c) => [c.key, c.label, c.count, c.selected])).toEqual([
      ['all', 'Tất cả', 4, true],
      ['sale', 'Đang giảm', 2, false],
      ['inStock', 'Còn hàng', 2, false],
    ]);
    expect(v.groupAria).toBe('Lọc sản phẩm yêu thích');
    expect(v.items).toHaveLength(4);
    expect(v.empty).toBeNull();
  });

  it('số trên chip không đổi theo bộ lọc đang chọn, chỉ cờ selected đổi', () => {
    const counts = (key: 'all' | 'sale' | 'inStock') => wishlistFilterView(MIXED, key).chips.map((c) => c.count);
    expect(counts('sale')).toEqual(counts('all'));
    expect(counts('inStock')).toEqual(counts('all'));
    expect(wishlistFilterView(MIXED, 'sale').chips.map((c) => c.selected)).toEqual([false, true, false]);
  });

  it('lọc Đang giảm và Còn hàng giữ đúng món, đúng thứ tự gốc', () => {
    expect(wishlistFilterView(MIXED, 'sale').items.map((p) => p.id)).toEqual(['sale-in', 'sale-out']);
    expect(wishlistFilterView(MIXED, 'inStock').items.map((p) => p.id)).toEqual(['sale-in', 'full-in']);
  });

  it('lọc ra rỗng khi danh sách còn món: có câu báo theo bộ lọc và nút về Tất cả', () => {
    const noSale = [item(100_000, null, true), item(100_000, 100_000, true)];
    const sale = wishlistFilterView(noSale, 'sale');
    expect(sale.items).toEqual([]);
    expect(sale.empty).toEqual({ message: 'Chưa có sản phẩm đang giảm giá trong danh sách yêu thích', ctaLabel: 'Xem tất cả sản phẩm đã lưu' });

    const allOut = [item(100_000, null, false)];
    expect(wishlistFilterView(allOut, 'inStock').empty).toEqual({
      message: 'Chưa có sản phẩm còn hàng trong danh sách yêu thích',
      ctaLabel: 'Xem tất cả sản phẩm đã lưu',
    });
  });

  it('Tất cả không bao giờ rỗng khi danh sách còn món; danh sách gốc rỗng thì không có lời báo lọc', () => {
    expect(wishlistFilterView(MIXED, 'all').empty).toBeNull();
    for (const key of ['all', 'sale', 'inStock'] as const) {
      const v = wishlistFilterView([], key);
      expect(v.items).toEqual([]);
      expect(v.empty).toBeNull();
    }
  });

  it('chữ không dính thuật ngữ cấm', () => {
    const v = wishlistFilterView([item(100_000, null, true)], 'sale');
    const text = [v.groupAria, ...v.chips.map((c) => c.label), v.empty!.message, v.empty!.ctaLabel].join(' | ');
    for (const t of FORBIDDEN_TERMS) expect(text, String(t.pattern)).not.toMatch(t.pattern);
  });
});
