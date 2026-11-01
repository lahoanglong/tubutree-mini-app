import { describe, expect, it } from 'vitest';
import type { AdminBundle } from './admin-bundles-client';
import { buildBundleInput, draftFromBundle, emptyBundleDraft, type BundleDraft, type BundleDraftItem } from './admin-bundle-form';

const item = (productId: string, o: Partial<BundleDraftItem> = {}): BundleDraftItem => ({
  productId, name: `SP ${productId}`, variationId: null, variationName: null, price: null, addonPrice: '', maxQty: '1', ...o,
});
const draft = (o: Partial<BundleDraft> = {}): BundleDraft => ({
  ...emptyBundleDraft('BUNDLE_PCT'), title: 'Combo gội xả', pct: '10', startAt: '2026-11-01T00:00', endAt: '2026-11-10T23:59', items: [item('p1'), item('p2')], ...o,
});
const addon = (o: Partial<BundleDraft> = {}): BundleDraft =>
  draft({ kind: 'ADDON', pct: '', anchor: { id: 'p0', name: 'Chính' }, items: [item('p1', { addonPrice: '39000', variationId: 'v1' })], ...o });
const pinned = (productId: string, o: Partial<BundleDraftItem> = {}) => item(productId, { variationId: `v-${productId}`, ...o });
const error = (d: BundleDraft) => {
  const r = buildBundleInput(d);
  return r.ok ? null : r.error;
};

describe('buildBundleInput: combo giảm %', () => {
  it('đủ dữ liệu: đổi giờ Việt Nam sang ISO +07:00, % và số món thành số, bỏ giá kèm/sản phẩm chính', () => {
    const r = buildBundleInput(draft());
    expect(r).toEqual({
      ok: true,
      input: {
        kind: 'BUNDLE_PCT', title: 'Combo gội xả', pct: 10,
        startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-10T16:59:00.000Z',
        isActive: true, sortOrder: 0,
        items: [{ productId: 'p1', maxQty: 1 }, { productId: 'p2', maxQty: 1 }],
      },
    });
  });

  it('mỗi món một lần, từ 2 đến 6 sản phẩm', () => {
    expect(error(draft({ items: [item('p1')] }))).toMatch(/ít nhất 2/);
    expect(error(draft({ items: [item('p1'), item('p1')] }))).toMatch(/một lần/);
    expect(error(draft({ items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p) => item(p)) }))).toMatch(/tối đa 6/);
  });

  it('% phải là số nguyên 1..100', () => {
    for (const bad of ['', '0', '101', '10.5', 'abc']) expect(error(draft({ pct: bad }))).toMatch(/% giảm/);
  });
});

describe('buildBundleInput: mua kèm', () => {
  it('có sản phẩm chính, giá kèm nguyên không âm (0đ hợp lệ), không gửi pct', () => {
    expect(buildBundleInput(addon())).toMatchObject({
      ok: true,
      input: { kind: 'ADDON', anchorProductId: 'p0', items: [{ productId: 'p1', variationId: 'v1', addonPrice: 39_000, maxQty: 1 }] },
    });
    const free = buildBundleInput(addon({ items: [pinned('p1', { addonPrice: '0' })] }));
    expect(free.ok && free.input.items[0]!.addonPrice).toBe(0);
    expect(free.ok && 'pct' in free.input).toBe(false);
  });

  it('thiếu sản phẩm chính, món trùng sản phẩm chính, quá 3 món', () => {
    expect(error(addon({ anchor: null }))).toMatch(/sản phẩm chính/);
    expect(error(addon({ items: [pinned('p0', { addonPrice: '1' })] }))).toMatch(/khác sản phẩm chính/);
    expect(error(addon({ items: ['a', 'b', 'c', 'd'].map((p) => pinned(p, { addonPrice: '1' })) }))).toMatch(/tối đa 3/);
  });

  it('giá kèm trống, âm, lẻ hoặc không thấp hơn giá đang bán (khi đã biết) thì từ chối', () => {
    for (const bad of ['', '-1', '1.5', 'x']) expect(error(addon({ items: [pinned('p1', { addonPrice: bad })] }))).toMatch(/giá mua kèm/i);
    expect(error(addon({ items: [pinned('p1', { addonPrice: '50000', price: 50_000 })] }))).toContain('thấp hơn giá đang bán');
    expect(error(addon({ items: [pinned('p1', { addonPrice: '49999', price: 50_000 })] }))).toBeNull();
  });

  it('món mua kèm phải ghim phân loại: giá kèm cố định không áp được cho mọi phân loại của sản phẩm', () => {
    expect(error(addon({ items: [item('p1', { addonPrice: '39000' })] }))).toMatch(/Chọn phân loại/);
  });
});

describe('buildBundleInput: dùng chung', () => {
  it('tên, giờ, thứ tự, số lượng ưu đãi mỗi đơn', () => {
    expect(error(draft({ title: '  ' }))).toMatch(/tên bộ/i);
    expect(error(draft({ startAt: '', endAt: '2026-11-10T23:59' }))).toMatch(/ngày và giờ/);
    expect(error(draft({ endAt: '2026-11-01T00:00' }))).toMatch(/sau giờ bắt đầu/);
    expect(error(draft({ sortOrder: '10000' }))).toMatch(/Thứ tự/);
    for (const bad of ['0', '11', '', '1.5']) expect(error(draft({ items: [item('p1', { maxQty: bad }), item('p2')] }))).toMatch(/từ 1 đến 10/);
  });

  it('giữ phân loại ghim của món khi sửa', () => {
    const r = buildBundleInput(draft({ items: [item('p1', { variationId: 'v9', variationName: '250ml' }), item('p2')] }));
    expect(r.ok && r.input.items[0]).toEqual({ productId: 'p1', variationId: 'v9', maxQty: 1 });
  });
});

describe('draftFromBundle', () => {
  const bundle: AdminBundle = {
    id: 'b1', kind: 'ADDON', title: 'Kèm xà phòng', pct: null, anchorProductId: 'p0', anchorProductName: 'Dầu gội',
    startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-10T16:59:00.000Z', isActive: false, sortOrder: 3, status: 'off', createdById: 'u1', createdByStaff: true,
    items: [{ productId: 'p1', productName: 'Xà phòng', productSlug: 'xa-phong', variationId: 'v1', variationName: '100g', addonPrice: 39_000, maxQty: 2, price: 50_000 }],
  };

  it('đưa bộ có sẵn về bản nháp của form (giờ Việt Nam) và ngược lại cho đúng dữ liệu cũ', () => {
    const d = draftFromBundle(bundle);
    expect(d).toMatchObject({ kind: 'ADDON', title: 'Kèm xà phòng', pct: '', anchor: { id: 'p0', name: 'Dầu gội' }, startAt: '2026-11-01T00:00', endAt: '2026-11-10T23:59', sortOrder: '3', isActive: false });
    expect(d.items).toEqual([{ productId: 'p1', name: 'Xà phòng', variationId: 'v1', variationName: '100g', price: 50_000, addonPrice: '39000', maxQty: '2' }]);
    const r = buildBundleInput(d);
    expect(r).toMatchObject({ ok: true, input: { kind: 'ADDON', anchorProductId: 'p0', startAt: bundle.startAt, endAt: bundle.endAt, isActive: false, sortOrder: 3, items: [{ productId: 'p1', variationId: 'v1', addonPrice: 39_000, maxQty: 2 }] } });
  });
});
