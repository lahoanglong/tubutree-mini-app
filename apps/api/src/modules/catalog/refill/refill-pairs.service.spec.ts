import { ConflictException } from '@nestjs/common';
import { RefillPairsService } from './refill-pairs.service';
import { REFILL_FIRST_ENABLED_KEY, REFILL_PAIRS_BLOCK_KEY, REFILL_PAIRS_OVERRIDE_KEY } from './refill-pairs';

const PRODUCTS = [
  { id: 'bottle', slug: 'nuoc-rua-chen-fuwa3e-3-8l', name: 'Nước rửa chén Fuwa3e 3,8L', brand: 'Fuwa3e', isCombo: false },
  { id: 'small', slug: 'nuoc-rua-chen-fuwa3e-500ml', name: 'Nước rửa chén Fuwa3e 500ml', brand: 'Fuwa3e', isCombo: false },
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

function build(flag: unknown, cfg: Record<string, unknown> = {}, stored: Record<string, unknown> = {}, products: readonly object[] = PRODUCTS) {
  const prisma = {
    product: { findMany: jest.fn(async () => products) },
    $queryRaw: jest.fn(async (..._args: unknown[]) => [{ id: 'bottle' }] as { id: string }[]),
  };
  const catalog = { cardsByIds: jest.fn(async (..._args: unknown[]) => [CARD] as (typeof CARD)[]) };
  let on = flag;
  const config = {
    get: jest.fn(async (key: string, def: unknown) => (key === REFILL_FIRST_ENABLED_KEY ? on : key in cfg ? cfg[key] : def)),
    set: jest.fn(async (key: string, value: unknown) => {
      if (key === REFILL_FIRST_ENABLED_KEY) on = value;
      else cfg[key] = value;
    }),
    // Như SystemConfigService.update: `next` nhận bản đang lưu (đọc dưới khoá dòng, không qua cache của get) và hàm `read` đọc khoá khác
    // trong cùng transaction (cũng không qua cache); lỗi thì không ghi.
    update: jest.fn(async (key: string, fallback: unknown, next: (current: unknown, read: (k: string) => Promise<unknown>) => unknown) => {
      const read = async (k: string) => (k in stored ? stored[k] : cfg[k]);
      const value = await next(key in stored ? stored[key] : key in cfg ? cfg[key] : fallback, read);
      cfg[key] = value;
      stored[key] = value;
      return value;
    }),
  };
  const svc = new RefillPairsService(prisma as never, catalog as never, config as never);
  return { svc, prisma, catalog, config, cfg };
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

describe('RefillPairsService: thẻ admin Cặp Refill (tubu-w6-01 P1-a)', () => {
  it('bảng: chai 3,8L tự ghép can 10L (2,6 lần); chai 500ml chờ ghép tay (20 lần), không vào bảng khách', async () => {
    const { svc } = build(true);
    const o = await svc.adminOverview();
    expect(o.enabled).toBe(true);
    expect(o.maxRatio).toBe(3);
    expect(o.rows).toEqual([
      { bottle: { id: 'bottle', slug: 'nuoc-rua-chen-fuwa3e-3-8l', name: 'Nước rửa chén Fuwa3e 3,8L', sizeLabel: '3,8L' }, refill: expect.objectContaining({ id: 'refill', sizeLabel: '10L' }), status: 'auto', candidates: 1, ratio: 2.6 },
      { bottle: expect.objectContaining({ id: 'small', sizeLabel: '500ml' }), refill: expect.objectContaining({ id: 'refill' }), status: 'size', candidates: 1, ratio: 20 },
    ]);
    expect(o.choices.refills.map((r) => r.id)).toEqual(['refill']);
    expect(o.choices.bottles.map((r) => r.id)).toEqual(['bottle', 'small', 'other']);
    expect([...(await svc.pairs())]).toEqual([['bottle', 'refill']]);
  });

  it('lưu: ghép tay, chặn, cờ ghi qua SystemConfig kèm người sửa; bảng cặp trong bộ nhớ bỏ ngay', async () => {
    const { svc, config, cfg } = build(false);
    expect([...(await svc.pairs())]).toEqual([['bottle', 'refill']]);
    const o = await svc.adminSave(
      { enabled: true, overrides: [{ bottleSlug: ' nuoc-rua-chen-fuwa3e-500ml ', refillSlug: 'refill-nuoc-rua-chen-fuwa3e-10l' }], block: ['nuoc-rua-chen-fuwa3e-3-8l', ' nuoc-rua-chen-fuwa3e-3-8l', ''] },
      'admin-1',
    );
    expect(config.set).toHaveBeenCalledWith(REFILL_FIRST_ENABLED_KEY, true, 'admin-1');
    expect(config.update).toHaveBeenCalledWith(REFILL_PAIRS_OVERRIDE_KEY, [], expect.any(Function), 'admin-1');
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toEqual([{ bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: 'refill-nuoc-rua-chen-fuwa3e-10l' }]);
    expect(config.set).toHaveBeenCalledWith(REFILL_PAIRS_BLOCK_KEY, ['nuoc-rua-chen-fuwa3e-3-8l'], 'admin-1');
    expect(o.rows.map((r) => [r.bottle.id, r.status])).toEqual([
      ['bottle', 'blocked'],
      ['small', 'manual'],
    ]);
    expect(o.block).toEqual([{ slug: 'nuoc-rua-chen-fuwa3e-3-8l', name: 'Nước rửa chén Fuwa3e 3,8L' }]);
    expect([...(await svc.pairs())]).toEqual([['small', 'refill']]);
  });

  it('lần quét đang chạy dở lúc admin lưu (đọc cấu hình cũ) không ghi đè bảng mới vào bộ nhớ đệm', async () => {
    const { svc, prisma } = build(true);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    prisma.product.findMany.mockImplementationOnce(async () => {
      await gate;
      return PRODUCTS;
    });
    const stale = svc.pairs();
    await svc.adminSave({ block: ['nuoc-rua-chen-fuwa3e-3-8l'] }, 'a');
    release();
    expect([...(await stale)]).toEqual([['bottle', 'refill']]);
    expect([...(await svc.pairs())]).toEqual([]);
  });

  it('ghép tay đã ghi rồi bước ghi cờ lỗi: lần lưu báo lỗi nhưng bảng cặp trong bộ nhớ vẫn bỏ, lần hỏi sau thấy cặp vừa ghép', async () => {
    const { svc, config } = build(true);
    expect([...(await svc.pairs())]).toEqual([['bottle', 'refill']]);
    config.set.mockRejectedValueOnce(new Error('mất kết nối DB'));
    await expect(svc.adminSave({ enabled: true, add: { bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: 'refill-nuoc-rua-chen-fuwa3e-10l' } }, 'a')).rejects.toThrow('mất kết nối DB');
    expect([...(await svc.pairs())]).toEqual([
      ['bottle', 'refill'],
      ['small', 'refill'],
    ]);
  });

  it('chỉ gửi phần nào thì ghi phần đó', async () => {
    const { svc, config } = build(true);
    await svc.adminSave({ block: [] }, 'a');
    expect(config.update).not.toHaveBeenCalled();
    expect(config.set).toHaveBeenCalledTimes(1);
    expect(config.set).toHaveBeenCalledWith(REFILL_PAIRS_BLOCK_KEY, [], 'a');
  });

  it('ghép tay sai: slug không đang bán, chai là gói refill, đích không phải refill, một chai hai cặp → 400, không ghi gì', async () => {
    const { svc, config, cfg } = build(true);
    const R = 'refill-nuoc-rua-chen-fuwa3e-10l';
    await expect(svc.adminSave({ overrides: [{ bottleSlug: 'khong-co', refillSlug: R }] }, 'a')).rejects.toThrow('Không có sản phẩm đang bán "khong-co"');
    await expect(svc.adminSave({ overrides: [{ bottleSlug: R, refillSlug: R }] }, 'a')).rejects.toThrow('Chai và gói Refill phải là hai sản phẩm khác nhau.');
    await expect(svc.adminSave({ overrides: [{ bottleSlug: R, refillSlug: 'refill-khac' }] }, 'a')).rejects.toThrow('Không có sản phẩm đang bán "refill-khac"');
    await expect(svc.adminSave({ overrides: [{ bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: 'xit-thom-fuwa3e-300ml' }] }, 'a')).rejects.toThrow('không phải gói Refill');
    await expect(
      svc.adminSave({ enabled: true, overrides: [{ bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: R }, { bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: R }] }, 'a'),
    ).rejects.toThrow('hai cặp');
    expect(config.set).not.toHaveBeenCalled();
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toBeUndefined();
  });

  it('add/remove gộp vào danh sách ĐANG LƯU: trang mở từ trước (chưa thấy cặp migration hay admin khác vừa thêm) không xoá mất các cặp đó', async () => {
    const R = 'refill-nuoc-rua-chen-fuwa3e-10l';
    const stored = [
      { bottleSlug: 'chai-da-ngung-ban', refillSlug: 'refill-da-ngung-ban' },
      { bottleSlug: 'nuoc-rua-chen-fuwa3e-3-8l', refillSlug: R },
    ];
    const { svc, cfg } = build(true, { [REFILL_PAIRS_OVERRIDE_KEY]: stored });
    await svc.adminSave({ add: { bottleSlug: ' nuoc-rua-chen-fuwa3e-500ml ', refillSlug: R } }, 'a');
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toEqual([...stored, { bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: R }]);
    await svc.adminSave({ remove: 'nuoc-rua-chen-fuwa3e-500ml' }, 'a');
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toEqual(stored);
  });

  it('add gộp trên bản đọc dưới khoá dòng (update), không trên bản cache của get: admin khác vừa ghép ở tiến trình API khác thì cặp đó còn (tubu-w10-01)', async () => {
    const R = 'refill-nuoc-rua-chen-fuwa3e-10l';
    const other = { bottleSlug: 'nuoc-rua-chen-fuwa3e-3-8l', refillSlug: R };
    // get() còn cache 60 giây của bản rỗng; trong DB đã có cặp admin kia vừa lưu.
    const { svc, config, cfg } = build(true, { [REFILL_PAIRS_OVERRIDE_KEY]: [] }, { [REFILL_PAIRS_OVERRIDE_KEY]: [other] });
    await svc.adminSave({ add: { bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: R } }, 'a');
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toEqual([other, { bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: R }]);
    expect(config.set).not.toHaveBeenCalledWith(REFILL_PAIRS_OVERRIDE_KEY, expect.anything(), expect.anything());
  });

  it('cặp mới khác thương hiệu hay ghép vào gói đang tắt: 400, không ghi gì', async () => {
    const R = 'refill-nuoc-rua-chen-fuwa3e-10l';
    const { svc, prisma, config } = build(true, { [REFILL_PAIRS_BLOCK_KEY]: [R] });
    prisma.product.findMany.mockResolvedValue([...PRODUCTS, { id: 'pine', slug: 'refill-nuoc-rua-chen-pineboo-5l', name: 'Refill Nước rửa chén Pineboo 5L', brand: 'Pineboo', isCombo: false }]);
    await expect(svc.adminSave({ add: { bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: 'refill-nuoc-rua-chen-pineboo-5l' } }, 'a')).rejects.toThrow('khác thương hiệu');
    await expect(svc.adminSave({ add: { bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: R } }, 'a')).rejects.toThrow('đang tắt ở thẻ Cặp Refill');
    expect(config.set).not.toHaveBeenCalled();
  });

  it('ghép tay vòng (chai A → chai B, chai B → chai A): 400, không ghi gì', async () => {
    const { svc, config } = build(true);
    await expect(
      svc.adminSave({ overrides: [{ bottleSlug: 'nuoc-rua-chen-fuwa3e-500ml', refillSlug: 'nuoc-rua-chen-fuwa3e-3-8l' }, { bottleSlug: 'nuoc-rua-chen-fuwa3e-3-8l', refillSlug: 'nuoc-rua-chen-fuwa3e-500ml' }] }, 'a'),
    ).rejects.toThrow('"Nước rửa chén Fuwa3e 3,8L" không phải gói Refill');
    expect(config.set).not.toHaveBeenCalled();
  });
});

describe('RefillPairsService: Duyệt nhanh gợi ý (tubu-w11-01)', () => {
  const NEAR_PRODUCTS = [
    ...PRODUCTS,
    { id: 'bh', slug: 'nuoc-giat-huong-bac-ha-fuwa3e-500ml', name: 'Nước giặt hương Bạc hà Fuwa3e 500ml', brand: 'Fuwa3e', isCombo: false },
    { id: 'cam', slug: 'nuoc-giat-huong-cam-fuwa3e-500ml', name: 'Nước giặt hương Cam Fuwa3e 500ml', brand: 'Fuwa3e', isCombo: false },
    { id: 'rbh', slug: 'refill-nuoc-giat-bac-ha-fuwa3e-10l', name: 'Refill nước giặt Bạc hà Fuwa3e 10L', brand: 'Fuwa3e', isCombo: false },
    { id: 'rcam', slug: 'refill-nuoc-giat-cam-fuwa3e-10l', name: 'Refill nước giặt Cam Fuwa3e 10L', brand: 'Fuwa3e', isCombo: false },
  ];
  const BH = { bottleSlug: 'nuoc-giat-huong-bac-ha-fuwa3e-500ml', refillSlug: 'refill-nuoc-giat-bac-ha-fuwa3e-10l' };
  const CAM = { bottleSlug: 'nuoc-giat-huong-cam-fuwa3e-500ml', refillSlug: 'refill-nuoc-giat-cam-fuwa3e-10l' };
  const OLD = { bottleSlug: 'chai-da-ngung-ban', refillSlug: 'refill-da-ngung-ban' };

  it('bảng admin có 2 dòng near; duyệt cả hai trong MỘT lần ghi dưới khoá dòng (update), giữ cặp đang lưu, bảng trả về hết near', async () => {
    const { svc, config, cfg } = build(true, {}, { [REFILL_PAIRS_OVERRIDE_KEY]: [OLD] }, NEAR_PRODUCTS);
    expect((await svc.adminOverview()).rows.filter((r) => r.status === 'near').map((r) => r.bottle.slug).sort()).toEqual([BH.bottleSlug, CAM.bottleSlug]);
    const out = await svc.adminSave({ confirm: [BH, CAM] }, 'po');
    expect(config.update).toHaveBeenCalledTimes(1);
    expect(config.update).toHaveBeenCalledWith(REFILL_PAIRS_OVERRIDE_KEY, [], expect.any(Function), 'po');
    expect(config.set).not.toHaveBeenCalled();
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toEqual([OLD, BH, CAM]);
    expect(out.rows.filter((r) => r.status === 'near')).toEqual([]);
    expect(out.rows.filter((r) => r.status === 'manual').map((r) => r.bottle.slug).sort()).toEqual([BH.bottleSlug, CAM.bottleSlug]);
  });

  it('gửi lại đúng lần duyệt đó: danh sách không đổi, không cặp trùng', async () => {
    const { svc, cfg } = build(true, {}, { [REFILL_PAIRS_OVERRIDE_KEY]: [OLD] }, NEAR_PRODUCTS);
    await svc.adminSave({ confirm: [BH, CAM] }, 'po');
    await svc.adminSave({ confirm: [BH, CAM] }, 'po');
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toEqual([OLD, BH, CAM]);
  });

  it('bảng vừa đổi (admin khác đã ghép chai Bạc hà sang gói khác): 409, không cặp nào của lần duyệt được ghi, kể cả cặp còn đúng', async () => {
    const other = { bottleSlug: BH.bottleSlug, refillSlug: 'refill-nuoc-rua-chen-fuwa3e-10l' };
    const { svc, cfg } = build(true, {}, { [REFILL_PAIRS_OVERRIDE_KEY]: [other] }, NEAR_PRODUCTS);
    await expect(svc.adminSave({ confirm: [CAM, BH] }, 'po')).rejects.toThrow(ConflictException);
    await expect(svc.adminSave({ confirm: [CAM, BH] }, 'po')).rejects.toThrow('chưa cặp nào được duyệt');
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toBeUndefined();
  });

  it('danh sách chặn đọc trong cùng transaction, không qua cache 60 giây của get: chai vừa bị chặn ở tiến trình API khác → 409, không ghi gì', async () => {
    const { svc, cfg } = build(true, {}, { [REFILL_PAIRS_BLOCK_KEY]: [CAM.bottleSlug] }, NEAR_PRODUCTS);
    await expect(svc.adminSave({ confirm: [BH, CAM] }, 'po')).rejects.toThrow(ConflictException);
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toBeUndefined();
  });

  it('cùng chai hai lần trong một lần duyệt: 400', async () => {
    const { svc, cfg } = build(true, {}, {}, NEAR_PRODUCTS);
    await expect(svc.adminSave({ confirm: [BH, BH] }, 'po')).rejects.toThrow('hai lần');
    expect(cfg[REFILL_PAIRS_OVERRIDE_KEY]).toBeUndefined();
  });
});
