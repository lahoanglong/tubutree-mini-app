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
import { startOfVnDay } from '../../src/common/vn-time';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/** Q22: đổi chu kỳ gói định kỳ đang chạy, tính lại ngày giao kế từ đơn kỳ gần nhất (real Postgres). */
const WEEK = 7 * 864e5;
const LATER = new Date(Date.now() + 7 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);

describe('Đổi chu kỳ gói định kỳ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let subs: SubscriptionsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        SubscriptionsService,
        WalletLedgerService,
        { provide: PricingService, useValue: {} },
        { provide: LoyaltyService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    subs = moduleRef.get(SubscriptionsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup() {
    const u = await createUser(prisma);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT Brand', slug: `it-sp-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, affiliateRate: 10, stock: 50 },
    });
    const addr = await prisma.address.create({
      data: {
        userId: u.id, recipient: 'Khach IT', phone: '0900000001', province: 'Ha Noi', district: '', ward: 'Phuong IT',
        street: '1 Duong IT', provinceCode: '84_VN01', districtCode: '', wardCode: '00001',
      },
    });
    const sub = await subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id, startDate: LATER });
    return { u, sub };
  }

  async function withLastOrder(userId: string, subId: string, createdAt: Date) {
    const order = await createOrder(prisma, { userId, createdAt });
    await prisma.subscription.update({ where: { id: subId }, data: { lastOrderId: order.id, nextRunAt: new Date(createdAt.getTime() + 4 * WEEK) } });
  }

  it('ACTIVE có đơn kỳ trước: ghi chu kỳ 6 và nextRunAt = 0h VN ngày đơn + 6 tuần', async () => {
    const { u, sub } = await setup();
    const lastOrderAt = new Date(Date.now() - 7 * 864e5);
    await withLastOrder(u.id, sub.id, lastOrderAt);

    await subs.update(u.id, sub.id, { intervalWeeks: 6 });

    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.intervalWeeks).toBe(6);
    expect(row.nextRunAt.toISOString()).toBe(new Date(startOfVnDay(lastOrderAt).getTime() + 6 * WEEK).toISOString());
    expect(row.status).toBe('ACTIVE');
  });

  it('chu kỳ ngắn lại làm mốc mới đã qua → 0h ngày mai giờ VN', async () => {
    const { u, sub } = await setup();
    await prisma.subscription.update({ where: { id: sub.id }, data: { intervalWeeks: 10 } });
    await withLastOrder(u.id, sub.id, new Date(Date.now() - 6 * WEEK));

    await subs.update(u.id, sub.id, { intervalWeeks: 4 });

    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.intervalWeeks).toBe(4);
    expect(row.nextRunAt.toISOString()).toBe(new Date(startOfVnDay().getTime() + 864e5).toISOString());
  });

  it('gói chưa ra đơn: giữ ngày bắt đầu, chỉ đổi chu kỳ', async () => {
    const { u, sub } = await setup();
    await subs.update(u.id, sub.id, { intervalWeeks: 10 });
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.intervalWeeks).toBe(10);
    expect(row.nextRunAt.toISOString()).toBe(sub.nextRunAt.toISOString());
  });

  it('đơn cron ghi lúc 03:00:00.200: đến ngày hẹn, đúng điều kiện quét của processDue (nextRunAt <= 03:00:00.010) vẫn bốc gói', async () => {
    const { u, sub } = await setup();
    const lastOrderAt = new Date(startOfVnDay().getTime() - 3 * 864e5 + 3 * 3600e3 + 200); // 03:00:00.200 giờ VN, 3 ngày trước
    await withLastOrder(u.id, sub.id, lastOrderAt);

    await subs.update(u.id, sub.id, { intervalWeeks: 6 });

    const cronStartOnDueDay = new Date(startOfVnDay(lastOrderAt).getTime() + 6 * WEEK + 3 * 3600e3 + 10);
    const picked = await prisma.subscription.findMany({
      where: { id: sub.id, status: 'ACTIVE', nextRunAt: { lte: cronStartOnDueDay } },
      select: { id: true },
    });
    expect(picked).toHaveLength(1);
    const dayBefore = await prisma.subscription.findMany({
      where: { id: sub.id, nextRunAt: { lte: new Date(cronStartOnDueDay.getTime() - 864e5) } },
      select: { id: true },
    });
    expect(dayBefore).toHaveLength(0);
  });

  it('gói PAUSED đổi chu kỳ rồi bật lại: nextRunAt theo đơn kỳ gần nhất + chu kỳ mới, không giữ ngày của chu kỳ cũ', async () => {
    const { u, sub } = await setup();
    const lastOrderAt = new Date(Date.now() - 6 * 864e5);
    await withLastOrder(u.id, sub.id, lastOrderAt);
    await subs.setStatus(u.id, sub.id, 'PAUSED');

    await subs.update(u.id, sub.id, { intervalWeeks: 10 });
    await subs.setStatus(u.id, sub.id, 'ACTIVE');

    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.status).toBe('ACTIVE');
    expect(row.intervalWeeks).toBe(10);
    expect(row.nextRunAt.toISOString()).toBe(new Date(startOfVnDay(lastOrderAt).getTime() + 10 * WEEK).toISOString());
  });

  it('hai lần đổi song song (6 và 8): chu kỳ và ngày giao kế luôn khớp một trong hai, không lẫn nhau', async () => {
    const { u, sub } = await setup();
    const lastOrderAt = new Date(Date.now() - 7 * 864e5);
    await withLastOrder(u.id, sub.id, lastOrderAt);

    await Promise.all([subs.update(u.id, sub.id, { intervalWeeks: 6 }), subs.update(u.id, sub.id, { intervalWeeks: 8 })]);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect([6, 8]).toContain(row.intervalWeeks);
    expect(row.nextRunAt.toISOString()).toBe(new Date(startOfVnDay(lastOrderAt).getTime() + row.intervalWeeks * WEEK).toISOString());
  });
});
