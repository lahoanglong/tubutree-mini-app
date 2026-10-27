import { Logger, NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import { LIKE_ESCAPE } from './search-text';
import { VARIATION_ORDER_BY } from './variation-order';

const card = (id: string) => ({
  id,
  slug: id,
  brand: 'b',
  name: id,
  thumbnail: null,
  images: [],
  basePrice: 1000,
  salePrice: null,
  isFeatured: false,
  ratingAvg: 0,
  reviewCount: 0,
  soldExternal: 0,
  soldApp: 0,
  variations: [{ stock: 5 }],
});

describe('CatalogService.boughtTogether (§6.12 thường mua kèm)', () => {
  function setup(rows: { productId: string }[], products: ReturnType<typeof card>[]) {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', slug: 'tinh-dau' }),
        findMany: jest.fn().mockResolvedValue(products),
      },
      $queryRaw: jest.fn().mockResolvedValue(rows),
    } as unknown as PrismaService;
    return new CatalogService(prisma);
  }

  it('sản phẩm không tồn tại → NotFound', async () => {
    const prisma = { product: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    await expect(new CatalogService(prisma).boughtTogether('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('trả card theo ĐÚNG thứ tự co-occurrence', async () => {
    const svc = setup([{ productId: 'p3' }, { productId: 'p2' }], [card('p2'), card('p3')]);
    const r = await svc.boughtTogether('tinh-dau');
    expect(r.map((c) => c.id)).toEqual(['p3', 'p2']); // giữ thứ tự từ query
  });

  describe('cache co-occurrence (D9-04)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('hai lần xem cùng sản phẩm trong TTL chỉ quét order_items một lần; danh sách card vẫn đọc tươi', async () => {
      const prisma = {
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', slug: 'tinh-dau' }), findMany: jest.fn().mockResolvedValue([card('p2')]) },
        $queryRaw: jest.fn().mockResolvedValue([{ productId: 'p2' }]),
      } as unknown as PrismaService;
      const svc = new CatalogService(prisma);
      await svc.boughtTogether('tinh-dau');
      await svc.boughtTogether('tinh-dau');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.product.findMany).toHaveBeenCalledTimes(2);
    });

    it('hết TTL thì quét lại', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const prisma = {
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', slug: 'tinh-dau' }), findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService;
      const svc = new CatalogService(prisma);
      await svc.boughtTogether('tinh-dau');
      now.mockReturnValue(1_000_000 + 10 * 60_000);
      await svc.boughtTogether('tinh-dau');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('cache đầy mà khoá đang làm mới chính là khoá hết hạn → không xoá nhầm khoá còn hạn của sản phẩm khác', async () => {
      const prisma = {
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'target' }), findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService;
      const svc = new CatalogService(prisma);
      const cache = (svc as unknown as { boughtTogetherCache: Map<string, { ids: string[]; expiresAt: number }> }).boughtTogetherCache;
      const alive = Date.now() + 60_000;
      cache.set('oldest-still-valid', { ids: [], expiresAt: alive });
      for (let i = 0; i < 498; i++) cache.set(`k${i}`, { ids: [], expiresAt: alive });
      cache.set('target', { ids: [], expiresAt: Date.now() - 1 });
      expect(cache.size).toBe(500);

      await svc.boughtTogether('tinh-dau');

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(cache.has('oldest-still-valid')).toBe(true);
      expect(cache.get('target')!.expiresAt).toBeGreaterThan(Date.now());
      expect(cache.size).toBe(500);
    });

    it('sản phẩm khác nhau không dùng chung kết quả; bộ nhớ có trần', async () => {
      let id = 0;
      const prisma = {
        product: { findUnique: jest.fn().mockImplementation(async () => ({ id: `p${++id}` })), findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService;
      const svc = new CatalogService(prisma);
      for (let i = 0; i < 700; i++) await svc.boughtTogether(`s${i}`);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(700);
      expect((svc as unknown as { boughtTogetherCache: Map<string, unknown> }).boughtTogetherCache.size).toBeLessThanOrEqual(500);
    });
  });

  it('không có đơn co-occurrence → trả rỗng (FE fallback related)', async () => {
    const svc = setup([], []);
    const r = await svc.boughtTogether('tinh-dau');
    expect(r).toEqual([]);
  });
});

describe('CatalogService.getBySlug — chỉ hiện SP APPROVED (P0 A2-03=A5-06=A6-04)', () => {
  const product = (approvalStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED') => ({
    id: 'p1',
    slug: 'tinh-dau',
    isActive: true,
    approvalStatus,
    soldExternal: 0,
    soldApp: 0,
    variations: [],
  });

  it('PENDING_REVIEW (chưa duyệt) → NotFound dù isActive=true', async () => {
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(product('PENDING_REVIEW')) },
    } as unknown as PrismaService;
    await expect(new CatalogService(prisma).getBySlug('tinh-dau')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('REJECTED (kể cả từng APPROVED rồi bị từ chối lại) → NotFound', async () => {
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(product('REJECTED')) },
    } as unknown as PrismaService;
    await expect(new CatalogService(prisma).getBySlug('tinh-dau')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('APPROVED → trả về sản phẩm bình thường', async () => {
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(product('APPROVED')) },
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma).getBySlug('tinh-dau');
    expect(r.id).toBe('p1');
  });
});

describe('CatalogService.getBySlug — cờ hàng của gian hàng đối tác (Q8 S2)', () => {
  it('partnerOwned = sản phẩm thuộc gian hàng (tự giao hoặc Tubu giao hộ) — PDP ẩn đặt định kỳ/mua chung', async () => {
    const row = (storefrontId: string | null) => ({ id: 'p1', slug: 'mat-ong', isActive: true, approvalStatus: 'APPROVED', soldExternal: 0, soldApp: 0, fulfilment: 'TUBU', storefrontId, variations: [] });
    const partner = { product: { findUnique: jest.fn().mockResolvedValue(row('sf-doi-tac')) } } as unknown as PrismaService;
    expect((await new CatalogService(partner).getBySlug('mat-ong')).partnerOwned).toBe(true);
    const tubu = { product: { findUnique: jest.fn().mockResolvedValue(row(null)) } } as unknown as PrismaService;
    expect((await new CatalogService(tubu).getBySlug('mat-ong')).partnerOwned).toBe(false);
  });
});

