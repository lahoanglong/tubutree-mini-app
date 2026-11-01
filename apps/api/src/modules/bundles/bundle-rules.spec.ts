import { allocateBundleDiscounts, bundleExposure, mergeMaxPerLine, type BundleLine, type LiveBundle } from './bundle-rules';

const line = (variationId: string, productId: string, total: number, quantity = 1): BundleLine => ({ variationId, productId, total, quantity });
const pct = (id: string, p: number, items: LiveBundle['items']): LiveBundle => ({ id, kind: 'BUNDLE_PCT', pct: p, anchorProductId: null, items });
const addon = (id: string, anchor: string | null, items: LiveBundle['items']): LiveBundle => ({ id, kind: 'ADDON', pct: null, anchorProductId: anchor, items });
const item = (productId: string, o: Partial<LiveBundle['items'][number]> = {}) => ({ productId, variationId: null, addonPrice: null, maxQty: 1, ...o });
const NONE = { total: 0, perLine: {} };

describe('allocateBundleDiscounts: BUNDLE_PCT', () => {
  const set = pct('b1', 10, [item('p1'), item('p2')]);

  it('đủ bộ: mỗi món giảm %, chỉ maxQty đơn vị mỗi món được hưởng', () => {
    const out = allocateBundleDiscounts([set], [line('v1', 'p1', 60_000), line('v2', 'p2', 80_000, 2)], 50);
    expect(out).toEqual({ total: 10_000, perLine: { v1: 6_000, v2: 4_000 } });
  });

  it('thiếu một món của bộ → không giảm', () => {
    expect(allocateBundleDiscounts([set], [line('v1', 'p1', 60_000)], 50)).toEqual(NONE);
  });

  it('bộ chỉ có một sản phẩm khác nhau hoặc % không dương → không giảm (không phải combo)', () => {
    expect(allocateBundleDiscounts([pct('b', 10, [item('p1')])], [line('v1', 'p1', 60_000)], 50)).toEqual(NONE);
    expect(allocateBundleDiscounts([pct('b', 0, [item('p1'), item('p2')])], [line('v1', 'p1', 100), line('v2', 'p2', 100)], 50)).toEqual(NONE);
  });

  it('% vượt trần cấu hình thì kẹp về trần', () => {
    const out = allocateBundleDiscounts([pct('b', 90, [item('p1'), item('p2')])], [line('v1', 'p1', 100_000), line('v2', 'p2', 100_000)], 30);
    expect(out.perLine).toEqual({ v1: 30_000, v2: 30_000 });
  });

  it('món ghim phân loại: phân loại khác của cùng sản phẩm không đủ bộ; đúng phân loại thì giảm đúng dòng đó', () => {
    const pinned = pct('b', 10, [item('p1', { variationId: 'v1a' }), item('p2')]);
    expect(allocateBundleDiscounts([pinned], [line('v1b', 'p1', 100_000), line('v2', 'p2', 100_000)], 50)).toEqual(NONE);
    const out = allocateBundleDiscounts([pinned], [line('v1a', 'p1', 100_000), line('v1b', 'p1', 100_000), line('v2', 'p2', 100_000)], 50);
    expect(out.perLine).toEqual({ v1a: 10_000, v2: 10_000 });
  });

  it('món không ghim, hai phân loại cùng sản phẩm: tổng đơn vị được hưởng đúng maxQty', () => {
    const b = pct('b', 10, [item('p1', { maxQty: 2 }), item('p2')]);
    const out = allocateBundleDiscounts([b], [line('v1a', 'p1', 200_000, 2), line('v1b', 'p1', 200_000, 2), line('v2', 'p2', 100_000)], 50);
    expect(out.perLine).toEqual({ v1a: 20_000, v2: 10_000 });
  });

  it('làm tròn xuống từng dòng và không bao giờ vượt total của dòng', () => {
    const out = allocateBundleDiscounts([pct('b', 100, [item('p1'), item('p2')])], [line('v1', 'p1', 99), line('v2', 'p2', 1)], 100);
    expect(out.perLine).toEqual({ v1: 99, v2: 1 });
    const odd = allocateBundleDiscounts([pct('b', 10, [item('p1'), item('p2')])], [line('v1', 'p1', 99), line('v2', 'p2', 100)], 50);
    expect(odd.perLine.v1).toBe(9);
  });

  it('dòng không có số lượng hợp lệ bị bỏ, không chia cho 0', () => {
    expect(allocateBundleDiscounts([set], [line('v1', 'p1', 100, 0), line('v2', 'p2', 100)], 50)).toEqual(NONE);
  });
});

