import { describe, expect, it } from 'vitest';
import { RAIL_AS_GRID_MAX, SECTION_BUDGET, SHOP_MAX_SECTIONS, collectionView, railFitsRow } from './collection-view';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

describe('railFitsRow', () => {
  it('kệ ngang từ 6 món trở xuống vừa một hàng ở màn rộng; 7 món trở lên thì phải cuộn', () => {
    expect(RAIL_AS_GRID_MAX).toBe(6);
    for (const n of [0, 1, 4, 6]) expect(railFitsRow(n), `${n} món`).toBe(true);
    for (const n of [7, 10, 14]) expect(railFitsRow(n), `${n} món`).toBe(false);
  });
  it('số món lạ (âm, NaN) không coi là vừa hàng', () => {
    expect(railFitsRow(-1)).toBe(false);
    expect(railFitsRow(Number.NaN)).toBe(false);
  });
});

describe('collectionView', () => {
  it('hằng số ngân sách', () => {
    expect(SECTION_BUDGET).toEqual({ rail: 10, grid: 6, line: 5 });
    expect(SHOP_MAX_SECTIONS).toBe(6);
  });

  it('CAROUSEL → kệ ngang cắt 10, báo còn nhiều hơn', () => {
    const v = collectionView({ kind: 'NORMAL', layout: 'CAROUSEL', items: items(14) });
    expect(v).toMatchObject({ layout: 'rail', total: 14, hasMore: true, comboPct: null });
    expect(v.items).toHaveLength(10);
    expect(collectionView({ kind: 'NORMAL', layout: 'CAROUSEL', items: items(10) }).hasMore).toBe(false);
  });

  it('GRID → lưới cắt 6 kèm "Tất cả"', () => {
    const v = collectionView({ kind: 'NORMAL', layout: 'GRID', items: items(9) });
    expect(v).toMatchObject({ layout: 'grid', total: 9, hasMore: true });
    expect(v.items).toHaveLength(6);
  });

  it('STACK → dòng cắt 5', () => {
    const v = collectionView({ kind: 'NORMAL', layout: 'STACK', items: items(8) });
    expect(v).toMatchObject({ layout: 'line', total: 8, hasMore: true });
    expect(v.items).toHaveLength(5);
  });

  it('kind COMBO → thẻ combo đủ món, mang % giảm', () => {
    const v = collectionView({ kind: 'COMBO', layout: 'GRID', items: items(8), comboDiscountPct: 12 });
    expect(v).toMatchObject({ layout: 'combo', total: 8, hasMore: false, comboPct: 12 });
    expect(v.items).toHaveLength(8);
  });

  it('COMBO mà % thiếu, 0 hoặc rác thì comboPct null (không hiện "giảm 0%")', () => {
    for (const pct of [null, undefined, 0, -3, Number.NaN]) {
      expect(collectionView({ kind: 'COMBO', layout: 'GRID', items: items(3), comboDiscountPct: pct }).comboPct).toBeNull();
    }
  });

  it('không phải COMBO thì bỏ qua % dù API có trả', () => {
    expect(collectionView({ kind: 'NORMAL', layout: 'GRID', items: items(3), comboDiscountPct: 10 }).comboPct).toBeNull();
  });

  it('bộ sưu tập rỗng không ném lỗi', () => {
    expect(collectionView({ kind: 'NORMAL', layout: 'CAROUSEL', items: [] })).toEqual({ layout: 'rail', items: [], total: 0, hasMore: false, comboPct: null });
  });

  it('layout lạ rơi về lưới như màn gian hàng hiện nay; không đổi mảng vào', () => {
    const src = items(8);
    const copy = [...src];
    expect(collectionView({ kind: 'NORMAL', layout: 'MASONRY', items: src }).layout).toBe('grid');
    expect(src).toEqual(copy);
  });
});
