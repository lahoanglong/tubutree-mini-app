import { describe, expect, it } from 'vitest';
import type { BundleDTO, BundleItemDTO } from '../api/bundle';
import type { ProductCard } from '../api/catalog';
import { PDP_ADDON_MAX, PDP_COMBO_MAX, addonLines, addonRows, addonSummary, bundleLive, comboView } from './bundle-view';

const NOW = Date.parse('2026-11-05T05:00:00Z');
const LATER = '2026-11-12T00:00:00.000Z';

const card = (id: string, o: Partial<ProductCard> = {}): ProductCard => ({
  id,
  slug: `sp-${id}`,
  brand: 'Tubu',
  name: `SP ${id}`,
  thumbnail: `https://img/${id}.jpg`,
  basePrice: 60_000,
  salePrice: null,
  isFeatured: false,
  inStock: true,
  ...o,
});
type ItemOpts = Partial<Omit<BundleItemDTO, 'product'>> & { product?: Partial<ProductCard> };
const item = (id: string, o: ItemOpts = {}): BundleItemDTO => {
  const { product, ...rest } = o;
  return { productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: true, product: card(id, product), ...rest };
};
const combo = (items: BundleItemDTO[], o: Partial<BundleDTO> = {}): BundleDTO => ({
  id: 'b1',
  kind: 'BUNDLE_PCT',
  title: 'Bộ đôi',
  pct: 10,
  endAt: LATER,
  anchorProductId: null,
  items,
  ...o,
});
const addon = (id: string, items: BundleItemDTO[], o: Partial<BundleDTO> = {}): BundleDTO => ({
  id,
  kind: 'ADDON',
  title: 'Kèm',
  pct: null,
  endAt: LATER,
  anchorProductId: 'anchor',
  items,
  ...o,
});

describe('hằng số', () => {
  it('khớp kệ pdp.combos / pdp.addons', () => {
    expect([PDP_COMBO_MAX, PDP_ADDON_MAX]).toEqual([2, 3]);
  });
});

describe('bundleLive', () => {
  it('đúng lúc endAt là đã hết; endAt hỏng thì không còn', () => {
    expect(bundleLive({ endAt: LATER }, NOW)).toBe(true);
    expect(bundleLive({ endAt: new Date(NOW).toISOString() }, NOW)).toBe(false);
    expect(bundleLive({ endAt: 'không phải ngày' }, NOW)).toBe(false);
  });
});

describe('comboView', () => {
  it('tổng và tổng sau giảm theo floor từng món; lines đủ món, mỗi món một đơn vị', () => {
    const v = comboView(combo([item('a', { product: { basePrice: 99 } }), item('b', { product: { basePrice: 99, salePrice: 55 } })], { pct: 10 }), NOW)!;
    expect(v.total).toBe(99 + 55);
    expect(v.comboTotal).toBe(154 - (Math.floor(99 * 0.1) + Math.floor(55 * 0.1)));
    expect(v.lines).toEqual([{ variationId: 'v-a', quantity: 1 }, { variationId: 'v-b', quantity: 1 }]);
    expect(v).toMatchObject({ id: 'b1', title: 'Bộ đôi', pct: 10 });
    expect(v.items.map((i) => [i.id, i.stock])).toEqual([['a', 'in'], ['b', 'in']]);
  });

  it('món hết hàng: thẻ món báo hết (ComboCard khoá nút), combo vẫn hiện', () => {
    const v = comboView(combo([item('a'), item('b', { inStock: false })]), NOW)!;
    expect(v.items.map((i) => i.stock)).toEqual(['in', 'out']);
  });

  it('hết hạn, một sản phẩm, pct không dương, thiếu phân loại, hoặc không phải combo → null', () => {
    const two = [item('a'), item('b')];
    expect(comboView(combo(two, { endAt: new Date(NOW).toISOString() }), NOW)).toBeNull();
    expect(comboView(combo([item('a')]), NOW)).toBeNull();
    expect(comboView(combo([item('a'), item('a')]), NOW)).toBeNull();
    expect(comboView(combo(two, { pct: 0 }), NOW)).toBeNull();
    expect(comboView(combo(two, { pct: null }), NOW)).toBeNull();
    expect(comboView(combo([item('a'), item('b', { variationId: null })]), NOW)).toBeNull();
    expect(comboView(addon('x', two), NOW)).toBeNull();
  });
});

