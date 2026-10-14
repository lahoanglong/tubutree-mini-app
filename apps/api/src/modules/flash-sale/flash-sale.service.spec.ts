import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { FlashSaleService } from './flash-sale.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { LifecycleService } from '../lifecycle/lifecycle.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;
const NOW = new Date('2026-07-05T10:00:00Z');
const activeItem = (over: Record<string, unknown> = {}) => ({
  id: 'fi1', variationId: 'v1', flashPrice: 80000, quota: 10, soldCount: 3,
  flashSale: { endAt: new Date('2026-07-05T12:00:00Z') },
  ...over,
});

describe('FlashSaleService.resolveEffective', () => {
  it('variation có flash ACTIVE còn quota → trả flashPrice + metadata', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([activeItem()]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config, notifications, lifecycle).resolveEffective(['v1'], NOW);
    expect(map.get('v1')).toMatchObject({ flashPrice: 80000, itemId: 'fi1', soldCount: 3, quota: 10 });
  });

  it('item hết quota (soldCount>=quota) → không có trong map', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([activeItem({ soldCount: 10 })]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config, notifications, lifecycle).resolveEffective(['v1'], NOW);
    expect(map.has('v1')).toBe(false);
  });

  it('variation không có item active → không có trong map', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config, notifications, lifecycle).resolveEffective(['v9'], NOW);
    expect(map.has('v9')).toBe(false);
  });

  it('variationIds rỗng → map rỗng, KHÔNG query', async () => {
    const findMany = jest.fn();
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config, notifications, lifecycle).resolveEffective([], NOW);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('where CHỈ lấy variation active (variation: { isActive: true })', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    await new FlashSaleService(prisma, config, notifications, lifecycle).resolveEffective(['v1'], NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variation: { isActive: true } }) }),
    );
  });
});

describe('FlashSaleService.resolveEffective — suất còn lại của khách (ENGAGE-4)', () => {
  const svcWith = (items: unknown[], purchases: unknown[]) => {
    const purchaseFind = jest.fn().mockResolvedValue(purchases);
    const prisma = {
      flashSaleItem: { findMany: jest.fn().mockResolvedValue(items) },
      flashSalePurchase: { findMany: purchaseFind },
    } as unknown as PrismaService;
    return { svc: new FlashSaleService(prisma, config, notifications, lifecycle), purchaseFind };
  };

  it('có userId → allowance = min(quota − đã bán, perUserLimit − khách đã mua)', async () => {
    const { svc, purchaseFind } = svcWith(
      [activeItem({ perUserLimit: 3, quota: 10, soldCount: 3 }), activeItem({ id: 'fi2', variationId: 'v2', perUserLimit: 5, quota: 4, soldCount: 2 })],
      [{ flashSaleItemId: 'fi1', quantity: 2 }],
    );
    const map = await svc.resolveEffective(['v1', 'v2'], NOW, 'u1');
    expect(purchaseFind).toHaveBeenCalledWith({
      where: { userId: 'u1', flashSaleItemId: { in: ['fi1', 'fi2'] } },
      select: { flashSaleItemId: true, quantity: true },
    });
    expect(map.get('v1')).toMatchObject({ allowance: 1, perUserLeft: 1, quotaLeft: 7 });
    expect(map.get('v2')).toMatchObject({ allowance: 2, perUserLeft: 5, quotaLeft: 2 });
  });

  it('khách đã dùng hết suất → vẫn trả item với allowance 0 (để báo lý do), không có userId → không tra lượt mua', async () => {
    const { svc } = svcWith([activeItem({ perUserLimit: 1 })], [{ flashSaleItemId: 'fi1', quantity: 1 }]);
    expect((await svc.resolveEffective(['v1'], NOW, 'u1')).get('v1')).toMatchObject({ allowance: 0 });

    const anon = svcWith([activeItem({ perUserLimit: 1 })], []);
    const map = await anon.svc.resolveEffective(['v1'], NOW);
    expect(anon.purchaseFind).not.toHaveBeenCalled();
    expect(map.get('v1')!.allowance).toBeUndefined();
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
    const list = await new FlashSaleService(prisma, config, notifications, lifecycle).listActive(NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemId: 'fi1', flashPrice: 80000, retailPrice: 100000, productSlug: 'a' });
  });

  it('where CHỈ lấy variation active (variation: { isActive: true })', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    await new FlashSaleService(prisma, config, notifications, lifecycle).listActive(NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variation: { isActive: true } }) }),
    );
  });
});

