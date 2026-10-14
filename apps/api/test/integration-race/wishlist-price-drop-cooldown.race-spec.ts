import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { createUser, randCode, warmPool } from './helpers';

/**
 * ENGAGE-18 trên Postgres thật: cooldown đọc từ notification_logs bằng lọc JSON `payload.data.product_id`, ngưỡng
 * giảm tối thiểu chặn thông báo giá nhích nhẹ, và nội dung có giá cũ/mới qua mẫu PRICE_DROP_ALERT trong DB.
 */
describe('Báo giảm giá wishlist: cooldown và ngưỡng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let lifecycle: LifecycleService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LifecycleService,
        { provide: AnalyticsEventsService, useValue: { recordBestEffort: jest.fn() } },
        { provide: ZnsClient, useValue: { sendTemplate: jest.fn().mockResolvedValue({ ok: true }) } },
        {
          provide: NotificationsService,
          inject: [PrismaService, ZnsClient, AnalyticsEventsService],
          useFactory: (p: PrismaService, z: ZnsClient, a: AnalyticsEventsService) => new NotificationsService(p, z, a),
        },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    lifecycle = moduleRef.get(LifecycleService);
    await prisma.notificationTemplate.upsert({
      where: { code: 'PRICE_DROP_ALERT' },
      update: { bodyTemplate: '{{product}} bạn yêu thích đang giảm giá{{price_note}}! Xem ngay 💚' },
      create: {
        id: `it-pd-${randCode(6)}`,
        code: 'PRICE_DROP_ALERT',
        channel: 'INAPP',
        bodyTemplate: '{{product}} bạn yêu thích đang giảm giá{{price_note}}! Xem ngay 💚',
      },
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function product() {
    const tag = randCode(8);
    return prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT Brand', slug: `it-sp-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 100_000 },
    });
  }

  const alerts = (userId: string, productId: string) =>
    prisma.notificationLog.findMany({
      where: { userId, templateCode: 'PRICE_DROP_ALERT', payload: { path: ['data', 'product_id'], equals: productId } },
      orderBy: { sentAt: 'asc' },
    });

  it('lần đầu báo cả hai người, nội dung có giá cũ → mới; lần hai trong cooldown không báo lại', async () => {
    const [u1, u2, p] = await Promise.all([createUser(prisma), createUser(prisma), product()]);
    await prisma.wishlist.createMany({ data: [{ userId: u1.id, productId: p.id }, { userId: u2.id, productId: p.id }] });

    await lifecycle.notifyWishlistPriceDrop(p.id, p.name, { oldPrice: 120_000, newPrice: 99_000 });

    const first = await alerts(u1.id, p.id);
    expect(first).toHaveLength(1);
    expect((first[0]!.payload as { body: string }).body).toContain('từ 120.000đ xuống 99.000đ');
    expect(await alerts(u2.id, p.id)).toHaveLength(1);

    // Giá dao động 99 → 120 → 90: lần giảm sau trong cooldown 7 ngày không nhắc lại.
    await lifecycle.notifyWishlistPriceDrop(p.id, p.name, { oldPrice: 120_000, newPrice: 90_000 });
    expect(await alerts(u1.id, p.id)).toHaveLength(1);
    expect(await alerts(u2.id, p.id)).toHaveLength(1);
  });

  it('hết cooldown (log cũ hơn 7 ngày) → báo lại đúng người đó; sản phẩm khác không bị ảnh hưởng', async () => {
    const [u1, u2, p, other] = await Promise.all([createUser(prisma), createUser(prisma), product(), product()]);
    await prisma.wishlist.createMany({
      data: [
        { userId: u1.id, productId: p.id },
        { userId: u2.id, productId: p.id },
        { userId: u1.id, productId: other.id },
      ],
    });
    await lifecycle.notifyWishlistPriceDrop(p.id, p.name);
    await prisma.notificationLog.updateMany({
      where: { userId: u1.id, templateCode: 'PRICE_DROP_ALERT' },
      data: { sentAt: new Date(Date.now() - 8 * 864e5) },
    });

    await lifecycle.notifyWishlistPriceDrop(p.id, p.name);
    expect(await alerts(u1.id, p.id)).toHaveLength(2);
    expect(await alerts(u2.id, p.id)).toHaveLength(1);

    await lifecycle.notifyWishlistPriceDrop(other.id, other.name);
    expect(await alerts(u1.id, other.id)).toHaveLength(1);
  });

  it('giảm dưới ngưỡng 5% → không ai nhận thông báo', async () => {
    const [u1, p] = await Promise.all([createUser(prisma), product()]);
    await prisma.wishlist.create({ data: { userId: u1.id, productId: p.id } });

    await lifecycle.notifyWishlistPriceDrop(p.id, p.name, { oldPrice: 100_000, newPrice: 99_000 });

    expect(await alerts(u1.id, p.id)).toHaveLength(0);
  });
});
