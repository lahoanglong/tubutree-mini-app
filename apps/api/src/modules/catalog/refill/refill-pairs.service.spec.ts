import { RefillPairsService } from './refill-pairs.service';
import { REFILL_FIRST_ENABLED_KEY, REFILL_PAIRS_BLOCK_KEY, REFILL_PAIRS_OVERRIDE_KEY } from './refill-pairs';

const PRODUCTS = [
  { id: 'bottle', slug: 'nuoc-rua-chen-fuwa3e-500ml', name: 'Nước rửa chén Fuwa3e 500ml', brand: 'Fuwa3e', isCombo: false },
  { id: 'refill', slug: 'refill-nuoc-rua-chen-fuwa3e-10l', name: 'Refill Nước rửa chén Fuwa3e 10L', brand: 'Fuwa3e', isCombo: false },
  { id: 'other', slug: 'xit-thom-fuwa3e-300ml', name: 'Xịt thơm Fuwa3e 300ml', brand: 'Fuwa3e', isCombo: false },
];

const CARD = {
  id: 'refill',
  slug: 'refill-nuoc-rua-chen-fuwa3e-10l',
  name: 'Refill Nước rửa chén Fuwa3e 10L',
  thumbnail: 'https://cdn/x.webp',
  basePrice: 890_000,
  salePrice: 850_000,
  repVariationId: 'v-refill',
  inStock: true,
  fulfiller: { kind: 'TUBU' },
};

function build(flag: unknown, cfg: Record<string, unknown> = {}) {
  const prisma = {
    product: { findMany: jest.fn(async () => PRODUCTS) },
    $queryRaw: jest.fn(async (..._args: unknown[]) => [{ id: 'bottle' }] as { id: string }[]),
  };
  const catalog = { cardsByIds: jest.fn(async (..._args: unknown[]) => [CARD] as (typeof CARD)[]) };
  const config = {
    get: jest.fn(async (key: string, def: unknown) => (key === REFILL_FIRST_ENABLED_KEY ? flag : key in cfg ? cfg[key] : def)),
  };
  const svc = new RefillPairsService(prisma as never, catalog as never, config as never);
  return { svc, prisma, catalog, config };
}

describe('RefillPairsService', () => {
  it('cờ tắt (mặc định): trả {} và không đọc danh mục, đơn hay thẻ', async () => {
    for (const flag of [false, undefined, 'true', 1]) {
      const { svc, prisma, catalog } = build(flag);
      await expect(svc.pairsFor(['bottle'])).resolves.toEqual({});
      await expect(svc.minePairsFor('u1', ['bottle'])).resolves.toEqual({});
      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(catalog.cardsByIds).not.toHaveBeenCalled();
    }
  });

  it('không có cấu hình thì coi như tắt', async () => {
    const svc = new RefillPairsService({} as never, {} as never);
    await expect(svc.pairsFor(['bottle'])).resolves.toEqual({});
  });

  it('cờ bật: chai → thẻ gói refill (giá đang bán, giá gạch, cỡ, còn hàng, Tubu giao)', async () => {
    const { svc, catalog } = build(true);
    await expect(svc.pairsFor(['bottle', 'other', 'refill'])).resolves.toEqual({
      bottle: {
        productId: 'refill',
        slug: 'refill-nuoc-rua-chen-fuwa3e-10l',
        name: 'Refill Nước rửa chén Fuwa3e 10L',
        thumbnail: 'https://cdn/x.webp',
        variationId: 'v-refill',
        price: 850_000,
        compareAt: 890_000,
        sizeLabel: '10L',
        inStock: true,
        tubu: true,
      },
    });
    expect(catalog.cardsByIds).toHaveBeenCalledWith(['refill']);
  });

  it('khách chưa từng nhận chai trong đơn đã giao: không có gợi ý', async () => {
    const { svc, prisma } = build(true);
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(svc.minePairsFor('u1', ['bottle'])).resolves.toEqual({});
  });

  it('khách đã có chai: chỉ trả cặp của chai đó; id không có cặp thì không hỏi đơn', async () => {
    const { svc, prisma } = build(true);
    await expect(svc.minePairsFor('u1', ['other'])).resolves.toEqual({});
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    const mine = await svc.minePairsFor('u1', ['bottle', 'other']);
    expect(Object.keys(mine)).toEqual(['bottle']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0]);
    expect(sql).toContain("o.status = 'DELIVERED'");
    expect(sql).toContain("o.type = 'RETAIL'");
    expect(sql).toContain('\\"placedForCustomer\\" = false');
  });

  it('gói refill hết thẻ (ngừng bán giữa chừng) thì bỏ cặp', async () => {
    const { svc, catalog } = build(true);
    catalog.cardsByIds.mockResolvedValueOnce([]);
    await expect(svc.pairsFor(['bottle'])).resolves.toEqual({});
  });

  it('chặn và ghi đè đọc từ cấu hình', async () => {
    const { svc } = build(true, { [REFILL_PAIRS_BLOCK_KEY]: ['refill-nuoc-rua-chen-fuwa3e-10l'], [REFILL_PAIRS_OVERRIDE_KEY]: [] });
    await expect(svc.pairsFor(['bottle'])).resolves.toEqual({});
  });

  it('bảng cặp dùng chung bộ nhớ đệm: nhiều lần hỏi cùng lúc chỉ quét danh mục một lần', async () => {
    const { svc, prisma } = build(true);
    await Promise.all([svc.pairsFor(['bottle']), svc.pairsFor(['bottle']), svc.minePairsFor('u1', ['bottle'])]);
    await svc.pairsFor(['bottle']);
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });
});
