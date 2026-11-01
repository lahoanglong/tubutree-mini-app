import { bundleLiveWhere, loadLiveBundles } from './bundle-read';

const NOW = new Date('2026-11-01T05:00:00.000Z');
const row = (o: Record<string, unknown> = {}) => ({
  id: 'b1',
  kind: 'BUNDLE_PCT',
  pct: 10,
  anchorProductId: null,
  anchorProduct: null,
  items: [
    { productId: 'p1', variationId: null, addonPrice: null, maxQty: 1, product: { storefrontId: null } },
    { productId: 'p2', variationId: 'v2', addonPrice: null, maxQty: 2, product: { storefrontId: null } },
  ],
  ...o,
});
const prismaWith = (rows: unknown[]) => ({ bundle: { findMany: jest.fn().mockResolvedValue(rows) } }) as never as Parameters<typeof loadLiveBundles>[0];

describe('bundleLiveWhere', () => {
  it('đang chạy theo ranh giới startAt <= now < endAt và bật', () => {
    expect(bundleLiveWhere(NOW)).toEqual({ isActive: true, startAt: { lte: NOW }, endAt: { gt: NOW } });
  });
});

describe('loadLiveBundles', () => {
  it('truy vấn đúng một lần theo lịch và theo sản phẩm có trong giỏ (món của bộ hoặc sản phẩm chính)', async () => {
    const prisma = prismaWith([]);
    await loadLiveBundles(prisma, NOW, ['p1', 'p9']);
    const args = (prisma.bundle.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({ isActive: true, startAt: { lte: NOW }, endAt: { gt: NOW } });
    expect(args.where.OR).toEqual([{ items: { some: { productId: { in: ['p1', 'p9'] } } } }, { anchorProductId: { in: ['p1', 'p9'] } }]);
    expect(prisma.bundle.findMany).toHaveBeenCalledTimes(1);
  });

  it('giỏ không có sản phẩm nào thì không truy vấn', async () => {
    const prisma = prismaWith([]);
    expect(await loadLiveBundles(prisma, NOW, [])).toEqual([]);
    expect(prisma.bundle.findMany).not.toHaveBeenCalled();
  });

  it('ánh xạ ra LiveBundle', async () => {
    const out = await loadLiveBundles(prismaWith([row()]), NOW, ['p1']);
    expect(out).toEqual([
      {
        id: 'b1',
        kind: 'BUNDLE_PCT',
        pct: 10,
        anchorProductId: null,
        items: [
          { productId: 'p1', variationId: null, addonPrice: null, maxQty: 1 },
          { productId: 'p2', variationId: 'v2', addonPrice: null, maxQty: 2 },
        ],
      },
    ]);
  });

  it('bộ có món thuộc gian hàng đối tác bị bỏ cả bộ (hàng đối tác không vào combo)', async () => {
    const partner = row({ items: [row().items[0], { ...row().items[1], product: { storefrontId: 'sf1' } }] });
    expect(await loadLiveBundles(prismaWith([partner, row({ id: 'b2' })]), NOW, ['p1'])).toEqual([expect.objectContaining({ id: 'b2' })]);
  });

  it('ADDON có sản phẩm chính là hàng đối tác, hoặc đã mất sản phẩm chính, bị bỏ', async () => {
    const base = { kind: 'ADDON', pct: null, items: [{ productId: 'p2', variationId: null, addonPrice: 1000, maxQty: 1, product: { storefrontId: null } }] };
    const partnerAnchor = row({ ...base, id: 'a1', anchorProductId: 'p1', anchorProduct: { storefrontId: 'sf1' } });
    const noAnchor = row({ ...base, id: 'a2', anchorProductId: null, anchorProduct: null });
    const ok = row({ ...base, id: 'a3', anchorProductId: 'p1', anchorProduct: { storefrontId: null } });
    expect(await loadLiveBundles(prismaWith([partnerAnchor, noAnchor, ok]), NOW, ['p1'])).toEqual([expect.objectContaining({ id: 'a3', anchorProductId: 'p1' })]);
  });
});
