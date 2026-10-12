import { describe, it, expect } from 'vitest';
import {
  RECENTLY_VIEWED_KEY, RECENTLY_VIEWED_MAX, clearRecentlyViewed, parseRecentlyViewed, readRecentlyViewed, recordRecentlyViewed,
  type StorageLike,
} from './recently-viewed';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}
const item = (slug: string) => ({ slug, name: `SP ${slug}`, thumbnail: null, price: 50000 });

describe('recently-viewed (spec 5b.4)', () => {
  it('chưa có gì → []', () => {
    expect(readRecentlyViewed(memoryStorage())).toEqual([]);
  });

  it('ghi mới nhất lên đầu; xem lại cùng slug thì dời lên đầu, không trùng', () => {
    const s = memoryStorage();
    recordRecentlyViewed(item('a'), 1, s);
    recordRecentlyViewed(item('b'), 2, s);
    const r = recordRecentlyViewed(item('a'), 3, s);
    expect(r.map((x) => x.slug)).toEqual(['a', 'b']);
    expect(r[0]!.viewedAt).toBe(3);
    expect(JSON.parse(s.data[RECENTLY_VIEWED_KEY]!)).toEqual(r);
  });

  it('xem lại cùng slug cập nhật tên/giá/ảnh theo lần xem mới nhất', () => {
    const s = memoryStorage();
    recordRecentlyViewed({ slug: 'a', name: 'Tên cũ', thumbnail: null, price: 1000 }, 1, s);
    const r = recordRecentlyViewed({ slug: 'a', name: 'Tên mới', thumbnail: 'https://x/y.jpg', price: 2000 }, 2, s);
    expect(r).toEqual([{ slug: 'a', name: 'Tên mới', thumbnail: 'https://x/y.jpg', price: 2000, viewedAt: 2 }]);
  });

  it('chỉ lưu đúng 5 trường của spec, bỏ trường dư (PDP truyền cả object sản phẩm)', () => {
    const s = memoryStorage();
    const fat = { ...item('a'), description: 'rất dài', variants: [1, 2, 3] };
    recordRecentlyViewed(fat, 7, s);
    expect(JSON.parse(s.data[RECENTLY_VIEWED_KEY]!)).toEqual([{ ...item('a'), viewedAt: 7 }]);
  });

  it('giữ tối đa 20, bỏ cái cũ nhất', () => {
    const s = memoryStorage();
    for (let i = 0; i < 25; i++) recordRecentlyViewed(item(`p${i}`), i, s);
    const r = readRecentlyViewed(s);
    expect(r).toHaveLength(RECENTLY_VIEWED_MAX);
    expect(r[0]!.slug).toBe('p24');
    expect(r.at(-1)!.slug).toBe('p5');
  });

  it('dữ liệu hỏng / sai shape bị bỏ qua, không ném', () => {
    expect(parseRecentlyViewed('{oops')).toEqual([]);
    expect(parseRecentlyViewed(JSON.stringify([{ slug: 'x' }, null, 3, { ...item('ok'), viewedAt: 1 }]))).toEqual([{ ...item('ok'), viewedAt: 1 }]);
    expect(parseRecentlyViewed(JSON.stringify({ slug: 'x' }))).toEqual([]);
    expect(parseRecentlyViewed(null)).toEqual([]);
    expect(parseRecentlyViewed('')).toEqual([]);
    expect(parseRecentlyViewed('null')).toEqual([]);
  });

  it('bỏ mục có số không hữu hạn hoặc slug rỗng', () => {
    const ok = { ...item('ok'), viewedAt: 1 };
    // JSON không biểu diễn được NaN/Infinity (thành null) → mục bị loại vì price/viewedAt không phải số.
    const raw = JSON.stringify([
      { ...item('nan'), price: Number.NaN, viewedAt: 1 },
      { ...item('inf'), viewedAt: Number.POSITIVE_INFINITY },
      { ...item(''), viewedAt: 1 },
      ok,
    ]);
    expect(parseRecentlyViewed(raw)).toEqual([ok]);
  });

  it('dữ liệu lưu trùng slug (sửa tay / lỗi cũ) → giữ bản đầu tiên (mới nhất)', () => {
    const raw = JSON.stringify([
      { ...item('a'), name: 'mới', viewedAt: 5 },
      { ...item('b'), viewedAt: 4 },
      { ...item('a'), name: 'cũ', viewedAt: 1 },
    ]);
    expect(parseRecentlyViewed(raw).map((x) => [x.slug, x.name])).toEqual([['a', 'mới'], ['b', 'SP b']]);
  });

  it('dữ liệu lưu dài hơn 20 bị cắt về 20', () => {
    const raw = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ ...item(`p${i}`), viewedAt: 100 - i })));
    expect(parseRecentlyViewed(raw)).toHaveLength(RECENTLY_VIEWED_MAX);
  });

  it('ghi khi khoá đang chứa dữ liệu hỏng → bắt đầu lại từ danh sách sạch, không ném', () => {
    const s = memoryStorage({ [RECENTLY_VIEWED_KEY]: '{oops' });
    expect(recordRecentlyViewed(item('a'), 1, s).map((x) => x.slug)).toEqual(['a']);
    expect(readRecentlyViewed(s).map((x) => x.slug)).toEqual(['a']);
  });

  it('mục không hợp lệ (slug rỗng, giá không hữu hạn) không được ghi', () => {
    const s = memoryStorage();
    recordRecentlyViewed(item('a'), 1, s);
    expect(recordRecentlyViewed(item(''), 2, s).map((x) => x.slug)).toEqual(['a']);
    expect(recordRecentlyViewed({ ...item('b'), price: Number.NaN }, 3, s).map((x) => x.slug)).toEqual(['a']);
    expect(readRecentlyViewed(s).map((x) => x.slug)).toEqual(['a']);
  });

  it('setItem ném (hết quota, chế độ riêng tư) → vẫn trả danh sách, không ném', () => {
    const s = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(recordRecentlyViewed(item('a'), 1, s).map((x) => x.slug)).toEqual(['a']);
  });

  it('getItem ném → đọc [] và ghi vẫn không ném', () => {
    const s = { ...memoryStorage(), getItem: () => { throw new Error('SecurityError'); } };
    expect(readRecentlyViewed(s)).toEqual([]);
    expect(recordRecentlyViewed(item('a'), 1, s).map((x) => x.slug)).toEqual(['a']);
  });

  it('removeItem ném → clear không ném', () => {
    const s = { ...memoryStorage(), removeItem: () => { throw new Error('SecurityError'); } };
    expect(() => clearRecentlyViewed(s)).not.toThrow();
  });

  it('không có storage (null) → đọc [] và ghi không ném', () => {
    expect(readRecentlyViewed(null)).toEqual([]);
    expect(recordRecentlyViewed(item('a'), 1, null)).toHaveLength(1);
    expect(() => clearRecentlyViewed(null)).not.toThrow();
  });

  it('clearRecentlyViewed xoá khoá', () => {
    const s = memoryStorage();
    recordRecentlyViewed(item('a'), 1, s);
    clearRecentlyViewed(s);
    expect(readRecentlyViewed(s)).toEqual([]);
    expect(RECENTLY_VIEWED_KEY in s.data).toBe(false);
  });
});
