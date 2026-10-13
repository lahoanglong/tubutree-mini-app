import { describe, expect, it } from 'vitest';
import {
  SEARCH_MAX_LENGTH,
  firstParam,
  homeHref,
  normalizeSearchQuery,
  pageHref,
  pageItems,
  parsePage,
} from './catalog-filter';

describe('catalog-filter — tìm kiếm và lọc thương hiệu ở trang chủ (C-025)', () => {
  it('normalizeSearchQuery cắt khoảng trắng, gộp khoảng trắng liền nhau, giới hạn 100 ký tự như API', () => {
    expect(normalizeSearchQuery('  dầu   gội  ')).toBe('dầu gội');
    expect(normalizeSearchQuery(undefined)).toBe('');
    expect(normalizeSearchQuery('   ')).toBe('');
    expect(SEARCH_MAX_LENGTH).toBe(100);
    expect(normalizeSearchQuery('a'.repeat(150))).toHaveLength(100);
  });

  it('homeHref giữ cả từ khoá và thương hiệu, có neo #san-pham khi đang lọc', () => {
    expect(homeHref({})).toBe('/');
    expect(homeHref({ brand: 'Tubu' })).toBe('/?brand=Tubu#san-pham');
    expect(homeHref({ q: 'dầu gội' })).toBe(`/?${new URLSearchParams({ q: 'dầu gội' }).toString()}#san-pham`);
    expect(homeHref({ brand: 'A&B', q: 'x y' })).toBe('/?brand=A%26B&q=x+y#san-pham');
    expect(homeHref({ brand: '', q: '  ' })).toBe('/');
  });
});

describe('catalog-filter — tham số URL lặp (?q=a&q=b)', () => {
  it('searchParams có thể là mảng khi khách/bot lặp tham số: lấy giá trị đầu, không ném lỗi', () => {
    expect(normalizeSearchQuery(['  dầu gội ', 'xà phòng'])).toBe('dầu gội');
    expect(normalizeSearchQuery([])).toBe('');
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('a')).toBe('a');
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe('catalog-filter — phân trang trang chủ (BUYERWEB-7)', () => {
  it('parsePage: chỉ nhận số nguyên dương, còn lại về trang 1, chặn số quá lớn', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage(['2', '5'])).toBe(2);
    for (const bad of [undefined, '', '0', '-1', '1.5', 'abc', '1e3', '2 ', '9999999']) {
      expect(parsePage(bad)).toBe(1);
    }
    expect(parsePage('99999')).toBe(1000);
  });

  it('homeHref: trang 1 không ghi ?page=, trang ≥ 2 ghi cùng bộ lọc', () => {
    expect(homeHref({ page: 1 })).toBe('/');
    expect(homeHref({ page: 2 })).toBe('/?page=2#san-pham');
    expect(homeHref({ brand: 'Tubu', q: 'gội', page: 3 })).toBe('/?brand=Tubu&q=g%E1%BB%99i&page=3#san-pham');
    expect(homeHref({ brand: 'Tubu', page: 1 })).toBe('/?brand=Tubu#san-pham');
  });

  it('pageHref luôn neo #san-pham, kể cả trang 1 không bộ lọc', () => {
    expect(pageHref({}, 1)).toBe('/#san-pham');
    expect(pageHref({}, 2)).toBe('/?page=2#san-pham');
    expect(pageHref({ brand: 'A&B' }, 1)).toBe('/?brand=A%26B#san-pham');
  });

  it('pageItems: đủ trang đầu/cuối/kề hiện tại, "gap" chỉ khi bỏ qua ít nhất 1 trang', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(1, 10)).toEqual([1, 2, 'gap', 10]);
    expect(pageItems(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pageItems(10, 10)).toEqual([1, 'gap', 9, 10]);
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