describe('FlashSaleService.listActive / listUpcoming — giá flash không còn thấp hơn giá đang bán (BUYERMINI-12)', () => {
  const row = (id: string, flashPrice: number, retailPrice: number, salePrice: number | null) => ({
    id, variationId: `v-${id}`, flashPrice, quota: 10, soldCount: 0,
    flashSale: { endAt: new Date('2026-07-05T12:00:00Z'), startAt: new Date('2026-07-05T14:00:00Z') },
    variation: { retailPrice, salePrice, product: { slug: id, name: id, thumbnail: null } },
    reminders: [],
  });

  it('listActive bỏ món có flashPrice ≥ giá đang bán (salePrice ?? retailPrice), trả kèm salePrice', async () => {
    const prisma = {
      flashSaleItem: {
        findMany: jest.fn().mockResolvedValue([row('ok', 80000, 100000, null), row('raised', 85000, 79000, null), row('sale', 80000, 100000, 75000), row('saleOk', 70000, 100000, 75000)]),
      },
    } as unknown as PrismaService;
    const list = await new FlashSaleService(prisma, config, notifications, lifecycle).listActive(NOW);
    expect(list.map((i) => i.itemId)).toEqual(['ok', 'saleOk']);
    expect(list[1]).toMatchObject({ flashPrice: 70000, retailPrice: 100000, salePrice: 75000 });
  });

  it('listUpcoming cũng bỏ món đó', async () => {
    const prisma = {
      flashSaleItem: { findMany: jest.fn().mockResolvedValue([row('ok', 80000, 100000, null), row('raised', 85000, 79000, null)]) },
    } as unknown as PrismaService;
    const list = await new FlashSaleService(prisma, config, notifications, lifecycle).listUpcoming('u1', NOW);
    expect(list.map((i) => i.itemId)).toEqual(['ok']);
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
    await new FlashSaleService({} as any, config, notifications, lifecycle).consumeQuota(tx as any, 'fi1', 'u1', 2, now);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.flashSalePurchase.updateMany).toHaveBeenCalled();
    expect(tx.flashSalePurchase.create).not.toHaveBeenCalled();
  });

  it('chưa có purchase + qty<=limit → create purchase', async () => {
    const tx = mkTx(1, 5, null, 0);
    await new FlashSaleService({} as any, config, notifications, lifecycle).consumeQuota(tx as any, 'fi1', 'u1', 2, now);
    expect(tx.flashSalePurchase.create).toHaveBeenCalled();
  });

  it('hết quota / flash hết giờ (rows=0) → throw "Hết suất ưu đãi."', async () => {
    const tx = mkTx(0, 5, { quantity: 0 }, 1);
    await expect(new FlashSaleService({} as any, config, notifications, lifecycle).consumeQuota(tx as any, 'fi1', 'u1', 2, now))
      .rejects.toThrow('Hết suất ưu đãi.');
  });

  it('vượt perUserLimit (đã có purchase, updateMany count=0) → rollback soldCount + throw', async () => {
    const tx = mkTx(1, 5, { quantity: 4 }, 0);
    await expect(new FlashSaleService({} as any, config, notifications, lifecycle).consumeQuota(tx as any, 'fi1', 'u1', 2, now))
      .rejects.toThrow('Vượt giới hạn mua ưu đãi.');
    expect(tx.flashSaleItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { soldCount: { decrement: 2 } } }),
    );
  });

  it('vượt perUserLimit (chưa có purchase, qty>limit) → rollback soldCount + throw', async () => {
    const tx = mkTx(1, 1, null, 0);
    await expect(new FlashSaleService({} as any, config, notifications, lifecycle).consumeQuota(tx as any, 'fi1', 'u1', 2, now))
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
    await new FlashSaleService({} as any, config, notifications, lifecycle).restore(tx as any, 'fi1', 'u1', 2);
    expect(tx.flashSaleItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { soldCount: { decrement: 2 } } }),
    );
    expect(tx.flashSalePurchase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: { decrement: 2 } } }),
    );
  });
});

