import { SubscriptionUpcomingService, subscriptionUpcomingDedupeKey } from './subscription-upcoming.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

jest.mock('../../common/cron-leader/run-exclusive', () => ({
  runExclusive: jest.fn(async (_p: unknown, _k: string, fn: () => Promise<unknown>) => ({ acquired: true, value: await fn() })),
}));

const VARIATION = { id: 'v1', isActive: true, product: { name: 'Nước giặt Tubu', isActive: true, approvalStatus: 'APPROVED' } };

function setup(opts: { template?: boolean; subs?: unknown[][]; variations?: unknown[]; notifyOk?: boolean } = {}) {
  const pages = [...(opts.subs ?? [[]])];
  const findMany = jest.fn(async () => pages.shift() ?? []);
  const prisma = {
    notificationTemplate: { findUnique: jest.fn().mockResolvedValue(opts.template === false ? null : { id: 'nt-sub-upcoming' }) },
    subscription: { findMany },
    variation: { findMany: jest.fn().mockResolvedValue(opts.variations ?? [VARIATION]) },
  } as unknown as PrismaService;
  const notifySafe = jest.fn().mockResolvedValue(opts.notifyOk ?? true);
  const svc = new SubscriptionUpcomingService(prisma, { notifySafe } as unknown as NotificationsService);
  return { svc, findMany, notifySafe, prisma };
}

describe('SubscriptionUpcomingService (nhắc 09:00 hôm trước kỳ giao)', () => {
  // 09:00 VN 24/11/2026 = 02:00Z.
  const now = new Date('2026-11-24T02:00:00.000Z');
  const tomorrowVn = new Date('2026-11-24T17:00:00.000Z'); // 00:00 VN 25/11

  it('chỉ quét gói ACTIVE, không đang thử lại, có kỳ giao trong NGÀY MAI giờ VN [0h, 24h)', async () => {
    const { svc, findMany } = setup();
    await svc.nudgeUpcoming(now);
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toEqual({ status: 'ACTIVE', retryCount: 0, nextRunAt: { gte: tomorrowVn, lt: new Date('2026-11-25T17:00:00.000Z') } });
  });

  it('gửi SUBSCRIPTION_UPCOMING với tên sản phẩm, ngày giao dd/mm/yyyy và khoá sub_upcoming:<gói>:<ngày VN>', async () => {
    const { svc, notifySafe } = setup({ subs: [[{ id: 's1', userId: 'u1', variationId: 'v1', nextRunAt: tomorrowVn }]] });
    await expect(svc.nudgeUpcoming(now)).resolves.toEqual({ due: 1, sent: 1, notSellable: 0, failed: 0 });
    expect(notifySafe).toHaveBeenCalledWith(
      'u1',
      'SUBSCRIPTION_UPCOMING',
      { product: 'Nước giặt Tubu', date: '25/11/2026' },
      { dedupeKey: 'sub_upcoming:s1:2026-11-25' },
      'sub=s1',
    );
  });

  it('khoá chống trùng theo ngày giao giờ VN: gói hẹn giờ lẻ cùng ngày cho cùng khoá', () => {
    expect(subscriptionUpcomingDedupeKey('s1', new Date('2026-11-25T07:23:00.000Z'))).toBe('sub_upcoming:s1:2026-11-25');
    expect(subscriptionUpcomingDedupeKey('s1', new Date('2026-11-25T17:00:00.000Z'))).toBe('sub_upcoming:s1:2026-11-26');
  });

  it('sản phẩm đã ngừng bán: không nhắc "sẽ tự đặt đơn" (đêm đó cron tạm dừng gói và báo riêng)', async () => {
    const { svc, notifySafe } = setup({
      subs: [[{ id: 's1', userId: 'u1', variationId: 'v1', nextRunAt: tomorrowVn }]],
      variations: [{ ...VARIATION, product: { ...VARIATION.product, isActive: false } }],
    });
    await expect(svc.nudgeUpcoming(now)).resolves.toMatchObject({ due: 1, sent: 0, notSellable: 1 });
    expect(notifySafe).not.toHaveBeenCalled();
  });

  it('hàng gian hàng đối tác: không nhắc (cron tạm dừng gói vì gói định kỳ chỉ nhận hàng Tubu)', async () => {
    const { svc, notifySafe } = setup({
      subs: [[{ id: 's1', userId: 'u1', variationId: 'v1', nextRunAt: tomorrowVn }]],
      variations: [{ ...VARIATION, product: { ...VARIATION.product, storefrontId: 'sf1' } }],
    });
    await expect(svc.nudgeUpcoming(now)).resolves.toMatchObject({ due: 1, sent: 0, notSellable: 1 });
    expect(notifySafe).not.toHaveBeenCalled();
  });

  it('DB chưa có mẫu tin (chưa chạy seed:reference): không quét, không gửi câu trung tính', async () => {
    const { svc, findMany, notifySafe } = setup({ template: false });
    await expect(svc.nudgeUpcoming(now)).resolves.toEqual({ skipped: 'NO_TEMPLATE' });
    expect(findMany).not.toHaveBeenCalled();
    expect(notifySafe).not.toHaveBeenCalled();
  });

  it('quét theo trang bằng con trỏ id; trang ngắn hơn PAGE thì dừng', async () => {
    const full = Array.from({ length: SubscriptionUpcomingService.PAGE }, (_, i) => ({ id: `s${String(i).padStart(4, '0')}`, userId: 'u1', variationId: 'v1', nextRunAt: tomorrowVn }));
    const { svc, findMany } = setup({ subs: [full, [{ id: 's9999', userId: 'u2', variationId: 'v1', nextRunAt: tomorrowVn }]] });
    await expect(svc.nudgeUpcoming(now)).resolves.toMatchObject({ due: SubscriptionUpcomingService.PAGE + 1 });
    expect(findMany).toHaveBeenCalledTimes(2);
    const second = (findMany.mock.calls[1] as unknown as [{ where: { id?: unknown } }])[0].where;
    expect(second.id).toEqual({ gt: full[full.length - 1]!.id });
  });

  it('gửi lỗi một gói (notifySafe trả false): đếm failed, gói sau vẫn được nhắc', async () => {
    const { svc, notifySafe } = setup({
      subs: [[
        { id: 's1', userId: 'u1', variationId: 'v1', nextRunAt: tomorrowVn },
        { id: 's2', userId: 'u2', variationId: 'v1', nextRunAt: tomorrowVn },
      ]],
    });
    notifySafe.mockResolvedValueOnce(false);
    await expect(svc.nudgeUpcoming(now)).resolves.toEqual({ due: 2, sent: 1, notSellable: 0, failed: 1 });
  });
});
