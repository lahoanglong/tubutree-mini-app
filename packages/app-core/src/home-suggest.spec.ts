import { describe, expect, it } from 'vitest';
import { SUGGEST_CHIP_MAX, SUGGEST_MAX, SUGGEST_MAX_DESKTOP, suggestChips, suggestLimit, vnDateSeed } from './home-suggest';

describe('vnDateSeed', () => {
  it('lấy ngày theo giờ Việt Nam (UTC+7), không theo UTC', () => {
    expect(vnDateSeed(Date.UTC(2026, 9, 31, 16, 59))).toBe('20261031');
    expect(vnDateSeed(Date.UTC(2026, 9, 31, 17, 0))).toBe('20261101');
    expect(vnDateSeed(Date.UTC(2026, 11, 31, 18, 30))).toBe('20270101');
  });
  it('số rác trả về ngày hợp lệ, không "NaN"', () => {
    expect(vnDateSeed(Number.NaN)).toMatch(/^\d{8}$/);
  });
  it('cùng một ngày VN → cùng seed; sang ngày khác → khác', () => {
    expect(vnDateSeed(Date.UTC(2026, 9, 31, 1))).toBe(vnDateSeed(Date.UTC(2026, 9, 31, 15)));
    expect(vnDateSeed(Date.UTC(2026, 9, 31, 1))).not.toBe(vnDateSeed(Date.UTC(2026, 10, 1, 1)));
  });
});

describe('suggestChips', () => {
  const cat = (id: string, productCount: number) => ({ id, name: `Danh mục ${id}`, productCount });
  it('"Tất cả" rồi tối đa 4 danh mục nhiều sản phẩm nhất', () => {
    const chips = suggestChips([cat('a', 3), cat('b', 9), cat('c', 5), cat('d', 7), cat('e', 1), cat('f', 6)]);
    expect(SUGGEST_CHIP_MAX).toBe(4);
    expect(chips.map((c) => c.categoryId)).toEqual([null, 'b', 'd', 'f', 'c']);
    expect(chips[0]).toMatchObject({ key: 'all', label: 'Tất cả' });
  });
  it('bỏ danh mục không có sản phẩm hoặc thiếu productCount (API cũ)', () => {
    expect(suggestChips([cat('a', 0), { id: 'b', name: 'B' }]).map((c) => c.categoryId)).toEqual([null]);
  });
  it('hoà số sản phẩm thì giữ thứ tự đầu vào; đầu vào rỗng chỉ có "Tất cả"', () => {
    expect(suggestChips([cat('x', 2), cat('y', 2)]).map((c) => c.categoryId)).toEqual([null, 'x', 'y']);
    expect(suggestChips([])).toHaveLength(1);
  });
});

describe('suggestLimit', () => {
  it('điện thoại dừng ở 100 món, máy tính ở 48', () => {
    expect(SUGGEST_MAX).toBe(100);
    expect(SUGGEST_MAX_DESKTOP).toBe(48);
    expect(suggestLimit(100, false)).toEqual({ hasMore: false, max: 100 });
    expect(suggestLimit(99, false).hasMore).toBe(true);
    expect(suggestLimit(48, true)).toEqual({ hasMore: false, max: 48 });
    expect(suggestLimit(20, true).hasMore).toBe(true);
  });
});