describe('FlashSaleService.createSale (ADMINOPS-16)', () => {
  const mk = () => ({ flashSale: { create: jest.fn().mockResolvedValue({ id: 's1' }) } }) as any;

  it('đợt đã kết thúc (năm 2020) → 400, không tạo', async () => {
    const prisma = mk();
    await expect(
      new FlashSaleService(prisma, config, notifications, lifecycle).createSale('a1', {
        title: 'Cũ',
        startAt: '2020-01-01T00:00:00Z',
        endAt: '2020-01-02T00:00:00Z',
      }),
    ).rejects.toThrow('Thời gian kết thúc phải ở tương lai.');
    expect(prisma.flashSale.create).not.toHaveBeenCalled();
  });

  it('ngày không đọc được → 400 nói rõ, không nhầm thành "bắt đầu sau kết thúc"', async () => {
    const prisma = mk();
    await expect(
      new FlashSaleService(prisma, config, notifications, lifecycle).createSale('a1', { title: 'X', startAt: 'abc', endAt: '2099-01-02T00:00:00Z' }),
    ).rejects.toThrow('Thời gian bắt đầu/kết thúc không hợp lệ.');
  });

  it('tiêu đề toàn khoảng trắng bị cắt; hợp lệ thì tạo', async () => {
    const prisma = mk();
    await new FlashSaleService(prisma, config, notifications, lifecycle).createSale('a1', {
      title: 'Giờ vàng',
      startAt: '2099-01-01T00:00:00Z',
      endAt: '2099-01-02T00:00:00Z',
    });
    expect(prisma.flashSale.create).toHaveBeenCalled();
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
      new FlashSaleService(prisma, config, notifications, lifecycle).updateSale('s1', { startAt: '2026-07-10', endAt: '2026-07-08' }),
    ).rejects.toThrow('Thời gian bắt đầu phải trước thời gian kết thúc.');
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  it('chỉ truyền startAt mới, sau endAt hiện tại → reject', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2026-07-01'), endAt: new Date('2026-07-05') }) as any;
    await expect(
      new FlashSaleService(prisma, config, notifications, lifecycle).updateSale('s1', { startAt: '2026-07-10' }),
    ).rejects.toThrow('Thời gian bắt đầu phải trước thời gian kết thúc.');
  });

  it('window hợp lệ → update thành công', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2099-07-01'), endAt: new Date('2099-07-05') }) as any;
    const r = await new FlashSaleService(prisma, config, notifications, lifecycle).updateSale('s1', { startAt: '2099-07-02', endAt: '2099-07-08' });
    expect(r).toEqual({ id: 's1' });
    expect(prisma.flashSale.update).toHaveBeenCalled();
  });

  it('ADMINOPS-16: đổi endAt về quá khứ → 400, không cập nhật', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2020-01-01'), endAt: new Date('2099-01-01') }) as any;
    await expect(
      new FlashSaleService(prisma, config, notifications, lifecycle).updateSale('s1', { endAt: '2020-02-01T00:00:00Z' }),
    ).rejects.toThrow('Thời gian kết thúc phải ở tương lai.');
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  it('không đổi startAt/endAt (chỉ title/isActive) → KHÔNG cần validate, update thành công', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2026-07-01'), endAt: new Date('2026-07-05') }) as any;
    const r = await new FlashSaleService(prisma, config, notifications, lifecycle).updateSale('s1', { title: 'Mới', isActive: false });
    expect(r).toEqual({ id: 's1' });
    expect(prisma.flashSale.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.flashSale.update).toHaveBeenCalled();
  });
});

describe('FlashSaleService.removeItem', () => {
  it('item không tồn tại → reject "Không tìm thấy sản phẩm flash."', async () => {
    const prisma = { flashSaleItem: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() } } as any;
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).removeItem('fiX'))
      .rejects.toThrow('Không tìm thấy sản phẩm flash.');
    expect(prisma.flashSaleItem.delete).not.toHaveBeenCalled();
  });

  it('item đã có soldCount>0 → reject, KHÔNG xoá', async () => {
    const prisma = {
      flashSaleItem: { findUnique: jest.fn().mockResolvedValue({ soldCount: 3 }), delete: jest.fn() },
    } as any;
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).removeItem('fi1'))
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
    const r = await new FlashSaleService(prisma, config, notifications, lifecycle).removeItem('fi1');
    expect(r).toEqual({ ok: true });
    expect(prisma.flashSaleItem.delete).toHaveBeenCalledWith({ where: { id: 'fi1' } });
  });
});

