import { NotFoundException } from '@nestjs/common';
import { BundlesService } from './bundles.service';
import { bundleLiveWhere } from './bundle-read';

const NOW = new Date('2026-11-05T05:00:00Z');
const card = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  slug: `sp-${id}`,
  brand: 'Tubu',
  name: `SP ${id}`,
  thumbnail: null,
  basePrice: 50_000,
  salePrice: null,
  repVariationId: `v-${id}`,
  isFeatured: false,
  inStock: true,
  ...o,
});
const item = (productId: string, o: Record<string, unknown> = {}) => ({
  productId,
  variationId: null,
  addonPrice: null,
  maxQty: 1,
  sortOrder: 0,
  product: { storefrontId: null },
  ...o,
});
const row = (o: Record<string, unknown> = {}) => ({
  id: 'b1',
  kind: 'BUNDLE_PCT',
  title: 'Bộ đôi',
  pct: 10,
  anchorProductId: null,
  anchorProduct: null,
  endAt: new Date('2026-11-30T00:00:00Z'),
  items: [item('p1'), item('p2')],
  ...o,
});

function setup(o: { rows?: unknown[]; cards?: ReturnType<typeof card>[]; product?: unknown; variations?: unknown[]; maxPct?: number } = {}) {
  const prisma = {
    product: { findFirst: jest.fn().mockResolvedValue(o.product === undefined ? { id: 'p1', storefrontId: null } : o.product) },
    bundle: { findMany: jest.fn().mockResolvedValue(o.rows ?? [row()]) },
    variation: { findMany: jest.fn().mockResolvedValue(o.variations ?? []) },
  };
  const catalog = { cardsByIds: jest.fn().mockResolvedValue(o.cards ?? [card('p1'), card('p2')]) };
  const config = { get: jest.fn().mockImplementation(async (_k: string, fb: unknown) => o.maxPct ?? fb) };
  return { svc: new BundlesService(prisma as never, catalog as never, config as never), prisma, catalog };
}

