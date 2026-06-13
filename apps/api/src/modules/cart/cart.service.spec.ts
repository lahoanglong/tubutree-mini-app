import { CartService } from './cart.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const coupons = {} as unknown as CouponsService;
const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;

describe('CartService guard tồn kho', () => {
  it('addItem: chặn sản phẩm không khả dụng (inactive/không tồn tại)', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config);
    await expect(svc.addItem('u1', { variationId: 'v1', quantity: 1 })).rejects.toThrow('không khả dụng');
  });

  it('addItem: chặn khi tổng số lượng vượt tồn kho', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, stock: 3 }) },
      cartItem: { findUnique: jest.fn().mockResolvedValue({ quantity: 2 }), upsert: jest.fn() },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config);
    // đã có 2, thêm 2 = 4 > 3
    await expect(svc.addItem('u1', { variationId: 'v1', quantity: 2 })).rejects.toThrow('Chỉ còn 3');
    expect((prisma.cartItem!.upsert as jest.Mock)).not.toHaveBeenCalled();
  });

  it('updateItem: chặn set quantity vượt tồn kho', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      cartItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'it1', cartId: 'c1', variation: { stock: 5 } }),
        update: jest.fn(),
      },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config);
    await expect(svc.updateItem('u1', 'it1', 10)).rejects.toThrow('Chỉ còn 5');
    expect((prisma.cartItem!.update as jest.Mock)).not.toHaveBeenCalled();
  });

  it('updateItem: chặn thao tác mục giỏ của cart khác', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      cartItem: { findUnique: jest.fn().mockResolvedValue({ id: 'it1', cartId: 'OTHER', variation: { stock: 5 } }) },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config);
    await expect(svc.updateItem('u1', 'it1', 1)).rejects.toThrow('Không tìm thấy');
  });
});
