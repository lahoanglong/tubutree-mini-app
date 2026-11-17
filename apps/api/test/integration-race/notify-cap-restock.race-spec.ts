import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RestockAlertsService } from '../../src/modules/restock-alerts/restock-alerts.service';
import { RESTOCK_ROUND_COOLDOWN_MS, RestockAlertsDispatcher } from '../../src/modules/restock-alerts/restock-alerts.dispatcher';
import { createUser, deleteItData, randCode, uniquePhone, warmPool } from './helpers';

/**
 * Trần tin chủ động ngoài app, báo hàng về và công tắc tương tác bài viết trên Postgres THẬT (wave tubu-notify-cap-restock mục 8).
 * Hàng đợi ZNS giả (chỉ ghi lại job), Zalo không bao giờ được gọi vì có hàng đợi; giờ yên tĩnh tắt để kết quả không phụ thuộc giờ chạy.
 */
describe('notify cap + restock alerts (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const productIds: string[] = [];

  const values: Record<string, unknown> = {
    'notify.proactive_cap_enabled': true,
    'notify.proactive_per_day': 1,
    'notify.proactive_per_week': 4,
    'catalog.restock_alert_enabled': true,
    // Giờ yên tĩnh 0–0 = không có; trần khuyến mãi tháng 0 = tắt, để chỉ trần tin chủ động quyết định.
    'notifications.zns_quiet_start_hour': 0,
    'notifications.zns_quiet_end_hour': 0,
    'notifications.zns_promo_monthly_cap': 0,
  };
  const config = { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) } as unknown as SystemConfigService;
  const add = jest.fn(async () => ({}));
  const remove = jest.fn(async () => 1);
  const sendTemplate = jest.fn();
  const recordBestEffort = jest.fn(async () => undefined);
  let notifications: NotificationsService;
  let restock: RestockAlertsService;
  let dispatcher: RestockAlertsDispatcher;

  async function customer(extra: Record<string, unknown> = {}) {
    const u = await createUser(prisma, { phone: uniquePhone(), notifyPromo: true, notifyGarden: true, ...extra });
    userIds.push(u.id);
    return u;
  }

  async function outOfStockVariations(n: number) {
    const tag = randCode(6);
    const product = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itrs-${tag.toLowerCase()}`,
        name: `Hàng về ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: {
          create: Array.from({ length: n }, (_, i) => ({ sku: `ITRS-${tag}-${i}`, name: `Loại ${i}`, attributes: {}, retailPrice: 100_000, stock: 0 })),
        },
      },
      include: { variations: { orderBy: { sku: 'asc' } } },
    });
    productIds.push(product.id);
    return product.variations.map((v) => v.id);
  }

  const setStock = (variationId: string, stock: number) => prisma.variation.update({ where: { id: variationId }, data: { stock } });
  const znsLogs = (userId: string) => prisma.notificationLog.findMany({ where: { userId, channel: 'ZNS' }, orderBy: { sentAt: 'asc' } });
  const inAppCount = (userId: string, templateCode: string) => prisma.notificationLog.count({ where: { userId, channel: 'INAPP', templateCode } });
  const suppressedFor = (userId: string) =>
    (recordBestEffort.mock.calls as unknown as Array<[{ eventName: string; userId: string; props: Record<string, string> }]>)
      .map((c) => c[0])
      .filter((e) => e.eventName === 'notification_suppressed' && e.userId === userId);
  /** Mốc cron hơi sau đồng hồ DB, để đăng ký vừa ghi chắc chắn thuộc đợt mở lúc này. */
  const tick = () => new Date(Date.now() + 5_000);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    notifications = new NotificationsService(
      prisma,
      { sendTemplate } as unknown as ZnsClient,
      { recordBestEffort } as unknown as AnalyticsEventsService,
      { add, remove } as never,
      config,
    );
    restock = new RestockAlertsService(prisma, config);
    dispatcher = new RestockAlertsDispatcher(prisma, restock, notifications);
  });

  beforeEach(() => {
    values['notify.proactive_cap_enabled'] = true;
    add.mockClear();
    remove.mockClear();
    recordBestEffort.mockClear();
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await prisma.$disconnect();
  });

  describe('trần tin chủ động', () => {
    it('10 tin chủ động song song cho một khách: đúng 1 ZNS, 9 bị trần (notification_suppressed), cả 10 tin trong app', async () => {
      const u = await customer();
      await Promise.all(Array.from({ length: 10 }, (_, i) => notifications.notify(u.id, 'CART_ABANDONED', { product: `SP ${i}` }, { znsTemplateId: 'zt-it' })));
      expect(await znsLogs(u.id)).toHaveLength(1);
      expect(await inAppCount(u.id, 'CART_ABANDONED')).toBe(10);
      const suppressed = suppressedFor(u.id);
      expect(suppressed).toHaveLength(9);
      expect(suppressed.every((e) => e.props.reason === 'day_cap' && e.props.category === 'cart')).toBe(true);
      const counters = await prisma.notificationProactiveCounter.findMany({ where: { userId: u.id } });
      expect(counters.map((c) => c.count)).toEqual([1]);
      expect(add).toHaveBeenCalledTimes(1);
      expect(sendTemplate).not.toHaveBeenCalled();
    });

    it('tin giao dịch không bao giờ bị trần: khách đã hết lượt vẫn nhận đủ 5 tin đơn song song qua ZNS', async () => {
      const u = await customer();
      await notifications.notify(u.id, 'REORDER_REMINDER', { product: 'SP' }, { znsTemplateId: 'zt-it' });
      await Promise.all(Array.from({ length: 5 }, (_, i) => notifications.notify(u.id, 'ORDER_CONFIRMED', { order_code: `T${i}` }, { znsTemplateId: 'zt-it' })));
      const logs = await znsLogs(u.id);
      expect(logs.filter((l) => l.templateCode === 'ORDER_CONFIRMED')).toHaveLength(5);
      expect(logs.filter((l) => l.templateCode === 'ORDER_CONFIRMED').every((l) => !(l.payload as Record<string, unknown>).proactive)).toBe(true);
    });

    it('ưu tiên: tin hàng về giành lượt của tin tương tác đang chờ; tin kia đóng FAILED kèm preemptedBy, job bị gỡ, bộ đếm giữ 1', async () => {
      const u = await customer();
      await notifications.notify(u.id, 'COMMUNITY_POST_LIKED', { title: 'Bài A' }, { znsTemplateId: 'zt-it' });
      const [social] = await znsLogs(u.id);
      expect(social!.status).toBe('PENDING');
      await notifications.notify(u.id, 'RESTOCK_AVAILABLE', { product: 'SP' }, { znsTemplateId: 'zt-it' });
      const logs = await znsLogs(u.id);
      const closed = logs.find((l) => l.id === social!.id)!;
      expect(closed.status).toBe('FAILED');
      expect((closed.payload as { proactive: { preemptedBy?: string } }).proactive.preemptedBy).toBe('RESTOCK_AVAILABLE');
      expect(logs.filter((l) => l.status === 'PENDING').map((l) => l.templateCode)).toEqual(['RESTOCK_AVAILABLE']);
      expect(remove).toHaveBeenCalledWith(`zns-${social!.id}`);
      expect(suppressedFor(u.id).map((e) => e.props.reason)).toEqual(['preempted']);
      const counters = await prisma.notificationProactiveCounter.findMany({ where: { userId: u.id } });
      expect(counters.map((c) => c.count)).toEqual([1]);
      // Job tới hạn của log đã nhường lượt (nếu gỡ job không được) không gọi Zalo.
      const outcome = await notifications.deliverZns({ notificationLogId: social!.id, phone: u.phone!, templateId: 'zt-it', templateData: {} }, false);
      expect(outcome).toBe('SKIPPED');
      expect(sendTemplate).not.toHaveBeenCalled();
      // Tin kém ưu tiên hơn tới sau không giành lại được lượt.
      await notifications.notify(u.id, 'CART_ABANDONED', { product: 'SP' }, { znsTemplateId: 'zt-it' });
      expect((await znsLogs(u.id)).filter((l) => l.status === 'PENDING').map((l) => l.templateCode)).toEqual(['RESTOCK_AVAILABLE']);
    });

    it('1 tin hàng về và 5 tin tương tác song song: cuối cùng chỉ một ZNS chờ gửi và đó là tin hàng về', async () => {
      const u = await customer();
      await Promise.all([
        ...Array.from({ length: 5 }, (_, i) => notifications.notify(u.id, 'COMMUNITY_POST_COMMENTED', { title: `Bài ${i}`, author: 'B' }, { znsTemplateId: 'zt-it' })),
        notifications.notify(u.id, 'RESTOCK_AVAILABLE', { product: 'SP' }, { znsTemplateId: 'zt-it' }),
      ]);
      const pending = (await znsLogs(u.id)).filter((l) => l.status === 'PENDING');
      expect(pending.map((l) => l.templateCode)).toEqual(['RESTOCK_AVAILABLE']);
      const counters = await prisma.notificationProactiveCounter.findMany({ where: { userId: u.id } });
      expect(counters.map((c) => c.count)).toEqual([1]);
    });

    it('cờ tắt: tin chủ động gửi ZNS như trước, không đếm', async () => {
      values['notify.proactive_cap_enabled'] = false;
      const u = await customer();
      await Promise.all(Array.from({ length: 3 }, () => notifications.notify(u.id, 'CART_ABANDONED', { product: 'SP' }, { znsTemplateId: 'zt-it' })));
      expect(await znsLogs(u.id)).toHaveLength(3);
      expect(await prisma.notificationProactiveCounter.count({ where: { userId: u.id } })).toBe(0);
    });
  });

  describe('báo hàng về', () => {
    it('đăng ký song song cùng biến thể: đúng một dòng chờ, mọi lần bấm đều trả đã đăng ký', async () => {
      const u = await customer();
      const [v] = await outOfStockVariations(1);
      const results = await Promise.all(Array.from({ length: 10 }, () => restock.subscribe(u.id, v!)));
      expect(results.every((r) => r.subscribed)).toBe(true);
      expect(await prisma.restockAlert.count({ where: { userId: u.id, variationId: v!, notifiedAt: null } })).toBe(1);
    });

    it('trần 20 đăng ký đang chờ mỗi khách, kể cả khi bấm song song ở nhiều biến thể', async () => {
      const u = await customer();
      const vs = await outOfStockVariations(25);
      for (const v of vs.slice(0, 19)) await restock.subscribe(u.id, v);
      const results = await Promise.allSettled(vs.slice(19, 24).map((v) => restock.subscribe(u.id, v)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof ConflictException)).toBe(true);
      expect(await prisma.restockAlert.count({ where: { userId: u.id, notifiedAt: null } })).toBe(20);
      await expect(restock.subscribe(u.id, vs[24]!)).rejects.toBeInstanceOf(ConflictException);
    });

    it('biến thể đang có hàng: không nhận đăng ký; huỷ chỉ xoá đăng ký đang chờ', async () => {
      const u = await customer();
      const [v] = await outOfStockVariations(1);
      await setStock(v!, 3);
      await expect(restock.subscribe(u.id, v!)).rejects.toBeInstanceOf(ConflictException);
      await setStock(v!, 0);
      await restock.subscribe(u.id, v!);
      const product = await prisma.variation.findUniqueOrThrow({ where: { id: v! }, select: { productId: true } });
      expect((await restock.status(product.productId, u.id)).variationIds).toEqual([v]);
      await restock.unsubscribe(u.id, v!);
      expect((await restock.status(product.productId, u.id)).variationIds).toEqual([]);
    });

    it('120 khách chờ một biến thể: một đợt, 100 tin lượt đầu, 20 tin lượt sau, mỗi khách đúng một tin', async () => {
      const [v] = await outOfStockVariations(1);
      const us = await Promise.all(Array.from({ length: 120 }, () => customer()));
      for (const u of us) await restock.subscribe(u.id, v!);
      await setStock(v!, 5);
      expect(await dispatcher.dispatchOnce(tick())).toBe(100);
      expect(await dispatcher.dispatchOnce(tick())).toBe(20);
      expect(await dispatcher.dispatchOnce(tick())).toBe(0);
      expect(await prisma.restockAlertRound.count({ where: { variationId: v! } })).toBe(1);
      const perUser = await prisma.notificationLog.groupBy({
        by: ['userId'],
        where: { userId: { in: us.map((u) => u.id) }, templateCode: 'RESTOCK_AVAILABLE', channel: 'INAPP' },
        _count: { _all: true },
      });
      expect(perUser).toHaveLength(120);
      expect(perUser.every((r) => r._count._all === 1)).toBe(true);
      expect(await prisma.restockAlert.count({ where: { variationId: v!, notifiedAt: null } })).toBe(0);
    });

    it('hai lượt cron chạy song song: không khách nào nhận hai tin', async () => {
      const [v] = await outOfStockVariations(1);
      const us = await Promise.all(Array.from({ length: 30 }, () => customer()));
      for (const u of us) await restock.subscribe(u.id, v!);
      await setStock(v!, 2);
      const now = tick();
      const [a, b] = await Promise.all([dispatcher.dispatchOnce(now), dispatcher.dispatchOnce(now)]);
      expect(a + b).toBe(30);
      expect(await prisma.notificationLog.count({ where: { userId: { in: us.map((u) => u.id) }, templateCode: 'RESTOCK_AVAILABLE' } })).toBe(30);
      expect(await prisma.restockAlertRound.count({ where: { variationId: v! } })).toBe(1);
    });

    it('tồn dao động 0→5→0→5 trong 24 giờ: một đợt; khách đăng ký sau đợt đầu chờ đợt sau 24 giờ', async () => {
      const [v] = await outOfStockVariations(1);
      const a = await customer();
      const b = await customer();
      await restock.subscribe(a.id, v!);
      await setStock(v!, 5);
      const first = tick();
      expect(await dispatcher.dispatchOnce(first)).toBe(1);
      await setStock(v!, 0);
      await restock.subscribe(b.id, v!);
      await prisma.restockAlert.updateMany({ where: { userId: b.id, variationId: v! }, data: { createdAt: new Date(first.getTime() + 60_000) } });
      await setStock(v!, 5);
      expect(await dispatcher.dispatchOnce(new Date(first.getTime() + 2 * 3_600_000))).toBe(0);
      expect(await prisma.restockAlertRound.count({ where: { variationId: v! } })).toBe(1);
      expect(await inAppCount(b.id, 'RESTOCK_AVAILABLE')).toBe(0);
      expect(await dispatcher.dispatchOnce(new Date(first.getTime() + RESTOCK_ROUND_COOLDOWN_MS + 60_000))).toBe(1);
      expect(await prisma.restockAlertRound.count({ where: { variationId: v! } })).toBe(2);
      expect(await inAppCount(a.id, 'RESTOCK_AVAILABLE')).toBe(1);
      expect(await inAppCount(b.id, 'RESTOCK_AVAILABLE')).toBe(1);
    });

    it('hàng hết lại trước lúc nhận đăng ký: không gửi, đăng ký vẫn chờ', async () => {
      const [v] = await outOfStockVariations(1);
      const u = await customer();
      await restock.subscribe(u.id, v!);
      await setStock(v!, 1);
      // Đợt đã mở từ lượt trước (tồn lúc đó > 0), nay hàng hết đúng lúc cron nhận dòng.
      await prisma.restockAlertRound.create({ data: { variationId: v!, startedAt: tick(), stockAtStart: 1 } });
      const realQuery = prisma.$transaction.bind(prisma);
      const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(async (...args: unknown[]) => {
        await setStock(v!, 0);
        return (realQuery as (...a: unknown[]) => unknown)(...args);
      });
      expect(await dispatcher.dispatchOnce(tick())).toBe(0);
      spy.mockRestore();
      expect(await prisma.restockAlert.count({ where: { userId: u.id, variationId: v!, notifiedAt: null } })).toBe(1);
      expect(await inAppCount(u.id, 'RESTOCK_AVAILABLE')).toBe(0);
    });

    it('gửi lỗi: đăng ký trả về chờ để lượt sau gửi lại', async () => {
      const [v] = await outOfStockVariations(1);
      const u = await customer();
      await restock.subscribe(u.id, v!);
      await setStock(v!, 1);
      const failing = new RestockAlertsDispatcher(prisma, restock, { notifySafe: async () => false } as unknown as NotificationsService);
      expect(await failing.dispatchOnce(tick())).toBe(0);
      expect(await prisma.restockAlert.count({ where: { userId: u.id, variationId: v!, notifiedAt: null } })).toBe(1);
      expect(await dispatcher.dispatchOnce(tick())).toBe(1);
      expect(await inAppCount(u.id, 'RESTOCK_AVAILABLE')).toBe(1);
    });

    it('cờ tắt: không nhận đăng ký mới', async () => {
      values['catalog.restock_alert_enabled'] = false;
      try {
        const u = await customer();
        const [v] = await outOfStockVariations(1);
        await expect(restock.subscribe(u.id, v!)).rejects.toThrow();
        expect(await restock.status('any', u.id)).toEqual({ enabled: false, variationIds: [] });
      } finally {
        values['catalog.restock_alert_enabled'] = true;
      }
    });
  });

  describe('migration điền notifySocial', () => {
    it('theo notifyGarden của từng khách, không ghi đè khách đã tự đổi công tắc mới, chạy lại không đổi gì', async () => {
      const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261117090000_notify_cap_restock/migration.sql'), 'utf-8');
      const fill = /UPDATE "users" SET "notifySocial" = "notifyGarden"[\s\S]*?;/.exec(sql)?.[0];
      expect(fill).toBeDefined();
      const legacyOff = await customer({ notifyGarden: false, notifySocial: true });
      const chose = await customer({ notifyGarden: false, notifySocial: true, notifySocialAt: new Date(), notifySocialSource: 'settings', notifySocialTextVersion: 'v2' });
      const legacyOn = await customer({ notifyGarden: true, notifySocial: true });
      const read = async () =>
        (await prisma.user.findMany({ where: { id: { in: [legacyOff.id, chose.id, legacyOn.id] } }, select: { id: true, notifySocial: true } }))
          .sort((x, y) => [legacyOff.id, chose.id, legacyOn.id].indexOf(x.id) - [legacyOff.id, chose.id, legacyOn.id].indexOf(y.id))
          .map((r) => r.notifySocial);
      await prisma.$executeRawUnsafe(fill!);
      expect(await read()).toEqual([false, true, true]);
      expect(await prisma.$executeRawUnsafe(fill!.replace(';', ` AND "id" IN ('${legacyOff.id}', '${chose.id}', '${legacyOn.id}');`))).toBe(0);
      expect(await read()).toEqual([false, true, true]);
    });

    it('ràng buộc nguồn đồng ý: nguồn lạ bị DB từ chối', async () => {
      const u = await customer();
      await expect(prisma.user.update({ where: { id: u.id }, data: { notifyPromoSource: 'hacker' } })).rejects.toThrow();
    });
  });
});
