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
});
