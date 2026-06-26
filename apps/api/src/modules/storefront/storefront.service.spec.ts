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

describe('StorefrontService.getMine', () => {
  it('trả gian hàng kèm collections+items (gồm cả isHidden) theo sortOrder', async () => {
    const sfWithChildren = {
      id: 's1', ownerUserId: 'u1', type: 'CTV',
      collections: [
        { id: 'c1', sortOrder: 0, items: [{ id: 'i1', isHidden: true }, { id: 'i2', isHidden: false }] },
      ],
    };
    const prisma = makePrisma();
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(sfWithChildren);
    const svc = new StorefrontService(prisma);
    const sf = await svc.getMine('u1');

    // verify behavior: trả đúng cây dữ liệu, item ẩn vẫn còn (để CTV sửa)
    expect(sf).toBe(sfWithChildren);
    const col0 = sf.collections[0]!;
    expect(col0.items).toHaveLength(2);
    expect(col0.items.some((i: any) => i.isHidden === true)).toBe(true);
    // include đúng: có collections.orderBy sortOrder + items
    const arg = (prisma.storefront.findFirst as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ ownerUserId: 'u1', type: 'CTV' });
    expect(arg.include.collections.orderBy).toEqual({ sortOrder: 'asc' });
    expect(arg.include.collections.include.items).toBeDefined();
  });

  it('throw NotFound khi chưa có gian hàng', async () => {
    const prisma = makePrisma();
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(null);
    const svc = new StorefrontService(prisma);
    await expect(svc.getMine('u1')).rejects.toThrow();
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

  it('updateCollection: owner sửa được', async () => {
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'c1', ...data })),
      },
    });
    const svc = new StorefrontService(prisma);
    const r = await svc.updateCollection('u1', 'c1', { title: 'New' });
    expect(r.title).toBe('New');
    expect(prisma.storefrontCollection.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { title: 'New' } });
  });

  it('updateCollection: non-owner bị reject, không gọi update', async () => {
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'OTHER' } }),
        update: jest.fn(),
      },
    });
    const svc = new StorefrontService(prisma);
    await expect(svc.updateCollection('u1', 'c1', { title: 'New' })).rejects.toThrow();
    expect(prisma.storefrontCollection.update).not.toHaveBeenCalled();
  });

  it('deleteCollection: owner xoá được', async () => {
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }),
        delete: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
    });
    const svc = new StorefrontService(prisma);
    const r = await svc.deleteCollection('u1', 'c1');
    expect(r).toEqual({ ok: true });
    expect(prisma.storefrontCollection.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('deleteCollection: non-owner bị reject, không gọi delete', async () => {
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'OTHER' } }),
        delete: jest.fn(),
      },
    });
    const svc = new StorefrontService(prisma);
    await expect(svc.deleteCollection('u1', 'c1')).rejects.toThrow();
    expect(prisma.storefrontCollection.delete).not.toHaveBeenCalled();
  });
});

