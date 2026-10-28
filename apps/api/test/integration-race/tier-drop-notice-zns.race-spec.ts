import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { TierDropNoticeService, TIER_DROP_ZNS_TEMPLATE_KEY } from '../../src/modules/loyalty/tier-drop-notice.service';
import { QUEUE_NOTIFICATIONS } from '../../src/jobs/queues';
import { createUser, pinConfig, randCode, warmPool } from './helpers';

/** ZNS lỗi sau khi tin trong app đã lưu: đêm sau chỉ gửi nốt ZNS, không lưu thêm tin trong app. Dùng NotificationsService thật. */
describe('TierDropNoticeService ZNS retry (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: TierDropNoticeService;
  let restoreCfg: () => Promise<void>;
  const sendTemplate = jest.fn();
  const tierId = `tier-${randCode(6)}`;
  const DAY = 864e5;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        LoyaltyService,
        NotificationsService,
        TierDropNoticeService,
        { provide: ZnsClient, useValue: { sendTemplate } },
        // Không có hàng đợi: ZNS gửi ngay tại chỗ nên lỗi gửi ném thẳng ra cho cron.
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: null },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(TierDropNoticeService);
    restoreCfg = await pinConfig(prisma, TIER_DROP_ZNS_TEMPLATE_KEY, '123456');
    await prisma.membershipTier.create({
      data: { id: tierId, name: 'Hạng thử ZNS', minPoints: 0, minSpending: 1_000_000, discountPct: 0, pointMultiplier: 1, perks: {}, sortOrder: 98 },
    });
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { tierId }, data: { tierId: null } });
    await prisma.membershipTier.deleteMany({ where: { id: tierId } });
    await restoreCfg?.();
    await moduleRef?.close();
  });

  it('ZNS ném lỗi lần đầu: không tính là đã báo; đêm sau gửi nốt ZNS, tin trong app vẫn đúng một', async () => {
    const until = new Date(Date.now() + 5 * DAY);
    const user = await createUser(prisma, { tierId, tierGraceUntil: until, phone: `09${randCode(8).replace(/\D/g, '1').slice(0, 8).padEnd(8, '1')}` });
    sendTemplate.mockRejectedValueOnce(new Error('zalo down')).mockResolvedValue({ ok: true });

    expect(await svc.sendNotices()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierDropNoticeFor).toBeNull();
    const inApp = () => prisma.notificationLog.count({ where: { userId: user.id, templateCode: 'TIER_DROP_NOTICE', channel: 'INAPP' } });
    const zns = () => prisma.notificationLog.count({ where: { userId: user.id, templateCode: 'TIER_DROP_NOTICE', channel: 'ZNS' } });
    expect(await inApp()).toBe(1);
    expect(await zns()).toBe(0);

    expect(await svc.sendNotices()).toBe(1);
    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(await inApp()).toBe(1);
    expect(await zns()).toBe(1);

    expect(await svc.sendNotices()).toBe(0);
    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(await zns()).toBe(1);
  });
});
