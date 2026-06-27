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
