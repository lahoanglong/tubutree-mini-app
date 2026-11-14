import { describe, it, expect } from 'vitest';
import type { WpImageList, WpImageRow } from '@/lib/wp-image-candidates';
import { TRIAGE_FILTERS, applyOptimistic, filterCounts, hasSuggestion, imageProgress, matchesFilter, matchesQuery, stillWithoutImage } from './triage-filter';

const row = (over: Partial<WpImageRow>): WpImageRow => ({
  productId: 'p1',
  productSlug: 'sp-1',
  name: 'Sản phẩm 1',
  isActive: true,
  variations: [],
  tier: 'EXACT',
  tierLabel: 'Chắc chắn cùng sản phẩm',
  note: '',
  state: 'PENDING',
  decidedBy: null,
  decidedAt: null,
  appliedCount: null,
  wp: [{ id: 1, slug: 'wp-1', name: 'WP 1', imageUrls: ['https://tubutree.com/a.png'], error: null }],
  defaultImageUrls: ['https://tubutree.com/a.png'],
  suggestUnavailable: false,
  ...over,
});

const rows: WpImageRow[] = [
  row({ productId: 'a', tier: 'EXACT', state: 'PENDING' }),
  row({ productId: 'b', tier: 'SAME_LINE', state: 'PENDING' }),
  row({ productId: 'c', tier: 'EXACT', state: 'SKIPPED' }),
  row({ productId: 'd', tier: 'WEAK', state: 'APPLIED', appliedCount: 3, wp: null, defaultImageUrls: null }),
  row({ productId: 'e', tier: 'COMPOSITE', state: 'HAS_IMAGES', wp: null, defaultImageUrls: null }),
  row({ productId: 'f', tier: 'CANDIDATE', state: 'PENDING' }),
  row({ productId: 'g', tier: 'NONE', state: 'PENDING', wp: null, defaultImageUrls: null }),
  row({ productId: 'h', tier: 'NONE', state: 'HAS_IMAGES', wp: null, defaultImageUrls: null }),
  row({ productId: 'i', tier: 'NONE', state: 'PENDING', suggestUnavailable: true, wp: null, defaultImageUrls: null }),
];