// R2-ENGAGE-3: ảnh đánh giá có thể là base64 tới ~700 nghìn ký tự/ảnh; PDP là trang vào nhiều nhất và app đọc đánh giá
// qua GET /products/:slug/reviews, nên PDP không nhúng ảnh đánh giá.
describe('CatalogService.getBySlug — PDP không nhúng ảnh đánh giá (R2-ENGAGE-3)', () => {
  it('select đánh giá nhúng không chứa images', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { product: { findUnique } } as unknown as PrismaService;
    await expect(new CatalogService(prisma).getBySlug('x')).rejects.toBeInstanceOf(NotFoundException);
    const arg = findUnique.mock.calls[0]![0] as { include: { reviews: { select: Record<string, unknown> } } };
    expect(arg.include.reviews.select).not.toHaveProperty('images');
    expect(arg.include.reviews.select).toMatchObject({ rating: true, comment: true });
  });
});

describe('CatalogService.getBySlug — không lộ ID nội bộ Pancake (C-036)', () => {
  it('product trả về không có pancakeId', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'p1',
      pancakeId: 'pk-123',
      slug: 'tinh-dau',
      isActive: true,
      approvalStatus: 'APPROVED',
      soldExternal: 1,
      soldApp: 2,
      variations: [{ id: 'v1', sku: 'S1' }],
      reviews: [],
    });
    const prisma = { product: { findUnique } } as unknown as PrismaService;
    const r = await new CatalogService(prisma).getBySlug('tinh-dau');
    expect(JSON.stringify(r)).not.toContain('pancakeId');
    expect(JSON.stringify(r)).not.toContain('pk-123');
    expect(r.sold).toBe(3);
    expect(r.variations[0]).toMatchObject({ id: 'v1', sku: 'S1' });
  });

  it('select biến thể công khai không chọn pancakeId', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { product: { findUnique } } as unknown as PrismaService;
    await expect(new CatalogService(prisma).getBySlug('x')).rejects.toBeInstanceOf(NotFoundException);
    const arg = findUnique.mock.calls[0]![0] as { include: { variations: { select: object } } };
    expect(arg.include.variations.select).not.toHaveProperty('pancakeId');
  });
});

describe('CatalogService.related/boughtTogether/getForYou/suggest — luôn lọc approvalStatus=APPROVED', () => {
  it('related(): where lọc approvalStatus APPROVED', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', brand: 'b' }),
        findMany,
      },
    } as unknown as PrismaService;
    await new CatalogService(prisma).related('tinh-dau');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true, approvalStatus: 'APPROVED' }) }),
    );
  });

  it('boughtTogether(): where lọc approvalStatus APPROVED', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', slug: 'tinh-dau' }),
        findMany,
      },
      $queryRaw: jest.fn().mockResolvedValue([{ productId: 'p2' }]),
    } as unknown as PrismaService;
    await new CatalogService(prisma).boughtTogether('tinh-dau');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true, approvalStatus: 'APPROVED' }) }),
    );
  });

  it('getForYou(): cả nhánh gợi ý theo lịch sử lẫn nhánh fallback isFeatured đều lọc approvalStatus APPROVED', async () => {
    const productFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ categoryIds: ['C'] }])
      .mockResolvedValueOnce([card('p2')]);
    const prisma = {
      orderItem: { findMany: jest.fn().mockResolvedValue([{ variationId: 'v1' }]) },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }]) },
      brandFollow: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: productFindMany },
    } as unknown as PrismaService;
    await new CatalogService(prisma).getForYou('u1');
    // call[1] = nhánh gợi ý theo danh mục đã mua
    expect(productFindMany.mock.calls[1]![0].where).toMatchObject({ isActive: true, approvalStatus: 'APPROVED' });

    const fallbackFindMany = jest.fn().mockResolvedValue([]);
    const prisma2 = {
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      brandFollow: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: fallbackFindMany },
    } as unknown as PrismaService;
    await new CatalogService(prisma2).getForYou('u2');
    // nhánh fallback isFeatured
    expect(fallbackFindMany.mock.calls[0]![0].where).toMatchObject({ isActive: true, isFeatured: true, approvalStatus: 'APPROVED' });
  });

  it('suggest(): where lọc approvalStatus APPROVED', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { product: { findMany }, $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as PrismaService;
    await new CatalogService(prisma).suggest('tinh dau');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true, approvalStatus: 'APPROVED' }) }),
    );
  });
});

describe('CatalogService.getBySlug — liên kết sang trang nhãn hàng (BUYERWEB-18)', () => {
  const row = (brandRef: unknown) => ({
    id: 'p1', slug: 'tinh-dau', isActive: true, approvalStatus: 'APPROVED', soldExternal: 0, soldApp: 0,
    brand: 'Hector', brandId: 'b1', brandRef, variations: [], reviews: [],
  });

  it('nhãn đã công khai → trả brandSlug, không lộ cả bản ghi brandRef', async () => {
    const findUnique = jest.fn().mockResolvedValue(row({ slug: 'hector', isPublished: true }));
    const r = await new CatalogService({ product: { findUnique } } as unknown as PrismaService).getBySlug('tinh-dau');
    expect(r.brandSlug).toBe('hector');
    expect(r).not.toHaveProperty('brandRef');
    const arg = findUnique.mock.calls[0]![0] as { include: { brandRef: { select: object } } };
    expect(arg.include.brandRef.select).toEqual({ slug: true, isPublished: true });
  });

  it('nhãn chưa công khai (trang /brand/:slug sẽ 404) hoặc sản phẩm không gắn nhãn → brandSlug null', async () => {
    const hidden = jest.fn().mockResolvedValue(row({ slug: 'hector', isPublished: false }));
    expect((await new CatalogService({ product: { findUnique: hidden } } as unknown as PrismaService).getBySlug('x')).brandSlug).toBeNull();
    const none = jest.fn().mockResolvedValue(row(null));
    expect((await new CatalogService({ product: { findUnique: none } } as unknown as PrismaService).getBySlug('x')).brandSlug).toBeNull();
  });
});