describe('FlashSaleService.deleteSale (R2-ENGAGE-13: xoá đợt chưa bắt đầu)', () => {
  const svc = (prisma: unknown) => new FlashSaleService(prisma as PrismaService, config, notifications, lifecycle);
  const future = new Date(Date.now() + 3 * 864e5);
  const past = new Date(Date.now() - 3600e3);

  it('đợt không tồn tại → reject, không xoá', async () => {
    const prisma = { flashSale: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() } };
    await expect(svc(prisma).deleteSale('sX')).rejects.toThrow('Không tìm thấy đợt flash sale.');
    expect(prisma.flashSale.delete).not.toHaveBeenCalled();
  });

  it('đợt đã bắt đầu → reject, chỉ cho tắt, KHÔNG xoá', async () => {
    const prisma = {
      flashSale: { findUnique: jest.fn().mockResolvedValue({ id: 's1', startAt: past, items: [] }), delete: jest.fn() },
    };
    await expect(svc(prisma).deleteSale('s1')).rejects.toThrow('Đợt flash sale đã bắt đầu, chỉ có thể tắt chứ không xoá.');
    expect(prisma.flashSale.delete).not.toHaveBeenCalled();
  });

  it('đợt chưa bắt đầu nhưng có item đã phát sinh đơn → reject (lưới an toàn)', async () => {
    const prisma = {
      flashSale: { findUnique: jest.fn().mockResolvedValue({ id: 's1', startAt: future, items: [{ soldCount: 2 }] }), delete: jest.fn() },
    };
    await expect(svc(prisma).deleteSale('s1')).rejects.toThrow('đã phát sinh đơn');
    expect(prisma.flashSale.delete).not.toHaveBeenCalled();
  });

  it('đợt chưa bắt đầu, chưa bán gì → xoá (item/nhắc tôi xoá theo cascade), trả { ok: true }', async () => {
    const prisma = {
      flashSale: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', startAt: future, items: [{ soldCount: 0 }] }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    await expect(svc(prisma).deleteSale('s1')).resolves.toEqual({ ok: true });
    expect(prisma.flashSale.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });
});

describe('FlashSaleService.addItem (validate)', () => {
  const base = () => ({
    flashSale: {
      findUnique: jest.fn().mockResolvedValue({ id: 's1', startAt: new Date('2026-07-05T09:00:00Z'), endAt: new Date('2026-07-05T12:00:00Z') }),
    },
    variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', retailPrice: 100000, salePrice: null, stock: 10 }) },
    flashSaleItem: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'fi1' }) },
  });
  it('đợt flash không tồn tại → reject', async () => {
    const prisma = base() as any;
    prisma.flashSale.findUnique.mockResolvedValue(null);
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).addItem('sX', { variationId: 'v1', flashPrice: 80000, quota: 5 }))
      .rejects.toThrow('Đợt flash không tồn tại.');
  });
  it('flashPrice >= giá đang bán (retailPrice khi không có salePrice) → reject', async () => {
    const prisma = base() as any;
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).addItem('s1', { variationId: 'v1', flashPrice: 120000, quota: 5 }))
      .rejects.toThrow('Giá flash phải thấp hơn giá đang bán.');
  });
  it('flashPrice >= salePrice (đang sale) → reject dù < retailPrice', async () => {
    const prisma = base() as any;
    prisma.variation.findUnique.mockResolvedValue({ id: 'v1', retailPrice: 100000, salePrice: 70000, stock: 10 });
    // 80000 < retailPrice 100000 nhưng >= salePrice 70000 → phải reject
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 5 }))
      .rejects.toThrow('Giá flash phải thấp hơn giá đang bán.');
  });
  it('quota > stock → reject', async () => {
    const prisma = base() as any;
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 999 }))
      .rejects.toThrow('Quota vượt tồn kho.');
  });
  it('variation đã có flash active khác → reject', async () => {
    const prisma = base() as any;
    prisma.flashSaleItem.findFirst.mockResolvedValue({ id: 'other' });
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 5 }))
      .rejects.toThrow('Sản phẩm đã có trong đợt flash khác.');
  });
  it('ENGAGE-19: chỉ chặn khi đợt khác của cùng SKU TRÙNG khung giờ với đợt này (không chặn đợt kế tiếp)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-05T08:00:00Z'));
    try {
      const prisma = base() as any;
      prisma.flashSale.findUnique.mockResolvedValue({
        id: 's1', startAt: new Date('2026-07-05T20:00:00Z'), endAt: new Date('2026-07-05T21:00:00Z'),
      });
      await new FlashSaleService(prisma, config, notifications, lifecycle).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 5 });
      expect(prisma.flashSaleItem.findFirst).toHaveBeenCalledWith({
        where: {
          variationId: 'v1',
          flashSale: { startAt: { lt: new Date('2026-07-05T21:00:00Z') }, endAt: { gt: new Date('2026-07-05T20:00:00Z') } },
        },
      });
      expect(prisma.flashSaleItem.create).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('hợp lệ → tạo item với perUserLimit default', async () => {
    const prisma = base() as any;
    const r = await new FlashSaleService(prisma, config, notifications, lifecycle).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 5 });
    expect(r).toEqual({ id: 'fi1' });
    expect(prisma.flashSaleItem.create).toHaveBeenCalled();
  });
});

