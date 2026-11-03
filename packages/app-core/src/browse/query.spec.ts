import { describe, expect, it } from 'vitest';
import { clipQuery, orderedPriceBounds, MAX_QUERY_LENGTH } from './query';

describe('clipQuery', () => {
  it('chuỗi ngắn giữ nguyên', () => expect(clipQuery('nước rửa')).toBe('nước rửa'));

  it('cắt theo điểm mã: emoji ở vị trí 99-100 không bị cắt đôi', () => {
    const q = `${'a'.repeat(99)}🌵🌵`;
    const out = clipQuery(q);
    expect(Array.from(out)).toHaveLength(MAX_QUERY_LENGTH);
    expect(out.endsWith('🌵')).toBe(true);
    expect(() => encodeURIComponent(out)).not.toThrow();
  });

  it('slice UTF-16 cũ làm hỏng encodeURIComponent (đối chứng)', () => {
    expect(() => encodeURIComponent(`${'a'.repeat(99)}🌵🌵`.slice(0, 100))).toThrow(URIError);
  });
});

describe('orderedPriceBounds', () => {
  it('min > max thì đổi chỗ', () => expect(orderedPriceBounds(500_000, 100_000)).toEqual({ minPrice: 100_000, maxPrice: 500_000 }));
  it('đúng thứ tự hoặc thiếu một đầu thì giữ', () => {
    expect(orderedPriceBounds(1, 2)).toEqual({ minPrice: 1, maxPrice: 2 });
    expect(orderedPriceBounds(5, undefined)).toEqual({ minPrice: 5, maxPrice: undefined });
    expect(orderedPriceBounds(5, 5)).toEqual({ minPrice: 5, maxPrice: 5 });
  });
});
