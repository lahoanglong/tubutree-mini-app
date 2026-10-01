import { describe, it, expect } from 'vitest';
import {
  CLEAR_SEARCH_PATCH, EMPTY_SEARCH_STATE, PRICE_RANGES, activeFilterChips, activeFilterCount, changedFilterTypes,
  draftFromState, isBrowseRoot, parseSearchState, priceRangeLabel, serializeSearchState, toCatalogQuery, type SearchState,
} from './search-state';

const parse = (s: string) => parseSearchState(new URLSearchParams(s));
const FULL: SearchState = {
  q: 'nước rửa', sort: 'best_seller', category: 'cat-a', segment: undefined, brands: ['Tubu', 'Mộc An'],
  minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4,
};

describe('parseSearchState', () => {
  it('URL rỗng → trạng thái gốc', () => {
    expect(parse('')).toEqual(EMPTY_SEARCH_STATE);
  });

  it('đọc đủ tham số; brand là danh sách phẩy (link cũ từ Trang chủ)', () => {
    expect(parse('q=+n%C6%B0%E1%BB%9Bc+r%E1%BB%ADa+&sort=best_seller&category=cat-a&brand=Tubu,M%E1%BB%99c%20An&minPrice=100000&maxPrice=200000&inStock=1&rating=4')).toEqual(FULL);
  });

  it('bỏ qua giá trị rác: sort lạ, giá âm/lẻ/chữ, rating ngoài 1..5, inStock khác "1"', () => {
    expect(parse('sort=cheapest&minPrice=-5&maxPrice=12.5&rating=9&inStock=true')).toEqual(EMPTY_SEARCH_STATE);
    expect(parse('minPrice=abc&brand=,,')).toEqual(EMPTY_SEARCH_STATE);
    expect(parse('rating=0&q=%20%20')).toEqual(EMPTY_SEARCH_STATE);
  });

  it('thương hiệu trùng lặp chỉ giữ một (khoá chip không trùng)', () => {
    expect(parse('brand=Tubu,%20Tubu,M%E1%BB%99c').brands).toEqual(['Tubu', 'Mộc']);
  });
});

describe('serializeSearchState', () => {
  it('thứ tự cố định, bỏ giá trị mặc định → cùng trạng thái luôn cùng URL', () => {
    expect(serializeSearchState(FULL).toString()).toBe(
      'q=n%C6%B0%E1%BB%9Bc+r%E1%BB%ADa&category=cat-a&brand=Tubu%2CM%E1%BB%99c+An&minPrice=100000&maxPrice=200000&inStock=1&rating=4&sort=best_seller',
    );
    expect(serializeSearchState(EMPTY_SEARCH_STATE).toString()).toBe('');
  });

  it('thứ tự tham số trong URL đầu vào không ảnh hưởng URL chuẩn', () => {
    const shuffled = parse('sort=newest&rating=4&inStock=1&q=a&segment=eco&maxPrice=5000');
    const ordered = parse('q=a&segment=eco&maxPrice=5000&inStock=1&rating=4&sort=newest');
    expect(serializeSearchState(shuffled).toString()).toBe(serializeSearchState(ordered).toString());
    expect(serializeSearchState(shuffled).toString()).toBe('q=a&segment=eco&maxPrice=5000&inStock=1&rating=4&sort=newest');
  });

  it('parse(serialize(x)) === x', () => {
    expect(parseSearchState(serializeSearchState(FULL))).toEqual(FULL);
    expect(parseSearchState(serializeSearchState(EMPTY_SEARCH_STATE))).toEqual(EMPTY_SEARCH_STATE);
    const other: SearchState = { q: 'a&b=c', sort: 'price_desc', segment: 'mom_baby', brands: ['A'], maxPrice: 0, inStock: false };
    expect(parseSearchState(serializeSearchState(other))).toEqual({ ...other, category: undefined, minPrice: undefined, minRating: undefined });
  });

  it('serialize(parse(url)) làm sạch giá trị rác nhưng giữ phần hợp lệ', () => {
    expect(serializeSearchState(parse('q=%20nuoc%20&sort=cheapest&minPrice=-5&inStock=true&rating=3')).toString()).toBe('q=nuoc&rating=3');
  });
});

