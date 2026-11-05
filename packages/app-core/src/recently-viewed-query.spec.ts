import { describe, expect, it } from 'vitest';
import { PRODUCT_SLUG_MAX, PRODUCT_SLUGS_LIST_MAX, PRODUCT_SLUGS_QUERY_MAX_CHARS } from '@tubutree/shared-types';
import { PRODUCTS_SLUGS_MAX_CHARS, recentlyViewedQuerySlugs } from './recently-viewed-query';

describe('recentlyViewedQuerySlugs', () => {
  it('giữ nguyên khi dưới trần', () => {
    expect(recentlyViewedQuerySlugs(['a', 'bb', 'ccc'])).toEqual(['a', 'bb', 'ccc']);
    expect(recentlyViewedQuerySlugs([])).toEqual([]);
  });

  it('đúng bằng trần thì giữ hết, quá một ký tự thì bỏ món cũ nhất', () => {
    const a = 'a'.repeat(4);
    const b = 'b'.repeat(5);
    expect([a, b].join(',').length).toBe(10);
    expect(recentlyViewedQuerySlugs([a, b], 10)).toEqual([a, b]);
    expect(recentlyViewedQuerySlugs([a, b], 9)).toEqual([a]);
  });

  it('slug quá dài để vừa trần tuỳ chỉnh: chuỗi nối không vượt trần, giữ món mới nhất trước', () => {
    const slugs = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, '0')}-${'x'.repeat(117)}`);
    const out = recentlyViewedQuerySlugs(slugs, 2000);
    expect(out.join(',').length).toBeLessThanOrEqual(2000);
    expect(out.length).toBe(16);
    expect(out).toEqual(slugs.slice(0, 16));
    expect(out.join(',').length).toBeLessThanOrEqual(PRODUCTS_SLUGS_MAX_CHARS);
  });

  it('20 slug dài PRODUCT_SLUG_MAX: giữ đủ 20 (dải "Đã xem gần đây" không bị cắt bớt), và trần ký tự là hằng chung với DTO', () => {
    expect(PRODUCTS_SLUGS_MAX_CHARS).toBe(PRODUCT_SLUGS_QUERY_MAX_CHARS);
    const slugs = Array.from({ length: PRODUCT_SLUGS_LIST_MAX }, (_, i) => `${String(i).padStart(2, '0')}${'x'.repeat(PRODUCT_SLUG_MAX - 2)}`);
    const out = recentlyViewedQuerySlugs(slugs);
    expect(out).toEqual(slugs);
    expect(out.join(',').length).toBeLessThanOrEqual(PRODUCT_SLUGS_QUERY_MAX_CHARS);
  });

  it('không gửi quá PRODUCT_SLUGS_LIST_MAX slug dù danh sách dài hơn (API từ chối quá 20 phần tử)', () => {
    const slugs = Array.from({ length: PRODUCT_SLUGS_LIST_MAX + 5 }, (_, i) => `s${i}`);
    expect(recentlyViewedQuerySlugs(slugs)).toEqual(slugs.slice(0, PRODUCT_SLUGS_LIST_MAX));
  });

  it('gặp slug dài hơn trần thì dừng: kết quả luôn là phần đầu của danh sách', () => {
    expect(recentlyViewedQuerySlugs(['a', 'z'.repeat(11), 'b'], 10)).toEqual(['a']);
    expect(recentlyViewedQuerySlugs(['z'.repeat(11), 'a'], 10)).toEqual([]);
  });
});
