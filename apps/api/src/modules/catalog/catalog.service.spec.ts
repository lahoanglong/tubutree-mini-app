import { Logger, NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { LIKE_ESCAPE, SQL_WHITESPACE_RE, VN_FOLD_FROM, VN_FOLD_TO } from './search-text';

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
    const prisma = { product: { findMany }, $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as PrismaService;
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
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    return { sql: strings.join('?'), values };
  };

  it('q → SQL gấp dấu bằng translate(); where lọc theo id tìm được (AND, không đè OR khác)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: ' Nước rửa ' });
    expect(findMany.mock.calls[0][0].where.AND).toEqual([{ id: { in: ['p1', 'p2'] } }]);
    expect(findMany.mock.calls[0][0].where.OR).toBeUndefined();
    const { sql, values } = sqlOf(queryRaw);
    expect(sql).toContain('translate(p.name');
    expect(LIKE_ESCAPE).toBe('!');
    expect(sql).toContain("ESCAPE '!'");
    expect(values).toEqual(expect.arrayContaining([VN_FOLD_FROM, VN_FOLD_TO, '%nuoc rua%', 'nước rửa']));
  });

  it('từ khoá chỉ đi vào SQL qua tham số ràng buộc, không nối chuỗi vào câu lệnh', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: "x'; DROP TABLE products;--" });
    const { sql, values } = sqlOf(queryRaw);
    expect(sql).not.toContain('DROP');
    expect(values).toContain('%x\'; drop table products;--%');
  });

  it('% và _ trong từ khoá được escape (không thành ký tự đại diện)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: '50%' });
    expect(queryRaw.mock.calls[0]).toContain('%50!%%');
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

  it('khoảng trắng không ngắt (NBSP) được gấp thành khoảng trắng thường ở phía SQL, giống foldVietnamese', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: 'nước rửa' });
    const { values } = sqlOf(queryRaw);
    expect(SQL_WHITESPACE_RE).toContain(' ');
    expect(values).toContain(SQL_WHITESPACE_RE);
    expect(values).toContain('%nuoc rua%');
  });

  it('SQL gấp dấu lỗi → lùi về contains như trước (mất tìm không dấu nhưng không sập trang)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const queryRaw = jest.fn().mockRejectedValue(new Error('function translate does not exist'));
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
      select: { slug: true, name: true, thumbnail: true, basePrice: true },
    });
    await expect(svc.suggest('  ')).resolves.toEqual([]);
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
      include: { variations: { where: { isActive: true } } },
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