// ============================================================
// "Nhắc tôi" — remind me for upcoming flash sales
// ============================================================

describe('FlashSaleService.setReminder', () => {
  const mkPrisma = (item: unknown) => ({
    flashSaleItem: { findUnique: jest.fn().mockResolvedValue(item) },
    flashSaleReminder: { upsert: jest.fn().mockResolvedValue({ id: 'r1' }) },
  });

  it('sale chưa bắt đầu (startAt > now) → upsert reminder', async () => {
    const prisma = mkPrisma({ id: 'fi1', flashSale: { startAt: new Date('2026-07-06T00:00:00Z') } }) as any;
    await new FlashSaleService(prisma, config, notifications, lifecycle).setReminder('u1', 'fi1', NOW);
    expect(prisma.flashSaleReminder.upsert).toHaveBeenCalledWith({
      where: { userId_flashSaleItemId: { userId: 'u1', flashSaleItemId: 'fi1' } },
      update: {},
      create: { userId: 'u1', flashSaleItemId: 'fi1' },
    });
  });

  it('item không tồn tại → reject, KHÔNG upsert', async () => {
    const prisma = mkPrisma(null) as any;
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).setReminder('u1', 'fiX', NOW)).rejects.toThrow();
    expect(prisma.flashSaleReminder.upsert).not.toHaveBeenCalled();
  });

  it('sale ĐÃ bắt đầu (startAt <= now) → reject "Ưu đãi đã bắt đầu.", KHÔNG upsert', async () => {
    const prisma = mkPrisma({ id: 'fi1', flashSale: { startAt: new Date('2026-07-05T09:00:00Z') } }) as any;
    await expect(new FlashSaleService(prisma, config, notifications, lifecycle).setReminder('u1', 'fi1', NOW))
      .rejects.toThrow('Ưu đãi đã bắt đầu.');
    expect(prisma.flashSaleReminder.upsert).not.toHaveBeenCalled();
  });
});

describe('FlashSaleService.cancelReminder', () => {
  it('xoá reminder theo userId+itemId, trả { ok: true }', async () => {
    const prisma = { flashSaleReminder: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) } } as any;
    const r = await new FlashSaleService(prisma, config, notifications, lifecycle).cancelReminder('u1', 'fi1');
    expect(prisma.flashSaleReminder.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', flashSaleItemId: 'fi1' } });
    expect(r).toEqual({ ok: true });
  });
});

