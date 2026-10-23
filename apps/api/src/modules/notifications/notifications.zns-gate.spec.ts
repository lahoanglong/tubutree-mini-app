import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { SystemConfigService } from '../system-config/system-config.service';

// 2026-10-20 19:00 UTC = 02:00 giờ VN ngày 21; 2026-10-20 05:00 UTC = 12:00 giờ VN.
const AT_0200_VN = new Date('2026-10-20T19:00:00.000Z');
const AT_1200_VN = new Date('2026-10-20T05:00:00.000Z');
const HOUR = 3_600_000;

function setup(opts: { templateCode: string; promoCountThisMonth?: number; config?: Record<string, unknown> }) {
  let seq = 0;
  const create = jest.fn().mockImplementation(async () => ({ id: `log-${++seq}` }));
  const count = jest.fn().mockResolvedValue(opts.promoCountThisMonth ?? 0);
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
    get: async <T>(k: string, fb?: T): Promise<T> => (opts.config && k in opts.config ? (opts.config[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
  const svc = new NotificationsService(
    prisma as unknown as PrismaService,
    { sendTemplate: jest.fn() } as unknown as ZnsClient,
    analytics,
    { add } as never,
    config,
  );
  const channels = () => create.mock.calls.map((c) => c[0].data.channel as string);
  return { svc, add, create, count, channels };
}

describe('NotificationsService: giờ yên tĩnh của ZNS (D5-02)', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AT_0200_VN));
  afterEach(() => jest.useRealTimers());

  it('REORDER_REMINDER lúc 02:00 giờ VN: job ZNS bị trễ tới 08:00 (6 giờ), không bị bỏ', async () => {
    const { svc, add, channels } = setup({ templateCode: 'REORDER_REMINDER' });
    await svc.notify('u1', 'REORDER_REMINDER', { product: 'X' });
    expect(channels()).toEqual(['INAPP', 'ZNS']);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][2].delay).toBe(6 * HOUR);
  });

  it('tin giao dịch (ORDER_CONFIRMED) cũng chỉ làm trễ, in-app vẫn lưu ngay', async () => {
    const { svc, add, channels } = setup({ templateCode: 'ORDER_CONFIRMED' });
    await svc.notify('u1', 'ORDER_CONFIRMED', { order_code: 'T1' });
    expect(channels()).toEqual(['INAPP', 'ZNS']);
    expect(add.mock.calls[0][2].delay).toBe(6 * HOUR);
  });

  it('21:00 đúng đã là giờ yên tĩnh, 08:00 đúng thì gửi ngay', async () => {
    const a = setup({ templateCode: 'ORDER_CONFIRMED' });
    jest.setSystemTime(new Date('2026-10-20T14:00:00.000Z')); // 21:00 VN
    await a.svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(a.add.mock.calls[0][2].delay).toBe(11 * HOUR);

    const b = setup({ templateCode: 'ORDER_CONFIRMED' });
    jest.setSystemTime(new Date('2026-10-20T01:00:00.000Z')); // 08:00 VN
    await b.svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(b.add.mock.calls[0][2].delay ?? 0).toBe(0);
  });

  it('trong khung 08:00-21:00 giờ VN: không trễ', async () => {
    jest.setSystemTime(AT_1200_VN);
    const { svc, add } = setup({ templateCode: 'REORDER_REMINDER' });
    await svc.notify('u1', 'REORDER_REMINDER', {});
    expect(add.mock.calls[0][2].delay ?? 0).toBe(0);
  });

  it('khung giờ đọc từ SystemConfig: yên tĩnh 22:00-06:00 thì 02:00 vẫn trễ, tới 06:00 (4 giờ)', async () => {
    const { svc, add } = setup({
      templateCode: 'ORDER_CONFIRMED',
      config: { 'notifications.zns_quiet_start_hour': 22, 'notifications.zns_quiet_end_hour': 6 },
    });
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(add.mock.calls[0][2].delay).toBe(4 * HOUR);
  });

  it('giờ bắt đầu bằng giờ kết thúc = tắt giờ yên tĩnh', async () => {
    const { svc, add } = setup({
      templateCode: 'ORDER_CONFIRMED',
      config: { 'notifications.zns_quiet_start_hour': 8, 'notifications.zns_quiet_end_hour': 8 },
    });
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(add.mock.calls[0][2].delay ?? 0).toBe(0);
  });
});

describe('NotificationsService: trần tin ZNS khuyến mãi/hậu mãi mỗi khách mỗi tháng (D5-02)', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AT_1200_VN));
  afterEach(() => jest.useRealTimers());

  it('tin khuyến mãi thứ 3 trong tháng: không có log ZNS, không xếp job, vẫn có INAPP', async () => {
    const { svc, add, channels } = setup({ templateCode: 'WINBACK_VOUCHER', promoCountThisMonth: 2 });
    await svc.notify('u1', 'WINBACK_VOUCHER', { discount: '30.000' });
    expect(channels()).toEqual(['INAPP']);
    expect(add).not.toHaveBeenCalled();
  });

  it('mới 1 tin trong tháng: tin thứ 2 vẫn đi ZNS', async () => {
    const { svc, add, channels } = setup({ templateCode: 'WINBACK_VOUCHER', promoCountThisMonth: 1 });
    await svc.notify('u1', 'WINBACK_VOUCHER', {});
    expect(channels()).toEqual(['INAPP', 'ZNS']);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('đếm đúng khách, đúng nhóm mẫu khuyến mãi, đúng ba trạng thái và đúng tháng giờ VN', async () => {
    const { svc, count } = setup({ templateCode: 'REORDER_REMINDER' });
    await svc.notify('u1', 'REORDER_REMINDER', {});
    const where = count.mock.calls[0][0].where;
    expect(where.userId).toBe('u1');
    expect(where.channel).toBe('ZNS');
    expect(where.status.in.sort()).toEqual(['PENDING', 'RETRYING', 'SENT']);
    expect(where.templateCode.in).toEqual(expect.arrayContaining(['REORDER_REMINDER', 'WINBACK_VOUCHER', 'REVIEW_REQUEST']));
    expect(where.templateCode.in).not.toContain('ORDER_CONFIRMED');
    expect(where.templateCode.in).not.toContain('GROUP_BUY_SUCCESS');
    expect(where.sentAt.gte).toEqual(new Date('2026-09-30T17:00:00.000Z'));
    expect(where.sentAt.lt).toEqual(new Date('2026-10-31T17:00:00.000Z'));
  });

  it('tin giao dịch không bị trần: ORDER_CONFIRMED vẫn đi dù khách đã nhận nhiều tin khuyến mãi', async () => {
    const { svc, channels, count } = setup({ templateCode: 'ORDER_CONFIRMED', promoCountThisMonth: 99 });
    await svc.notify('u1', 'ORDER_CONFIRMED', {});
    expect(channels()).toEqual(['INAPP', 'ZNS']);
    expect(count).not.toHaveBeenCalled();
  });

  it('trần đọc từ SystemConfig: đặt 1 thì tin thứ 2 đã bị bỏ', async () => {
    const { svc, channels } = setup({
      templateCode: 'WINBACK_VOUCHER',
      promoCountThisMonth: 1,
      config: { 'notifications.zns_promo_monthly_cap': 1 },
    });
    await svc.notify('u1', 'WINBACK_VOUCHER', {});
    expect(channels()).toEqual(['INAPP']);
  });
});
