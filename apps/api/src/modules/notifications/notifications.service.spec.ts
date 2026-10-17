import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

function makePrisma(over: Record<string, unknown> = {}) {
  // create trả về id khác nhau mỗi lần gọi để test phân biệt được log INAPP vs log ZNS
  // qua notificationId khi assert recordBestEffort.
  let seq = 0;
  const create = jest.fn().mockImplementation(async () => ({ id: `log-${++seq}` }));
  const base = {
    notificationTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0900000000' }) },
    notificationLog: { create, findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({}) },
  };
  return { prisma: { ...base, ...over } as unknown as PrismaService, create };
}

function makeAnalytics() {
  return { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
}

describe('NotificationsService.notify', () => {
  /**
   * Thiếu template thì fallback CŨ in nguyên văn mã code cho khách — họ nhận được một thông báo
   * nội dung là "SUBSCRIPTION_ORDER_FAILED". Nay hiện câu tiếng Việt trung tính; mã code vẫn
   * được lưu ở templateCode để dò, và log warn để phát hiện template thiếu.
   */
  it('thiếu template → vẫn ghi INAPP log, nội dung là câu tiếng Việt chứ không phải mã code', async () => {
    const { prisma, create } = makePrisma();
    const zns = { sendTemplate: jest.fn() } as unknown as ZnsClient;
    const analytics = makeAnalytics();
    await new NotificationsService(prisma, zns, analytics).notify('u1', 'ORDER_CONFIRMED', { order_code: 'X1' });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.channel).toBe('INAPP');
    expect(data.templateCode).toBe('ORDER_CONFIRMED');
    expect(data.payload.body).not.toContain('ORDER_CONFIRMED');
    expect(data.payload.body.length).toBeGreaterThan(0);
    expect(zns.sendTemplate).not.toHaveBeenCalled();
    // notification_sent phải bắn cho nhánh INAPP (luôn chạy), dù thiếu template.
    expect(analytics.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'notification_sent',
        userId: 'u1',
        platform: 'system',
        notificationId: 'log-1',
        props: expect.objectContaining({ templateCode: 'ORDER_CONFIRMED', channel: 'INAPP' }),
      }),
    );
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
    const analytics = makeAnalytics();
    await new NotificationsService(prisma, zns, analytics).notify('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU9' });
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
    const sendTemplate = jest.fn().mockResolvedValue({ ok: true });
    const zns = { sendTemplate } as unknown as ZnsClient;
    const analytics = makeAnalytics();
    await new NotificationsService(prisma, zns, analytics).notify('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU9' });
    expect(sendTemplate).toHaveBeenCalledWith('0900000000', 'zt-123', { order_code: 'TUBU9' });
    // 2 log: INAPP + ZNS
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].data.channel).toBe('ZNS');
    expect(create.mock.calls[1][0].data.status).toBe('SENT');
    // notification_sent phải bắn 2 lần: 1 cho INAPP (luôn chạy), 1 cho ZNS (nhánh này có chạy).
    expect(analytics.recordBestEffort).toHaveBeenCalledTimes(2);
    expect(analytics.recordBestEffort).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventName: 'notification_sent',
        notificationId: 'log-1',
        props: expect.objectContaining({ channel: 'INAPP' }),
      }),
    );
    expect(analytics.recordBestEffort).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventName: 'notification_sent',
        userId: 'u1',
        platform: 'system',
        notificationId: 'log-2',
        props: expect.objectContaining({ templateCode: 'ORDER_CONFIRMED', channel: 'ZNS' }),
      }),
    );
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
    const analytics = makeAnalytics();
    await new NotificationsService(prisma, { sendTemplate } as unknown as ZnsClient, analytics).notify(
      'u1',
      'ORDER_CONFIRMED',
      {},
    );
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    // Không có phone → nhánh ZNS không chạy → chỉ bắn notification_sent 1 lần (INAPP).
    expect(analytics.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ props: expect.objectContaining({ channel: 'INAPP' }) }),
    );
  });

  it('ZNS gửi thất bại → log ZNS status FAILED kèm mã lỗi và lý do của Zalo', async () => {
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
    const failure = { ok: false, retryable: false, code: -124, reason: 'template not approved' };
    const zns = { sendTemplate: jest.fn().mockResolvedValue(failure) } as unknown as ZnsClient;
    const analytics = makeAnalytics();
    await new NotificationsService(prisma, zns, analytics).notify('u1', 'C', {});
    expect(create.mock.calls[1][0].data.status).toBe('FAILED');
    expect(create.mock.calls[1][0].data.error).toContain('-124');
    expect(create.mock.calls[1][0].data.error).toContain('template not approved');
    // Event notification_sent bắn cho ZNS vô điều kiện — status gửi thành công/thất bại đã nằm
    // trong NotificationLog.status riêng, không lẫn vào việc "event có xảy ra" hay không.
    expect(analytics.recordBestEffort).toHaveBeenCalledTimes(2);
    expect(analytics.recordBestEffort).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ props: expect.objectContaining({ channel: 'ZNS' }) }),
    );
  });
});

