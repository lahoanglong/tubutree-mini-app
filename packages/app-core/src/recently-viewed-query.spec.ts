import { describe, expect, it } from 'vitest';
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

  it('20 slug 120 ký tự: chuỗi nối không vượt trần, giữ món mới nhất trước', () => {
    const slugs = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, '0')}-${'x'.repeat(117)}`);
    const out = recentlyViewedQuerySlugs(slugs);
    expect(out.join(',').length).toBeLessThanOrEqual(PRODUCTS_SLUGS_MAX_CHARS);
    expect(out.length).toBe(16);
    expect(out).toEqual(slugs.slice(0, 16));
  });

  it('một slug dài hơn trần bị bỏ qua, các slug còn lại vẫn giữ', () => {
    expect(recentlyViewedQuerySlugs(['a', 'z'.repeat(11), 'b'], 10)).toEqual(['a', 'b']);
  });
});
