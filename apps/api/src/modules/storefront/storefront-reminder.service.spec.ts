import { StorefrontReminderService } from './storefront-reminder.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

function trendingRow(id: string, name: string) {
  return { id, name };
}

function storeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'sf1',
    ownerUserId: 'u1',
    lastReminderAt: null,
    collections: [{ items: [{ productId: 'p-have-1' }] }],
    ...over,
  };
}

function setup(opts: {
  trending?: ReturnType<typeof trendingRow>[];
  stores?: ReturnType<typeof storeRow>[];
  claimedCount?: number;
  notifyImpl?: () => Promise<void>;
}) {
  const productFindMany = jest.fn().mockResolvedValue(opts.trending ?? [trendingRow('p1', 'Nước giặt sinh học Fuwa3e')]);
  const storefrontFindMany = jest.fn().mockResolvedValue(opts.stores ?? [storeRow()]);
  const storefrontUpdateMany = jest.fn().mockResolvedValue({ count: opts.claimedCount ?? 1 });
  const prisma = {
    product: { findMany: productFindMany },
    storefront: { findMany: storefrontFindMany, updateMany: storefrontUpdateMany },
  } as unknown as PrismaService;
  const notify = jest.fn(opts.notifyImpl ?? (() => Promise.resolve(undefined)));
  const notifications = { notify } as unknown as NotificationsService;
  const svc = new StorefrontReminderService(prisma, notifications);
  return { svc, productFindMany, storefrontFindMany, storefrontUpdateMany, notify };
}

describe('StorefrontReminderService.remindTrendingProducts', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('gian hàng đang hoạt động, thiếu SP nổi bật, chưa từng nhắc → notify + claim atomic', async () => {
    const { svc, notify, storefrontUpdateMany } = setup({
      trending: [trendingRow('p1', 'Nước giặt sinh học Fuwa3e'), trendingRow('p2', 'Dầu gội Visante')],
      stores: [storeRow({ collections: [{ items: [{ productId: 'p1' }] }] })], // đã có p1, thiếu p2
    });
    await svc.remindTrendingProducts();

    expect(storefrontUpdateMany).toHaveBeenCalledTimes(1);
    expect(storefrontUpdateMany.mock.calls[0]?.[0].data.lastReminderAt).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledWith('u1', 'STOREFRONT_TRENDING_PRODUCTS', {
      count: '1',
      sample: 'Dầu gội Visante',
    });
  });

  it('gian hàng trắng (chưa có sản phẩm nào) → bỏ qua, không notify', async () => {
    const { svc, notify, storefrontUpdateMany } = setup({
      stores: [storeRow({ collections: [] })],
    });
    await svc.remindTrendingProducts();
    expect(notify).not.toHaveBeenCalled();
    expect(storefrontUpdateMany).not.toHaveBeenCalled();
  });

  it('gian hàng đã có ĐỦ mọi sản phẩm nổi bật → không notify', async () => {
    const { svc, notify } = setup({
      trending: [trendingRow('p1', 'A')],
      stores: [storeRow({ collections: [{ items: [{ productId: 'p1' }] }] })],
    });
    await svc.remindTrendingProducts();
    expect(notify).not.toHaveBeenCalled();
  });

  it('không có sản phẩm isFeatured nào → return sớm, KHÔNG query storefront', async () => {
    const { svc, storefrontFindMany } = setup({ trending: [] });
    await svc.remindTrendingProducts();
    expect(storefrontFindMany).not.toHaveBeenCalled();
  });

  it('query storefront lọc đúng type CTV, isPublished, cooldown 6 ngày', async () => {
    const { svc, storefrontFindMany } = setup({ stores: [] });
    await svc.remindTrendingProducts();
    const where = storefrontFindMany.mock.calls[0]?.[0].where;
    expect(where.type).toBe('CTV');
    expect(where.isPublished).toBe(true);
    expect(where.OR).toEqual([
      { lastReminderAt: null },
      { lastReminderAt: { lt: new Date('2026-06-29T00:00:00Z') } },
    ]);
  });

  it('thua race claim (updateMany count=0) → bỏ qua, không notify', async () => {
    const { svc, notify } = setup({ claimedCount: 0 });
    await svc.remindTrendingProducts();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notify lỗi → revert lastReminderAt về giá trị cũ để lượt sau thử lại', async () => {
    const { svc, storefrontUpdateMany } = setup({
      stores: [storeRow({ lastReminderAt: null })],
      notifyImpl: () => Promise.reject(new Error('ZNS down')),
    });
    await svc.remindTrendingProducts();
    // Lần 1: claim. Lần 2: revert về lastReminderAt cũ (null).
    expect(storefrontUpdateMany).toHaveBeenCalledTimes(2);
    expect(storefrontUpdateMany.mock.calls[1]?.[0].data.lastReminderAt).toBeNull();
  });

  it('ownerUserId null (dữ liệu bất thường) → bỏ qua, không crash', async () => {
    const { svc, notify } = setup({ stores: [storeRow({ ownerUserId: null })] });
    await expect(svc.remindTrendingProducts()).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('lỗi truy vấn (DB down) không ném ra ngoài — bọc try/catch toàn thân', async () => {
    const prisma = {
      product: { findMany: jest.fn().mockRejectedValue(new Error('DB down')) },
    } as unknown as PrismaService;
    const notifications = { notify: jest.fn() } as unknown as NotificationsService;
    const svc = new StorefrontReminderService(prisma, notifications);
    await expect(svc.remindTrendingProducts()).resolves.toBeUndefined();
  });
});