describe('FlashSaleService.listUpcoming', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'fi1', variationId: 'v1', flashPrice: 80000,
    flashSale: { startAt: new Date('2026-07-05T12:00:00Z') },
    variation: { retailPrice: 100000, product: { slug: 'a', name: 'A', thumbnail: null } },
    reminders: [],
    ...over,
  });

  it('trả item sắp diễn ra kèm reminded=false khi user chưa đặt nhắc', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([row()]) } } as any;
    const list = await new FlashSaleService(prisma, config, notifications, lifecycle).listUpcoming('u1', NOW);
    expect(list).toEqual([{
      itemId: 'fi1', variationId: 'v1', productSlug: 'a', productName: 'A', thumbnail: null,
      flashPrice: 80000, retailPrice: 100000, startAt: row().flashSale.startAt, reminded: false,
    }]);
  });

  it('user đã đặt nhắc (có reminder) → reminded=true', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([row({ reminders: [{ id: 'r1' }] })]) } } as any;
    const list = await new FlashSaleService(prisma, config, notifications, lifecycle).listUpcoming('u1', NOW);
    expect(list[0]?.reminded).toBe(true);
  });

  it('where lọc sale isActive+startAt>now+endAt>now, reminders lọc theo userId, sort startAt asc', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleItem: { findMany } } as any;
    await new FlashSaleService(prisma, config, notifications, lifecycle).listUpcoming('u1', NOW);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ flashSale: { isActive: true, startAt: { gt: NOW }, endAt: { gt: NOW } } });
    expect(arg.include.reminders).toEqual({ where: { userId: 'u1' }, select: { id: true } });
    expect(arg.orderBy).toEqual({ flashSale: { startAt: 'asc' } });
  });
});

