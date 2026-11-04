import { NotificationsService } from './notifications.service';
import { NotificationTemplatesAdminService } from './notification-templates-admin.service';
import { TEMPLATE_CACHE_TTL_MS } from './notification-template-cache';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

const TPL = { id: 'nt1', code: 'ORDER_CONFIRMED', channel: 'INAPP', zaloTemplateId: null, bodyTemplate: 'Đơn {{order_code}} xong' };

function setup() {
  const tplFindUnique = jest.fn(async ({ where }: { where: { code: string } }) => (where.code === TPL.code ? { ...TPL } : null));
  const userFindUnique = jest.fn().mockResolvedValue({ phone: '0900000000', notifyPromo: false, notifyGarden: false });
  const prisma = {
    notificationTemplate: {
      findUnique: tplFindUnique,
      update: jest.fn(async ({ data }: { data: object }) => ({ ...TPL, ...data })),
    },
    user: { findUnique: userFindUnique },
    notificationLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }), findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
  const zns = { sendTemplate: jest.fn() } as unknown as ZnsClient;
  const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
  return {
    prisma,
    tplFindUnique,
    userFindUnique,
    svc: new NotificationsService(prisma, zns, analytics),
    admin: new NotificationTemplatesAdminService(prisma),
  };
}

describe('NotificationsService.notify: bộ nhớ đệm mẫu theo mã', () => {
  afterEach(() => jest.useRealTimers());

  it('nhiều lần notify cùng mã chỉ đọc mẫu một lần', async () => {
    const { svc, tplFindUnique } = setup();
    for (let i = 0; i < 5; i++) await svc.notify(`u${i}`, 'ORDER_CONFIRMED', { order_code: 'X' });
    expect(tplFindUnique).toHaveBeenCalledTimes(1);
  });

  it('mã khác nhau đọc riêng; mã thiếu mẫu cũng được nhớ', async () => {
    const { svc, tplFindUnique } = setup();
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    await svc.notify('u1', 'NO_SUCH_CODE', {});
    await svc.notify('u2', 'NO_SUCH_CODE', {});
    expect(tplFindUnique).toHaveBeenCalledTimes(2);
  });

  it('admin sửa mẫu xong thì lần notify sau đọc lại mẫu và dùng nội dung mới', async () => {
    const { svc, admin, tplFindUnique, prisma } = setup();
    await svc.notify('u1', 'ORDER_CONFIRMED', { order_code: 'X' });
    expect(tplFindUnique).toHaveBeenCalledTimes(1);
    await admin.update('ORDER_CONFIRMED', { bodyTemplate: 'Đơn {{order_code}} đã giao' });
    const readsAfterUpdate = tplFindUnique.mock.calls.length; // update() tự đọc mẫu hiện tại một lần
    await svc.notify('u1', 'ORDER_CONFIRMED', { order_code: 'X' });
    expect(tplFindUnique.mock.calls.length).toBe(readsAfterUpdate + 1);
    expect(prisma.notificationLog.create).toHaveBeenCalledTimes(2);
  });

  it('lần đọc DB bắt đầu trước khi admin sửa mẫu không ghi bản cũ vào cache', async () => {
    const { svc, admin, tplFindUnique } = setup();
    let release!: (v: unknown) => void;
    tplFindUnique.mockImplementationOnce(() => new Promise((r) => { release = r; }) as never);
    const pending = svc.notify('u1', 'ORDER_CONFIRMED', { order_code: 'X' });
    await new Promise((r) => setImmediate(r));
    await admin.update('ORDER_CONFIRMED', { bodyTemplate: 'Đơn {{order_code}} đã giao' });
    release({ ...TPL }); // bản cũ về sau khi đã invalidate
    await pending;
    const reads = tplFindUnique.mock.calls.length;
    await svc.notify('u2', 'ORDER_CONFIRMED', { order_code: 'X' });
    expect(tplFindUnique.mock.calls.length).toBe(reads + 1);
  });

  it('quá TTL thì đọc lại', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-04T01:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const { svc, tplFindUnique } = setup();
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    jest.setSystemTime(Date.now() + TEMPLATE_CACHE_TTL_MS - 1);
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(tplFindUnique).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 2);
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(tplFindUnique).toHaveBeenCalledTimes(2);
  });

  it('user chỉ đọc đúng các trường notify dùng (phone, notifyPromo, notifyGarden)', async () => {
    const { svc, userFindUnique } = setup();
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { phone: true, notifyPromo: true, notifyGarden: true },
    });
  });
});
