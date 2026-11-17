import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { isPreemptedZnsLog, proactiveDayKey } from './notification-proactive-cap';

// Giờ VN = UTC+7.
const AT_1200_VN = new Date('2026-11-17T05:00:00.000Z');
const AT_2059_VN = new Date('2026-11-17T13:59:00.000Z');
const AT_2130_VN = new Date('2026-11-17T14:30:00.000Z');
const AT_0759_VN = new Date('2026-11-17T00:59:00.000Z');

function setup(opts: { templateCode: string; capOn?: boolean; usedToday?: number; usedWeek?: number; pending?: unknown[] }) {
  let seq = 0;
  const create = jest.fn().mockImplementation(async () => ({ id: `log-${++seq}` }));
  const queryRaw = jest.fn().mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('SUM("count")')) return [{ day: opts.usedToday ?? 0, week: opts.usedWeek ?? opts.usedToday ?? 0 }];
    if (sql.includes('INSERT INTO "notification_proactive_counters"')) return [{ count: 1 }];
    return [];
  });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    notificationTemplate: {
      findUnique: jest.fn().mockResolvedValue({ code: opts.templateCode, channel: 'ZNS', bodyTemplate: 'x', zaloTemplateId: 'zt-1' }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0900000000', notifyPromo: true, notifyGarden: true, notifySocial: true }) },
    notificationLog: {
      create,
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue(opts.pending ?? []),
      update: jest.fn(),
      updateMany,
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: queryRaw,
  } as Record<string, unknown>;
  prisma.$transaction = jest.fn((fn: (t: unknown) => unknown) => fn(prisma));
  const add = jest.fn().mockResolvedValue({});
  const remove = jest.fn().mockResolvedValue(1);
  const record = jest.fn().mockResolvedValue(undefined);
  const values: Record<string, unknown> = { 'notify.proactive_cap_enabled': opts.capOn ?? false };
  const config = { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) } as unknown as SystemConfigService;
  const svc = new NotificationsService(
    prisma as unknown as PrismaService,
    { sendTemplate: jest.fn() } as unknown as ZnsClient,
    { recordBestEffort: record } as unknown as AnalyticsEventsService,
    { add, remove } as never,
    config,
  );
  const logs = (channel: string) => create.mock.calls.map((c) => c[0].data).filter((d) => d.channel === channel);
  const suppressed = () => record.mock.calls.map((c) => c[0]).filter((e) => e.eventName === 'notification_suppressed');
  return { svc, add, remove, queryRaw, updateMany, logs, suppressed };
}

describe('trần tin chủ động: cờ notify.proactive_cap_enabled tắt (mặc định)', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AT_1200_VN));
  afterEach(() => jest.useRealTimers());

  it('tin chủ động gửi ZNS như cũ: không đếm, không đánh dấu payload, không ghi notification_suppressed', async () => {
    const t = setup({ templateCode: 'CART_ABANDONED', usedToday: 99 });
    await t.svc.notify('u1', 'CART_ABANDONED', { product: 'X' });
    expect(t.logs('ZNS')).toHaveLength(1);
    expect(t.logs('ZNS')[0].payload).not.toHaveProperty('proactive');
    expect(t.queryRaw).not.toHaveBeenCalled();
    expect(t.suppressed()).toEqual([]);
    expect(t.add).toHaveBeenCalledTimes(1);
  });
});