describe('FlashSaleService.notifyStartedFlashSales', () => {
  it('ENGAGE-19: chạy mỗi phút (trước đây mỗi giờ tròn: sale 20:30 tới 21:00 mới nhắc, sale 20:30–21:00 không ai được nhắc)', () => {
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, FlashSaleService.prototype.notifyStartedFlashSales);
    expect(meta).toMatchObject({ cronTime: '* * * * *', timeZone: 'Asia/Ho_Chi_Minh' });
  });

  const now = new Date('2026-07-05T10:00:00Z');
  const reminderRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1', userId: 'u1', notifiedAt: null,
    item: {
      flashSale: { isActive: true, startAt: new Date('2026-07-05T09:00:00Z'), endAt: new Date('2026-07-05T12:00:00Z') },
      variation: { product: { name: 'Dầu gội Visante' } },
    },
    ...over,
  });

  it('reminder cho sale ĐÃ bắt đầu, chưa notify → claim atomic + notify FLASH_STARTING', async () => {
    const findMany = jest.fn().mockResolvedValue([reminderRow()]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { flashSaleReminder: { findMany, updateMany } } as any;
    const notify = jest.fn().mockResolvedValue(undefined);
    const notifSvc = { notify } as unknown as NotificationsService;
    await new FlashSaleService(prisma, config, notifSvc, lifecycle).notifyStartedFlashSales(now);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'r1', notifiedAt: null }, data: { notifiedAt: now } });
    expect(notify).toHaveBeenCalledWith('u1', 'FLASH_STARTING', { product: 'Dầu gội Visante' });
  });

  it('claim thất bại (count 0, cron khác đã nhắc) → KHÔNG notify', async () => {
    const findMany = jest.fn().mockResolvedValue([reminderRow()]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = { flashSaleReminder: { findMany, updateMany } } as any;
    const notify = jest.fn().mockResolvedValue(undefined);
    const notifSvc = { notify } as unknown as NotificationsService;
    await new FlashSaleService(prisma, config, notifSvc, lifecycle).notifyStartedFlashSales(now);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sale CHƯA bắt đầu (startAt > now) → bỏ qua, KHÔNG claim/notify', async () => {
    const rowNotStarted = reminderRow({
      item: {
        flashSale: { isActive: true, startAt: new Date('2026-07-05T11:00:00Z'), endAt: new Date('2026-07-05T12:00:00Z') },
        variation: { product: { name: 'X' } },
      },
    });
    const findMany = jest.fn().mockResolvedValue([rowNotStarted]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = { flashSaleReminder: { findMany, updateMany } } as any;
    const notify = jest.fn();
    const notifSvc = { notify } as unknown as NotificationsService;
    await new FlashSaleService(prisma, config, notifSvc, lifecycle).notifyStartedFlashSales(now);
    // Không CLAIM dòng nào (claim nhận diện bằng where.id); lượt dọn sổ cuối hàm thì được phép.
    expect(updateMany.mock.calls.every((c) => c[0].where.id === undefined)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sale đã kết thúc (endAt <= now) → bỏ qua', async () => {
    const rowEnded = reminderRow({
      item: {
        flashSale: { isActive: true, startAt: new Date('2026-07-05T07:00:00Z'), endAt: new Date('2026-07-05T09:00:00Z') },
        variation: { product: { name: 'X' } },
      },
    });
    const findMany = jest.fn().mockResolvedValue([rowEnded]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { flashSaleReminder: { findMany, updateMany } } as any;
    const notify = jest.fn();
    const notifSvc = { notify } as unknown as NotificationsService;
    await new FlashSaleService(prisma, config, notifSvc, lifecycle).notifyStartedFlashSales(now);
    expect(updateMany.mock.calls.every((c) => c[0].where.id === undefined)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  /**
   * Claim (notifiedAt) được ghi TRƯỚC khi gửi. Nuốt lỗi gửi là mất luôn cơ hội giờ vàng của
   * khách đó — claim chặn mọi lượt sau — và `.catch(() => undefined)` xoá sạch dấu vết.
   */
  it('notify lỗi → không throw, và TRẢ LẠI claim để lượt cron sau thử lại', async () => {
    const findMany = jest.fn().mockResolvedValue([reminderRow()]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { flashSaleReminder: { findMany, updateMany } } as any;
    const notify = jest.fn().mockRejectedValue(new Error('boom'));
    const notifSvc = { notify } as unknown as NotificationsService;

    await expect(
      new FlashSaleService(prisma, config, notifSvc, lifecycle).notifyStartedFlashSales(now),
    ).resolves.not.toThrow();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', notifiedAt: now },
      data: { notifiedAt: null },
    });
  });

  /**
   * Nhắc của sale đã kết thúc/đã tắt nằm lại vĩnh viễn ở notifiedAt = null (không có đường dọn)
   * và tích tụ dần. Truy vấn cũ chỉ lọc notifiedAt và không có orderBy, nên khi số dòng "chết"
   * vượt 500 thì lô lấy ra có thể KHÔNG chứa dòng nào thuộc sale đang chạy — không ai được
   * nhắc, không lỗi, không log.
   */
  it('chỉ lấy nhắc của sale ĐANG CHẠY, có thứ tự ổn định', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleReminder: { findMany, updateMany: jest.fn().mockResolvedValue({ count: 0 }) } } as any;
    await new FlashSaleService(prisma, config, notifications, lifecycle).notifyStartedFlashSales(now);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      notifiedAt: null,
      item: { flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } } },
    });
    expect(args.orderBy).toEqual({ id: 'asc' });
  });

  it('dọn sổ nhắc của sale đã kết thúc/đã tắt để không lấn chỗ lô 500', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const updateMany = jest.fn().mockResolvedValue({ count: 7 });
    const prisma = { flashSaleReminder: { findMany, updateMany } } as any;
    await new FlashSaleService(prisma, config, notifications, lifecycle).notifyStartedFlashSales(now);
    const sweep = updateMany.mock.calls.at(-1)![0];
    expect(sweep.where.notifiedAt).toBeNull();
    expect(sweep.where.item).toEqual({ flashSale: { endAt: { lte: now } } });
  });

  /**
   * `isActive` là cờ admin bật/tắt bất cứ lúc nào. Đóng sổ theo nó nghĩa là: sale chạy 20:00,
   * 18:30 admin tắt để sửa giá, cron 19:00 đánh dấu TOÀN BỘ nhắc là đã-nhắc, 19:30 admin bật
   * lại — tới giờ vàng không một ai được nhắc.
   */
  it('KHÔNG đóng sổ theo isActive (admin tắt sale tạm thời không được giết nhắc)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = { flashSaleReminder: { findMany, updateMany } } as any;
    await new FlashSaleService(prisma, config, notifications, lifecycle).notifyStartedFlashSales(now);
    const sweep = updateMany.mock.calls.at(-1)![0];
    expect(JSON.stringify(sweep.where)).not.toContain('isActive');
  });
});

