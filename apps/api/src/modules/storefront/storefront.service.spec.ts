import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { StorefrontService } from './storefront.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(over: Record<string, any> = {}) {
  return {
    user: { findUniqueOrThrow: jest.fn() },
    storefront: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    ...over,
  } as unknown as PrismaService;
}

describe('StorefrontService.getOrCreateMine', () => {
  it('tạo gian hàng draft cho CTV nếu chưa có', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
      id: 'u1', role: 'AFFILIATE', referralCode: 'LINH123', fullName: 'Linh',
    });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.storefront.create as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));

    const svc = new StorefrontService(prisma);
    const sf = await svc.getOrCreateMine('u1');

    expect(prisma.storefront.create).toHaveBeenCalled();
    expect(sf.slug).toBe('LINH123');
    expect(sf.type).toBe('CTV');
    expect(sf.title).toContain('Linh');
  });

  it('trả gian hàng có sẵn, không tạo mới', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', role: 'AFFILIATE', referralCode: 'L', fullName: 'L' });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', type: 'CTV' });

    const svc = new StorefrontService(prisma);
    const sf = await svc.getOrCreateMine('u1');

    expect(sf.id).toBe('s1');
    expect(prisma.storefront.create).not.toHaveBeenCalled();
  });

  it('từ chối user không phải CTV', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', role: 'CUSTOMER', referralCode: 'L' });
    const svc = new StorefrontService(prisma);
    await expect(svc.getOrCreateMine('u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StorefrontService.updateMine/publishMine', () => {
  it('cập nhật title/note/theme', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', ownerUserId: 'u1' });
    (prisma.storefront.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));
    const svc = new StorefrontService(prisma);
    const r = await svc.updateMine('u1', { title: 'Shop Linh', headerNote: 'xin chào', theme: 'leaf-orange' });
    expect(r.title).toBe('Shop Linh');
    expect(prisma.storefront.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
  });

  it('publish set isPublished + publishedAt', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', ownerUserId: 'u1' });
    (prisma.storefront.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));
    const svc = new StorefrontService(prisma);
    const r = await svc.publishMine('u1', true);
    expect(r.isPublished).toBe(true);
    expect(r.publishedAt).toBeInstanceOf(Date);
  });
});

describe('StorefrontService collections', () => {
  it('createCollection gắn vào storefront của tôi, sortOrder kế tiếp', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      storefrontCollection: { count: jest.fn().mockResolvedValue(2), create: jest.fn().mockImplementation(({ data }) => ({ id: 'c3', ...data })) },
    });
    const svc = new StorefrontService(prisma);
    const c = await svc.createCollection('u1', { title: 'Skincare' });
    expect(c.storefrontId).toBe('s1');
    expect(c.sortOrder).toBe(2);
    expect(c.kind).toBe('NORMAL');
  });

  it('reorderCollections cập nhật sortOrder theo thứ tự mảng', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      storefrontCollection: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]), update: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    });
    const svc = new StorefrontService(prisma);
    await svc.reorderCollections('u1', ['b', 'a']);
    expect(prisma.storefrontCollection.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { sortOrder: 0 } });
    expect(prisma.storefrontCollection.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { sortOrder: 1 } });
  });
});