describe('NotificationsService.notify — gộp tin theo cửa sổ thời gian (dedupeWithinMs)', () => {
  const NOW = new Date('2026-10-17T10:00:00.000Z');
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  function build(seen: { id: string } | null, seenInTx: { id: string } | null = seen) {
    const findFirst = jest.fn().mockResolvedValue(seenInTx);
    const quickFindFirst = jest.fn().mockResolvedValue(seen);
    const create = jest.fn().mockResolvedValue({ id: 'log-1' });
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1), notificationLog: { findFirst, create } };
    const transaction = jest.fn((fn: (t: typeof tx) => unknown) => fn(tx));
    const templateFind = jest.fn().mockResolvedValue({ code: 'C', channel: 'INAPP', bodyTemplate: 'x', zaloTemplateId: null });
    const { prisma } = makePrisma({
      notificationTemplate: { findUnique: templateFind },
      notificationLog: { create: jest.fn(), findFirst: quickFindFirst, findMany: jest.fn(), updateMany: jest.fn() },
      $transaction: transaction,
    });
    const svc = new NotificationsService(prisma, { sendTemplate: jest.fn() } as unknown as ZnsClient, makeAnalytics());
    return { svc, findFirst, quickFindFirst, create, transaction, templateFind };
  }

  it('đã có tin cùng khoá trong cửa sổ → không ghi tin thứ hai', async () => {
    const { svc, findFirst, create } = build({ id: 'old' });

    await svc.notify('u1', 'C', {}, { dedupeKey: 'post-activity:p1', dedupeWithinMs: 3_600_000 });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          channel: 'INAPP',
          payload: { path: ['dedupeKey'], equals: 'post-activity:p1' },
          sentAt: { gte: new Date('2026-10-17T09:00:00.000Z') },
        }),
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('chưa có tin nào trong cửa sổ (tin cũ hơn cửa sổ không tính) → ghi tin mới kèm khoá', async () => {
    const { svc, create } = build(null);

    await svc.notify('u1', 'C', { a: 'b' }, { dedupeKey: 'post-activity:p1', dedupeWithinMs: 3_600_000 });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', templateCode: 'C', channel: 'INAPP', payload: { body: 'x', data: { a: 'b' }, dedupeKey: 'post-activity:p1' } }),
    });
  });

  it('không có dedupeWithinMs → hành vi cũ: khoá chặn vĩnh viễn, không lọc theo thời gian', async () => {
    const { svc, findFirst } = build(null);

    await svc.notify('u1', 'C', {}, { dedupeKey: 'referral:abc' });

    expect(findFirst.mock.calls[0][0].where).not.toHaveProperty('sentAt');
  });

  it.each([0, -5, Number.NaN])('dedupeWithinMs = %s không phải cửa sổ hợp lệ → chặn vĩnh viễn như khi bỏ trống', async (ms) => {
    const { svc, findFirst } = build(null);

    await svc.notify('u1', 'C', {}, { dedupeKey: 'referral:abc', dedupeWithinMs: ms });

    expect(findFirst.mock.calls[0][0].where).not.toHaveProperty('sentAt');
  });
});
