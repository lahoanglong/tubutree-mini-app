import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { vnDateKey } from '../../src/common/vn-time';
import { createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * ENGAGE-14 trên Postgres thật: hết hàng đúng đêm cron không được làm gói 4-10 tuần mất cả kỳ (hẹn lại 0h ngày mai,
 * tối đa subscribe.stock_retry_days đêm), và quá 200 gói đến hạn thì phần dư vẫn được xử lý ngay trong lượt cron đó.
 */
describe('Gói định kỳ: thử lại khi hết hàng và quét nhiều trang (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let subs: SubscriptionsService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        WalletLedgerService,
        SubscriptionsService,
        {
          provide: PricingService,
          useValue: {
            calcShippingFee: jest.fn().mockResolvedValue(0),
            calcPointsEarned: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: LoyaltyService, useValue: { getTierMultiplier: jest.fn().mockResolvedValue(1) } },
        { provide: NotificationsService, useValue: { notify } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    // SystemConfigService cache 60s: ghi MỘT lần trước khi service đọc.
    await setConfig(prisma, 'subscribe.stock_retry_days', 2);
    subs = moduleRef.get(SubscriptionsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const tomorrowVn = () => new Date(`${vnDateKey(new Date(Date.now() + 864e5))}T00:00:00+07:00`);

  async function variation(stock: number) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT Brand', slug: `it-sp-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, affiliateRate: 10, stock },
    });
  }

  async function dueSubscription(variationId: string, over: { retryCount?: number } = {}) {
    const u = await createUser(prisma);
    const a = await prisma.address.create({
      data: {
        userId: u.id, recipient: 'Khach IT', phone: randomPhone(), province: 'Ha Noi', district: '', ward: 'Phuong IT',
        street: '1 Duong IT', provinceCode: '01', districtCode: '', wardCode: '00001',
      },
    });
    return prisma.subscription.create({
      data: {
        userId: u.id, variationId, addressId: a.id, quantity: 1, intervalWeeks: 4, paymentMethod: 'COD',
        nextRunAt: new Date(Date.now() - 60_000), retryCount: over.retryCount ?? 0,
      },
    });
  }

  it('hết hàng → hẹn 0h ngày mai + retryCount 1, không đơn, báo khách một lần; có hàng lại thì ra đơn và reset bộ đếm', async () => {
    const v = await variation(0);
    const sub = await dueSubscription(v.id);

    await subs.processDue();

    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.nextRunAt.toISOString()).toBe(tomorrowVn().toISOString());
    expect(after.retryCount).toBe(1);
    expect(after.status).toBe('ACTIVE');
    expect(await prisma.order.count({ where: { subscriptionId: sub.id } })).toBe(0);
    const failedNotices = notify.mock.calls.filter(([uid, code]) => uid === sub.userId && code === 'SUBSCRIPTION_ORDER_FAILED');
    expect(failedNotices).toHaveLength(1);

    // Đêm sau: hàng về.
    await prisma.variation.update({ where: { id: v.id }, data: { stock: 5 } });
    await prisma.subscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    await subs.processDue();

    const placed = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(await prisma.order.count({ where: { subscriptionId: sub.id } })).toBe(1);
    expect(placed.retryCount).toBe(0);
    const days = (placed.nextRunAt.getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(29);
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(4);
  });

  it('hết lượt thử lại (retryCount = trần) → bỏ kỳ: nextRunAt ở kỳ kế (~4 tuần), reset bộ đếm, báo ngày kỳ kế tiếp', async () => {
    const v = await variation(0);
    const sub = await dueSubscription(v.id, { retryCount: 2 });

    await subs.processDue();

    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.retryCount).toBe(0);
    const days = (after.nextRunAt.getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(29);
    const notice = notify.mock.calls.find(([uid, code]) => uid === sub.userId && code === 'SUBSCRIPTION_ORDER_FAILED');
    expect(notice?.[2].retry).toMatch(/kỳ kế tiếp ngày/);
  });

  it('hơn 200 gói đến hạn → mọi gói đều được xử lý trong cùng lượt cron (không dồn sang đêm sau)', async () => {
    const v = await variation(0);
    const created: string[] = [];
    for (let i = 0; i < 205; i += 5) {
      const batch = await Promise.all([0, 1, 2, 3, 4].map(() => dueSubscription(v.id)));
      created.push(...batch.map((s) => s.id));
    }

    await subs.processDue();

    const rows = await prisma.subscription.findMany({ where: { id: { in: created } }, select: { retryCount: true, nextRunAt: true } });
    expect(rows).toHaveLength(205);
    expect(rows.every((r) => r.retryCount === 1 && r.nextRunAt.getTime() > Date.now())).toBe(true);
  }, 120_000);
});