// ENGAGE-18: khách yêu thích sản phẩm không được báo khi nó vào flash sale.
describe('FlashSaleService.notifyWishlistOfStartedSales', () => {
  const now = new Date('2026-07-05T10:10:00Z');
  const item = (over: Record<string, unknown> = {}) => ({
    id: 'fi1', flashPrice: 80_000, quota: 10, soldCount: 3,
    variation: { retailPrice: 120_000, salePrice: null, product: { id: 'p1', name: 'Dầu gội Visante' } },
    ...over,
  });
  function setup(sales: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(sales);
    const notifyDrop = jest.fn().mockResolvedValue(undefined);
    const svc = new FlashSaleService(
      { flashSale: { findMany } } as any,
      config,
      notifications,
      { notifyWishlistPriceDrop: notifyDrop } as unknown as LifecycleService,
    );
    return { svc, findMany, notifyDrop };
  }

  it('sale vừa bắt đầu → báo wishlist của sản phẩm với giá gốc → giá flash', async () => {
    const { svc, notifyDrop } = setup([{ id: 's1', items: [item()] }]);
    await svc.notifyWishlistOfStartedSales(now);
    expect(notifyDrop).toHaveBeenCalledWith('p1', 'Dầu gội Visante', { oldPrice: 120_000, newPrice: 80_000 });
  });

  it('chỉ lấy sale đang bật, đã bắt đầu trong 2 giờ qua và chưa kết thúc', async () => {
    const { svc, findMany } = setup([]);
    await svc.notifyWishlistOfStartedSales(now);
    const where = findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.endAt).toEqual({ gt: now });
    expect(where.startAt.lte).toEqual(now);
    expect(now.getTime() - where.startAt.gt.getTime()).toBe(2 * 3600e3);
  });

  it('giá gốc là salePrice nếu biến thể đang có giá sale', async () => {
    const { svc, notifyDrop } = setup([
      { id: 's1', items: [item({ variation: { retailPrice: 120_000, salePrice: 100_000, product: { id: 'p1', name: 'X' } } })] },
    ]);
    await svc.notifyWishlistOfStartedSales(now);
    expect(notifyDrop).toHaveBeenCalledWith('p1', 'X', { oldPrice: 100_000, newPrice: 80_000 });
  });

  it('một sản phẩm nhiều biến thể trong sale → báo MỘT lần, theo biến thể giảm sâu nhất', async () => {
    const { svc, notifyDrop } = setup([
      {
        id: 's1',
        items: [
          item({ id: 'a', flashPrice: 110_000 }),
          item({ id: 'b', flashPrice: 60_000 }),
        ],
      },
    ]);
    await svc.notifyWishlistOfStartedSales(now);
    expect(notifyDrop).toHaveBeenCalledTimes(1);
    expect(notifyDrop).toHaveBeenCalledWith('p1', 'Dầu gội Visante', { oldPrice: 120_000, newPrice: 60_000 });
  });

  it('dòng đã bán hết suất (soldCount >= quota) hoặc giá flash không thấp hơn giá gốc → không báo', async () => {
    const { svc, notifyDrop } = setup([
      { id: 's1', items: [item({ soldCount: 10 }), item({ id: 'c', flashPrice: 130_000 })] },
    ]);
    await svc.notifyWishlistOfStartedSales(now);
    expect(notifyDrop).not.toHaveBeenCalled();
  });

  it('báo lỗi một sản phẩm không chặn sản phẩm khác, và không ném ra ngoài cron', async () => {
    const notifyDrop = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const svc = new FlashSaleService(
      {
        flashSale: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 's1',
              items: [
                item(),
                item({ id: 'z', flashPrice: 30_000, variation: { retailPrice: 50_000, salePrice: null, product: { id: 'p2', name: 'Y' } } }),
              ],
            },
          ]),
        },
      } as any,
      config,
      notifications,
      { notifyWishlistPriceDrop: notifyDrop } as unknown as LifecycleService,
    );
    await expect(svc.notifyWishlistOfStartedSales(now)).resolves.toBeUndefined();
    expect(notifyDrop).toHaveBeenCalledTimes(2);
  });
});
