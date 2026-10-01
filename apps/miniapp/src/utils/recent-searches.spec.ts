import { describe, it, expect } from 'vitest';
import { RECENT_SEARCHES_KEY, clearRecentSearches, pushRecentSearch, readRecentSearches } from './recent-searches';
import type { StorageLike } from './recently-viewed';

function memoryStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

describe('recent-searches (giữ khoá cũ tubu_recent_searches)', () => {
  it('bỏ từ khoá < 2 ký tự; mới nhất lên đầu; trùng (không phân biệt hoa thường) dời lên đầu; tối đa 8', () => {
    const s = memoryStorage();
    pushRecentSearch('a', s);
    pushRecentSearch('nước', s);
    pushRecentSearch('xà phòng', s);
    expect(pushRecentSearch('NƯỚC', s)).toEqual(['NƯỚC', 'xà phòng']);
    for (let i = 0; i < 10; i++) pushRecentSearch(`tu khoa ${i}`, s);
    expect(readRecentSearches(s)).toHaveLength(8);
    expect(JSON.parse(s.data[RECENT_SEARCHES_KEY]!)[0]).toBe('tu khoa 9');
  });

  it('khoá cũ: đọc đúng định dạng mà browse.tsx hiện ghi (mảng JSON các chuỗi, mới nhất trước)', () => {
    const s = memoryStorage();
    s.data[RECENT_SEARCHES_KEY] = JSON.stringify(['nước rửa chén', 'túi vải']);
    expect(readRecentSearches(s)).toEqual(['nước rửa chén', 'túi vải']);
    expect(pushRecentSearch('bàn chải', s)).toEqual(['bàn chải', 'nước rửa chén', 'túi vải']);
    expect(JSON.parse(s.data[RECENT_SEARCHES_KEY]!)).toEqual(['bàn chải', 'nước rửa chén', 'túi vải']);
  });

  it('cắt khoảng trắng đầu/cuối; chỉ toàn khoảng trắng bị bỏ qua và không ghi gì', () => {
    const s = memoryStorage();
    expect(pushRecentSearch('   ', s)).toEqual([]);
    expect(RECENT_SEARCHES_KEY in s.data).toBe(false);
    expect(pushRecentSearch('  xà phòng  ', s)).toEqual(['xà phòng']);
  });

  it('dữ liệu hỏng → []; clear xoá', () => {
    const s = memoryStorage();
    s.data[RECENT_SEARCHES_KEY] = '[1, "ok", null]';
    expect(readRecentSearches(s)).toEqual(['ok']);
    clearRecentSearches(s);
    expect(readRecentSearches(s)).toEqual([]);
    expect(RECENT_SEARCHES_KEY in s.data).toBe(false);
  });

  it('JSON hỏng / không phải mảng / chuỗi rỗng → [] không ném', () => {
    const s = memoryStorage();
    for (const raw of ['{oops', '{"a":1}', 'null', '"text"', '']) {
      s.data[RECENT_SEARCHES_KEY] = raw;
      expect(readRecentSearches(s)).toEqual([]);
    }
  });

  it('bỏ chuỗi rỗng/chỉ khoảng trắng và trùng (không phân biệt hoa thường) trong dữ liệu lưu; cắt về 8', () => {
    const s = memoryStorage();
    s.data[RECENT_SEARCHES_KEY] = JSON.stringify(['', '  ', 'Nước', 'nước', ...Array.from({ length: 12 }, (_, i) => `k${i}`)]);
    const r = readRecentSearches(s);
    expect(r[0]).toBe('Nước');
    expect(r.filter((x) => x.toLowerCase() === 'nước')).toHaveLength(1);
    expect(r).toHaveLength(8);
  });

  it('storage ném / vắng → không ném, push vẫn trả danh sách trong bộ nhớ', () => {
    const throwing: StorageLike = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    };
    expect(readRecentSearches(throwing)).toEqual([]);
    expect(pushRecentSearch('nước rửa', throwing)).toEqual(['nước rửa']);
    expect(() => clearRecentSearches(throwing)).not.toThrow();
    expect(readRecentSearches(null)).toEqual([]);
    expect(pushRecentSearch('nước rửa', null)).toEqual(['nước rửa']);
    expect(() => clearRecentSearches(null)).not.toThrow();
  });
});
