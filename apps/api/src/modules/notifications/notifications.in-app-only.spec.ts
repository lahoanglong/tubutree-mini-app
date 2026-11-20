import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

/** `inAppOnly` (tin nhắc Refill 21 ngày khi cờ ZNS riêng tắt): mẫu đã gắn mã ZNS vẫn chỉ ghi tin trong app. */
describe('NotificationsService.notify inAppOnly', () => {
  function setup() {
    let seq = 0;
    const create = jest.fn().mockImplementation(async () => ({ id: `log-${++seq}` }));
    const prisma = {
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({ code: 'REORDER_REMINDER_REFILL', channel: 'ZNS', bodyTemplate: 'Châm lại {{product}}', zaloTemplateId: 'zt-refill' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0900000000', notifyPromo: true, notifyGarden: true, notifySocial: true }) },
      notificationLog: { create, count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const sendTemplate = jest.fn().mockResolvedValue({ ok: true });
    const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
    return { svc: new NotificationsService(prisma, { sendTemplate } as unknown as ZnsClient, analytics), create, sendTemplate };
  }

  it('inAppOnly: chỉ một log INAPP, không gọi Zalo', async () => {
    const { svc, create, sendTemplate } = setup();
    await svc.notify('u1', 'REORDER_REMINDER_REFILL', { product: 'Refill 10L' }, { inAppOnly: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.channel).toBe('INAPP');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('không đặt inAppOnly: mẫu ZNS vẫn gửi như trước', async () => {
    const { svc, create, sendTemplate } = setup();
    await svc.notify('u1', 'REORDER_REMINDER_REFILL', { product: 'Refill 10L' });
    expect(sendTemplate).toHaveBeenCalledWith('0900000000', 'zt-refill', { product: 'Refill 10L' });
    expect(create.mock.calls.map((c) => c[0].data.channel)).toEqual(['INAPP', 'ZNS']);
  });
});