describe('nhóm lọc duyệt ảnh WordPress', () => {
  it('đủ tám nhóm: sáu nhóm cũ giữ thứ tự, thêm "Có ảnh gợi ý" và "Chưa có gợi ý"', () => {
    expect(TRIAGE_FILTERS.map((f) => f.label)).toEqual(['Tất cả', 'Chờ duyệt', 'Khớp chính xác', 'Đã duyệt', 'Đã bỏ qua', 'Chưa có ảnh', 'Có ảnh gợi ý', 'Chưa có gợi ý']);
  });

  it('mỗi nhóm lọc đúng dòng; "Chờ duyệt" không lẫn dòng chưa có gợi ý (không có gì để duyệt)', () => {
    const ids = (f: Parameters<typeof matchesFilter>[1]) => rows.filter((r) => matchesFilter(r, f)).map((r) => r.productId);
    expect(ids('all')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(ids('pending')).toEqual(['a', 'b', 'f']);
    expect(ids('exact')).toEqual(['a', 'c']);
    expect(ids('applied')).toEqual(['d']);
    expect(ids('skipped')).toEqual(['c']);
    expect(ids('noImage')).toEqual(['a', 'b', 'c', 'f', 'g', 'i']);
    expect(ids('suggested')).toEqual(['a', 'b', 'c', 'f']);
    expect(ids('noSuggestion')).toEqual(['g']);
  });

  it('WordPress lỗi (chưa biết có gợi ý hay không) không bị tính là "Chưa có gợi ý", vẫn tính là "Chưa có ảnh"', () => {
    const c = filterCounts(rows);
    expect(c.noSuggestion).toBe(1);
    expect(c.suggested + c.noSuggestion + rows.filter((r) => r.suggestUnavailable).length).toBe(c.noImage);
  });

  it('bộ đếm khớp số dòng của từng nhóm', () => {
    expect(filterCounts(rows)).toEqual({ all: 9, pending: 3, exact: 2, applied: 1, skipped: 1, noImage: 6, suggested: 4, noSuggestion: 1 });
    expect(filterCounts([])).toEqual({ all: 0, pending: 0, exact: 0, applied: 0, skipped: 0, noImage: 0, suggested: 0, noSuggestion: 0 });
  });

  it('"Chưa có ảnh" chỉ tính sản phẩm còn rỗng ảnh; chỉ hạng NONE là không có gợi ý', () => {
    expect(rows.map(stillWithoutImage)).toEqual([true, true, true, false, false, true, true, false, true]);
    expect(rows.map(hasSuggestion)).toEqual([true, true, true, true, true, true, false, false, false]);
  });
});

describe('ô tìm duyệt ảnh WordPress', () => {
  const sp = row({ name: 'Cà phê muối túi 50x16g', productSlug: 'ca-phe-muoi-tui-50x16g-9fbabb' });

  it('ô trống hoặc toàn khoảng trắng giữ hết', () => {
    expect(matchesQuery(sp, '')).toBe(true);
    expect(matchesQuery(sp, '   ')).toBe(true);
  });

  it('không phân biệt dấu và hoa thường: "ca phe" ra "Cà phê", "CÀ PHÊ" cũng ra', () => {
    expect(matchesQuery(sp, 'ca phe')).toBe(true);
    expect(matchesQuery(sp, 'CÀ PHÊ MUỐI')).toBe(true);
    expect(matchesQuery(sp, 'đường')).toBe(false);
  });

  it('khớp theo mã sản phẩm (slug), kể cả phần băm cuối và dạng có gạch nối', () => {
    expect(matchesQuery(sp, '9fbabb')).toBe(true);
    expect(matchesQuery(sp, 'ca-phe-muoi')).toBe(true);
    expect(matchesQuery(sp, '9fbabc')).toBe(false);
  });

  it('nhiều từ: phải có đủ mọi từ, thứ tự tuỳ ý', () => {
    expect(matchesQuery(sp, 'muối cà')).toBe(true);
    expect(matchesQuery(sp, 'muối sầu')).toBe(false);
  });
});

describe('applyOptimistic', () => {
  const list: WpImageList = { items: rows.slice(0, 5), counts: { PENDING: 2, SKIPPED: 1, APPLIED: 1, HAS_IMAGES: 1 } };

  it('duyệt: dòng thành APPLIED kèm số ảnh, bỏ ảnh ứng viên, đếm lại, không đổi dòng khác', () => {
    const next = applyOptimistic(list, { kind: 'approve', productId: 'a', imageCount: 2 });
    const a = next.items.find((r) => r.productId === 'a')!;
    expect(a).toMatchObject({ state: 'APPLIED', appliedCount: 2, wp: null, defaultImageUrls: null });
    expect(next.counts).toEqual({ PENDING: 1, SKIPPED: 1, APPLIED: 2, HAS_IMAGES: 1 });
    expect(next.items.find((r) => r.productId === 'b')).toBe(list.items[1]);
  });

  it('bỏ qua và khôi phục giữ ảnh ứng viên để thẻ không trống', () => {
    const skipped = applyOptimistic(list, { kind: 'skip', productId: 'a' });
    expect(skipped.items[0]).toMatchObject({ state: 'SKIPPED', appliedCount: null });
    expect(skipped.items[0]!.defaultImageUrls).toEqual(['https://tubutree.com/a.png']);
    expect(skipped.counts.SKIPPED).toBe(2);
    const restored = applyOptimistic(skipped, { kind: 'restore', productId: 'a' });
    expect(restored.items[0]!.state).toBe('PENDING');
    expect(restored.counts).toEqual(list.counts);
  });

  it('không sửa bản gốc', () => {
    const before = JSON.stringify(list);
    applyOptimistic(list, { kind: 'approve', productId: 'a', imageCount: 1 });
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('applyOptimistic — tải ảnh tay', () => {
  const countOf = (items: WpImageRow[]) => ({
    PENDING: items.filter((r) => r.state === 'PENDING').length,
    SKIPPED: items.filter((r) => r.state === 'SKIPPED').length,
    APPLIED: items.filter((r) => r.state === 'APPLIED').length,
    HAS_IMAGES: items.filter((r) => r.state === 'HAS_IMAGES').length,
  });
  const list: WpImageList = { items: rows, counts: countOf(rows) };

  it('dòng tải ảnh xong thành "Đã có ảnh" (HAS_IMAGES), bỏ ảnh ứng viên, cập nhật số đếm, không đụng dòng khác', () => {
    const next = applyOptimistic(list, { kind: 'upload', productId: 'a' });
    expect(next.items[0]).toMatchObject({ productId: 'a', state: 'HAS_IMAGES', appliedCount: null, wp: null, defaultImageUrls: null });
    expect(next.counts).toEqual({ ...list.counts, PENDING: list.counts.PENDING - 1, HAS_IMAGES: list.counts.HAS_IMAGES + 1 });
    expect(next.items[1]).toBe(list.items[1]);
  });

  it('dòng đã bỏ qua tải ảnh tay cũng thành HAS_IMAGES, không còn nằm trong nhóm "Chưa có ảnh"', () => {
    const next = applyOptimistic(list, { kind: 'upload', productId: 'c' });
    expect(next.items.find((r) => r.productId === 'c')!.state).toBe('HAS_IMAGES');
    expect(filterCounts(next.items).noImage).toBe(filterCounts(list.items).noImage - 1);
  });
});

describe('imageProgress — thanh "Đã đủ X / Y sản phẩm"', () => {
  // rows: d đã duyệt, e và h đã có ảnh => 3 dòng đã đủ trên 9 dòng.
  it('đã đủ = đã duyệt + đã có ảnh; tổng = mọi dòng trên trang', () => {
    expect(imageProgress(rows, new Set())).toEqual({ done: 3, total: rows.length });
  });

  it('sản phẩm tải ảnh tay trong phiên mà máy chủ không còn trả về (rời danh sách) vẫn tính vào cả đủ lẫn tổng', () => {
    expect(imageProgress(rows, new Set(['gone-1', 'gone-2']))).toEqual({ done: 5, total: rows.length + 2 });
  });

  it('id đã tải ảnh mà vẫn còn trong danh sách (HAS_IMAGES) không bị đếm hai lần', () => {
    const list: WpImageList = { items: rows, counts: { PENDING: 5, SKIPPED: 1, APPLIED: 1, HAS_IMAGES: 2 } };
    const after = applyOptimistic(list, { kind: 'upload', productId: 'a' });
    expect(imageProgress(after.items, new Set(['a']))).toEqual({ done: 4, total: rows.length });
  });

  it('danh sách rỗng: 0 / 0', () => {
    expect(imageProgress([], new Set())).toEqual({ done: 0, total: 0 });
  });
});
