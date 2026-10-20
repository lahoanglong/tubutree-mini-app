import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { FlashQuotaLineError, FlashSaleService } from './flash-sale.service';
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

  it('kèm serverNow (giờ máy chủ lúc tính danh sách) để app bù lệch đồng hồ điện thoại khi đếm ngược', async () => {
    const row = {
      id: 'fi1', variationId: 'v1', flashPrice: 80000, quota: 10, soldCount: 3,
      flashSale: { endAt: new Date('2026-07-05T12:00:00Z') },
      variation: { retailPrice: 100000, product: { slug: 'a', name: 'A', thumbnail: null } },
    };
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([row]) } } as unknown as PrismaService;
    const list = await new FlashSaleService(prisma, config, notifications, lifecycle).listActive(NOW);
    expect(list[0]!.serverNow).toBe(NOW.toISOString());
  });

  it('where CHỈ lấy hàng còn bán (biến thể và sản phẩm đang bán, sản phẩm đã duyệt)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    await new FlashSaleService(prisma, config, notifications, lifecycle).listActive(NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variation: { isActive: true, product: { isActive: true, approvalStatus: 'APPROVED' } } }) }),
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

describe('FlashSaleService.consumeQuotas', () => {
  const now = new Date('2026-07-05T10:00:00Z');
  type Item = { sold: number; quota: number; active?: boolean; limit: number };

  /**
   * Tx giả giữ trạng thái suất và ghi lại thứ tự khoá: `sold:<id>` (UPDATE flash_sale_items), `own:<ids>` (khoá dòng suất của
   * khách), `users` (KEY SHARE), `bump:<id>`, `create:<id>`, `undo:<id>` (hoàn soldCount khi vượt giới hạn).
   */
  function mkTx(items: Record<string, Item>, own: Record<string, number>, opts: { appearOnUsersLock?: Record<string, number> } = {}) {
    const log: string[] = [];
    const tx = {
      $executeRaw: jest.fn(async (_sql: TemplateStringsArray, qty: number, id: string) => {
        log.push(`sold:${id}`);
        const it = items[id]!;
        if (it.active === false || it.sold + qty > it.quota) return 0;
        it.sold += qty;
        return 1;
      }),
      $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
        const text = sql.join('?');
        if (text.includes('FROM "users"')) {
          log.push('users');
          Object.assign(own, opts.appearOnUsersLock ?? {});
          return [];
        }
        const ids = (values[1] as { values: string[] }).values;
        log.push(`own:${ids.join(',')}`);
        return ids.filter((id) => id in own).sort().map((flashSaleItemId) => ({ flashSaleItemId }));
      }),
      flashSaleItem: {
        findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, perUserLimit: items[id]!.limit })),
        ),
        updateMany: jest.fn(async ({ where, data }: { where: { id: string }; data: { soldCount: { decrement: number } } }) => {
          log.push(`undo:${where.id}`);
          items[where.id]!.sold -= data.soldCount.decrement;
          return { count: 1 };
        }),
      },
      flashSalePurchase: {
        updateMany: jest.fn(
          async ({ where, data }: { where: { flashSaleItemId: string; quantity: { lte: number } }; data: { quantity: { increment: number } } }) => {
            log.push(`bump:${where.flashSaleItemId}`);
            const q = own[where.flashSaleItemId];
            if (q === undefined || q > where.quantity.lte) return { count: 0 };
            own[where.flashSaleItemId] = q + data.quantity.increment;
            return { count: 1 };
          },
        ),
        create: jest.fn(async ({ data }: { data: { flashSaleItemId: string; quantity: number } }) => {
          log.push(`create:${data.flashSaleItemId}`);
          own[data.flashSaleItemId] = data.quantity;
          return {};
        }),
      },
    };
    return { tx, log };
  }
  const svc = () => new FlashSaleService({} as any, config, notifications, lifecycle);
  const run = (tx: unknown, lines: { flashSaleItemId: string; quantity: number }[]) => svc().consumeQuotas(tx as any, 'u1', lines, now);

  it('đã có dòng suất, trong giới hạn → trừ soldCount + cộng dòng suất, KHÔNG khoá users', async () => {
    const items = { fi1: { sold: 1, quota: 10, limit: 5 } };
    const own = { fi1: 1 };
    const { tx, log } = mkTx(items, own);
    expect(await run(tx, [{ flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['OK']);
    expect(log).toEqual(['sold:fi1', 'own:fi1', 'bump:fi1']);
    expect(items.fi1.sold).toBe(3);
    expect(own.fi1).toBe(3);
  });

  it('chưa có dòng suất → khoá dòng suất, KEY SHARE users, ĐỌC LẠI rồi mới chèn', async () => {
    const own: Record<string, number> = {};
    const { tx, log } = mkTx({ fi1: { sold: 0, quota: 10, limit: 5 } }, own);
    expect(await run(tx, [{ flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['OK']);
    expect(log).toEqual(['sold:fi1', 'own:fi1', 'users', 'own:fi1', 'create:fi1']);
    const [sql, ...values] = tx.$queryRaw.mock.calls.find(([q]) => q.join('?').includes('"users"'))!;
    expect(sql.join('?')).toMatch(/FROM "users" WHERE "id" = \? FOR KEY SHARE/);
    expect(values).toEqual(['u1']);
    expect(own).toEqual({ fi1: 2 });
  });

  it('chưa có dòng suất nhưng đọc lại sau khoá users thấy dòng (gộp vừa chuyển sang) → cộng dồn, không chèn', async () => {
    const own: Record<string, number> = {};
    const { tx, log } = mkTx({ fi1: { sold: 1, quota: 10, limit: 5 } }, own, { appearOnUsersLock: { fi1: 1 } });
    expect(await run(tx, [{ flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['OK']);
    expect(log).toEqual(['sold:fi1', 'own:fi1', 'users', 'own:fi1', 'bump:fi1']);
    expect(own).toEqual({ fi1: 3 });
  });

  it('nhiều dòng [mới, đã có, mới] → mọi soldCount theo id, mọi dòng suất theo id, rồi MỘT lần khoá users, rồi chèn', async () => {
    const items = { fi1: { sold: 1, quota: 10, limit: 5 }, fi2: { sold: 0, quota: 10, limit: 5 }, fi3: { sold: 0, quota: 10, limit: 5 } };
    const own: Record<string, number> = { fi1: 1 };
    const { tx, log } = mkTx(items, own);
    const lines = [
      { flashSaleItemId: 'fi3', quantity: 1 },
      { flashSaleItemId: 'fi1', quantity: 1 },
      { flashSaleItemId: 'fi2', quantity: 2 },
    ];
    expect(await run(tx, lines)).toEqual(['OK', 'OK', 'OK']);
    expect(log).toEqual(['sold:fi1', 'sold:fi2', 'sold:fi3', 'own:fi1,fi2,fi3', 'bump:fi1', 'users', 'own:fi2,fi3', 'create:fi2', 'create:fi3']);
    expect(own).toEqual({ fi1: 2, fi2: 2, fi3: 1 });
    expect([items.fi1.sold, items.fi2.sold, items.fi3.sold]).toEqual([2, 2, 1]);
  });

  it('mọi dòng đã có dòng suất → KHÔNG khoá users', async () => {
    const own = { fi1: 1, fi2: 1 };
    const { tx, log } = mkTx({ fi1: { sold: 1, quota: 10, limit: 5 }, fi2: { sold: 1, quota: 10, limit: 5 } }, own);
    expect(await run(tx, [{ flashSaleItemId: 'fi2', quantity: 1 }, { flashSaleItemId: 'fi1', quantity: 1 }])).toEqual(['OK', 'OK']);
    expect(log).not.toContain('users');
  });

  it('hai dòng cùng suất chưa có dòng → dòng đầu chèn, dòng sau cộng dồn', async () => {
    const own: Record<string, number> = {};
    const { tx, log } = mkTx({ fi1: { sold: 0, quota: 10, limit: 5 } }, own);
    expect(await run(tx, [{ flashSaleItemId: 'fi1', quantity: 1 }, { flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['OK', 'OK']);
    expect(log.filter((e) => e.startsWith('create') || e.startsWith('bump'))).toEqual(['create:fi1', 'bump:fi1']);
    expect(own).toEqual({ fi1: 3 });
  });

  it('hết quota / flash hết giờ (rows=0) → SOLD_OUT, không đụng dòng suất', async () => {
    const { tx, log } = mkTx({ fi1: { sold: 9, quota: 10, limit: 5 } }, {});
    expect(await run(tx, [{ flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['SOLD_OUT']);
    expect(log).toEqual(['sold:fi1']);
    const { tx: tx2 } = mkTx({ fi1: { sold: 0, quota: 10, active: false, limit: 5 } }, {});
    expect(await run(tx2, [{ flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['SOLD_OUT']);
  });

  it('vượt perUserLimit (đã có dòng suất) → OVER_LIMIT + hoàn soldCount vừa trừ', async () => {
    const items = { fi1: { sold: 4, quota: 10, limit: 5 } };
    const { tx, log } = mkTx(items, { fi1: 4 });
    expect(await run(tx, [{ flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['OVER_LIMIT']);
    expect(log).toEqual(['sold:fi1', 'own:fi1', 'bump:fi1', 'undo:fi1']);
    expect(items.fi1.sold).toBe(4);
  });

  it('vượt perUserLimit (chưa có dòng suất, qty>limit) → OVER_LIMIT + hoàn soldCount, không chèn', async () => {
    const items = { fi1: { sold: 0, quota: 10, limit: 1 } };
    const { tx, log } = mkTx(items, {});
    expect(await run(tx, [{ flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['OVER_LIMIT']);
    expect(log).toEqual(['sold:fi1', 'own:fi1', 'users', 'own:fi1', 'undo:fi1']);
    expect(items.fi1.sold).toBe(0);
  });

  it('kết quả theo đúng thứ tự dòng truyền vào (caller báo lỗi của dòng hỏng đầu tiên)', async () => {
    const { tx } = mkTx({ fi1: { sold: 0, quota: 10, limit: 1 }, fi2: { sold: 10, quota: 10, limit: 5 } }, {});
    expect(await run(tx, [{ flashSaleItemId: 'fi2', quantity: 1 }, { flashSaleItemId: 'fi1', quantity: 2 }])).toEqual(['SOLD_OUT', 'OVER_LIMIT']);
  });

  it('lỗi hạ tầng → FlashQuotaLineError giữ lỗi gốc và vị trí dòng đang xử lý', async () => {
    const { tx } = mkTx({ fi1: { sold: 0, quota: 10, limit: 5 }, fi2: { sold: 0, quota: 10, limit: 5 } }, { fi2: 1 });
    const boom = new Error('Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected`');
    tx.flashSalePurchase.updateMany.mockRejectedValueOnce(boom);
    const err = await run(tx, [{ flashSaleItemId: 'fi1', quantity: 1 }, { flashSaleItemId: 'fi2', quantity: 1 }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlashQuotaLineError);
    expect((err as FlashQuotaLineError).lineIndex).toBe(1);
    expect((err as FlashQuotaLineError).original).toBe(boom);
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

  // R4-ADMIN-11: gõ nhầm năm (2036 thay 2026) tạo đợt giá flash kéo dài 10 năm.
  it('đợt dài hơn flashsale.max_duration_days (mặc định 31 ngày) → 400 nêu số ngày tối đa, không tạo; đúng 31 ngày thì được', async () => {
    const prisma = mk();
    const svc = new FlashSaleService(prisma, config, notifications, lifecycle);
    await expect(
      svc.createSale('a1', { title: 'Gõ nhầm năm', startAt: '2099-01-01T00:00:00Z', endAt: '2109-01-01T00:00:00Z' }),
    ).rejects.toThrow(/31 ngày/);
    await expect(
      svc.createSale('a1', { title: 'X', startAt: '2099-01-01T00:00:00Z', endAt: '2099-02-01T00:00:01Z' }),
    ).rejects.toThrow(/flashsale\.max_duration_days/);
    expect(prisma.flashSale.create).not.toHaveBeenCalled();
    await svc.createSale('a1', { title: 'Tháng 1', startAt: '2099-01-01T00:00:00Z', endAt: '2099-02-01T00:00:00Z' });
    expect(prisma.flashSale.create).toHaveBeenCalledTimes(1);
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
  const mkPrisma = (current: Record<string, unknown>, clash: unknown = null) => {
    const prisma = {
      flashSale: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({ id: 's1' }),
      },
      flashSaleItem: { findFirst: jest.fn().mockResolvedValue(clash) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    return prisma;
  };

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

  it('R4-ADMIN-11: dời endAt làm đợt dài quá flashsale.max_duration_days → 400, không cập nhật', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2099-01-01T00:00:00Z'), endAt: new Date('2099-01-02T00:00:00Z'), items: [] }) as any;
    await expect(
      new FlashSaleService(prisma, config, notifications, lifecycle).updateSale('s1', { endAt: '2109-01-02T00:00:00Z' }),
    ).rejects.toThrow(/31 ngày/);
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  it('ADMINOPS-16: đổi endAt về quá khứ → 400, không cập nhật', async () => {
    const prisma = mkPrisma({ id: 's1', startAt: new Date('2020-01-01'), endAt: new Date('2099-01-01') }) as any;
    await expect(
      new FlashSaleService(prisma, config, notifications, lifecycle).updateSale('s1', { endAt: '2020-02-01T00:00:00Z' }),
    ).rejects.toThrow('Thời gian kết thúc phải ở tương lai.');
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  // R3-UI-5: đợt đã bắt đầu mà đổi startAt sang tương lai thì biến mất khỏi khách giữa chừng rồi xoá được như đợt chưa bắt đầu.
  describe('đợt đã bắt đầu không đổi được giờ bắt đầu (R3-UI-5)', () => {
    const running = () => ({ id: 's1', startAt: new Date(Date.now() - 3600_000), endAt: new Date(Date.now() + 3600_000), items: [] });
    const svc = (prisma: unknown) => new FlashSaleService(prisma as any, config, notifications, lifecycle);

    it('startAt sang tương lai → 400, KHÔNG update', async () => {
      const prisma = mkPrisma(running());
      await expect(svc(prisma).updateSale('s1', { startAt: new Date(Date.now() + 1800_000).toISOString() })).rejects.toThrow(
        'Đợt flash sale đã bắt đầu, không đổi được giờ bắt đầu',
      );
      expect(prisma.flashSale.update).not.toHaveBeenCalled();
    });

    it('startAt sang quá khứ khác đi cũng → 400 (đợt đã bán theo giờ cũ)', async () => {
      const prisma = mkPrisma(running());
      await expect(svc(prisma).updateSale('s1', { startAt: new Date(Date.now() - 7200_000).toISOString() })).rejects.toThrow('đã bắt đầu');
      expect(prisma.flashSale.update).not.toHaveBeenCalled();
    });

    it('gửi lại đúng startAt hiện tại kèm endAt mới → vẫn sửa được endAt', async () => {
      const cur = running();
      const prisma = mkPrisma(cur);
      const endAt = new Date(Date.now() + 7200_000).toISOString();
      await svc(prisma).updateSale('s1', { startAt: cur.startAt.toISOString(), endAt });
      expect(prisma.flashSale.update).toHaveBeenCalled();
    });

    it('chỉ đổi endAt, title, isActive → vẫn được', async () => {
      const prisma = mkPrisma(running());
      await svc(prisma).updateSale('s1', { endAt: new Date(Date.now() + 7200_000).toISOString(), title: 'Mới', isActive: false });
      expect(prisma.flashSale.update).toHaveBeenCalled();
    });

    it('đợt chưa bắt đầu vẫn đổi được startAt', async () => {
      const prisma = mkPrisma({ id: 's1', startAt: new Date('2099-07-01'), endAt: new Date('2099-07-05'), items: [] });
      await svc(prisma).updateSale('s1', { startAt: '2099-07-02' });
      expect(prisma.flashSale.update).toHaveBeenCalled();
    });
  });

  // Đổi khung giờ không được lách chặn trùng SKU của addItem (hai giá flash cùng lúc cho một biến thể).
  describe('đổi khung giờ không làm hai đợt trùng giờ cùng một biến thể', () => {
    const svc = (prisma: unknown) => new FlashSaleService(prisma as any, config, notifications, lifecycle);
    const upcoming = () => ({ id: 's1', startAt: new Date('2099-07-01'), endAt: new Date('2099-07-05'), items: [{ variationId: 'v1' }, { variationId: 'v2' }] });

    it('trùng giờ với đợt khác có cùng biến thể → 400, KHÔNG update', async () => {
      const prisma = mkPrisma(upcoming(), { id: 'fi9' });
      await expect(svc(prisma).updateSale('s1', { endAt: '2099-07-20' })).rejects.toThrow('Sản phẩm đã có trong đợt flash khác.');
      expect(prisma.flashSale.update).not.toHaveBeenCalled();
      expect(prisma.flashSaleItem.findFirst.mock.calls[0]![0].where).toMatchObject({
        variationId: { in: ['v1', 'v2'] },
        flashSale: { id: { not: 's1' }, startAt: { lt: new Date('2099-07-20') } },
      });
    });

    it('không trùng → update; đợt không có item thì không truy vấn trùng', async () => {
      const prisma = mkPrisma(upcoming(), null);
      await svc(prisma).updateSale('s1', { endAt: '2099-07-20' });
      expect(prisma.flashSale.update).toHaveBeenCalled();
      const empty = mkPrisma({ ...upcoming(), items: [] });
      await svc(empty).updateSale('s1', { endAt: '2099-07-20' });
      expect(empty.flashSaleItem.findFirst).not.toHaveBeenCalled();
    });
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
  const base = () => {
    const prisma = {
      flashSale: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', startAt: new Date('2026-07-05T09:00:00Z'), endAt: new Date('2026-07-05T12:00:00Z') }),
      },
      variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', retailPrice: 100000, salePrice: null, stock: 10 }) },
      flashSaleItem: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'fi1' }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    return prisma;
  };
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

  // R4-ADMIN-11: giá flash 1đ (gõ thiếu số) trước đây vẫn lên bán; chỉ quota giới hạn thiệt hại.
  it('giảm quá flashsale.max_discount_pct (mặc định 90%) → reject nêu giá sàn và khoá cấu hình; đúng sàn thì được', async () => {
    const prisma = base() as any;
    const svc = new FlashSaleService(prisma, config, notifications, lifecycle);
    await expect(svc.addItem('s1', { variationId: 'v1', flashPrice: 1, quota: 5 })).rejects.toThrow(/10\.000đ/);
    await expect(svc.addItem('s1', { variationId: 'v1', flashPrice: 9_999, quota: 5 })).rejects.toThrow(/flashsale\.max_discount_pct/);
    expect(prisma.flashSaleItem.create).not.toHaveBeenCalled();
    await svc.addItem('s1', { variationId: 'v1', flashPrice: 10_000, quota: 5 });
    expect(prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
  });

  it('admin nâng flashsale.max_discount_pct lên 1 (100%) → giá flash rất thấp được nhận', async () => {
    const prisma = base() as any;
    const cfg = { get: async <T>(k: string, fb?: T): Promise<T> => (k === 'flashsale.max_discount_pct' ? 1 : fb) as T } as unknown as SystemConfigService;
    await new FlashSaleService(prisma, cfg, notifications, lifecycle).addItem('s1', { variationId: 'v1', flashPrice: 1_000, quota: 5 });
    expect(prisma.flashSaleItem.create).toHaveBeenCalled();
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

  const sellable = { isActive: true, product: { isActive: true, approvalStatus: 'APPROVED' } };

  it('sale chưa bắt đầu (startAt > now) → upsert reminder', async () => {
    const prisma = mkPrisma({ id: 'fi1', flashSale: { startAt: new Date('2026-07-06T00:00:00Z') }, variation: sellable }) as any;
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

  it('hàng đã ngừng bán (biến thể/sản phẩm tắt hoặc chưa duyệt) → reject, KHÔNG upsert', async () => {
    for (const variation of [
      { ...sellable, isActive: false },
      { isActive: true, product: { isActive: false, approvalStatus: 'APPROVED' } },
      { isActive: true, product: { isActive: true, approvalStatus: 'PENDING_REVIEW' } },
    ]) {
      const prisma = mkPrisma({ id: 'fi1', flashSale: { startAt: new Date('2026-07-06T00:00:00Z') }, variation }) as any;
      await expect(new FlashSaleService(prisma, config, notifications, lifecycle).setReminder('u1', 'fi1', NOW)).rejects.toThrow();
      expect(prisma.flashSaleReminder.upsert).not.toHaveBeenCalled();
    }
  });

  it('sale ĐÃ bắt đầu (startAt <= now) → reject "Ưu đãi đã bắt đầu.", KHÔNG upsert', async () => {
    const prisma = mkPrisma({ id: 'fi1', flashSale: { startAt: new Date('2026-07-05T09:00:00Z') }, variation: sellable }) as any;
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

  it('where lọc hàng còn bán, sale isActive+startAt>now+endAt>now, reminders lọc theo userId, sort startAt asc', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleItem: { findMany } } as any;
    await new FlashSaleService(prisma, config, notifications, lifecycle).listUpcoming('u1', NOW);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ variation: { isActive: true, product: { isActive: true, approvalStatus: 'APPROVED' } }, flashSale: { isActive: true, startAt: { gt: NOW }, endAt: { gt: NOW } } });
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
  it('chỉ lấy nhắc của sale ĐANG CHẠY trên hàng còn bán, có thứ tự ổn định', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { flashSaleReminder: { findMany, updateMany: jest.fn().mockResolvedValue({ count: 0 }) } } as any;
    await new FlashSaleService(prisma, config, notifications, lifecycle).notifyStartedFlashSales(now);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      notifiedAt: null,
      item: { variation: { isActive: true, product: { isActive: true, approvalStatus: 'APPROVED' } }, flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } } },
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

  it('chỉ xét mặt hàng còn bán: sản phẩm ngừng bán không bị báo "giảm giá"', async () => {
    const { svc, findMany } = setup([]);
    await svc.notifyWishlistOfStartedSales(now);
    expect(findMany.mock.calls[0][0].include.items.where).toEqual({ variation: { isActive: true, product: { isActive: true, approvalStatus: 'APPROVED' } } });
  });

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