describe('CatalogService.brands cache 60s', () => {
  it('gọi 2 lần liên tiếp chỉ hit DB 1 lần (TTL chưa hết)', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ brand: 'TuBu', _count: { _all: 3 } }]);
    const prisma = { product: { groupBy }, brand: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    const svc = new CatalogService(prisma);

    const a = await svc.brands();
    const b = await svc.brands();

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ brand: 'TuBu', count: 3, slug: null }]);
    expect(b).toEqual(a);
  });

  it('nhãn đã công khai kèm slug để trang chủ dẫn tới /brand/:slug; nhãn chưa công khai thì slug null (BUYERWEB-18)', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { brand: 'Hector', _count: { _all: 2 } },
      { brand: 'Gốm Bát Tràng', _count: { _all: 1 } },
    ]);
    const findMany = jest.fn().mockResolvedValue([{ name: 'Hector', slug: 'hector' }]);
    const prisma = { product: { groupBy }, brand: { findMany } } as unknown as PrismaService;
    const out = (await new CatalogService(prisma).brands()) as { brand: string; count: number; slug: string | null }[];
    expect(out).toEqual([
      { brand: 'Hector', count: 2, slug: 'hector' },
      { brand: 'Gốm Bát Tràng', count: 1, slug: null },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { isPublished: true, name: { in: ['Hector', 'Gốm Bát Tràng'] } },
      select: { name: true, slug: true },
    });
  });

  it('expire sau 60s → hit DB lần 2 (chứng minh TTL thực sự chạy)', async () => {
    // Trước đây test chỉ chứng minh cache hit, không chứng minh expiry — nếu ai đó
    // hardcode "return cache" mà không check expiresAt, test cũ vẫn pass.
    jest.useFakeTimers();
    try {
      const groupBy = jest.fn().mockResolvedValue([{ brand: 'TuBu', _count: { _all: 3 } }]);
      const prisma = { product: { groupBy }, brand: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
      const svc = new CatalogService(prisma);

      await svc.brands();
      jest.advanceTimersByTime(61_000);
      await svc.brands();

      expect(groupBy).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('CatalogService.getForYou (Feed "Dành cho bạn")', () => {
  function setup(prismaOverrides: Record<string, unknown>) {
    const prisma = {
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      brandFollow: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      ...prismaOverrides,
    } as unknown as PrismaService;
    return { prisma, svc: new CatalogService(prisma) };
  }

  it('có lịch sử mua ở danh mục C → gợi ý cùng danh mục; SP ĐÃ MUA vẫn có mặt nhưng xếp SAU mọi SP chưa mua (spec 4a.3, A2-04)', async () => {
    const orderItemFindMany = jest.fn().mockResolvedValue([{ variationId: 'v1' }]);
    const variationFindMany = jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }]);
    const productFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ categoryIds: ['C'] }])
      .mockResolvedValueOnce([
        { ...card('p1'), soldExternal: 100, soldApp: 0 }, // đã mua, bán chạy nhất
        { ...card('p2'), soldExternal: 5, soldApp: 0 },
        { ...card('p3'), soldExternal: 10, soldApp: 20 },
      ]);
    const { prisma, svc } = setup({
      orderItem: { findMany: orderItemFindMany },
      variation: { findMany: variationFindMany },
      product: { findMany: productFindMany },
    });

    const r = await svc.getForYou('u1');

    expect(r.map((c) => c.id)).toEqual(['p3', 'p2', 'p1']);
    // Không còn loại ở DB — SP đã mua được phép xuất hiện.
    const candidateWhere = (prisma as any).product.findMany.mock.calls[1][0].where;
    expect(candidateWhere.id).toBeUndefined();
    expect(candidateWhere.OR).toEqual(expect.arrayContaining([{ categoryIds: { hasSome: ['C'] } }]));
  });

  it('nhánh fallback isFeatured cũng xếp SP đã mua sau', async () => {
    const productFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ categoryIds: [] }])
      .mockResolvedValueOnce([
        { ...card('p1'), isFeatured: true, soldExternal: 50, soldApp: 0 },
        { ...card('pf'), isFeatured: true, soldExternal: 1, soldApp: 0 },
      ]);
    const { svc } = setup({
      orderItem: { findMany: jest.fn().mockResolvedValue([{ variationId: 'v1' }]) },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }]) },
      product: { findMany: productFindMany },
    });
    const r = await svc.getForYou('u1');
    expect(r.map((c) => c.id)).toEqual(['pf', 'p1']);
  });

  it('user chưa có lịch sử mua & chưa theo dõi nhãn nào → fallback sản phẩm nổi bật (isFeatured)', async () => {
    const productFindMany = jest.fn().mockResolvedValue([
      { ...card('pf1'), isFeatured: true, soldExternal: 1, soldApp: 1 },
    ]);
    const { svc } = setup({ product: { findMany: productFindMany } });

    const r = await svc.getForYou('u-moi');

    expect(r.map((c) => c.id)).toEqual(['pf1']);
    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(productFindMany.mock.calls[0][0].where).toMatchObject({ isActive: true, isFeatured: true });
  });

  it('theo dõi nhãn (chưa từng mua) → gợi ý sản phẩm của nhãn đó thay vì fallback', async () => {
    const productFindMany = jest.fn().mockResolvedValue([{ ...card('pb1'), soldExternal: 2, soldApp: 0 }]);
    const { prisma, svc } = setup({
      brandFollow: { findMany: jest.fn().mockResolvedValue([{ brandId: 'b1' }]) },
      product: { findMany: productFindMany },
    });

    const r = await svc.getForYou('u2');

    expect(r.map((c) => c.id)).toEqual(['pb1']);
    const candidateWhere = (prisma as any).product.findMany.mock.calls[0][0].where;
    expect(candidateWhere.OR).toEqual(expect.arrayContaining([{ brandId: { in: ['b1'] } }]));
  });

  it('lấy tối đa 10 sản phẩm dù matched nhiều hơn', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...card(`p${i}`), soldExternal: i, soldApp: 0 }));
    const { svc } = setup({
      brandFollow: { findMany: jest.fn().mockResolvedValue([{ brandId: 'b1' }]) },
      product: { findMany: jest.fn().mockResolvedValue(many) },
    });

    const r = await svc.getForYou('u3');

    expect(r).toHaveLength(10);
    expect(r[0]?.id).toBe('p14'); // sold cao nhất trước
  });
});