describe('trần tin chủ động: cờ bật', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AT_1200_VN));
  afterEach(() => jest.useRealTimers());

  it('tin giao dịch không bao giờ bị trần, kể cả khi khách đã dùng hết lượt trong ngày', async () => {
    const t = setup({ templateCode: 'ORDER_CONFIRMED', capOn: true, usedToday: 5, usedWeek: 20 });
    await t.svc.notify('u1', 'ORDER_CONFIRMED', { order_code: 'T1' });
    expect(t.logs('ZNS')).toHaveLength(1);
    expect(t.logs('ZNS')[0].payload).not.toHaveProperty('proactive');
    expect(t.queryRaw).not.toHaveBeenCalled();
  });

  it('còn lượt: ghi log ZNS mang dấu ngày và nhóm, tăng bộ đếm', async () => {
    const t = setup({ templateCode: 'CART_ABANDONED', capOn: true });
    await t.svc.notify('u1', 'CART_ABANDONED', { product: 'X' });
    expect(t.logs('ZNS')[0].payload.proactive).toEqual({ dayKey: '2026-11-17', group: 'cart' });
    expect(t.queryRaw.mock.calls.some((c) => (c[0] as TemplateStringsArray).join('?').includes('INSERT INTO "notification_proactive_counters"'))).toBe(true);
  });

  it('hết lượt trong ngày: không ghi log ZNS, không xếp job; tin trong app vẫn lưu; ghi notification_suppressed lý do day_cap', async () => {
    const t = setup({ templateCode: 'CART_ABANDONED', capOn: true, usedToday: 1 });
    await t.svc.notify('u1', 'CART_ABANDONED', { product: 'X' });
    expect(t.logs('ZNS')).toEqual([]);
    expect(t.logs('INAPP')).toHaveLength(1);
    expect(t.add).not.toHaveBeenCalled();
    expect(t.suppressed()).toEqual([
      expect.objectContaining({ userId: 'u1', props: { templateCode: 'CART_ABANDONED', category: 'cart', reason: 'day_cap', channel: 'ZNS' } }),
    ]);
  });

  it('còn lượt ngày nhưng hết lượt tuần: lý do week_cap', async () => {
    const t = setup({ templateCode: 'REORDER_REMINDER', capOn: true, usedToday: 0, usedWeek: 4 });
    await t.svc.notify('u1', 'REORDER_REMINDER', { product: 'X' });
    expect(t.logs('ZNS')).toEqual([]);
    expect(t.suppressed()[0].props.reason).toBe('week_cap');
  });

  it('hết lượt nhưng có tin kém ưu tiên cùng ngày còn chờ: tin hàng về giành lượt, tin kia đóng FAILED kèm preemptedBy và gỡ job', async () => {
    const pending = [{ id: 'log-old', templateCode: 'COMMUNITY_POST_LIKED', sentAt: new Date(), payload: { data: {}, proactive: { dayKey: '2026-11-17', group: 'social' } } }];
    const t = setup({ templateCode: 'RESTOCK_AVAILABLE', capOn: true, usedToday: 1, pending });
    await t.svc.notify('u1', 'RESTOCK_AVAILABLE', { product: 'X' });
    expect(t.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'log-old', status: 'PENDING' },
        data: expect.objectContaining({ status: 'FAILED', payload: expect.objectContaining({ proactive: { dayKey: '2026-11-17', group: 'social', preemptedBy: 'RESTOCK_AVAILABLE' } }) }),
      }),
    );
    expect(t.remove).toHaveBeenCalledWith('zns-log-old');
    expect(t.logs('ZNS')).toHaveLength(1);
    expect(t.suppressed()).toEqual([expect.objectContaining({ props: expect.objectContaining({ templateCode: 'COMMUNITY_POST_LIKED', reason: 'preempted', category: 'social' }) })]);
  });

  it('tin cùng hoặc ưu tiên cao hơn đang chờ thì không bị giành: tin kém ưu tiên mới tới bị trần', async () => {
    const pending = [{ id: 'log-old', templateCode: 'CART_ABANDONED', sentAt: new Date(), payload: { data: {}, proactive: { dayKey: '2026-11-17', group: 'cart' } } }];
    const t = setup({ templateCode: 'COMMUNITY_POST_LIKED', capOn: true, usedToday: 1, pending });
    await t.svc.notify('u1', 'COMMUNITY_POST_LIKED', { actor: 'A' });
    expect(t.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'log-old', status: 'PENDING' } }));
    expect(t.logs('ZNS')).toEqual([]);
  });
});

describe('trần tin chủ động: ngày tính trần là ngày tin tới tay khách (giờ yên tĩnh 21:00–08:00)', () => {
  afterEach(() => jest.useRealTimers());

  it.each([
    ['20:59', '2026-11-17', AT_2059_VN],
    ['21:30 (dời sang 08:00 hôm sau)', '2026-11-18', AT_2130_VN],
    ['07:59 (dời sang 08:00 cùng ngày)', '2026-11-17', AT_0759_VN],
  ])('tin tạo lúc %s VN tính vào ngày %s', async (_label, dayKey, now) => {
    jest.useFakeTimers().setSystemTime(now);
    const t = setup({ templateCode: 'CART_ABANDONED', capOn: true });
    await t.svc.notify('u1', 'CART_ABANDONED', { product: 'X' });
    expect(t.logs('ZNS')[0].payload.proactive.dayKey).toBe(dayKey);
  });

  it('proactiveDayKey theo giờ VN, không theo UTC', () => {
    expect(proactiveDayKey(new Date('2026-11-17T16:59:00.000Z'))).toBe('2026-11-17');
    expect(proactiveDayKey(new Date('2026-11-17T17:00:00.000Z'))).toBe('2026-11-18');
  });
});

describe('deliverZns: log đã nhường lượt', () => {
  it('job tới hạn của log FAILED mang preemptedBy thì SKIPPED, không gọi Zalo', async () => {
    const sendTemplate = jest.fn();
    const payload = { data: {}, proactive: { dayKey: '2026-11-17', group: 'social', preemptedBy: 'RESTOCK_AVAILABLE' } };
    const prisma = {
      notificationLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ status: 'FAILED', payload }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    } as unknown as PrismaService;
    const svc = new NotificationsService(prisma, { sendTemplate } as unknown as ZnsClient, { recordBestEffort: jest.fn() } as never);
    const out = await svc.deliverZns({ notificationLogId: 'log-old', phone: '0900000000', templateId: 'zt-1', templateData: {} }, false);
    expect(out).toBe('SKIPPED');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(isPreemptedZnsLog(payload)).toBe(true);
    expect(isPreemptedZnsLog({ data: {}, proactive: { dayKey: '2026-11-17', group: 'social' } })).toBe(false);
  });
});