describe('allocateBundleDiscounts: ADDON', () => {
  const deal = addon('a1', 'p1', [item('p2', { addonPrice: 39_000 })]);

  it('có sản phẩm chính: món kèm về giá kèm', () => {
    const out = allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50);
    expect(out).toEqual({ total: 11_000, perLine: { v2: 11_000 } });
  });

  it('thiếu sản phẩm chính hoặc bộ mất sản phẩm chính → không giảm', () => {
    expect(allocateBundleDiscounts([deal], [line('v2', 'p2', 50_000)], 50)).toEqual(NONE);
    expect(allocateBundleDiscounts([addon('a', null, [item('p2', { addonPrice: 1 })])], [line('v1', 'p1', 1), line('v2', 'p2', 50_000)], 50)).toEqual(NONE);
  });

  it('giá kèm không thấp hơn đơn giá hiện tại (sale tụt) → không giảm, không bao giờ làm giá tăng', () => {
    expect(allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 30_000)], 50)).toEqual(NONE);
    expect(allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 39_000)], 50)).toEqual(NONE);
  });

  it('giá kèm 0đ hợp lệ: giảm đủ đơn giá, không vượt total của dòng', () => {
    const free = addon('a', 'p1', [item('p2', { addonPrice: 0 })]);
    const out = allocateBundleDiscounts([free], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50);
    expect(out.perLine).toEqual({ v2: 50_000 });
  });

  it('chỉ maxQty đơn vị được giá kèm', () => {
    const out = allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 150_000, 3)], 50);
    expect(out.perLine).toEqual({ v2: 11_000 });
    const two = addon('a', 'p1', [item('p2', { addonPrice: 39_000, maxQty: 2 })]);
    expect(allocateBundleDiscounts([two], [line('v1', 'p1', 80_000), line('v2', 'p2', 150_000, 3)], 50).perLine).toEqual({ v2: 22_000 });
  });

  it('món kèm trùng sản phẩm chính bị bỏ; món không có giá kèm bị bỏ', () => {
    const odd = addon('a', 'p1', [item('p1', { addonPrice: 0 }), item('p2')]);
    expect(allocateBundleDiscounts([odd], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50)).toEqual(NONE);
  });
});

describe('gộp nhiều bộ: mỗi dòng lấy khoản LỚN NHẤT, không cộng', () => {
  it('hai bộ cùng dòng', () => {
    const lines = [line('v1', 'p1', 100_000), line('v2', 'p2', 100_000)];
    const out = allocateBundleDiscounts([pct('a', 10, [item('p1'), item('p2')]), pct('b', 25, [item('p1'), item('p2')])], lines, 50);
    expect(out.perLine).toEqual({ v1: 25_000, v2: 25_000 });
    expect(out.total).toBe(50_000);
  });

  it('mergeMaxPerLine lấy max từng dòng và tính lại total', () => {
    expect(mergeMaxPerLine({ total: 14, perLine: { v1: 5, v2: 9 } }, { total: 7, perLine: { v1: 7 } })).toEqual({ total: 16, perLine: { v1: 7, v2: 9 } });
    expect(mergeMaxPerLine(NONE, NONE)).toEqual(NONE);
  });
});

describe('bundleExposure: số tiền tối đa một đơn được giảm', () => {
  it('BUNDLE_PCT cộng floor(giá × % / 100) × maxQty từng món', () => {
    const items = [{ price: 60_000, addonPrice: null, maxQty: 1 }, { price: 40_000, addonPrice: null, maxQty: 2 }];
    expect(bundleExposure({ kind: 'BUNDLE_PCT', pct: 10 }, items)).toBe(14_000);
  });

  it('ADDON cộng (giá − giá kèm) × maxQty, giá kèm cao hơn giá thì 0', () => {
    expect(bundleExposure({ kind: 'ADDON', pct: null }, [{ price: 50_000, addonPrice: 39_000, maxQty: 2 }])).toBe(22_000);
    expect(bundleExposure({ kind: 'ADDON', pct: null }, [{ price: 30_000, addonPrice: 39_000, maxQty: 2 }])).toBe(0);
  });
});
