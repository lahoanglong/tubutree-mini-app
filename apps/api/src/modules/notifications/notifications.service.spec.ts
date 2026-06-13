import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';

function makePrisma(over: Record<string, unknown> = {}) {
  const create = jest.fn().mockResolvedValue({});
  const base = {
    notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0900000000' }) },
    notificationLog: { create, findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({}) },
  };
  return { prisma: { ...base, ...over } as unknown as PrismaService, create };
}

describe('NotificationsService.notify', () => {
  it('luôn ghi INAPP log dù không có template (fallback dùng code)', async () => {
    const { prisma, create } = makePrisma();
    const zns = { sendTemplate: jest.fn() } as unknown as ZnsClient;
    await new NotificationsService(prisma, zns).notify('u1', 'ORDER_CONFIRMED', { order_code: 'X1' });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.channel).toBe('INAPP');
    expect(data.payload.body).toBe('ORDER_CONFIRMED'); // fallback = code khi thiếu template
    expect(zns.sendTemplate).not.toHaveBeenCalled();
  });

  it('render biến {{...}} trong template + KHÔNG gửi ZNS khi channel INAPP', async () => {
    const { prisma, create } = makePrisma({
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'ORDER_CONFIRMED',
          channel: 'INAPP',
          bodyTemplate: 'Đơn {{order_code}} đã xác nhận',
          zaloTemplateId: null,
        }),
      },
    });
    const zns = { sendTemplate: jest.fn() } as unknown as ZnsClient;
    await new NotificationsService(prisma, zns).notify('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU9' });
    expect(create.mock.calls[0][0].data.payload.body).toBe('Đơn TUBU9 đã xác nhận');
    expect(zns.sendTemplate).not.toHaveBeenCalled();
  });

  it('template ZNS + user có phone + zaloTemplateId → gửi ZNS và ghi log ZNS', async () => {
    const { prisma, create } = makePrisma({
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'ORDER_CONFIRMED',
          channel: 'ZNS',
          bodyTemplate: 'Đơn {{order_code}}',
          zaloTemplateId: 'zt-123',
        }),
      },
    });
    const sendTemplate = jest.fn().mockResolvedValue(true);
    const zns = { sendTemplate } as unknown as ZnsClient;
    await new NotificationsService(prisma, zns).notify('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU9' });
    expect(sendTemplate).toHaveBeenCalledWith('0900000000', 'zt-123', { order_code: 'TUBU9' });
    // 2 log: INAPP + ZNS
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].data.channel).toBe('ZNS');
    expect(create.mock.calls[1][0].data.status).toBe('SENT');
  });

  it('template ZNS nhưng user không có phone → chỉ ghi INAPP, không gửi ZNS', async () => {
    const { prisma, create } = makePrisma({
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'ORDER_CONFIRMED',
          channel: 'ZNS',
          bodyTemplate: 'x',
          zaloTemplateId: 'zt-123',
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: null }) },
    });
    const sendTemplate = jest.fn();
    await new NotificationsService(prisma, { sendTemplate } as unknown as ZnsClient).notify('u1', 'ORDER_CONFIRMED', {});
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('ZNS gửi thất bại (false) → log ZNS status FAILED', async () => {
    const { prisma, create } = makePrisma({
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'C',
          channel: 'ZNS',
          bodyTemplate: 'x',
          zaloTemplateId: 'zt',
        }),
      },
    });
    const zns = { sendTemplate: jest.fn().mockResolvedValue(false) } as unknown as ZnsClient;
    await new NotificationsService(prisma, zns).notify('u1', 'C', {});
    expect(create.mock.calls[1][0].data.status).toBe('FAILED');
  });
});
