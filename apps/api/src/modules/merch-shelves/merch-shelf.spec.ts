import {
  categoryShelfKey,
  isCuratedBasis,
  leadPins,
  parseShelfKey,
  pinFirst,
  pinInWindow,
  pinWarnings,
  sanitizeCount,
  shelfVersion,
  spreadPick,
  type VersionedPin,
} from './merch-shelf';

const ids = (n: number, p = 'p') => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(3, '0')}`);

describe('merch-shelf: khoá kệ', () => {
  it('nhận đúng ba loại khoá, slug danh mục theo dạng admin tạo', () => {
    expect(parseShelfKey('home_featured')).toEqual({ key: 'home_featured', categorySlug: null });
    expect(parseShelfKey('best_sellers')).toEqual({ key: 'best_sellers', categorySlug: null });
    expect(parseShelfKey('category:cham-soc-be')).toEqual({ key: 'category:cham-soc-be', categorySlug: 'cham-soc-be' });
    expect(categoryShelfKey('cham-soc-be')).toBe('category:cham-soc-be');
  });

  it.each([undefined, 42, '', 'home', 'category:', 'category:Chăm sóc', 'category:a--b', 'category:-a', `category:${'a'.repeat(121)}`, 'brand:abc'])('từ chối %p', (raw) => {
    expect(parseShelfKey(raw)).toBeNull();
  });
});

describe('merch-shelf: khung giờ', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  it('không khung giờ thì luôn hiệu lực; chưa tới giờ hay đã tới giờ kết thúc thì rơi khỏi kệ', () => {
    expect(pinInWindow({ startsAt: null, endsAt: null }, now)).toBe(true);
    expect(pinInWindow({ startsAt: new Date('2026-11-18T10:00:00Z'), endsAt: null }, now)).toBe(true);
    expect(pinInWindow({ startsAt: new Date('2026-11-18T10:00:01Z'), endsAt: null }, now)).toBe(false);
    expect(pinInWindow({ startsAt: null, endsAt: new Date('2026-11-18T10:00:00Z') }, now)).toBe(false);
    expect(pinInWindow({ startsAt: null, endsAt: new Date('2026-11-18T10:00:01Z') }, now)).toBe(true);
  });
});

describe('merch-shelf: ghép thứ tự', () => {
  it('món ghim đứng đầu theo thứ tự ghim, phần còn lại giữ thứ tự cũ, không lặp', () => {
    const ranked = ['a', 'b', 'c', 'd', 'e'];
    expect(pinFirst(ranked, ['d', 'b'], 20)).toEqual(['d', 'b', 'a', 'c', 'e']);
  });

  it('món ghim không có trong danh sách đã lọc thì không hiện', () => {
    expect(pinFirst(['a', 'b', 'c'], ['x', 'c', 'y'], 20)).toEqual(['c', 'a', 'b']);
  });

  it('không ghim, hay mọi ghim bị lọc: trả đúng thứ tự cũ', () => {
    const ranked = ['a', 'b', 'c'];
    expect(pinFirst(ranked, [], 20)).toEqual(ranked);
    expect(pinFirst(ranked, ['x'], 20)).toEqual(ranked);
  });

  it('ghim trùng chỉ tính một lần, tối đa `limit` món ghim đứng đầu (mọi ghim nằm ở trang 1)', () => {
    expect(leadPins(['a', 'b', 'c', 'd'], ['c', 'c', 'a', 'd'], 2)).toEqual(['c', 'a']);
    expect(pinFirst(['a', 'b', 'c', 'd'], ['d', 'c', 'b'], 2)).toEqual(['d', 'c', 'a', 'b']);
    expect(leadPins(['a'], ['a'], 0)).toEqual([]);
  });

  it('phân trang: duyệt hết các trang không lặp, không sót, tổng không đổi', () => {
    const ranked = ids(111);
    const pins = ['p100', 'p007', 'p055', 'nope', 'p007', 'p110'];
    const merged = pinFirst(ranked, pins, 20);
    expect(merged).toHaveLength(ranked.length);
    expect(new Set(merged).size).toBe(ranked.length);
    expect([...merged].sort()).toEqual([...ranked].sort());
    const pages: string[] = [];
    for (let page = 1; (page - 1) * 20 < merged.length; page++) pages.push(...merged.slice((page - 1) * 20, page * 20));
    expect(pages).toEqual(merged);
    expect(merged.slice(0, 4)).toEqual(['p100', 'p007', 'p055', 'p110']);
    expect(merged.slice(4)).toEqual(ranked.filter((id) => !['p100', 'p007', 'p055', 'p110'].includes(id)));
  });
});

describe('merch-shelf: ngưỡng số bán', () => {
  it('đổi cơ sở đúng tại ngưỡng: ít hơn `minProducts` sản phẩm có số bán thì là kệ chọn tay', () => {
    expect(isCuratedBasis(0, 6)).toBe(true);
    expect(isCuratedBasis(5, 6)).toBe(true);
    expect(isCuratedBasis(6, 6)).toBe(false);
    expect(isCuratedBasis(7, 6)).toBe(false);
  });

  it('cấu hình sai dạng dùng mặc định', () => {
    expect(sanitizeCount(8, 6, 1000)).toBe(8);
    for (const bad of ['8', 0, -1, 1.5, null, undefined, 1001, Number.NaN]) expect(sanitizeCount(bad, 6, 1000)).toBe(6);
  });
});

describe('merch-shelf: phiên bản kệ', () => {
  const t = new Date('2026-11-18T01:00:00Z');
  const row = (productId: string, position: number, extra: Partial<VersionedPin> = {}): VersionedPin => ({
    productId,
    position,
    startsAt: null,
    endsAt: null,
    note: null,
    updatedAt: t,
    ...extra,
  });

  it('không phụ thuộc thứ tự đọc; đổi vị trí, ghi chú, khung giờ hay updatedAt thì đổi dấu', () => {
    const base = shelfVersion([row('a', 0), row('b', 1)]);
    expect(shelfVersion([row('b', 1), row('a', 0)])).toBe(base);
    expect(shelfVersion([row('a', 1), row('b', 0)])).not.toBe(base);
    expect(shelfVersion([row('a', 0, { note: 'x' }), row('b', 1)])).not.toBe(base);
    expect(shelfVersion([row('a', 0, { endsAt: t }), row('b', 1)])).not.toBe(base);
    expect(shelfVersion([row('a', 0, { updatedAt: new Date(t.getTime() + 1) }), row('b', 1)])).not.toBe(base);
    expect(shelfVersion([])).toBe(shelfVersion([]));
    expect(shelfVersion([])).not.toBe(base);
  });
});

describe('merch-shelf: cảnh báo sẵn sàng', () => {
  const ready = { isPublic: true, inStock: true, hasImage: true, hasShortDesc: true, hasCategory: true };
  it('món đủ thì không cảnh báo; thiếu gì báo nấy', () => {
    expect(pinWarnings(ready)).toEqual([]);
    expect(pinWarnings({ ...ready, inCategory: true })).toEqual([]);
    expect(pinWarnings({ isPublic: false, inStock: false, hasImage: false, hasShortDesc: false, hasCategory: false, inCategory: false })).toEqual([
      'NOT_ON_SALE',
      'OUT_OF_STOCK',
      'NO_IMAGE',
      'NO_SHORT_DESC',
      'NO_CATEGORY',
      'OUTSIDE_CATEGORY',
    ]);
  });
});

describe('merch-shelf: gợi ý trải đều', () => {
  it('ưu tiên khác nhãn và khác danh mục, hết thì nới dần, giữ thứ tự xếp hạng khi được', () => {
    const c = (id: string, brand: string, cat: string) => ({ id, brand, categoryIds: [cat] });
    const ranked = [c('1', 'A', 'x'), c('2', 'A', 'y'), c('3', 'B', 'x'), c('4', 'B', 'z'), c('5', 'C', 'y'), c('6', 'a', 'w')];
    expect(spreadPick(ranked, 3).map((p) => p.id)).toEqual(['1', '4', '5']);
    expect(spreadPick(ranked, 6).map((p) => p.id)).toEqual(['1', '4', '5', '6', '2', '3']);
    expect(spreadPick(ranked, 10)).toHaveLength(6);
    expect(spreadPick([], 8)).toEqual([]);
  });
});
