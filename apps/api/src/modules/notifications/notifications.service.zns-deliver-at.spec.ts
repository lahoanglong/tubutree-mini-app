import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { SystemConfigService } from '../system-config/system-config.service';

// 2026-10-31 15:00 UTC = 22:00 giờ VN ngày 31/10 (giờ yên tĩnh); tin tới tay khách 08:00 VN ngày 01/11 = 01:00 UTC.
const AT_2200_VN_OCT_31 = new Date('2026-10-31T15:00:00.000Z');
const DELIVER_AT = new Date('2026-11-01T01:00:00.000Z');
const AT_1200_VN = new Date('2026-10-20T05:00:00.000Z');

function setup(opts: { templateCode: string; failQuietConfig?: boolean }) {
  let seq = 0;
  const create = jest.fn().mockImplementation(async () => ({ id: `log-${++seq}` }));
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    notificationTemplate: {
      findUnique: jest.fn().mockResolvedValue({ code: opts.templateCode, channel: 'ZNS', bodyTemplate: 'x', zaloTemplateId: 'zt-1' }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0900000000', notifyPromo: true, notifyGarden: true }) },
    notificationLog: { create, count, findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(1),
  } as Record<string, unknown>;
  prisma.$transaction = jest.fn((fn: (t: unknown) => unknown) => fn(prisma));
  const add = jest.fn().mockResolvedValue({});
  const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
  const config = {
    get: async <T>(k: string, fb?: T): Promise<T> => {
      if (opts.failQuietConfig && k.startsWith('notifications.zns_quiet_')) throw new Error('db down');
      return fb as T;
    },
  } as unknown as SystemConfigService;
  const svc = new NotificationsService(
    prisma as unknown as PrismaService,
    { sendTemplate: jest.fn() } as unknown as ZnsClient,
    analytics,
    { add } as never,
    config,
  );
  const znsLogs = () => create.mock.calls.map((c) => c[0].data).filter((d) => d.channel === 'ZNS');
  return { svc, add, count, znsLogs };
}

describe('NotificationsService: lỗi đọc giờ yên tĩnh không để log ZNS kẹt PENDING', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AT_1200_VN));
  afterEach(() => jest.useRealTimers());

  it('config.get lỗi (DB tạm thời) → lỗi nổi lên trước khi ghi log ZNS, không có log PENDING không job', async () => {
    const { svc, add, znsLogs } = setup({ templateCode: 'ORDER_CONFIRMED', failQuietConfig: true });
    await expect(svc.notify('u1', 'ORDER_CONFIRMED', { order_code: 'T1' })).rejects.toThrow('db down');
    expect(znsLogs()).toEqual([]);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('NotificationsService: trần ZNS khuyến mãi theo tháng của thời điểm tin tới tay khách', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AT_2200_VN_OCT_31));
  afterEach(() => jest.useRealTimers());

  it('tin khuyến mãi tạo 22:00 ngày 31/10 sẽ tới 08:00 ngày 01/11: đếm trần theo tháng 11 và ghi sentAt = lúc tới', async () => {
    const { svc, add, count, znsLogs } = setup({ templateCode: 'REORDER_REMINDER' });
    await svc.notify('u1', 'REORDER_REMINDER', { product: 'X' });

    const where = count.mock.calls[0][0].where;
    expect(where.sentAt.gte).toEqual(new Date('2026-10-31T17:00:00.000Z'));
    expect(where.sentAt.lt).toEqual(new Date('2026-11-30T17:00:00.000Z'));
    expect(znsLogs()).toHaveLength(1);
    expect(znsLogs()[0].sentAt).toEqual(DELIVER_AT);
    expect(add.mock.calls[0][2].delay).toBe(DELIVER_AT.getTime() - AT_2200_VN_OCT_31.getTime());
  });

  it('tin giao dịch (không bị trần) trong giờ yên tĩnh: không đổi sentAt của log', async () => {
    const { svc, znsLogs } = setup({ templateCode: 'ORDER_CONFIRMED' });
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(znsLogs()[0].sentAt).toBeUndefined();
  });

  it('tin khuyến mãi trong giờ gửi (không trễ): đếm theo tháng hiện tại, không đặt sentAt', async () => {
    jest.setSystemTime(AT_1200_VN);
    const { svc, count, znsLogs } = setup({ templateCode: 'REORDER_REMINDER' });
    await svc.notify('u1', 'REORDER_REMINDER', {});
    expect(count.mock.calls[0][0].where.sentAt.gte).toEqual(new Date('2026-09-30T17:00:00.000Z'));
    expect(znsLogs()[0].sentAt).toBeUndefined();
  });
});
