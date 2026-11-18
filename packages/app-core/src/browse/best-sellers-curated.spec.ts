import { describe, expect, it } from 'vitest';
import { BEST_SELLERS_ALL_KEY, bestSellerPanelLabel, bestSellersHeading, curatedShelfItems, isCuratedShelf } from './best-sellers';
import { browseSortOptions } from './sort';

const card = (id: string, curated?: boolean) => (curated === undefined ? { id } : { id, curated });

describe('isCuratedShelf', () => {
  it('khi có thẻ mang dấu curated của API (món ghim đứng đầu, sau là xếp hạng thường); rỗng, chưa tải, API cũ thì không', () => {
    expect(isCuratedShelf([card('a', true), card('b', true)])).toBe(true);
    expect(isCuratedShelf([card('a', true), card('b')])).toBe(true);
    expect(isCuratedShelf([card('b'), card('a', true)])).toBe(true);
    expect(isCuratedShelf([card('a'), card('b')])).toBe(false);
    expect(isCuratedShelf([{ id: 'a', curated: 'true' }])).toBe(false);
    expect(isCuratedShelf([])).toBe(false);
    expect(isCuratedShelf(undefined)).toBe(false);
  });
});

describe('curatedShelfItems', () => {
  it('kệ chọn tay: chỉ món ghim, giữ thứ tự (kể cả khi kệ đã đảo ảnh trước)', () => {
    expect(curatedShelfItems([card('p2', true), card('p1', true), card('x'), card('y')]).map((c) => c.id)).toEqual(['p2', 'p1']);
    expect(curatedShelfItems([card('x'), card('p2', true), card('y'), card('p1', true)]).map((c) => c.id)).toEqual(['p2', 'p1']);
  });

  it('dưới minItems món ghim thì không vẽ gì; không phải kệ chọn tay thì nguyên danh sách', () => {
    expect(curatedShelfItems([card('p1', true), card('p2', true), card('x')], 3)).toEqual([]);
    expect(curatedShelfItems([card('p1', true), card('p2', true), card('p3', true), card('x')], 3).map((c) => c.id)).toEqual(['p1', 'p2', 'p3']);
    const plain = [card('a'), card('b')];
    expect(curatedShelfItems(plain, 3)).toEqual(plain);
    expect(curatedShelfItems([])).toEqual([]);
  });
});

describe('bestSellersHeading', () => {
  it('kệ chọn tay: "Tubu chọn cho bạn", không dòng thước đo, không xếp hạng', () => {
    expect(bestSellersHeading([card('a', true)], [{ basis: 'days30' }])).toEqual({ basis: 'curated', title: 'Tubu chọn cho bạn', subtitle: undefined, ranked: false });
  });

  it('đủ số bán: giữ đúng chữ hôm nay theo basis (30 ngày, hoặc tổng khi API cũ)', () => {
    expect(bestSellersHeading([card('a')], [{ basis: 'days30' }])).toEqual({ basis: 'days30', title: 'Bán chạy nhất', subtitle: 'Theo lượt bán 30 ngày qua', ranked: true });
    expect(bestSellersHeading([card('a')], [{ basis: 'days30' }, { basis: 'total' }])).toEqual({
      basis: 'total',
      title: 'Bán chạy nhất',
      subtitle: 'Theo tổng lượt bán',
      ranked: true,
    });
    expect(bestSellersHeading([card('a')])).toMatchObject({ basis: 'days30', subtitle: 'Theo lượt bán 30 ngày qua' });
  });

  it('đang tải hoặc rỗng: như hôm nay (tiêu đề Bán chạy nhất, trạng thái rỗng giữ nguyên)', () => {
    expect(bestSellersHeading(undefined)).toMatchObject({ basis: 'days30', title: 'Bán chạy nhất', ranked: true });
    expect(bestSellersHeading([])).toMatchObject({ title: 'Bán chạy nhất' });
  });
});

describe('bestSellerPanelLabel: tên vùng khi cây danh mục chưa về theo tiêu đề đang hiện', () => {
  it('mặc định là tên trang cũ; truyền tiêu đề kệ chọn tay thì dùng tiêu đề đó', () => {
    expect(bestSellerPanelLabel(null, 'cat-1')).toBe('Bán chạy nhất');
    expect(bestSellerPanelLabel(null, 'cat-1', 'Tubu chọn cho bạn')).toBe('Tubu chọn cho bạn');
    expect(bestSellerPanelLabel(null, BEST_SELLERS_ALL_KEY, 'Tubu chọn cho bạn')).toBe('Tất cả');
  });
});

describe('browseSortOptions: kệ chọn tay', () => {
  const values = (o: { value: string }[]) => o.map((x) => x.value);
  it('ẩn tab Bán chạy khi curated; không truyền thì như cũ', () => {
    expect(values(browseSortOptions(undefined, false))).toEqual(['default', 'best_seller', 'newest', 'price']);
    expect(values(browseSortOptions(undefined, false, { curated: false }))).toEqual(['default', 'best_seller', 'newest', 'price']);
    expect(values(browseSortOptions(undefined, false, { curated: true }))).toEqual(['default', 'newest', 'price']);
    expect(values(browseSortOptions('price_asc', true, { curated: true }))).toEqual(['default', 'newest', 'price']);
  });

  it('đang chọn sẵn Bán chạy (link cũ) thì giữ tab để không mất tab đang chọn', () => {
    expect(values(browseSortOptions('best_seller', false, { curated: true }))).toEqual(['default', 'best_seller', 'newest', 'price']);
    expect(values(browseSortOptions('best_seller_30d', false, { curated: true }))).toEqual(['default', 'best_seller', 'newest', 'price']);
  });
});
