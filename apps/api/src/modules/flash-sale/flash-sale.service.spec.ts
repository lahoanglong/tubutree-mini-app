import { FlashSaleService } from './flash-sale.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const NOW = new Date('2026-07-05T10:00:00Z');
const activeItem = (over: Record<string, unknown> = {}) => ({
  id: 'fi1', variationId: 'v1', flashPrice: 80000, quota: 10, soldCount: 3,
  flashSale: { endAt: new Date('2026-07-05T12:00:00Z') },
  ...over,
});

describe('FlashSaleService.resolveEffective', () => {
  it('variation có flash ACTIVE còn quota → trả flashPrice + metadata', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([activeItem()]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective(['v1'], NOW);
    expect(map.get('v1')).toMatchObject({ flashPrice: 80000, itemId: 'fi1', soldCount: 3, quota: 10 });
  });

  it('item hết quota (soldCount>=quota) → không có trong map', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([activeItem({ soldCount: 10 })]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective(['v1'], NOW);
    expect(map.has('v1')).toBe(false);
  });

  it('variation không có item active → không có trong map', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective(['v9'], NOW);
    expect(map.has('v9')).toBe(false);
  });

  it('variationIds rỗng → map rỗng, KHÔNG query', async () => {
    const findMany = jest.fn();
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective([], NOW);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('where CHỈ lấy variation active (variation: { isActive: true })', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    await new FlashSaleService(prisma, config).resolveEffective(['v1'], NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variation: { isActive: true } }) }),
    );
  });
});

describe('FlashSaleService.listActive', () => {
  it('trả item active còn quota kèm giá + endAt', async () => {
    const row = {
      id: 'fi1', variationId: 'v1', flashPrice: 80000, quota: 10, soldCount: 3,
      flashSale: { endAt: new Date('2026-07-05T12:00:00Z') },
      variation: { retailPrice: 100000, product: { slug: 'a', name: 'A', thumbnail: null } },
    };
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([row]) } } as unknown as PrismaService;
    const list = await new FlashSaleService(prisma, config).listActive(NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemId: 'fi1', flashPrice: 80000, retailPrice: 100000, productSlug: 'a' });
  });

  it('where CHỈ lấy variation active (variation: { isActive: true })', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    await new FlashSaleService(prisma, config).listActive(NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variation: { isActive: true } }) }),
    );
  });
});

describe('FlashSaleService.consumeQuota', () => {
  const now = new Date('2026-07-05T10:00:00Z');
  const mkTx = (soldRaw: number, perUserLimit: number, existing: any, purchaseHit: number) => ({
    $executeRaw: jest.fn().mockResolvedValue(soldRaw),
    flashSaleItem: {
      findUnique: jest.fn().mockResolvedValue({ perUserLimit }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    flashSalePurchase: {
      findUnique: jest.fn().mockResolvedValue(existing),
      updateMany: jest.fn().mockResolvedValue({ count: purchaseHit }),
      create: jest.fn().mockResolvedValue({}),
    },
  });

  it('còn quota + trong giới hạn (đã có purchase) → trừ soldCount (raw) + tăng purchase', async () => {
    const tx = mkTx(1, 5, { quantity: 1 }, 1);
    await new FlashSaleService({} as any, config).consumeQuota(tx as any, 'fi1', 'u1', 2, now);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.flashSalePurchase.updateMany).toHaveBeenCalled();
    expect(tx.flashSalePurchase.create).not.toHaveBeenCalled();
  });

  it('chưa có purchase + qty<=limit → create purchase', async () => {
    const tx = mkTx(1, 5, null, 0);
    await new FlashSaleService({} as any, config).consumeQuota(tx as any, 'fi1', 'u1', 2, now);
    expect(tx.flashSalePurchase.create).toHaveBeenCalled();
  });

  it('hết quota / flash hết giờ (rows=0) → throw "Hết suất ưu đãi."', async () => {
    const tx = mkTx(0, 5, { quantity: 0 }, 1);
    await expect(new FlashSaleService({} as any, config).consumeQuota(tx as any, 'fi1', 'u1', 2, now))
      .rejects.toThrow('Hết suất ưu đãi.');
  });

  it('vượt perUserLimit (đã có purchase, updateMany count=0) → rollback soldCount + throw', async () => {
    const tx = mkTx(1, 5, { quantity: 4 }, 0);
    await expect(new FlashSaleService({} as any, config).consumeQuota(tx as any, 'fi1', 'u1', 2, now))
      .rejects.toThrow('Vượt giới hạn mua ưu đãi.');
    expect(tx.flashSaleItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { soldCount: { decrement: 2 } } }),
    );
  });

  it('vượt perUserLimit (chưa có purchase, qty>limit) → rollback soldCount + throw', async () => {
    const tx = mkTx(1, 1, null, 0);
    await expect(new FlashSaleService({} as any, config).consumeQuota(tx as any, 'fi1', 'u1', 2, now))
      .rejects.toThrow('Vượt giới hạn mua ưu đãi.');
    expect(tx.flashSaleItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { soldCount: { decrement: 2 } } }),
    );
  });
});

describe('FlashSaleService.restore', () => {
  it('hoàn soldCount + purchase.quantity (guard gte)', async () => {
    const tx = {
      flashSaleItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      flashSalePurchase: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await new FlashSaleService({} as any, config).restore(tx as any, 'fi1', 'u1', 2);
    expect(tx.flashSaleItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { soldCount: { decrement: 2 } } }),
    );
    expect(tx.flashSalePurchase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: { decrement: 2 } } }),
    );
  });
});