describe('CatalogService — "đã bán" (soldExternal + soldApp)', () => {
  it('recomputeSoldCounts: gom đơn DELIVERED theo product, chỉ chạm dòng CẦN đổi', async () => {
    const tx = jest.fn().mockResolvedValue([]);
    const prisma = {
      orderItem: { groupBy: jest.fn().mockResolvedValue([
        { variationId: 'v1', _sum: { quantity: 5 } },
        { variationId: 'v2', _sum: { quantity: 3 } },
      ]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', productId: 'p1' }, { id: 'v2', productId: 'p1' },
      ]) },
      product: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), update: jest.fn() },
      $transaction: tx,
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma).recomputeSoldCounts();
    // p1 = 5 + 3 = 8 (gộp 2 biến thể)
    expect((prisma as any).product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { soldApp: 8 } });
    // Đưa về 0 CHỈ những dòng đang khác 0 và không còn đơn nào — `updateMany` không điều kiện sẽ
    // khoá MỌI dòng products suốt transaction, chặn đứng cron đồng bộ và mọi thao tác sửa SP.
    expect((prisma as any).product.updateMany).toHaveBeenCalledWith({
      where: { soldApp: { not: 0 }, id: { notIn: ['p1'] } },
      data: { soldApp: 0 },
    });
    expect(r.updated).toBe(1);
  });

  it('không có đơn nào → vẫn đưa các dòng khác 0 về 0, không cần điều kiện notIn rỗng', async () => {
    const prisma = {
      orderItem: { groupBy: jest.fn().mockResolvedValue([]) },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      product: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;

    await new CatalogService(prisma).recomputeSoldCounts();

    expect((prisma as any).product.updateMany).toHaveBeenCalledWith({
      where: { soldApp: { not: 0 } },
      data: { soldApp: 0 },
    });
  });

  it('setSoldExternal: gom 1 findMany theo SKU (không N+1) rồi cập nhật theo lô qua $transaction', async () => {
    const variationFindMany = jest.fn().mockResolvedValue([{ sku: 'SKU1', productId: 'p1' }]);
    const transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
    const prisma = {
      variation: { findMany: variationFindMany },
      product: { update: jest.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma).setSoldExternal([{ sku: 'SKU1', count: 1200 }]);
    expect(variationFindMany).toHaveBeenCalledWith({ where: { sku: { in: ['SKU1'] } }, select: { sku: true, productId: true } });
    expect((prisma as any).product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { soldExternal: 1200 } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(r.updated).toBe(1);
  });

  it('setSoldExternal: bỏ qua sku không tồn tại / count âm', async () => {
    const prisma = {
      variation: { findMany: jest.fn().mockResolvedValue([]) }, // 'NOPE' không khớp variation nào
      product: { update: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma).setSoldExternal([{ sku: 'NOPE', count: 5 }, { sku: 'X', count: -1 }]);
    expect((prisma as any).product.update).not.toHaveBeenCalled();
    expect(r.updated).toBe(0);
  });

  it('setSoldExternal: nhiều SKU hơn 1 lô (BATCH_SIZE=50) → gọi $transaction nhiều lần, gộp đúng tổng updated', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ sku: `SKU${i}`, count: i }));
    const variationFindMany = jest
      .fn()
      .mockResolvedValue(rows.map((r, i) => ({ sku: r.sku, productId: `p${i}` })));
    const transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
    const prisma = {
      variation: { findMany: variationFindMany },
      product: { update: jest.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma).setSoldExternal(rows);
    expect(variationFindMany).toHaveBeenCalledTimes(1); // 1 lần duy nhất, không N+1
    expect(transaction).toHaveBeenCalledTimes(3); // 120 dòng / 50 mỗi lô = 3 lô
    expect(r.updated).toBe(120);
  });
});

describe('CatalogService.list (Multi-brand filtering)', () => {
  it('truyền 1 brand → query where.brand = "Pơ Lang"', async () => {
    const findMany = jest.fn().mockResolvedValue([card('p1')]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      product: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[card('p1')], 1]),
    } as unknown as PrismaService;

    const svc = new CatalogService(prisma);
    await svc.list({ page: 1, limit: 10, brand: 'Pơ Lang' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brand: 'Pơ Lang' }),
      }),
    );
  });

  it('luôn lọc approvalStatus=APPROVED (P0 A2-03=A5-06=A6-04: SP chưa duyệt/bị từ chối không được lộ ra catalog công khai)', async () => {
    const findMany = jest.fn().mockResolvedValue([card('p1')]);
    const prisma = {
      product: { findMany, count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn().mockResolvedValue([[card('p1')], 1]),
    } as unknown as PrismaService;

    await new CatalogService(prisma).list({ page: 1, limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true, approvalStatus: 'APPROVED' }) }),
    );
  });

  it('truyền nhiều brand phân cách dấu phẩy → query where.brand = { in: ["Pơ Lang", "Visante"] }', async () => {
    const findMany = jest.fn().mockResolvedValue([card('p1'), card('p2')]);
    const count = jest.fn().mockResolvedValue(2);
    const prisma = {
      product: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[card('p1'), card('p2')], 2]),
    } as unknown as PrismaService;

    const svc = new CatalogService(prisma);
    await svc.list({ page: 1, limit: 10, brand: 'Pơ Lang, Visante' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brand: { in: ['Pơ Lang', 'Visante'] } }),
      }),
    );
  });
});