describe('BundlesService.forProduct', () => {
  it('chỉ đọc bộ đang chạy có sản phẩm này (món của bộ hoặc sản phẩm chính)', async () => {
    const { svc, prisma } = setup();
    await svc.forProduct('sp-p1', NOW);
    const where = prisma.bundle.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject(bundleLiveWhere(NOW));
    expect(where.OR).toEqual([{ items: { some: { productId: 'p1' } } }, { anchorProductId: 'p1' }]);
  });

  it('combo: đủ món kèm thẻ, giá, hạn; % kẹp theo bundle.max_pct', async () => {
    const { svc } = setup({ rows: [row({ pct: 90 })], maxPct: 25 });
    const out = await svc.forProduct('sp-p1', NOW);
    expect(out.addons).toEqual([]);
    expect(out.combos).toHaveLength(1);
    const c = out.combos[0]!;
    expect(c).toMatchObject({ id: 'b1', kind: 'BUNDLE_PCT', title: 'Bộ đôi', pct: 25, endAt: '2026-11-30T00:00:00.000Z', anchorProductId: null });
    expect(c.items.map((i) => [i.productId, i.variationId, i.inStock, i.maxQty, i.addonPrice])).toEqual([
      ['p1', 'v-p1', true, 1, null],
      ['p2', 'v-p2', true, 1, null],
    ]);
    expect(c.items[0]!.product).toMatchObject({ id: 'p1', basePrice: 50_000 });
  });

  it('bộ có món thuộc gian hàng đối tác bị bỏ cả bộ', async () => {
    const partner = row({ items: [item('p1'), item('p2', { product: { storefrontId: 'sf1' } })] });
    expect((await setup({ rows: [partner] }).svc.forProduct('sp-p1', NOW)).combos).toEqual([]);
  });

  it('món bị ẩn khỏi catalog công khai (cardsByIds không trả) thì bỏ cả bộ, không quảng cáo bộ không đủ', async () => {
    const { svc } = setup({ cards: [card('p1')] });
    expect((await svc.forProduct('sp-p1', NOW)).combos).toEqual([]);
  });

  it('món hết hàng: bộ vẫn hiện nhưng inStock=false để thẻ báo "Combo tạm hết"', async () => {
    const { svc } = setup({ cards: [card('p1'), card('p2', { inStock: false })] });
    const c = (await svc.forProduct('sp-p1', NOW)).combos[0]!;
    expect(c.items.map((i) => i.inStock)).toEqual([true, false]);
  });

  it('món ghim phân loại: giá và tồn lấy từ đúng phân loại ghim; phân loại ghim đã tắt thì bỏ cả bộ', async () => {
    const pinned = row({ items: [item('p1'), item('p2', { variationId: 'v2b' })] });
    const ok = setup({ rows: [pinned], variations: [{ id: 'v2b', productId: 'p2', retailPrice: 70_000, salePrice: 65_000, stock: 0 }] });
    const c = (await ok.svc.forProduct('sp-p1', NOW)).combos[0]!;
    expect(c.items[1]).toMatchObject({ variationId: 'v2b', inStock: false });
    expect(c.items[1]!.product).toMatchObject({ basePrice: 70_000, salePrice: 65_000, repVariationId: 'v2b' });
    expect((await setup({ rows: [pinned], variations: [] }).svc.forProduct('sp-p1', NOW)).combos).toEqual([]);
    expect(ok.prisma.variation.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['v2b'] }, isActive: true });
  });

  it('chỉ bộ có từ hai sản phẩm khác nhau mới là combo', async () => {
    const one = row({ items: [item('p1')] });
    expect((await setup({ rows: [one] }).svc.forProduct('sp-p1', NOW)).combos).toEqual([]);
  });

  it('ADDON chỉ hiện ở sản phẩm chính; món kèm thiếu giá kèm thì bỏ bộ; ở trang của món kèm không hiện', async () => {
    const addon = row({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items: [item('p2', { addonPrice: 39_000, maxQty: 2 })] });
    const onAnchor = await setup({ rows: [addon] }).svc.forProduct('sp-p1', NOW);
    expect(onAnchor.combos).toEqual([]);
    expect(onAnchor.addons).toHaveLength(1);
    expect(onAnchor.addons[0]!).toMatchObject({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1' });
    expect(onAnchor.addons[0]!.items[0]).toMatchObject({ productId: 'p2', addonPrice: 39_000, maxQty: 2 });

    const onSide = await setup({ rows: [addon], product: { id: 'p2', storefrontId: null }, cards: [card('p1'), card('p2')] }).svc.forProduct('sp-p2', NOW);
    expect(onSide.addons).toEqual([]);

    const noPrice = row({ ...addon, items: [item('p2')] });
    expect((await setup({ rows: [noPrice] }).svc.forProduct('sp-p1', NOW)).addons).toEqual([]);
  });

  it('ADDON: món có giá kèm không thấp hơn giá đang bán bị bỏ (không quảng cáo deal không giảm được); hết món thì bỏ bộ', async () => {
    const mk = (extra: unknown[]) =>
      row({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items: extra });
    const mixed = mk([item('p2', { addonPrice: 50_000 }), item('p3', { addonPrice: 10_000 })]);
    const cards = [card('p1'), card('p2'), card('p3')];
    const out = await setup({ rows: [mixed], cards }).svc.forProduct('sp-p1', NOW);
    expect(out.addons[0]!.items.map((i) => i.productId)).toEqual(['p3']);
    const none = mk([item('p2', { addonPrice: 60_000 })]);
    expect((await setup({ rows: [none], cards }).svc.forProduct('sp-p1', NOW)).addons).toEqual([]);
  });

  it('tối đa 2 combo và 3 bộ mua kèm', async () => {
    const combos = ['c1', 'c2', 'c3'].map((id) => row({ id }));
    expect((await setup({ rows: combos }).svc.forProduct('sp-p1', NOW)).combos.map((c) => c.id)).toEqual(['c1', 'c2']);
    const addons = ['a1', 'a2', 'a3', 'a4'].map((id) =>
      row({ id, kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items: [item('p2', { addonPrice: 1000 })] }),
    );
    expect((await setup({ rows: addons }).svc.forProduct('sp-p1', NOW)).addons.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('sản phẩm không có/không công khai → 404; sản phẩm của gian hàng đối tác → rỗng, không đọc bộ', async () => {
    await expect(setup({ product: null }).svc.forProduct('x', NOW)).rejects.toBeInstanceOf(NotFoundException);
    const partner = setup({ product: { id: 'p1', storefrontId: 'sf1' } });
    expect(await partner.svc.forProduct('sp-p1', NOW)).toEqual({ combos: [], addons: [] });
    expect(partner.prisma.bundle.findMany).not.toHaveBeenCalled();
  });
});

describe('BundlesService.homeCombos', () => {
  it('chỉ combo đang chạy, đủ hàng; bộ có món hết hàng bị bỏ', async () => {
    const { svc, prisma } = setup({ rows: [row({ id: 'ok' }), row({ id: 'out', items: [item('p1'), item('p3')] })], cards: [card('p1'), card('p2'), card('p3', { inStock: false })] });
    const out = await svc.homeCombos(4, NOW);
    expect(out.map((b) => b.id)).toEqual(['ok']);
    expect(prisma.bundle.findMany.mock.calls[0][0].where).toMatchObject({ ...bundleLiveWhere(NOW), kind: 'BUNDLE_PCT' });
  });

  it('limit kẹp trong 1..8', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ id: `b${i}` }));
    expect((await setup({ rows }).svc.homeCombos(99, NOW))).toHaveLength(8);
    expect((await setup({ rows }).svc.homeCombos(0, NOW))).toHaveLength(1);
  });
});