describe('addonRows', () => {
  const deal = (id: string, price: number, o: ItemOpts = {}) => item(id, { addonPrice: price, ...o });

  it('giá kèm, giá gốc, % tiết kiệm làm tròn, giữ maxQty', () => {
    const rows = addonRows([addon('a1', [deal('p2', 40_000, { maxQty: 2 })])], NOW);
    expect(rows).toEqual([
      { key: 'a1:p2', bundleId: 'a1', productId: 'p2', variationId: 'v-p2', name: 'SP p2', thumbnail: 'https://img/p2.jpg', listPrice: 60_000, addonPrice: 40_000, savingPct: 33, maxQty: 2 },
    ]);
  });

  it('giá gốc là giá đang bán (sale nếu có)', () => {
    const rows = addonRows([addon('a1', [deal('p2', 30_000, { product: { basePrice: 80_000, salePrice: 50_000 } })])], NOW);
    expect(rows[0]).toMatchObject({ listPrice: 50_000, savingPct: 40 });
  });

  it('bỏ món hết hàng, thiếu phân loại, giá kèm không thấp hơn giá bán, và bộ hết hạn', () => {
    const rows = addonRows(
      [
        addon('a1', [deal('out', 10_000, { inStock: false }), deal('novar', 10_000, { variationId: null }), deal('same', 60_000), deal('high', 70_000), deal('ok', 59_999)]),
        addon('a2', [deal('late', 1_000)], { endAt: new Date(NOW).toISOString() }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.productId)).toEqual(['ok']);
  });

  it('bỏ bộ không phải ADDON; cắt đúng max (mặc định 3)', () => {
    const many = addon('a1', ['p1', 'p2', 'p3', 'p4'].map((id) => deal(id, 1_000)));
    expect(addonRows([many, combo([item('x'), item('y')])], NOW)).toHaveLength(3);
    expect(addonRows([many], NOW, 2).map((r) => r.productId)).toEqual(['p1', 'p2']);
  });

  it('một sản phẩm ở hai bộ chỉ một dòng, lấy giá kèm thấp nhất (không thêm hai đơn vị)', () => {
    const rows = addonRows([addon('a1', [deal('p2', 45_000)]), addon('a2', [deal('p2', 40_000)])], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'a2:p2', addonPrice: 40_000 });
  });
});

describe('addonSummary và addonLines', () => {
  const rows = addonRows([addon('a1', [item('p1', { addonPrice: 40_000 }), item('p2', { addonPrice: 50_000 })])], NOW);

  it('cộng đúng phải trả và tiết kiệm của dòng đã chọn; rỗng → 0', () => {
    expect(addonSummary(rows, new Set(['a1:p1', 'a1:p2']))).toEqual({ count: 2, pay: 90_000, save: 30_000 });
    expect(addonSummary(rows, new Set(['a1:p2']))).toEqual({ count: 1, pay: 50_000, save: 10_000 });
    expect(addonSummary(rows, new Set())).toEqual({ count: 0, pay: 0, save: 0 });
    expect(addonSummary(rows, new Set(['khoá lạ']))).toEqual({ count: 0, pay: 0, save: 0 });
  });

  it('dòng giỏ chỉ gồm món đã chọn, mỗi món một đơn vị', () => {
    expect(addonLines(rows, new Set(['a1:p2']))).toEqual([{ variationId: 'v-p2', quantity: 1 }]);
    expect(addonLines(rows, new Set())).toEqual([]);
  });
});
