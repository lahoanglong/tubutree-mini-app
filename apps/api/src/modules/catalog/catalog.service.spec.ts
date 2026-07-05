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

  it('có lịch sử mua ở danh mục C → gợi ý sản phẩm active cùng danh mục, LOẠI sản phẩm đã mua, sắp theo đã bán giảm dần', async () => {
    const orderItemFindMany = jest.fn().mockResolvedValue([{ variationId: 'v1' }]);
    const variationFindMany = jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }]);
    // Lần 1: lấy categoryIds của sản phẩm đã mua. Lần 2: query gợi ý (matched).
    const productFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ categoryIds: ['C'] }])
      .mockResolvedValueOnce([
        { ...card('p2'), soldExternal: 5, soldApp: 0 }, // sold = 5
        { ...card('p3'), soldExternal: 10, soldApp: 20 }, // sold = 30
      ]);
    const { prisma, svc } = setup({
      orderItem: { findMany: orderItemFindMany },
      variation: { findMany: variationFindMany },
      product: { findMany: productFindMany },
    });

    const r = await svc.getForYou('u1');

    expect(r.map((c) => c.id)).toEqual(['p3', 'p2']); // p3 (sold 30) trước p2 (sold 5)
    expect(r.map((c) => c.id)).not.toContain('p1'); // không gợi ý lại sản phẩm đã mua
    // Query gợi ý phải loại trừ sản phẩm đã mua ngay ở DB, không chỉ lọc ở JS.
    const candidateWhere = (prisma as any).product.findMany.mock.calls[1][0].where;
    expect(candidateWhere.id).toEqual({ notIn: ['p1'] });
    expect(candidateWhere.OR).toEqual(expect.arrayContaining([{ categoryIds: { hasSome: ['C'] } }]));
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
  it('recomputeSoldCounts: gom đơn DELIVERED theo product (reset 0 rồi set)', async () => {
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
    // reset toàn bộ về 0 trước
    expect((prisma as any).product.updateMany).toHaveBeenCalledWith({ data: { soldApp: 0 } });
    // p1 = 5 + 3 = 8 (gộp 2 biến thể)
    expect((prisma as any).product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { soldApp: 8 } });
    expect(r.updated).toBe(1);
  });

  it('setSoldExternal: map sku→product, set soldExternal', async () => {
    const prisma = {
      variation: { findUnique: jest.fn().mockResolvedValue({ productId: 'p1' }) },
      product: { update: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma).setSoldExternal([{ sku: 'SKU1', count: 1200 }]);
    expect((prisma as any).variation.findUnique).toHaveBeenCalledWith({ where: { sku: 'SKU1' }, select: { productId: true } });
    expect((prisma as any).product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { soldExternal: 1200 } });
    expect(r.updated).toBe(1);
  });

  it('setSoldExternal: bỏ qua sku không tồn tại / count âm', async () => {
    const prisma = {
      variation: { findUnique: jest.fn().mockResolvedValue(null) },
      product: { update: jest.fn() },
    } as unknown as PrismaService;
    const r = await new CatalogService(prisma).setSoldExternal([{ sku: 'NOPE', count: 5 }, { sku: 'X', count: -1 }]);
    expect((prisma as any).product.update).not.toHaveBeenCalled();
    expect(r.updated).toBe(0);
  });
});
