import { describe, expect, it } from 'vitest';
import { composeHomeShelves, seeAllHref, type ShelfEntry } from './home-shelves';

const e = <T,>(id: string, item: T): ShelfEntry<T> => ({ id, item });
const ids = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => e(`${prefix}${i}`, `${prefix}${i}`));
const none = { flash: [], purchased: [], combos: [], bestSellers: [] };

describe('composeHomeShelves', () => {
  it('món ở Giờ vàng và Bán chạy chỉ hiện ở Giờ vàng (hạng cao nhất)', () => {
    const r = composeHomeShelves({
      ...none,
      flash: ids(3, 'a'),
      bestSellers: [e('a0', 'a0'), ...ids(5, 'b')],
    });
    expect(r.flash).toEqual(['a0', 'a1', 'a2']);
    expect(r.bestSellers).not.toContain('a0');
    expect(r.bestSellers).toHaveLength(5);
  });

  it('Giờ vàng dưới 3 món thì ẩn và KHÔNG chiếm món: các món đó còn hiện ở Bán chạy nhất', () => {
    const r = composeHomeShelves({ ...none, flash: ids(2, 'a'), bestSellers: [e('a0', 'a0'), e('a1', 'a1'), e('b0', 'b0')] });
    expect(r.flash).toEqual([]);
    expect(r.bestSellers).toEqual(['a0', 'a1', 'b0']);
    expect(r.seen.has('a0')).toBe(true);
  });

  it('Bán chạy nhất cắt 10 món; còn dưới 3 món sau chống trùng thì ẩn', () => {
    expect(composeHomeShelves({ ...none, bestSellers: ids(12) }).bestSellers).toHaveLength(10);
    const r = composeHomeShelves({ ...none, purchased: [e('p0', 'p0'), e('p1', 'p1')], bestSellers: ids(4) });
    expect(r.bestSellers).toEqual([]);
  });

  it('Mua lại một món vẫn hiện (sàn 1); Mua lại thắng Bán chạy nhất', () => {
    const r = composeHomeShelves({ ...none, purchased: [e('p0', 'mua')], bestSellers: ids(5) });
    expect(r.purchased).toEqual(['mua']);
    expect(r.bestSellers).toHaveLength(4);
  });

  it('`seen` là hợp mọi kệ còn hiện, để Gợi ý hôm nay loại trùng', () => {
    const r = composeHomeShelves({ ...none, flash: ids(3, 'a'), purchased: ids(1, 'm'), bestSellers: ids(3, 'b') });
    expect([...r.seen].sort()).toEqual(['a0', 'a1', 'a2', 'b0', 'b1', 'b2', 'm0']);
  });

  it('mọi kệ rỗng: không lỗi, `seen` rỗng', () => {
    const r = composeHomeShelves(none);
    expect(r.flash).toEqual([]);
    expect(r.seen.size).toBe(0);
  });

  it('giữ nguyên kiểu phần tử của từng kệ', () => {
    const r = composeHomeShelves({ ...none, flash: [e('x', { itemId: 1 }), e('y', { itemId: 2 }), e('z', { itemId: 3 })] });
    expect(r.flash[1]).toEqual({ itemId: 2 });
  });
});

describe('seeAllHref', () => {
  it('lấy ở SHELVES và đi qua liveRoute', () => {
    expect(seeAllHref('home.bestSellers')).toBe('/best-sellers');
    expect(seeAllHref('home.bestSellers', 'web')).toBe('/ban-chay');
    expect(seeAllHref('browse.bestSellers')).toBe('/best-sellers');
    expect(seeAllHref('home.purchased')).toBe('/orders');
    expect(seeAllHref('home.purchased', 'web')).toBe('/tai-khoan/don-hang');
  });
  it('kệ đang lọc theo danh mục: lối xem tất cả giữ `category` (cùng thước đo 30 ngày ở trang đích), chỉ với route nhận tham số này', () => {
    expect(seeAllHref('home.bestSellers', 'mini', { category: 'c1' })).toBe('/best-sellers?category=c1');
    expect(seeAllHref('home.bestSellers', 'web', { category: 'c 1' })).toBe('/ban-chay?category=c+1');
    expect(seeAllHref('home.bestSellers', 'web', { category: null })).toBe('/ban-chay');
    expect(seeAllHref('home.purchased', 'mini', { category: 'c1' })).toBe('/orders');
  });
  it('Giờ vàng có trang riêng (P12): "Xem tất cả" của khối Trang chủ và của /offers trỏ tới đó', () => {
    expect(seeAllHref('home.flash')).toBe('/flash-sale');
    expect(seeAllHref('home.flash', 'web')).toBe('/gio-vang');
    expect(seeAllHref('offers.flash')).toBe('/flash-sale');
    expect(seeAllHref('offers.flash', 'web')).toBe('/gio-vang');
  });
  it('kệ không có lối xem tất cả trả null', () => {
    expect(seeAllHref('home.combos')).toBeNull();
  });
});
