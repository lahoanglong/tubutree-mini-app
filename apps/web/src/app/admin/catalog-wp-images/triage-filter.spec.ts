import { describe, it, expect } from 'vitest';
import type { WpImageList, WpImageRow } from '@/lib/wp-image-candidates';
import { TRIAGE_FILTERS, applyOptimistic, filterCounts, matchesFilter, stillWithoutImage } from './triage-filter';

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
  ...over,
});

const rows: WpImageRow[] = [
  row({ productId: 'a', tier: 'EXACT', state: 'PENDING' }),
  row({ productId: 'b', tier: 'SAME_LINE', state: 'PENDING' }),
  row({ productId: 'c', tier: 'EXACT', state: 'SKIPPED' }),
  row({ productId: 'd', tier: 'WEAK', state: 'APPLIED', appliedCount: 3, wp: null, defaultImageUrls: null }),
  row({ productId: 'e', tier: 'COMPOSITE', state: 'HAS_IMAGES', wp: null, defaultImageUrls: null }),
];

describe('nhóm lọc duyệt ảnh WordPress', () => {
  it('đủ sáu nhóm theo thứ tự đề bài', () => {
    expect(TRIAGE_FILTERS.map((f) => f.label)).toEqual(['Tất cả', 'Chờ duyệt', 'Khớp chính xác', 'Đã duyệt', 'Đã bỏ qua', 'Chưa có ảnh']);
  });

  it('mỗi nhóm lọc đúng dòng', () => {
    const ids = (f: Parameters<typeof matchesFilter>[1]) => rows.filter((r) => matchesFilter(r, f)).map((r) => r.productId);
    expect(ids('all')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids('pending')).toEqual(['a', 'b']);
    expect(ids('exact')).toEqual(['a', 'c']);
    expect(ids('applied')).toEqual(['d']);
    expect(ids('skipped')).toEqual(['c']);
    expect(ids('noImage')).toEqual(['a', 'b', 'c']);
  });

  it('bộ đếm khớp số dòng của từng nhóm', () => {
    expect(filterCounts(rows)).toEqual({ all: 5, pending: 2, exact: 2, applied: 1, skipped: 1, noImage: 3 });
    expect(filterCounts([])).toEqual({ all: 0, pending: 0, exact: 0, applied: 0, skipped: 0, noImage: 0 });
  });

  it('"Chưa có ảnh" chỉ tính sản phẩm còn rỗng ảnh', () => {
    expect(rows.map(stillWithoutImage)).toEqual([true, true, true, false, false]);
  });
});

describe('applyOptimistic', () => {
  const list: WpImageList = { items: rows, counts: { PENDING: 2, SKIPPED: 1, APPLIED: 1, HAS_IMAGES: 1 } };

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
