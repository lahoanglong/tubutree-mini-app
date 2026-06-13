import { LifecycleService } from './lifecycle.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function setup(rows: unknown[], existing: unknown = null) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const upsert = jest.fn().mockResolvedValue({});
  const findUnique = jest.fn().mockResolvedValue(existing);
  const prisma = {
    $queryRaw: queryRaw,
    reorderReminder: { findUnique, upsert },
  } as unknown as PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;
  return { svc: new LifecycleService(prisma, config, notifications), upsert, notify, findUnique };
}

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  variationId: 'v1',
  productName: 'Dầu gội Visante 500ml',
  lastOrderAt: new Date('2026-04-01'),
  ...over,
});

describe('LifecycleService.sendReorderReminders (§6.14.7)', () => {
  it('sản phẩm tới hạn, chưa từng nhắc → notify + upsert remindedAt', async () => {
    const { svc, upsert, notify } = setup([row()], null);
    await svc.sendReorderReminders();
    expect(notify).toHaveBeenCalledWith('u1', 'REORDER_REMINDER', { product: 'Dầu gội Visante 500ml' });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.remindedAt).toBeInstanceOf(Date);
  });

  it('đã nhắc sau đơn cuối (remindedAt >= lastOrderAt) → KHÔNG nhắc lại (chống spam)', async () => {
    const { svc, notify, upsert } = setup([row({ lastOrderAt: new Date('2026-04-01') })], {
      remindedAt: new Date('2026-04-20'), // đã nhắc sau đơn cuối
    });
    await svc.sendReorderReminders();
    expect(notify).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('có đơn MỚI hơn lần nhắc trước (remindedAt < lastOrderAt) → nhắc lại', async () => {
    const { svc, notify } = setup([row({ lastOrderAt: new Date('2026-06-01') })], {
      remindedAt: new Date('2026-04-20'), // nhắc cũ, đã có đơn mới 06-01
    });
    await svc.sendReorderReminders();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('không có sản phẩm tới hạn → không làm gì', async () => {
    const { svc, notify, upsert } = setup([]);
    await svc.sendReorderReminders();
    expect(notify).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