describe('CatalogService.list — bộ lọc dự án 4b', () => {
  function setup() {
    const findMany = jest.fn().mockResolvedValue([card('p1')]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      product: { findMany, count },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), findMany, count };
  }
  const argsOf = (findMany: jest.Mock) => findMany.mock.calls[0][0];

  it('khoảng giá lọc theo GIÁ ĐANG BÁN (salePrice nếu có, không thì basePrice) — đúng giá thẻ SP hiển thị', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, minPrice: 100000, maxPrice: 200000 });
    const range = { gte: 100000, lte: 200000 };
    expect(argsOf(findMany).where.AND).toEqual([{ OR: [{ salePrice: range }, { salePrice: null, basePrice: range }] }]);
  });

  it('chỉ minPrice → chỉ gte; min > max → tự đổi chỗ', async () => {
    const a = setup();
    await a.svc.list({ page: 1, limit: 20, minPrice: 500000 });
    expect(argsOf(a.findMany).where.AND).toEqual([{ OR: [{ salePrice: { gte: 500000 } }, { salePrice: null, basePrice: { gte: 500000 } }] }]);
    const b = setup();
    await b.svc.list({ page: 1, limit: 20, minPrice: 300000, maxPrice: 100000 });
    const range = { gte: 100000, lte: 300000 };
    expect(argsOf(b.findMany).where.AND).toEqual([{ OR: [{ salePrice: range }, { salePrice: null, basePrice: range }] }]);
  });

  it('inStock → còn ít nhất 1 phân loại ĐANG BÁN có tồn > 0 (cùng quy tắc với inStock của thẻ)', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, inStock: true });
    expect(argsOf(findMany).where.variations).toEqual({ some: { isActive: true, stock: { gt: 0 } } });
  });

  it('inStock=false → không lọc tồn kho', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, inStock: false });
    expect(argsOf(findMany).where.variations).toBeUndefined();
  });

  it('minRating → ratingAvg >= minRating', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, minRating: 4 });
    expect(argsOf(findMany).where.ratingAvg).toEqual({ gte: 4 });
  });

  it('slugs → chỉ các sản phẩm công khai có slug đó (dải "Đã xem gần đây" lấy giá hiện hành), tối đa 20 slug, bỏ khoảng trắng và ô rỗng', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, slugs: ' a , b,,c ' });
    expect(argsOf(findMany).where).toEqual({ isActive: true, approvalStatus: 'APPROVED', slug: { in: ['a', 'b', 'c'] } });
    const many = setup();
    await many.svc.list({ page: 1, limit: 20, slugs: Array.from({ length: 30 }, (_, i) => `s${i}`).join(',') });
    expect(argsOf(many.findMany).where.slug.in).toHaveLength(20);
  });

  it('slugs rỗng → không trả sản phẩm nào, không rơi về cả catalog', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, slugs: ' , ' });
    expect(argsOf(findMany).where.slug).toEqual({ in: [] });
  });

  it('không truyền tham số mới → where như trước (không AND/variations/ratingAvg)', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, brand: 'Tubu' });
    expect(argsOf(findMany).where).toEqual({ isActive: true, approvalStatus: 'APPROVED', brand: 'Tubu' });
  });

  it('mọi kiểu sắp xếp (trừ best_seller) có id tăng dần làm tiêu chí phụ → phân trang không trùng/sót khi hoà', async () => {
    const a = setup();
    await a.svc.list({ page: 1, limit: 20 });
    expect(argsOf(a.findMany).orderBy).toEqual([{ isFeatured: 'desc' }, { id: 'asc' }]);
    const b = setup();
    await b.svc.list({ page: 1, limit: 20, sort: 'newest' });
    expect(argsOf(b.findMany).orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });

  it('count dùng đúng where của findMany', async () => {
    const { svc, findMany, count } = setup();
    await svc.list({ page: 1, limit: 20, minRating: 4, inStock: true });
    expect(count).toHaveBeenCalledWith({ where: argsOf(findMany).where });
  });
});

