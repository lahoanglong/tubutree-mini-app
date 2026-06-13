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
