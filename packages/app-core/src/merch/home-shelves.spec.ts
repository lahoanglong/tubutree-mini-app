import { describe, expect, it } from 'vitest';
import { comboShelfEntry, composeHomeShelves, flashShelfEntry, purchasedShelfEntry, ranksAreSequential, seeAllHref, variationKey, type ShelfEntry } from './home-shelves';

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

describe('combo chiếm món theo slug', () => {
  const combo = (id: string, ...slugs: string[]) => comboShelfEntry({ id, items: slugs.map((slug) => ({ slug })) });
  const slugs = (...list: string[]) => list.map((s) => e(s, s));

  it('comboShelfEntry: id là id bộ, `also` là slug các món, `item` là chính view', () => {
    const view = { id: 'c1', items: [{ slug: 'a' }, { slug: 'b' }] };
    expect(comboShelfEntry(view)).toEqual({ id: 'c1', also: ['a', 'b'], item: view });
  });

  it('Bán chạy nhất bỏ món đã nằm trong combo; `seen` có món của combo để Gợi ý hôm nay cũng bỏ', () => {
    const r = composeHomeShelves({
      ...none,
      combos: [combo('c1', 'a', 'b'), combo('c2', 'c', 'd')],
      bestSellers: slugs('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'),
    });
    expect(r.combos.map((v) => v.id)).toEqual(['c1', 'c2']);
    expect(r.bestSellers).toEqual(['e', 'f', 'g', 'h']);
    expect([...r.seen].sort()).toEqual(['a', 'b', 'c', 'c1', 'c2', 'd', 'e', 'f', 'g', 'h']);
  });

  it('Giờ vàng giữ món trùng nhưng không loại combo: combo vẫn hiện và vẫn chiếm món của Bán chạy nhất', () => {
    const r = composeHomeShelves({
      ...none,
      flash: slugs('a', 'x', 'y'),
      combos: [combo('c1', 'a', 'b'), combo('c2', 'c', 'd')],
      bestSellers: slugs('a', 'b', 'c', 'd', 'e', 'f', 'g'),
    });
    expect(r.flash).toEqual(['a', 'x', 'y']);
    expect(r.combos.map((v) => v.id)).toEqual(['c1', 'c2']);
    expect(r.bestSellers).toEqual(['e', 'f', 'g']);
  });

  it('Mua lại giữ món của mình nhưng không loại combo: Mua lại về sau không làm kệ combo biến mất', () => {
    const combos = [combo('c1', 'a', 'b'), combo('c2', 'c', 'd')];
    const bestSellers = slugs('a', 'b', 'c', 'd', 'e', 'f', 'g');
    const before = composeHomeShelves({ ...none, combos, bestSellers });
    const after = composeHomeShelves({ ...none, purchased: [e('b', 'mua')], combos, bestSellers });
    expect(after.purchased).toEqual(['mua']);
    expect(after.combos).toEqual(before.combos);
    expect(after.combos.map((v) => v.id)).toEqual(['c1', 'c2']);
    expect(after.bestSellers).toEqual(before.bestSellers);
  });

  it('dưới 2 combo thì kệ ẩn và KHÔNG chiếm món, Bán chạy nhất giữ đủ món', () => {
    const r = composeHomeShelves({ ...none, combos: [combo('c1', 'a', 'b')], bestSellers: slugs('a', 'b', 'c', 'd') });
    expect(r.combos).toEqual([]);
    expect(r.bestSellers).toEqual(['a', 'b', 'c', 'd']);
    expect(r.seen.has('c1')).toBe(false);
  });

  it('chống trùng làm Bán chạy nhất dưới 3 món thì ẩn, `seen` không giữ món của kệ đã ẩn', () => {
    const r = composeHomeShelves({
      ...none,
      combos: [combo('c1', 'a', 'b'), combo('c2', 'c', 'd')],
      bestSellers: slugs('a', 'b', 'c', 'e', 'f'),
    });
    expect(r.bestSellers).toEqual([]);
    expect(r.seen.has('e')).toBe(false);
  });

  it('hai combo chung một món không loại nhau', () => {
    const r = composeHomeShelves({ ...none, combos: [combo('c1', 'a', 'b'), combo('c2', 'b', 'c')] });
    expect(r.combos.map((v) => v.id)).toEqual(['c1', 'c2']);
  });
});