describe('CatalogService — tìm không dấu (dự án 4b)', () => {
  function setup(queryRaw: jest.Mock) {
    const findMany = jest.fn().mockResolvedValue([card('p1')]);
    const prisma = {
      product: { findMany, count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), findMany };
  }
  const sqlOf = (queryRaw: jest.Mock) => {
    const [query] = queryRaw.mock.calls[0] as [Prisma.Sql];
    return { sql: query.strings.join('?'), values: query.values };
  };

  it('q → SQL so cột nameSearch (đã gấp dấu, có index) với từ khoá gấp ở TS; where lọc theo id tìm được (AND, không đè OR khác)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: ' Nước rửa ' });
    expect(findMany.mock.calls[0][0].where.AND).toEqual([{ id: { in: ['p1', 'p2'] } }]);
    expect(findMany.mock.calls[0][0].where.OR).toBeUndefined();
    const { sql, values } = sqlOf(queryRaw);
    expect(sql).toContain('p."nameSearch" LIKE ?');
    expect(sql).not.toContain('translate(');
    expect(sql).toContain('p.tags @> ARRAY[?]::text[]');
    expect(LIKE_ESCAPE).toBe('!');
    expect(sql).toContain("ESCAPE '!'");
    expect(values).toEqual(expect.arrayContaining(['%nuoc_rua%', 'nước rửa']));
  });

  it('từ khoá chỉ đi vào SQL qua tham số ràng buộc, không nối chuỗi vào câu lệnh', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: "x'; DROP TABLE products;--" });
    const { sql, values } = sqlOf(queryRaw);
    expect(sql).not.toContain('DROP');
    expect(values).toContain('%x\';_drop_table_products;--%');
  });

  it('% và _ trong từ khoá được escape (không thành ký tự đại diện)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: '50%' });
    expect(sqlOf(queryRaw).values).toContain('%50!%%');
  });

  it('SQL cắt ứng viên có thứ tự xác định (ORDER BY) + trần TEXT_MATCH_LIMIT, và chỉ xét SP đang bán đã duyệt', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: 'nuoc' });
    const { sql, values } = sqlOf(queryRaw);
    expect(sql).toMatch(/ORDER BY[^]*p\.id[^]*LIMIT/);
    expect(sql).toContain('"isActive" = true');
    expect(sql).toContain("\"approvalStatus\" = 'APPROVED'");
    expect(values[values.length - 1]).toBe(2000);
  });

  it('khoảng trắng không ngắt (NBSP) trong từ khoá được gấp thành khoảng trắng thường trước khi vào SQL', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: 'nước rửa' });
    const { values } = sqlOf(queryRaw);
    expect(values).toContain('%nuoc_rua%');
  });

  it('SQL gấp dấu lỗi → lùi về contains như trước (mất tìm không dấu nhưng không sập trang)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const queryRaw = jest.fn().mockRejectedValue(new Error('column p.nameSearch does not exist'));
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: 'Nước rửa' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ name: { contains: 'Nước rửa', mode: 'insensitive' } }, { tags: { has: 'nước rửa' } }] },
    ]);
  });

  it('q chỉ có khoảng trắng → coi như không tìm (không gọi SQL)', async () => {
    const queryRaw = jest.fn();
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: '   ' });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it('không có q → không gọi SQL, where như trước', async () => {
    const queryRaw = jest.fn();
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20 });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where).toEqual({ isActive: true, approvalStatus: 'APPROVED' });
  });

  it('q kết hợp khoảng giá → cả hai nằm trong AND', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }]);
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: 'nuoc', maxPrice: 100000 });
    expect(findMany.mock.calls[0][0].where.AND).toEqual([
      { id: { in: ['p1'] } },
      { OR: [{ salePrice: { lte: 100000 } }, { salePrice: null, basePrice: { lte: 100000 } }] },
    ]);
  });

  it('suggest dùng cùng cách khớp; giữ shape {slug,name,thumbnail,basePrice}, tối đa 8; q rỗng → []', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }]);
    const { svc, findMany } = setup(queryRaw);
    await svc.suggest('nuoc rua');
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, approvalStatus: 'APPROVED', AND: [{ id: { in: ['p1'] } }] },
      take: 8,
      select: { id: true, slug: true, name: true, thumbnail: true, basePrice: true, salePrice: true },
    });
    await expect(svc.suggest('  ')).resolves.toEqual([]);
  });

  it('suggest: từ khoá dưới 2 ký tự sau gấp dấu → [] không gọi SQL', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }]);
    const { svc, findMany } = setup(queryRaw);
    await expect(svc.suggest('a')).resolves.toEqual([]);
    await expect(svc.suggest(' Ư ')).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('CatalogService.list — best_seller (dự án 4b)', () => {
  const RANKED = [
    { id: 'c', soldApp: 0, soldExternal: 15 },
    { id: 'a', soldApp: 5, soldExternal: 10 },
    { id: 'b', soldApp: 20, soldExternal: 0 },
    { id: 'd', soldApp: 0, soldExternal: 0 },
  ];
  function setup(pageRows: ReturnType<typeof card>[]) {
    const findMany = jest.fn().mockResolvedValueOnce(RANKED).mockResolvedValueOnce(pageRows);
    const $transaction = jest.fn();
    const prisma = { product: { findMany, count: jest.fn() }, $transaction } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), findMany, $transaction };
  }

  it('xếp theo soldApp + soldExternal giảm dần, hoà thì id tăng dần; giữ thứ tự dù DB trả lộn xộn', async () => {
    const { svc, findMany } = setup([card('a'), card('b')]);
    const r = await svc.list({ page: 1, limit: 2, sort: 'best_seller' });
    expect(r.data.map((c) => c.id)).toEqual(['b', 'a']);
    expect(r.meta).toEqual({ page: 1, limit: 2, total: 4 });
    expect(findMany.mock.calls[0][0]).toEqual({
      where: { isActive: true, approvalStatus: 'APPROVED' },
      select: { id: true, soldApp: true, soldExternal: true },
    });
    expect(findMany.mock.calls[1][0]).toEqual({
      where: { AND: [{ isActive: true, approvalStatus: 'APPROVED' }, { id: { in: ['b', 'a'] } }] },
      include: { variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY } },
    });
  });

  it('trang 2 nối tiếp đúng thứ tự, không trùng trang 1', async () => {
    const { svc, findMany } = setup([card('d'), card('c')]);
    const r = await svc.list({ page: 2, limit: 2, sort: 'best_seller' });
    expect(r.data.map((c) => c.id)).toEqual(['c', 'd']);
    expect(findMany.mock.calls[1][0].where.AND[1]).toEqual({ id: { in: ['c', 'd'] } });
  });

  it('trang vượt quá → data rỗng, total vẫn đúng, không gọi truy vấn thứ 2', async () => {
    const { svc, findMany } = setup([]);
    const r = await svc.list({ page: 9, limit: 2, sort: 'best_seller' });
    expect(r).toEqual({ data: [], meta: { page: 9, limit: 2, total: 4 } });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('giữ bộ lọc ở cả hai bước (vd brand + inStock); không dùng $transaction/count', async () => {
    const { svc, findMany, $transaction } = setup([card('b')]);
    await svc.list({ page: 1, limit: 1, sort: 'best_seller', brand: 'Tubu', inStock: true });
    const where = { isActive: true, approvalStatus: 'APPROVED', brand: 'Tubu', variations: { some: { isActive: true, stock: { gt: 0 } } } };
    expect(findMany.mock.calls[0][0].where).toEqual(where);
    expect(findMany.mock.calls[1][0].where.AND[0]).toEqual(where);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('hoà điểm (kể cả khi tổng bằng nhau nhưng soldApp/soldExternal khác nhau) → id tăng dần, không phụ thuộc thứ tự DB trả', async () => {
    const tied = [
      { id: 'z', soldApp: 3, soldExternal: 7 },
      { id: 'm', soldApp: 10, soldExternal: 0 },
      { id: 'k', soldApp: 0, soldExternal: 10 },
      { id: 'a', soldApp: 1, soldExternal: 0 },
    ];
    const findMany = jest.fn().mockResolvedValueOnce(tied).mockResolvedValueOnce([card('k'), card('m')]);
    const prisma = { product: { findMany }, $transaction: jest.fn() } as unknown as PrismaService;
    const r = await new CatalogService(prisma).list({ page: 1, limit: 2, sort: 'best_seller' });
    expect(findMany.mock.calls[1][0].where.AND[1]).toEqual({ id: { in: ['k', 'm'] } });
    expect(r.data.map((c) => c.id)).toEqual(['k', 'm']);
  });

  it('SP bị ẩn giữa hai bước → bỏ khỏi trang, không lỗi', async () => {
    const { svc } = setup([card('b')]); // 'a' vừa bị tắt
    const r = await svc.list({ page: 1, limit: 2, sort: 'best_seller' });
    expect(r.data.map((c) => c.id)).toEqual(['b']);
  });
});

describe('CatalogService.list — sắp theo giá đang bán (U1-B01)', () => {
  // Giá đang bán = salePrice ?? basePrice, cùng quy tắc với bộ lọc giá và thẻ SP.
  const ROWS = [
    { id: 'a', basePrice: 89000, salePrice: null },
    { id: 'b', basePrice: 100000, salePrice: 75000 }, // base cao hơn 'a' nhưng giá đang bán rẻ hơn
    { id: 'c', basePrice: 95000, salePrice: null },
    { id: 'd', basePrice: 79000, salePrice: null },
    { id: 'e', basePrice: 95000, salePrice: 95000 }, // hoà với 'c'
  ];
  type Row = (typeof ROWS)[number];

  // Bảng sản phẩm giả: hiểu lọc theo id và orderBy theo cột đơn giản, để test chạy cả hai cách làm (orderBy của Prisma hay xếp ở TS).
  function setup() {
    const findMany = jest.fn(async (args: { skip?: number; take?: number; where?: { AND?: { id?: { in: string[] } }[] }; orderBy?: Record<string, 'asc' | 'desc'>[] | Record<string, 'asc' | 'desc'> }) => {
      const ids = args.where?.AND?.find((c) => c.id)?.id?.in;
      let rows: Row[] = ids ? ROWS.filter((r) => ids.includes(r.id)) : [...ROWS];
      const keys = ([] as Record<string, 'asc' | 'desc'>[]).concat(args.orderBy ?? []);
      rows = rows.sort((x, y) => {
        for (const k of keys) {
          const [col, dir] = Object.entries(k)[0] as [keyof Row, 'asc' | 'desc'];
          const vx = x[col] as string | number | null;
          const vy = y[col] as string | number | null;
          if (vx === vy) continue;
          return ((vx ?? 0) < (vy ?? 0) ? -1 : 1) * (dir === 'asc' ? 1 : -1);
        }
        return 0;
      });
      if (args.take !== undefined) rows = rows.slice(args.skip ?? 0, (args.skip ?? 0) + args.take);
      return rows.map((r) => ({ ...card(r.id), basePrice: r.basePrice, salePrice: r.salePrice }));
    });
    const count = jest.fn().mockResolvedValue(ROWS.length);
    const prisma = { product: { findMany, count }, $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)) } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), findMany };
  }

  it('Giá tăng: SP có sale rẻ hơn base của SP khác đứng trước; hoà thì id tăng dần', async () => {
    const r = await setup().svc.list({ page: 1, limit: 5, sort: 'price_asc' });
    expect(r.data.map((c) => c.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(r.meta).toEqual({ page: 1, limit: 5, total: 5 });
  });

  it('Giá giảm: đảo chiều theo giá đang bán, hoà thì id tăng dần', async () => {
    const r = await setup().svc.list({ page: 1, limit: 5, sort: 'price_desc' });
    expect(r.data.map((c) => c.id)).toEqual(['c', 'e', 'a', 'd', 'b']);
  });

  it('trang 2 nối tiếp trang 1 theo giá đang bán, không trùng, total = số SP khớp', async () => {
    const { svc } = setup();
    const p1 = await svc.list({ page: 1, limit: 3, sort: 'price_asc' });
    const p2 = await svc.list({ page: 2, limit: 3, sort: 'price_asc' });
    expect([...p1.data, ...p2.data].map((c) => c.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(p2.meta).toEqual({ page: 2, limit: 3, total: 5 });
  });

  it('giữ bộ lọc ở bước xếp hạng (brand + inStock)', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 3, sort: 'price_asc', brand: 'Tubu', inStock: true });
    const where = { isActive: true, approvalStatus: 'APPROVED', brand: 'Tubu', variations: { some: { isActive: true, stock: { gt: 0 } } } };
    expect(findMany.mock.calls[0]?.[0].where).toEqual(where);
  });
});

