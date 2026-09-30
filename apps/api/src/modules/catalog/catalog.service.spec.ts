import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import type { PrismaService } from '../../prisma/prisma.service';

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
    const prisma = { product: { findMany } } as unknown as PrismaService;
    await new CatalogService(prisma).suggest('tinh dau');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true, approvalStatus: 'APPROVED' }) }),
    );
  });
});

describe('CatalogService.brands cache 60s', () => {
  it('gọi 2 lần liên tiếp chỉ hit DB 1 lần (TTL chưa hết)', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ brand: 'TuBu', _count: { _all: 3 } }]);
    const prisma = { product: { groupBy } } as unknown as PrismaService;
    const svc = new CatalogService(prisma);

    const a = await svc.brands();
    const b = await svc.brands();

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ brand: 'TuBu', count: 3 }]);
    expect(b).toEqual(a);
  });

  it('expire sau 60s → hit DB lần 2 (chứng minh TTL thực sự chạy)', async () => {
    // Trước đây test chỉ chứng minh cache hit, không chứng minh expiry — nếu ai đó
    // hardcode "return cache" mà không check expiresAt, test cũ vẫn pass.
    jest.useFakeTimers();
    try {
      const groupBy = jest.fn().mockResolvedValue([{ brand: 'TuBu', _count: { _all: 3 } }]);
      const prisma = { product: { groupBy } } as unknown as PrismaService;
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