describe('Mua lại chống trùng Giờ vàng theo phân loại (P2 #3)', () => {
  const flashOf = (slug: string, variationId: string) => ({ productSlug: slug, variationId });
  const boughtOf = (slug: string, variationId: string) => ({ slug, variationId });
  const flash3 = (...first: ReturnType<typeof flashOf>[]) => [...first, flashOf('x1', 'vx1'), flashOf('x2', 'vx2')].map(flashShelfEntry);

  it('khoá của hai hàm: Giờ vàng khoá bằng slug + chiếm phân loại, Mua lại khoá bằng phân loại + chiếm slug', () => {
    expect(variationKey('v1')).toBe('variation:v1');
    expect(flashShelfEntry(flashOf('can', 'v1l'))).toEqual({ id: 'can', also: ['variation:v1l'], item: flashOf('can', 'v1l') });
    expect(purchasedShelfEntry(boughtOf('can', 'v5l'))).toEqual({ id: 'variation:v5l', also: ['can'], item: boughtOf('can', 'v5l') });
  });

  it('Can 1L đang Giờ vàng, khách mua Can 5L cùng sản phẩm: Mua lại vẫn hiện Can 5L', () => {
    const r = composeHomeShelves({ ...none, flash: flash3(flashOf('can', 'v1l')), purchased: [purchasedShelfEntry(boughtOf('can', 'v5l'))] });
    expect(r.purchased).toEqual([boughtOf('can', 'v5l')]);
  });

  it('đúng phân loại đang Giờ vàng thì Mua lại bỏ nó (khối ẩn vì sàn 1 món)', () => {
    const r = composeHomeShelves({ ...none, flash: flash3(flashOf('can', 'v1l')), purchased: [purchasedShelfEntry(boughtOf('can', 'v1l'))] });
    expect(r.purchased).toEqual([]);
  });

  it('khách mua cả Can 1L và Can 5L, Giờ vàng chỉ 1L: còn Can 5L; sản phẩm đó vẫn bị chiếm slug nên Bán chạy nhất bỏ nó', () => {
    const r = composeHomeShelves({
      ...none,
      flash: flash3(flashOf('can', 'v1l')),
      purchased: [purchasedShelfEntry(boughtOf('can', 'v1l')), purchasedShelfEntry(boughtOf('can', 'v5l'))],
      bestSellers: [e('can', 'can'), ...ids(4, 'b')],
    });
    expect(r.purchased).toEqual([boughtOf('can', 'v5l')]);
    expect(r.bestSellers).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(r.seen.has('can')).toBe(true);
  });

  it('`seen` chỉ chứa slug (Gợi ý hôm nay loại theo slug), không lẫn khoá phân loại', () => {
    const r = composeHomeShelves({ ...none, flash: flash3(flashOf('can', 'v1l')), purchased: [purchasedShelfEntry(boughtOf('mia', 'v-mia'))] });
    expect([...r.seen].sort()).toEqual(['can', 'mia', 'x1', 'x2']);
  });

  it('hai phân loại của một sản phẩm đều hiện ở Mua lại (không gộp theo slug)', () => {
    const r = composeHomeShelves({ ...none, purchased: [purchasedShelfEntry(boughtOf('can', 'v1l')), purchasedShelfEntry(boughtOf('can', 'v5l'))] });
    expect(r.purchased.map((p) => p.variationId)).toEqual(['v1l', 'v5l']);
  });
});

describe('ranksAreSequential (P2 #4)', () => {
  it('hạng liền từ 1 (1..k) giữ số; rỗng cũng tính là liền', () => {
    expect(ranksAreSequential([1, 2, 3])).toBe(true);
    expect(ranksAreSequential([1])).toBe(true);
    expect(ranksAreSequential([])).toBe(true);
  });

  it('có hạng bị kệ trên chiếm (hụt giữa dãy hoặc mất hạng 1) thì không liền', () => {
    expect(ranksAreSequential([1, 2, 4, 5])).toBe(false);
    expect(ranksAreSequential([2, 3, 4])).toBe(false);
    expect(ranksAreSequential([2])).toBe(false);
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
