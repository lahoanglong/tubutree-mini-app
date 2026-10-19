import { AnalyticsEventsService } from './analytics-events.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AnalyticsEventsService.record', () => {
  it('ghi đủ 13 trường vào tx.analyticsEvent.create, tự sinh eventId nếu không truyền', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { analyticsEvent: { create } } as unknown as PrismaService;
    const svc = new AnalyticsEventsService({} as PrismaService);

    await svc.record(tx, {
      eventName: 'order_placed',
      userId: 'u1',
      platform: 'miniapp',
      props: { orderId: 'o1' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0].data;
    expect(arg.eventName).toBe('order_placed');
    expect(arg.userId).toBe('u1');
    expect(arg.platform).toBe('miniapp');
    expect(arg.props).toEqual({ orderId: 'o1' });
    expect(typeof arg.eventId).toBe('string');
    expect(arg.eventId.length).toBeGreaterThan(10);
    expect(arg.anonymousId).toBeNull();
    expect(arg.occurredAt).toBeInstanceOf(Date);
  });

  it('ghi nguồn và chiến dịch của phiên (null khi vắng)', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { analyticsEvent: { create } } as unknown as PrismaService;
    const svc = new AnalyticsEventsService({} as PrismaService);

    await svc.record(tx, { eventName: 'app_opened', platform: 'miniapp', entrySource: 'card-2610', campaign: 'hop-hang' });
    await svc.record(tx, { eventName: 'app_opened', platform: 'miniapp' });

    expect(create.mock.calls[0][0].data).toMatchObject({ entrySource: 'card-2610', campaign: 'hop-hang' });
    expect(create.mock.calls[1][0].data).toMatchObject({ entrySource: null, campaign: null });
  });

  it('dùng eventId truyền vào nếu có, không tự sinh mới', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { analyticsEvent: { create } } as unknown as PrismaService;
    const svc = new AnalyticsEventsService({} as PrismaService);

    await svc.record(tx, { eventId: 'fixed-id', eventName: 'app_opened', platform: 'miniapp' });

    expect(create.mock.calls[0][0].data.eventId).toBe('fixed-id');
  });
});

describe('AnalyticsEventsService.recordBestEffort', () => {
  it('lỗi khi ghi DB bị nuốt, không throw ra ngoài', async () => {
    const create = jest.fn().mockRejectedValue(new Error('DB down'));
    const prisma = { analyticsEvent: { create } } as unknown as PrismaService;
    const svc = new AnalyticsEventsService(prisma);

    await expect(
      svc.recordBestEffort({ eventName: 'client_error', platform: 'miniapp' }),
    ).resolves.toBeUndefined();
  });
});

describe('AnalyticsEventsService.recordMany / recordManyBestEffort', () => {
  it('lô rỗng không chạm DB', async () => {
    const createMany = jest.fn();
    const svc = new AnalyticsEventsService({ analyticsEvent: { createMany } } as unknown as PrismaService);
    await svc.recordManyBestEffort([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('recordMany dùng tx truyền vào, tự sinh eventId khi thiếu và bỏ qua eventId trùng', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const tx = { analyticsEvent: { createMany } } as unknown as PrismaService;
    const svc = new AnalyticsEventsService({} as PrismaService);
    await svc.recordMany(tx, [
      { eventId: 'a', eventName: 'add_to_cart', platform: 'miniapp' },
      { eventName: 'add_to_cart', platform: 'miniapp' },
    ]);
    const arg = createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0].eventId).toBe('a');
    expect(typeof arg.data[1].eventId).toBe('string');
  });
});
