import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { createUser, warmPool } from './helpers';

/**
 * C-022 / A1-009: công tắc "Khuyến mãi & mã giảm giá" trước đây chỉ lưu trên máy khách, server vẫn gửi.
 * Kiểm trên Postgres thật: cột mới có mặc định true cho khách cũ, tuỳ chọn lưu được, và notify()
 * không ghi tin khuyến mãi (cả trong app lẫn ZNS) cho khách đã tắt.
 */
describe('Tuỳ chọn thông báo khuyến mãi (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: NotificationsService;
  const sendTemplate = jest.fn().mockResolvedValue(true);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        { provide: AnalyticsEventsService, useValue: { recordBestEffort: jest.fn() } },
        { provide: ZnsClient, useValue: { sendTemplate } },
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
    svc = moduleRef.get(NotificationsService);
    await prisma.notificationTemplate.upsert({
      where: { code: 'CART_ABANDONED' },
      create: { id: 'it-cart-abandoned', code: 'CART_ABANDONED', channel: 'ZNS', zaloTemplateId: 'zt-it', bodyTemplate: 'Giỏ hàng' },
      update: {},
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const logsOf = (userId: string) => prisma.notificationLog.findMany({ where: { userId } });

  it('khách mới mặc định nhận cả hai nhóm tin', async () => {
    const u = await createUser(prisma);
    await expect(svc.getPrefs(u.id)).resolves.toEqual({ notifyPromo: true, notifyGarden: true });
  });

  it('tắt khuyến mãi → lưu DB, notify bỏ qua tin khuyến mãi nhưng vẫn gửi tin đơn hàng', async () => {
    sendTemplate.mockClear();
    const u = await createUser(prisma, { phone: `08${Date.now().toString().slice(-8)}` });
    await expect(svc.updatePrefs(u.id, { notifyPromo: false })).resolves.toEqual({
      notifyPromo: false,
      notifyGarden: true,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).notifyPromo).toBe(false);

    await svc.notify(u.id, 'CART_ABANDONED', {});
    expect(await logsOf(u.id)).toHaveLength(0);
    expect(sendTemplate).not.toHaveBeenCalled();

    await svc.notify(u.id, 'ORDER_CONFIRMED', { order_code: 'IT1' });
    const logs = await logsOf(u.id);
    expect(logs.map((l) => l.templateCode)).toEqual(['ORDER_CONFIRMED']);
  });

  it('bật lại → tin khuyến mãi gửi bình thường', async () => {
    const u = await createUser(prisma);
    await svc.updatePrefs(u.id, { notifyPromo: false });
    await svc.updatePrefs(u.id, { notifyPromo: true });
    await svc.notify(u.id, 'CART_ABANDONED', {});
    expect((await logsOf(u.id)).map((l) => l.templateCode)).toEqual(['CART_ABANDONED']);
  });
});