describe('FlashSaleService.updateSale', () => {
  const mkPrisma = (current: Record<string, unknown>) => ({
    flashSale: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue({ id: 's1' }),
    },
  });

  it('startAt sau endAt (cả 2 đều truyền) → reject, KHÔNG update', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2026-07-01'), endAt: new Date('2026-07-02') }) as any;
    await expect(
      new FlashSaleService(prisma, config).updateSale('s1', { startAt: '2026-07-10', endAt: '2026-07-08' }),
    ).rejects.toThrow('startAt phải trước endAt.');
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  it('chỉ truyền startAt mới, sau endAt hiện tại → reject', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2026-07-01'), endAt: new Date('2026-07-05') }) as any;
    await expect(
      new FlashSaleService(prisma, config).updateSale('s1', { startAt: '2026-07-10' }),
    ).rejects.toThrow('startAt phải trước endAt.');
  });

  it('window hợp lệ → update thành công', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2026-07-01'), endAt: new Date('2026-07-05') }) as any;
    const r = await new FlashSaleService(prisma, config).updateSale('s1', { startAt: '2026-07-02', endAt: '2026-07-08' });
    expect(r).toEqual({ id: 's1' });
    expect(prisma.flashSale.update).toHaveBeenCalled();
  });

  it('không đổi startAt/endAt (chỉ title/isActive) → KHÔNG cần validate, update thành công', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2026-07-01'), endAt: new Date('2026-07-05') }) as any;
    const r = await new FlashSaleService(prisma, config).updateSale('s1', { title: 'Mới', isActive: false });
    expect(r).toEqual({ id: 's1' });
    expect(prisma.flashSale.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.flashSale.update).toHaveBeenCalled();
  });
});

describe('FlashSaleService.removeItem', () => {
  it('item không tồn tại → reject "Không tìm thấy sản phẩm flash."', async () => {
    const prisma = { flashSaleItem: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() } } as any;
    await expect(new FlashSaleService(prisma, config).removeItem('fiX'))
      .rejects.toThrow('Không tìm thấy sản phẩm flash.');
    expect(prisma.flashSaleItem.delete).not.toHaveBeenCalled();
  });

  it('item đã có soldCount>0 → reject, KHÔNG xoá', async () => {
    const prisma = {
      flashSaleItem: { findUnique: jest.fn().mockResolvedValue({ soldCount: 3 }), delete: jest.fn() },
    } as any;
    await expect(new FlashSaleService(prisma, config).removeItem('fi1'))
      .rejects.toThrow('Không thể xoá sản phẩm đã phát sinh đơn giờ vàng. Hãy tắt đợt flash thay vì xoá.');
    expect(prisma.flashSaleItem.delete).not.toHaveBeenCalled();
  });

  it('item soldCount===0 → xoá thành công, trả { ok: true }', async () => {
    const prisma = {
      flashSaleItem: {
        findUnique: jest.fn().mockResolvedValue({ soldCount: 0 }),
        delete: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const r = await new FlashSaleService(prisma, config).removeItem('fi1');
    expect(r).toEqual({ ok: true });
    expect(prisma.flashSaleItem.delete).toHaveBeenCalledWith({ where: { id: 'fi1' } });
  });
});

describe('FlashSaleService.addItem (validate)', () => {
  const base = () => ({
    flashSale: { findUnique: jest.fn().mockResolvedValue({ id: 's1' }) },
    variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', retailPrice: 100000, salePrice: null, stock: 10 }) },
    flashSaleItem: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'fi1' }) },
  });
  it('đợt flash không tồn tại → reject', async () => {
    const prisma = base() as any;
    prisma.flashSale.findUnique.mockResolvedValue(null);
    await expect(new FlashSaleService(prisma, config).addItem('sX', { variationId: 'v1', flashPrice: 80000, quota: 5 }))
      .rejects.toThrow('Đợt flash không tồn tại.');
  });
  it('flashPrice >= giá đang bán (retailPrice khi không có salePrice) → reject', async () => {
    const prisma = base() as any;
    await expect(new FlashSaleService(prisma, config).addItem('s1', { variationId: 'v1', flashPrice: 120000, quota: 5 }))
      .rejects.toThrow('Giá flash phải thấp hơn giá đang bán.');
  });
  it('flashPrice >= salePrice (đang sale) → reject dù < retailPrice', async () => {
    const prisma = base() as any;
    prisma.variation.findUnique.mockResolvedValue({ id: 'v1', retailPrice: 100000, salePrice: 70000, stock: 10 });
    // 80000 < retailPrice 100000 nhưng >= salePrice 70000 → phải reject
    await expect(new FlashSaleService(prisma, config).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 5 }))
      .rejects.toThrow('Giá flash phải thấp hơn giá đang bán.');
  });
  it('quota > stock → reject', async () => {
    const prisma = base() as any;
    await expect(new FlashSaleService(prisma, config).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 999 }))
      .rejects.toThrow('Quota vượt tồn kho.');
  });
  it('variation đã có flash active khác → reject', async () => {
    const prisma = base() as any;
    prisma.flashSaleItem.findFirst.mockResolvedValue({ id: 'other' });
    await expect(new FlashSaleService(prisma, config).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 5 }))
      .rejects.toThrow('Sản phẩm đã có trong đợt flash khác.');
  });
  it('hợp lệ → tạo item với perUserLimit default', async () => {
    const prisma = base() as any;
    const r = await new FlashSaleService(prisma, config).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 5 });
    expect(r).toEqual({ id: 'fi1' });
    expect(prisma.flashSaleItem.create).toHaveBeenCalled();
  });
});