describe('StorefrontService items', () => {
  it('addItem gắn vào collection của tôi', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, affiliateBlocked: false }) },
      storefrontItem: { count: jest.fn().mockResolvedValue(1), create: jest.fn().mockImplementation(({ data }) => ({ id: 'i2', ...data })) },
    });
    const svc = new StorefrontService(prisma);
    const it = await svc.addItem('u1', 'c1', { productId: 'p1', note: 'thích' });
    expect(it.collectionId).toBe('c1');
    expect(it.productId).toBe('p1');
    expect(it.sortOrder).toBe(1);
  });

  it('addItem chặn SP affiliateBlocked=true, không tạo item', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, affiliateBlocked: true }) },
      storefrontItem: { count: jest.fn(), create: jest.fn() },
    });
    const svc = new StorefrontService(prisma);
    await expect(svc.addItem('u1', 'c1', { productId: 'p1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storefrontItem.create).not.toHaveBeenCalled();
  });

  it('addItem chặn SP isActive=false, không tạo item', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: false, affiliateBlocked: false }) },
      storefrontItem: { count: jest.fn(), create: jest.fn() },
    });
    const svc = new StorefrontService(prisma);
    await expect(svc.addItem('u1', 'c1', { productId: 'p1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storefrontItem.create).not.toHaveBeenCalled();
  });

  it('addItem chặn productId không tồn tại', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      storefrontItem: { count: jest.fn(), create: jest.fn() },
    });
    const svc = new StorefrontService(prisma);
    await expect(svc.addItem('u1', 'c1', { productId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storefrontItem.create).not.toHaveBeenCalled();
  });

  it('updateItem chặn người không sở hữu', async () => {
    const prisma = makePrisma({
      storefrontItem: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', collection: { storefront: { ownerUserId: 'OTHER' } } }) },
    });
    const svc = new StorefrontService(prisma);
    await expect(svc.updateItem('u1', 'i1', { isHidden: true })).rejects.toThrow();
  });

  it('removeItem: owner xoá item của mình', async () => {
    const prisma = makePrisma({
      storefrontItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'i1', collection: { storefront: { ownerUserId: 'u1' } } }),
        delete: jest.fn().mockResolvedValue({ id: 'i1' }),
      },
    });
    const svc = new StorefrontService(prisma);
    const r = await svc.removeItem('u1', 'i1');
    expect(r).toEqual({ ok: true });
    expect(prisma.storefrontItem.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
  });

  it('reorderItems: chỉ cập nhật id thuộc collection, id lạ bị loại khỏi ops', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      storefrontItem: {
        findMany: jest.fn().mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]),
        update: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    });
    const svc = new StorefrontService(prisma);
    // 'STRANGER' không thuộc collection → phải bị loại
    await svc.reorderItems('u1', 'c1', ['i2', 'STRANGER', 'i1']);
    expect(prisma.storefrontItem.update).toHaveBeenCalledWith({ where: { id: 'i2' }, data: { sortOrder: 0 } });
    expect(prisma.storefrontItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { sortOrder: 1 } });
    // id lạ KHÔNG được cập nhật, và chỉ có đúng 2 lần update
    expect(prisma.storefrontItem.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'STRANGER' } }),
    );
    expect(prisma.storefrontItem.update).toHaveBeenCalledTimes(2);
  });
});

describe('StorefrontService.pickerProducts', () => {
  it('loại SP affiliateBlocked, trả maxRate', async () => {
    const prisma = makePrisma({
      product: { findMany: jest.fn().mockResolvedValue([
        { id: 'p1', name: 'Dầu gội', slug: 'dau-goi', thumbnail: 't', basePrice: 189000, salePrice: null, ratingAvg: 4.8, reviewCount: 42,
          variations: [{ affiliateRate: '8' }, { affiliateRate: '10' }] },
      ]) },
    });
    const svc = new StorefrontService(prisma);
    const r = await svc.pickerProducts('u1', { search: 'dầu' });
    expect((prisma.product.findMany as jest.Mock).mock.calls[0]?.[0].where.affiliateBlocked).toBe(false);
    const first = r[0]!;
    expect(first.maxAffiliateRate).toBe(10);
    expect(first.name).toBe('Dầu gội');
    // KHÔNG lộ mảng variations (chứa affiliateRate từng biến thể) cho CTV
    expect((first as any).variations).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('affiliateRate');
  });
});

describe('StorefrontService.getPublicBySlug', () => {
  it('404 nếu chưa publish', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(null) } });
    const svc = new StorefrontService(prisma);
    await expect(svc.getPublicBySlug('x')).rejects.toThrow();
  });

  it('ẩn item isHidden + loại SP inactive/affiliateBlocked + không trả affiliateRate', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'linh', title: 'Shop', isPublished: true,
        collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 0,
          items: [
            { id: 'i1', isHidden: false, isPinned: false, sortOrder: 0, note: null, variationId: null,
              product: { id: 'p1', name: 'P1', slug: 'p1', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 4.5, reviewCount: 3, isActive: true, affiliateBlocked: false } },
            { id: 'i2', isHidden: true, isPinned: false, sortOrder: 1, note: null, variationId: null,
              product: { id: 'p2', name: 'P2', slug: 'p2', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 0, reviewCount: 0, isActive: true, affiliateBlocked: false } },
            { id: 'i3', isHidden: false, isPinned: false, sortOrder: 2, note: null, variationId: null,
              product: { id: 'p3', name: 'P3', slug: 'p3', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 0, reviewCount: 0, isActive: true, affiliateBlocked: true } },
          ] }],
      }) },
    });
    const svc = new StorefrontService(prisma);
    const r = await svc.getPublicBySlug('linh');
    const col0 = r.collections[0]!;
    // i2 ẩn (isHidden), i3 bị chặn (affiliateBlocked) → chỉ còn i1
    expect(col0.items).toHaveLength(1);
    expect(col0.items[0]!.id).toBe('i1');
    // affiliateRate không lộ; affiliateBlocked chỉ dùng để lọc, không nằm trong output
    expect(JSON.stringify(r)).not.toContain('affiliateRate');
    expect(JSON.stringify(r)).not.toContain('affiliateBlocked');
  });
});
