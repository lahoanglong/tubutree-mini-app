import { describe, expect, it } from 'vitest';
import { SEARCH_MAX_LENGTH, firstParam, homeHref, normalizeSearchQuery } from './catalog-filter';

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
