import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { GroupBuyService } from '../../src/modules/groupbuy/groupbuy.service';
import { createUser, randCode, warmPool } from './helpers';

/**
 * R2-ENGAGE-10: nhóm mua chung hết hạn chuyển FAILED phải báo mọi thành viên, đúng MỘT lần dù cron chạy chồng nhau
 * (hai instance hoặc hai lần quét trùng giờ).
 */
describe('Nhóm mua chung hết hạn báo thành viên (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let groupBuy: GroupBuyService;
  const tag = randCode(6).toLowerCase();
  let productId = '';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        GroupBuyService,
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
    groupBuy = moduleRef.get(GroupBuyService);
    const product = await prisma.product.create({
      data: { brand: 'IT Brand', slug: `it-gb-${tag}`, name: `Nước rửa chén IT ${tag}`, description: 'IT', basePrice: 100_000, approvalStatus: 'APPROVED' },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.groupBuy.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await moduleRef?.close();
  });

  async function expiredGroup(memberCount: number, over: { expiresAt?: Date } = {}) {
    const users = await Promise.all(Array.from({ length: memberCount }, () => createUser(prisma)));
    const group = await prisma.groupBuy.create({
      data: {
        productId,
        initiatorId: users[0]!.id,
        targetSize: 5,
        currentSize: memberCount,
        unitPrice: 85_000,
        basePrice: 100_000,
        expiresAt: over.expiresAt ?? new Date(Date.now() - 60_000),
        members: { create: users.map((u) => ({ userId: u.id })) },
      },
    });
    return { group, users };
  }
  const notices = (userId: string) => prisma.notificationLog.findMany({ where: { userId, templateCode: 'GROUP_BUY_FAILED' } });

  it('nhóm quá hạn → FAILED và mỗi thành viên (kể cả người mở nhóm) nhận đúng một thông báo nêu tên sản phẩm', async () => {
    const { group, users } = await expiredGroup(3);

    await groupBuy.expireGroups();

    expect((await prisma.groupBuy.findUniqueOrThrow({ where: { id: group.id } })).status).toBe('FAILED');
    for (const u of users) {
      const rows = await notices(u.id);
      expect(rows).toHaveLength(1);
      const payload = rows[0]!.payload as { body: string; data: { product_slug: string } };
      expect(payload.body).toContain(`Nước rửa chén IT ${tag}`);
      expect(payload.data.product_slug).toBe(`it-gb-${tag}`);
    }
  });

  it('hai lần quét chạy chồng nhau → vẫn một thông báo/người', async () => {
    const { users } = await expiredGroup(2);

    await Promise.all([groupBuy.expireGroups(), groupBuy.expireGroups(), groupBuy.expireGroups()]);

    for (const u of users) expect(await notices(u.id)).toHaveLength(1);
  });

  it('nhóm còn hạn hoặc đã SUCCESS không bị đóng và không ai bị báo', async () => {
    const live = await expiredGroup(2, { expiresAt: new Date(Date.now() + 3_600_000) });
    const done = await expiredGroup(2);
    await prisma.groupBuy.update({ where: { id: done.group.id }, data: { status: 'SUCCESS' } });

    await groupBuy.expireGroups();

    expect((await prisma.groupBuy.findUniqueOrThrow({ where: { id: live.group.id } })).status).toBe('OPEN');
    expect((await prisma.groupBuy.findUniqueOrThrow({ where: { id: done.group.id } })).status).toBe('SUCCESS');
    for (const u of [...live.users, ...done.users]) expect(await notices(u.id)).toHaveLength(0);
  });
});