describe('toCatalogQuery', () => {
  it('map sang tham số API; brand nối phẩy; inStock=false bỏ qua', () => {
    expect(toCatalogQuery(FULL, 2, 30)).toEqual({
      page: 2, limit: 30, q: 'nước rửa', sort: 'best_seller', category: 'cat-a', segment: undefined, brand: 'Tubu,Mộc An',
      minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4,
    });
    expect(toCatalogQuery(EMPTY_SEARCH_STATE, 1, 1)).toEqual({ page: 1, limit: 1, q: undefined, sort: undefined, category: undefined, segment: undefined, brand: undefined, minPrice: undefined, maxPrice: undefined, inStock: undefined, minRating: undefined });
  });
});

describe('bộ lọc', () => {
  it('activeFilterCount đếm theo LOẠI (giá 1, còn hàng 1, thương hiệu 1, đánh giá 1)', () => {
    expect(activeFilterCount(FULL)).toBe(4);
    expect(activeFilterCount({ ...EMPTY_SEARCH_STATE, maxPrice: 100000 })).toBe(1);
    expect(activeFilterCount(EMPTY_SEARCH_STATE)).toBe(0);
  });

  it('isBrowseRoot: không q, không danh mục/phân khúc, không bộ lọc (sort không tính)', () => {
    expect(isBrowseRoot({ ...EMPTY_SEARCH_STATE, sort: 'newest' })).toBe(true);
    expect(isBrowseRoot({ ...EMPTY_SEARCH_STATE, segment: 'eco' })).toBe(false);
    expect(isBrowseRoot({ ...EMPTY_SEARCH_STATE, inStock: true })).toBe(false);
  });

  it('changedFilterTypes chỉ liệt kê loại thật sự đổi', () => {
    const draft = { ...draftFromState(FULL), inStock: false, brands: ['Mộc An', 'Tubu'] };
    expect(changedFilterTypes(FULL, draft)).toEqual(['in_stock']); // thứ tự brand khác nhưng cùng tập
    expect(changedFilterTypes(EMPTY_SEARCH_STATE, draftFromState(FULL))).toEqual(['price', 'in_stock', 'brand', 'rating']);
  });

  it('CLEAR_SEARCH_PATCH xoá mọi thứ trừ sort', () => {
    expect({ ...FULL, ...CLEAR_SEARCH_PATCH }).toEqual({ ...EMPTY_SEARCH_STATE, sort: 'best_seller' });
  });

  it('priceRangeLabel theo các mốc', () => {
    expect(PRICE_RANGES.map((r) => priceRangeLabel(r.min, r.max))).toEqual(['Dưới 100k', '100k–200k', '200k–500k', 'Từ 500k']);
  });

  it('activeFilterChips: mỗi chip một patch gỡ đúng bộ lọc đó', () => {
    const chips = activeFilterChips({ ...FULL, category: undefined, segment: 'eco' }, { segmentName: 'Sống xanh' });
    expect(chips.map((c) => c.label)).toEqual(['Sống xanh', 'Tubu', 'Mộc An', '100k–200k', 'Còn hàng', 'Từ 4★']);
    expect(chips.find((c) => c.label === 'Tubu')!.patch).toEqual({ brands: ['Mộc An'] });
    expect(chips.find((c) => c.label === '100k–200k')!.patch).toEqual({ minPrice: undefined, maxPrice: undefined });
    expect(chips[0]!.patch).toEqual({ segment: undefined });
  });

  it('activeFilterChips: danh mục chưa tải tên → không hiện id thô', () => {
    expect(activeFilterChips({ ...EMPTY_SEARCH_STATE, category: 'cat-a' }, {})).toEqual([]);
  });
});

describe('parseSearchState — giới hạn độ dài', () => {
  it('q dài quá 100 ký tự bị cắt (và cắt khoảng trắng thừa ở đuôi)', () => {
    expect(parse(`q=${'a'.repeat(150)}`).q).toBe('a'.repeat(100));
    expect(parse(`q=${'a'.repeat(99)}+${'b'.repeat(50)}`).q).toBe('a'.repeat(99));
    expect(parse(`q=${'a'.repeat(100)}`).q).toBe('a'.repeat(100));
  });
});
