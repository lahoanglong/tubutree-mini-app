import { NotFoundException } from '@nestjs/common';
import { WishlistService } from './wishlist.service';
import type { PrismaService } from '../../prisma/prisma.service';

const variation = (stock: number) => ({ stock });
const product = (id: string, opts: { stock?: number } = {}) => ({
  id,
  slug: `${id}-slug`,
  brand: 'Visante',
  name: `SP ${id}`,
  thumbnail: null,
  images: [],
  basePrice: 100000,
  salePrice: null,
  isFeatured: false,
  variations: [variation(opts.stock ?? 5)],
});

describe('WishlistService.list', () => {
  it('giữ thứ tự thêm gần nhất + bỏ sản phẩm đã ẩn/xóa', async () => {
    const prisma = {
      wishlist: {
        findMany: jest.fn().mockResolvedValue([
          { productId: 'p1' },
          { productId: 'p2' },
          { productId: 'pX' }, // sản phẩm không còn active → bị lọc
        ]),
      },
      // product.findMany trả về lệch thứ tự + thiếu pX
      product: { findMany: jest.fn().mockResolvedValue([product('p2'), product('p1')]) },
    } as unknown as PrismaService;

    const svc = new WishlistService(prisma);
    const result = await svc.list('user1');

    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']); // theo thứ tự wishlist, không theo product.findMany
    expect(result[0]!.inStock).toBe(true);
  });

  it('trả [] khi chưa thích gì (không query product)', async () => {
    const prisma = {
      wishlist: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const svc = new WishlistService(prisma);
    const result = await svc.list('user1');
    expect(result).toEqual([]);
    expect((prisma.product.findMany as jest.Mock)).not.toHaveBeenCalled();
  });

  it('inStock=false khi mọi variation hết hàng', async () => {
    const prisma = {
      wishlist: { findMany: jest.fn().mockResolvedValue([{ productId: 'p1' }]) },
      product: { findMany: jest.fn().mockResolvedValue([product('p1', { stock: 0 })]) },
    } as unknown as PrismaService;
    const svc = new WishlistService(prisma);
    const result = await svc.list('user1');
    expect(result[0]!.inStock).toBe(false);
  });

  it('trả kèm ratingAvg/reviewCount/sold (đồng bộ CatalogService.toCard)', async () => {
    const prisma = {
      wishlist: { findMany: jest.fn().mockResolvedValue([{ productId: 'p1' }]) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { ...product('p1'), ratingAvg: 4.5, reviewCount: 12, soldExternal: 3, soldApp: 7 },
        ]),
      },
    } as unknown as PrismaService;
    const svc = new WishlistService(prisma);
    const result = await svc.list('user1');
    expect(result[0]).toMatchObject({ ratingAvg: 4.5, reviewCount: 12, sold: 10 });
  });
});

describe('WishlistService.ids', () => {
  it('chỉ trả productId của sản phẩm còn active (khớp với list())', async () => {
    const prisma = {
      wishlist: { findMany: jest.fn().mockResolvedValue([{ productId: 'p1' }, { productId: 'pX' }]) },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) }, // pX đã bị ẩn/xóa
    } as unknown as PrismaService;
    const svc = new WishlistService(prisma);
    const result = await svc.ids('user1');
    expect(result).toEqual(['p1']);
  });

  it('trả [] khi chưa thích gì (không query product)', async () => {
    const prisma = {
      wishlist: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const svc = new WishlistService(prisma);
    const result = await svc.ids('user1');
    expect(result).toEqual([]);
    expect((prisma.product.findMany as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('WishlistService.add', () => {
  it('sản phẩm tồn tại + active → upsert wishlist', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: true }) },
      wishlist: { upsert },
    } as unknown as PrismaService;
    const out = await new WishlistService(prisma).add('user1', 'p1');
    expect(out).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_productId: { userId: 'user1', productId: 'p1' } },
      create: { userId: 'user1', productId: 'p1' },
      update: {},
    });
  });

  it('sản phẩm không tồn tại → NotFound, không tạo wishlist row rác', async () => {
    const upsert = jest.fn();
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      wishlist: { upsert },
    } as unknown as PrismaService;
    await expect(new WishlistService(prisma).add('user1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('sản phẩm đã bị ẩn (isActive=false) → NotFound', async () => {
    const upsert = jest.fn();
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: false }) },
      wishlist: { upsert },
    } as unknown as PrismaService;
    await expect(new WishlistService(prisma).add('user1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(upsert).not.toHaveBeenCalled();
  });
});
