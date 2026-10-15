import 'reflect-metadata';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

type Row = { id: string; userId: string; channel: string; status: string };

function setup(rows: Row[]) {
  const updateMany = jest.fn().mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: { status: string } }) => {
    const notRead = (where.status as { not?: string } | undefined)?.not;
    let count = 0;
    for (const r of rows) {
      if (r.userId !== where.userId) continue;
      if (where.channel && r.channel !== where.channel) continue;
      if (notRead && r.status === notRead) continue;
      r.status = data.status;
      count++;
    }
    return { count };
  });
  const prisma = { notificationLog: { updateMany } } as unknown as PrismaService;
  const svc = new NotificationsService(prisma, {} as ZnsClient, {} as AnalyticsEventsService);
  return { svc, updateMany };
}

describe('NotificationsService.markAllRead (R6-BUYER-5)', () => {
  const rows = (): Row[] => [
    { id: 'a', userId: 'u1', channel: 'INAPP', status: 'SENT' },
    { id: 'b', userId: 'u1', channel: 'INAPP', status: 'READ' },
    { id: 'c', userId: 'u1', channel: 'ZNS', status: 'SENT' },
    { id: 'd', userId: 'u2', channel: 'INAPP', status: 'SENT' },
  ];

  it('chỉ đánh dấu tin INAPP chưa đọc của chính khách', async () => {
    const data = rows();
    const { svc } = setup(data);
    await expect(svc.markAllRead('u1')).resolves.toEqual({ ok: true, count: 1 });
    expect(data.map((r) => r.status)).toEqual(['READ', 'READ', 'SENT', 'SENT']);
  });

  it('gọi lại là idempotent: count 0, không lỗi', async () => {
    const { svc } = setup(rows());
    await svc.markAllRead('u1');
    await expect(svc.markAllRead('u1')).resolves.toEqual({ ok: true, count: 0 });
  });

  it('lọc theo userId lấy từ token, không có tham số nào khác', async () => {
    const { svc, updateMany } = setup(rows());
    await svc.markAllRead('u2');
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u2', channel: 'INAPP', status: { not: 'READ' } },
      data: { status: 'READ' },
    });
  });
});

describe('NotificationsController read-all', () => {
  it('POST me/notifications/read-all dùng userId của người gọi và tách khỏi :id/read', () => {
    const markAllRead = jest.fn().mockResolvedValue({ ok: true, count: 3 });
    const ctrl = new NotificationsController({ markAllRead } as unknown as NotificationsService);
    expect(Reflect.getMetadata('path', NotificationsController)).toBe('me/notifications');
    expect(Reflect.getMetadata('path', NotificationsController.prototype.markAllRead)).toBe('read-all');
    void ctrl.markAllRead('u1');
    expect(markAllRead).toHaveBeenCalledWith('u1');
  });
});