describe('CatalogService.categories — productCount (dự án 4b)', () => {
  const CAT = (id: string, sortOrder: number) => ({ id, parentId: null, name: id, slug: id, image: null, sortOrder });

  function setup() {
    const categoryFindMany = jest.fn().mockResolvedValue([CAT('cat-a', 1), CAT('cat-b', 2)]);
    const productFindMany = jest.fn().mockResolvedValue([
      { categoryIds: ['cat-a'] },
      { categoryIds: ['cat-a', 'cat-a'] }, // trùng id trong 1 SP → vẫn đếm 1
      { categoryIds: [] },
    ]);
    const prisma = { category: { findMany: categoryFindMany }, product: { findMany: productFindMany } } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), categoryFindMany, productFindMany };
  }

  it('mỗi danh mục kèm số SP đang bán (active + APPROVED); danh mục trống → 0; giữ thứ tự sortOrder', async () => {
    const { svc, productFindMany } = setup();
    await expect(svc.categories()).resolves.toEqual([
      { ...CAT('cat-a', 1), productCount: 2 },
      { ...CAT('cat-b', 2), productCount: 0 },
    ]);
    expect(productFindMany).toHaveBeenCalledWith({
      where: { isActive: true, approvalStatus: 'APPROVED' },
      select: { categoryIds: true },
    });
  });

  it('cache 60s vẫn áp dụng cho cả hai truy vấn', async () => {
    const { svc, categoryFindMany, productFindMany } = setup();
    await svc.categories();
    await svc.categories();
    expect(categoryFindMany).toHaveBeenCalledTimes(1);
    expect(productFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('CatalogService.getBySlug — ai giao hàng (D4, R2-BUYERMINI-1)', () => {
  const base = { id: 'p1', slug: 'xa-phong', isActive: true, approvalStatus: 'APPROVED', soldExternal: 0, soldApp: 0, variations: [], reviews: [] };
  const config = { get: jest.fn(async <T>(k: string, fb?: T) => (k === 'merchant.default_shipping_fee' ? (27_000 as T) : (fb as T))) };
  const OPEN_STORE = {
    title: 'Shop',
    type: 'MERCHANT',
    shippingFee: null as number | null,
    freeShipFrom: null as number | null,
    ordersPausedAt: null as Date | null,
    owner: { role: 'DEALER', isBlocked: false } as { role: string; isBlocked: boolean } | null,
  };

  it('hàng Tubu giao → fulfiller TUBU, không lộ đối tượng storefront', async () => {
    const prisma = { product: { findUnique: jest.fn().mockResolvedValue({ ...base, fulfilment: 'TUBU', storefront: null }) } } as unknown as PrismaService;
    const r = await new CatalogService(prisma, config as never).getBySlug('xa-phong');
    expect(r.fulfiller).toEqual({ kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null });
    expect(r).not.toHaveProperty('storefront');
  });

  it('hàng gian hàng tự giao → tên gian hàng, phí giao và ngưỡng miễn phí của gian hàng', async () => {
    const storefront = { ...OPEN_STORE, title: 'Xà phòng Cô Lan', shippingFee: 22_000, freeShipFrom: 300_000 };
    const prisma = { product: { findUnique: jest.fn().mockResolvedValue({ ...base, fulfilment: 'MERCHANT', storefront }) } } as unknown as PrismaService;
    const r = await new CatalogService(prisma, config as never).getBySlug('xa-phong');
    expect(r.fulfiller).toEqual({ kind: 'MERCHANT', name: 'Xà phòng Cô Lan', shippingFee: 22_000, freeShipFrom: 300_000 });
  });

  it('gian hàng chưa đặt phí giao → phí mặc định merchant.default_shipping_fee', async () => {
    const storefront = { ...OPEN_STORE, title: 'Shop A', shippingFee: null, freeShipFrom: null };
    const prisma = { product: { findUnique: jest.fn().mockResolvedValue({ ...base, fulfilment: 'MERCHANT', storefront }) } } as unknown as PrismaService;
    const r = await new CatalogService(prisma, config as never).getBySlug('xa-phong');
    expect(r.fulfiller).toEqual({ kind: 'MERCHANT', name: 'Shop A', shippingFee: 27_000, freeShipFrom: null });
  });

  // R3-MERCHANT-3: trang sản phẩm nói thẳng khi gian hàng không nhận đơn, thay vì để khách thêm vào giỏ rồi mới bị chặn.
  it('R3-MERCHANT-3: gian hàng tạm nghỉ → fulfiller UNAVAILABLE lý do STORE_PAUSED, kèm tên gian hàng', async () => {
    const storefront = { ...OPEN_STORE, title: 'Shop A', ordersPausedAt: new Date() };
    const prisma = { product: { findUnique: jest.fn().mockResolvedValue({ ...base, fulfilment: 'MERCHANT', storefront }) } } as unknown as PrismaService;
    const r = await new CatalogService(prisma, config as never).getBySlug('xa-phong');
    expect(r.fulfiller).toEqual({ kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Shop A', shippingFee: null, freeShipFrom: null });
    expect(JSON.stringify(r)).not.toContain('isBlocked');
  });

  it.each([
    ['chủ gian hàng bị khoá', { role: 'DEALER', isBlocked: true }],
    ['chủ gian hàng bị hạ quyền', { role: 'CUSTOMER', isBlocked: false }],
    ['gian hàng mất chủ', null],
  ])('R3-MERCHANT-3: %s → UNAVAILABLE lý do STORE_CLOSED', async (_label, owner) => {
    const storefront = { ...OPEN_STORE, title: 'Shop B', owner };
    const prisma = { product: { findUnique: jest.fn().mockResolvedValue({ ...base, fulfilment: 'MERCHANT', storefront }) } } as unknown as PrismaService;
    const r = await new CatalogService(prisma, config as never).getBySlug('xa-phong');
    expect(r.fulfiller).toEqual({ kind: 'UNAVAILABLE', reason: 'STORE_CLOSED', name: 'Shop B', shippingFee: null, freeShipFrom: null });
  });

  it('R3-MERCHANT-4: lý do từ chối bản sửa là lời nhắn riêng cho đối tác, không lộ ra PDP công khai', async () => {
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue({ ...base, fulfilment: 'TUBU', storefront: null, rejectReason: 'Ảnh vi phạm' }) },
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma, config as never).getBySlug('xa-phong');
    expect(r).not.toHaveProperty('rejectReason');
  });

  it('R3-MERCHANT-3: PDP lấy thêm trạng thái tạm nghỉ và chủ gian hàng từ DB', async () => {
    const findUnique = jest.fn().mockResolvedValue({ ...base, fulfilment: 'TUBU', storefront: null });
    await new CatalogService({ product: { findUnique } } as unknown as PrismaService, config as never).getBySlug('xa-phong');
    expect(findUnique.mock.calls[0][0].include.storefront.select).toMatchObject({
      ordersPausedAt: true,
      owner: { select: { role: true, isBlocked: true } },
    });
  });
});

describe('CatalogService — JSON công khai không nhúng ảnh base64', () => {
  const PNG = 'data:image/png;base64,' + 'A'.repeat(4000);
  const row = (over: Record<string, unknown> = {}) => ({ ...card('p1'), thumbnail: PNG, images: [PNG, 'https://cdn.example.com/b.jpg'], ...over });

  it('danh sách và gợi ý tìm kiếm: thẻ sản phẩm chỉ có đường dẫn ảnh', async () => {
    const prisma = {
      $transaction: jest.fn().mockResolvedValue([[row(), row({ id: 'p2', thumbnail: null })], 2]),
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', slug: 'a', name: 'A', thumbnail: PNG, basePrice: 1 }]), count: jest.fn().mockResolvedValue(2) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const svc = new CatalogService(prisma);
    jest.spyOn(svc as unknown as { listWhere: () => Promise<object> }, 'listWhere').mockResolvedValue({});
    const list = await svc.list({ page: 1, limit: 20 } as never);
    expect(JSON.stringify(list)).not.toContain('data:image');
    expect(JSON.stringify(list)).toContain('/public-image/product/p1/thumb');
    jest.spyOn(svc as unknown as { textWhere: () => Promise<object> }, 'textWhere').mockResolvedValue({});
    const hints = await svc.suggest('tinh dau');
    expect(JSON.stringify(hints)).not.toContain('data:image');
  });

  it('trang chi tiết: images và thumbnail không chứa base64, link thường giữ nguyên', async () => {
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue({ ...row(), isActive: true, approvalStatus: 'APPROVED', fulfilment: 'TUBU', storefrontId: null, variations: [] }) },
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma).getBySlug('a');
    expect(JSON.stringify(r)).not.toContain('data:image');
    expect(r.images).toEqual([expect.stringMatching(/^\/public-image\/product\/p1\/0\?v=/), 'https://cdn.example.com/b.jpg']);
  });
});
