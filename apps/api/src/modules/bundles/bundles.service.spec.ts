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
  refPrice: null,
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

type FlashRow = { variationId: string; productId: string; soldCount?: number; quota?: number };
const pin = (id: string, productId: string, o: Record<string, unknown> = {}) => ({ id, productId, retailPrice: 50_000, salePrice: null, stock: 5, ...o });

function setup(
  o: { rows?: unknown[]; cards?: ReturnType<typeof card>[]; product?: unknown; variations?: unknown[]; maxPct?: number; flash?: FlashRow[] } = {},
) {
  const prisma = {
    product: { findFirst: jest.fn().mockResolvedValue(o.product === undefined ? { id: 'p1', storefrontId: null, variations: [{ id: 'v-p1' }] } : o.product) },
    bundle: { findMany: jest.fn().mockResolvedValue(o.rows ?? [row()]) },
    variation: { findMany: jest.fn().mockResolvedValue(o.variations ?? []) },
    flashSaleItem: {
      findMany: jest
        .fn()
        .mockResolvedValue((o.flash ?? []).map((f) => ({ variationId: f.variationId, soldCount: f.soldCount ?? 0, quota: f.quota ?? 10, variation: { productId: f.productId } }))),
    },
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
    const addon = row({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items: [item('p2', { refPrice: 50_000, addonPrice: 39_000, maxQty: 2, variationId: 'v2a' })] });
    const onAnchor = await setup({ rows: [addon], variations: [pin('v2a', 'p2')] }).svc.forProduct('sp-p1', NOW);
    expect(onAnchor.combos).toEqual([]);
    expect(onAnchor.addons).toHaveLength(1);
    expect(onAnchor.addons[0]!).toMatchObject({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1' });
    expect(onAnchor.addons[0]!.items[0]).toMatchObject({ productId: 'p2', variationId: 'v2a', addonPrice: 39_000, maxQty: 2 });

    const onSide = await setup({ rows: [addon], product: { id: 'p2', storefrontId: null, variations: [{ id: 'v-p2' }] }, cards: [card('p1'), card('p2')], variations: [pin('v2a', 'p2')] }).svc.forProduct('sp-p2', NOW);
    expect(onSide.addons).toEqual([]);

    const noPrice = row({ ...addon, items: [item('p2', { variationId: 'v2a' })] });
    expect((await setup({ rows: [noPrice], variations: [pin('v2a', 'p2')] }).svc.forProduct('sp-p1', NOW)).addons).toEqual([]);
  });

  it('sản phẩm chính hết hàng: không hiện Mua kèm (không bỏ món chính vào giỏ được), combo vẫn hiện', async () => {
    const addon = row({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items: [item('p2', { refPrice: 50_000, addonPrice: 39_000, variationId: 'v2a' })] });
    const soldOut = { id: 'p1', storefrontId: null, variations: [] };
    const out = await setup({ rows: [addon, row({ id: 'c1' })], product: soldOut, variations: [pin('v2a', 'p2')] }).svc.forProduct('sp-p1', NOW);
    expect(out.addons).toEqual([]);
    expect(out.combos.map((c) => c.id)).toEqual(['c1']);
    const ok = await setup({ rows: [addon], variations: [pin('v2a', 'p2')] }).svc.forProduct('sp-p1', NOW);
    expect(ok.addons).toHaveLength(1);
  });

  it('tồn của sản phẩm chính đọc theo phân loại đang bán còn tồn (cùng điều kiện với thẻ sản phẩm)', async () => {
    const t = setup();
    await t.svc.forProduct('sp-p1', NOW);
    const arg = t.prisma.product.findFirst.mock.calls[0]![0] as { select: { variations: unknown } };
    expect(arg.select.variations).toMatchObject({ where: { isActive: true, stock: { gt: 0 } } });
  });

  it('ADDON ghi tay không ghim phân loại: không quảng cáo (giỏ không giảm vì giá kèm cố định không hợp nhiều phân loại)', async () => {
    const unpinned = row({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items: [item('p2', { addonPrice: 10_000 })] });
    expect((await setup({ rows: [unpinned] }).svc.forProduct('sp-p1', NOW)).addons).toEqual([]);
  });

  it('ADDON: món có giá kèm không thấp hơn giá đang bán bị bỏ (không quảng cáo deal không giảm được); hết món thì bỏ bộ', async () => {
    const mk = (extra: unknown[]) =>
      row({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items: extra });
    const mixed = mk([item('p2', { refPrice: 50_000, addonPrice: 50_000, variationId: 'v2a' }), item('p3', { refPrice: 50_000, addonPrice: 10_000, variationId: 'v3a' })]);
    const cards = [card('p1'), card('p2'), card('p3')];
    const variations = [pin('v2a', 'p2'), pin('v3a', 'p3')];
    const out = await setup({ rows: [mixed], cards, variations }).svc.forProduct('sp-p1', NOW);
    expect(out.addons[0]!.items.map((i) => i.productId)).toEqual(['p3']);
    const none = mk([item('p2', { refPrice: 50_000, addonPrice: 60_000, variationId: 'v2a' })]);
    expect((await setup({ rows: [none], cards, variations }).svc.forProduct('sp-p1', NOW)).addons).toEqual([]);
  });

  describe('giá mua kèm công khai = giá giỏ tính (cùng addonPayPrice, trần theo giá tham chiếu lúc tạo)', () => {
    const mk = (items: unknown[]) => row({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items });
    const kem = (o: Record<string, unknown> = {}) => item('p2', { variationId: 'v2a', addonPrice: 39_000, refPrice: 50_000, ...o });
    const priced = async (items: unknown[], variation: Record<string, unknown>) =>
      (await setup({ rows: [mk(items)], variations: [pin('v2a', 'p2', variation)] }).svc.forProduct('sp-p1', NOW)).addons[0]?.items[0];

    it('phân loại tăng giá sau khi tạo (50.000đ → 500.000đ): giá kèm hiện đúng giá sau trần, 489.000đ, không phải 39.000đ', async () => {
      expect(await priced([kem()], { retailPrice: 500_000 })).toMatchObject({ variationId: 'v2a', addonPrice: 489_000 });
    });

    it('giá hiện tại đúng giá tham chiếu hoặc thấp hơn: giá kèm giữ 39.000đ', async () => {
      expect(await priced([kem()], { retailPrice: 50_000 })).toMatchObject({ addonPrice: 39_000 });
      expect(await priced([kem()], { retailPrice: 60_000, salePrice: 45_000 })).toMatchObject({ addonPrice: 39_000 });
    });

    it('thiếu giá tham chiếu (dòng ghi tay): giỏ không giảm nên không quảng cáo, hết món thì bỏ cả bộ', async () => {
      expect(await priced([kem({ refPrice: null })], {})).toBeUndefined();
      const twoItems = mk([kem({ refPrice: null }), item('p3', { variationId: 'v3a', addonPrice: 10_000, refPrice: 50_000 })]);
      const out = await setup({ rows: [twoItems], cards: [card('p1'), card('p2'), card('p3')], variations: [pin('v2a', 'p2'), pin('v3a', 'p3')] }).svc.forProduct('sp-p1', NOW);
      expect(out.addons[0]!.items.map((i) => i.productId)).toEqual(['p3']);
    });

    it('giá kèm không thấp hơn giá tham chiếu: không giảm được đồng nào dù giá hiện tại cao, không quảng cáo', async () => {
      expect(await priced([kem({ addonPrice: 50_000 })], { retailPrice: 500_000 })).toBeUndefined();
    });
  });

  it('tối đa 2 combo và 3 bộ mua kèm', async () => {
    const combos = ['c1', 'c2', 'c3'].map((id) => row({ id }));
    expect((await setup({ rows: combos }).svc.forProduct('sp-p1', NOW)).combos.map((c) => c.id)).toEqual(['c1', 'c2']);
    const addons = ['a1', 'a2', 'a3', 'a4'].map((id) =>
      row({ id, kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items: [item('p2', { refPrice: 50_000, addonPrice: 1000, variationId: 'v2a' })] }),
    );
    expect((await setup({ rows: addons, variations: [pin('v2a', 'p2')] }).svc.forProduct('sp-p1', NOW)).addons.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('sản phẩm không có/không công khai → 404; sản phẩm của gian hàng đối tác → rỗng, không đọc bộ', async () => {
    await expect(setup({ product: null }).svc.forProduct('x', NOW)).rejects.toBeInstanceOf(NotFoundException);
    const partner = setup({ product: { id: 'p1', storefrontId: 'sf1' } });
    expect(await partner.svc.forProduct('sp-p1', NOW)).toEqual({ combos: [], addons: [] });
    expect(partner.prisma.bundle.findMany).not.toHaveBeenCalled();
  });
});

describe('BundlesService: Giờ vàng (giỏ không đưa dòng Giờ vàng vào bundle, nên không quảng cáo bộ mà giỏ sẽ không giảm)', () => {
  const addon = (items: unknown[]) =>
    row({ id: 'a1', kind: 'ADDON', pct: null, anchorProductId: 'p1', anchorProduct: { storefrontId: null }, items });
  const side = item('p2', { refPrice: 50_000, addonPrice: 39_000, variationId: 'v2a' });

  it('sản phẩm chính đang Giờ vàng: không hiện Mua kèm (giỏ không thấy sản phẩm chính nên tính 180.000đ thay vì giá kèm)', async () => {
    const base = { rows: [addon([side])], variations: [pin('v2a', 'p2')] };
    expect((await setup(base).svc.forProduct('sp-p1', NOW)).addons).toHaveLength(1);
    const inFlash = setup({ ...base, flash: [{ variationId: 'v1a', productId: 'p1' }] });
    expect((await inFlash.svc.forProduct('sp-p1', NOW)).addons).toEqual([]);
  });

  it('món kèm đang Giờ vàng: món đó bị bỏ khỏi bộ; hết món thì bỏ bộ', async () => {
    const two = addon([side, item('p3', { refPrice: 50_000, addonPrice: 10_000, variationId: 'v3a' })]);
    const cards = [card('p1'), card('p2'), card('p3')];
    const variations = [pin('v2a', 'p2'), pin('v3a', 'p3')];
    const one = await setup({ rows: [two], cards, variations, flash: [{ variationId: 'v2a', productId: 'p2' }] }).svc.forProduct('sp-p1', NOW);
    expect(one.addons[0]!.items.map((i) => i.productId)).toEqual(['p3']);
    const none = await setup({ rows: [addon([side])], variations, flash: [{ variationId: 'v2a', productId: 'p2' }] }).svc.forProduct('sp-p1', NOW);
    expect(none.addons).toEqual([]);
  });

  it('combo có một món (phân loại sẽ vào giỏ) đang Giờ vàng: bỏ cả combo ở trang sản phẩm lẫn Trang chủ', async () => {
    const ok = setup();
    expect((await ok.svc.forProduct('sp-p1', NOW)).combos).toHaveLength(1);
    expect(await ok.svc.homeCombos(4, NOW)).toHaveLength(1);
    const flash = [{ variationId: 'v-p2', productId: 'p2' }];
    expect((await setup({ flash }).svc.forProduct('sp-p1', NOW)).combos).toEqual([]);
    expect(await setup({ flash }).svc.homeCombos(4, NOW)).toEqual([]);
  });

  it('combo món ghim phân loại: chỉ khi đúng phân loại ghim đang Giờ vàng mới bỏ', async () => {
    const pinned = row({ items: [item('p1'), item('p2', { variationId: 'v2b' })] });
    const variations = [pin('v2b', 'p2')];
    expect((await setup({ rows: [pinned], variations, flash: [{ variationId: 'v-p2', productId: 'p2' }] }).svc.forProduct('sp-p1', NOW)).combos).toHaveLength(1);
    expect((await setup({ rows: [pinned], variations, flash: [{ variationId: 'v2b', productId: 'p2' }] }).svc.forProduct('sp-p1', NOW)).combos).toEqual([]);
  });

  it('suất Giờ vàng đã hết (soldCount >= quota): giỏ tính giá thường nên bộ vẫn hiện', async () => {
    const { svc } = setup({ flash: [{ variationId: 'v-p2', productId: 'p2', soldCount: 10, quota: 10 }] });
    expect((await svc.forProduct('sp-p1', NOW)).combos).toHaveLength(1);
  });

  it('tra Giờ vàng theo đúng điều kiện của giỏ: đợt bật và đang trong giờ, phân loại còn bán; gồm cả sản phẩm chính', async () => {
    const { svc, prisma } = setup({ rows: [addon([side])], variations: [pin('v2a', 'p2')] });
    await svc.forProduct('sp-p1', NOW);
    const where = prisma.flashSaleItem.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      variation: { productId: { in: expect.arrayContaining(['p1', 'p2']) }, isActive: true },
      flashSale: { isActive: true, startAt: { lte: NOW }, endAt: { gt: NOW } },
    });
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
