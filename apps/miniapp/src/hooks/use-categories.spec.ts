import { describe, it, expect } from 'vitest';
import { SEGMENT_ENTRIES, categoryEntries, segmentLabel } from './use-categories';

const cat = (id: string, productCount?: number) => ({ id, parentId: null, name: `DM ${id}`, slug: id, image: null, sortOrder: 1, productCount });

describe('categoryEntries (plan 4b Ruling 4)', () => {
  it('danh mục thật có hàng → giữ, theo thứ tự API; danh mục trống bị ẩn', () => {
    const r = categoryEntries([cat('a', 3), cat('b', 0), cat('c', 1)]);
    expect(r.map((e) => [e.kind, e.key, e.label])).toEqual([
      ['category', 'a', 'DM a'],
      ['category', 'c', 'DM c'],
    ]);
  });

  it('không danh mục nào có hàng / API cũ (thiếu productCount) / chưa có dữ liệu → 4 phân khúc', () => {
    expect(categoryEntries([cat('a', 0)])).toBe(SEGMENT_ENTRIES);
    expect(categoryEntries([cat('a')])).toBe(SEGMENT_ENTRIES);
    expect(categoryEntries([])).toBe(SEGMENT_ENTRIES);
    expect(categoryEntries(undefined)).toBe(SEGMENT_ENTRIES);
    expect(SEGMENT_ENTRIES.map((e) => e.key)).toEqual(['mom_baby', 'home_clean', 'skincare', 'eco']);
  });

  it('chỉ lọc theo productCount khi nó là số: danh mục thiếu productCount không bị ẩn khi các danh mục khác có số', () => {
    const r = categoryEntries([cat('a', 2), cat('b'), cat('c', 0)]);
    expect(r.map((e) => e.key)).toEqual(['a', 'b']);
  });

  it('phân khúc dự phòng cùng kiểu với danh mục (kind/key/label/icon đều có) để Browse render chung một đường', () => {
    for (const e of SEGMENT_ENTRIES) {
      expect(e.kind).toBe('segment');
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.icon).toBeTruthy();
    }
    const real = categoryEntries([cat('a', 1)])[0]!;
    expect(Object.keys(real).sort()).toEqual(Object.keys(SEGMENT_ENTRIES[0]!).sort());
  });

  it('segmentLabel dùng nhãn tiếng Việt thống nhất (không emoji)', () => {
    expect(segmentLabel('mom_baby')).toBe('Cho mẹ & bé');
    expect(segmentLabel('nope')).toBeUndefined();
  });
});
