import { LifecycleService } from './lifecycle.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function setup(rows: unknown[], existing: unknown = null, claimedCount = 1) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const findUnique = jest.fn().mockResolvedValue(existing);
  const create = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: claimedCount });
  const prisma = {
    $queryRaw: queryRaw,
    reorderReminder: { findUnique, create, updateMany },
  } as unknown as PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;
  return { svc: new LifecycleService(prisma, config, notifications), create, updateMany, notify, findUnique };
}

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  variationId: 'v1',
  productName: 'Dầu gội Visante 500ml',
  lastOrderAt: new Date('2026-04-01'),
  ...over,
});

describe('LifecycleService.sendReorderReminders (§6.14.7)', () => {
  it('sản phẩm tới hạn, chưa từng nhắc → notify + create remindedAt', async () => {
    const { svc, create, notify } = setup([row()], null);
    await svc.sendReorderReminders();
    expect(notify).toHaveBeenCalledWith('u1', 'REORDER_REMINDER', { product: 'Dầu gội Visante 500ml' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.remindedAt).toBeInstanceOf(Date);
  });

  it('đã nhắc sau đơn cuối (remindedAt >= lastOrderAt) → KHÔNG nhắc lại (chống spam)', async () => {
    const { svc, notify, create, updateMany } = setup([row({ lastOrderAt: new Date('2026-04-01') })], {
      remindedAt: new Date('2026-04-20'), // đã nhắc sau đơn cuối
    });
    await svc.sendReorderReminders();
    expect(notify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('có đơn MỚI hơn lần nhắc trước (remindedAt < lastOrderAt) → nhắc lại (claim qua updateMany)', async () => {
    const { svc, notify, updateMany } = setup([row({ lastOrderAt: new Date('2026-06-01') })], {
      remindedAt: new Date('2026-04-20'), // nhắc cũ, đã có đơn mới 06-01
    });
    await svc.sendReorderReminders();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('không có sản phẩm tới hạn → không làm gì', async () => {
    const { svc, notify, create } = setup([]);
    await svc.sendReorderReminders();
    expect(notify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('2 cron instance chạy chồng, đã có bản ghi: claim updateMany count=0 → bỏ qua, không notify (chống double-send)', async () => {
    const { svc, notify, updateMany } = setup(
      [row({ lastOrderAt: new Date('2026-06-01') })],
      { remindedAt: new Date('2026-04-20') },
      0,
    );
    await svc.sendReorderReminders();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('2 cron instance chạy chồng, lần đầu nhắc: create race → P2002 → bỏ qua, không notify (chống double-send)', async () => {
    const { svc, notify, create } = setup([row()], null);
    create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await svc.sendReorderReminders();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('LifecycleService.notifyWishlistPriceDrop (§6.14.10)', () => {
  function setupWishlist(users: string[]) {
    const findMany = jest.fn().mockResolvedValue(users.map((userId) => ({ userId })));
    const prisma = { wishlist: { findMany } } as unknown as PrismaService;
    const notify = jest.fn().mockResolvedValue(undefined);
    const notifications = { notify } as unknown as NotificationsService;
    return { svc: new LifecycleService(prisma, config, notifications), notify };
  }

  it('báo cho tất cả user đã wishlist sản phẩm', async () => {
    const { svc, notify } = setupWishlist(['u1', 'u2']);
    await svc.notifyWishlistPriceDrop('p1', 'Tinh dầu tràm');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith('u1', 'PRICE_DROP_ALERT', { product: 'Tinh dầu tràm' });
    expect(notify).toHaveBeenCalledWith('u2', 'PRICE_DROP_ALERT', { product: 'Tinh dầu tràm' });
  });

  it('không ai wishlist → không báo', async () => {
    const { svc, notify } = setupWishlist([]);
    await svc.notifyWishlistPriceDrop('p1', 'X');
    expect(notify).not.toHaveBeenCalled();
  });
});
