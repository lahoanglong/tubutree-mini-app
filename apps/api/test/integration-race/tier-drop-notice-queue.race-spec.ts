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

/**
 * R-170 trên đường production: ZNS đi qua hàng đợi, lỗi nằm ở queue.add (không phải sendTemplate).
 * NotificationsService thật + Postgres thật; hàng đợi giả có `add` ném lỗi theo lệnh.
 */
describe('TierDropNoticeService ZNS qua hàng đợi (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: TierDropNoticeService;
  let restoreCfg: () => Promise<void>;
  const sendTemplate = jest.fn();
  const add = jest.fn();
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
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: { add } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(TierDropNoticeService);
    restoreCfg = await pinConfig(prisma, TIER_DROP_ZNS_TEMPLATE_KEY, '123456');
    await prisma.membershipTier.create({
      data: { id: tierId, name: 'Hạng thử hàng đợi', minPoints: 0, minSpending: 1_000_000, discountPct: 0, pointMultiplier: 1, perks: {}, sortOrder: 97 },
    });
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { tierId }, data: { tierId: null } });
    await prisma.membershipTier.deleteMany({ where: { id: tierId } });
    await restoreCfg?.();
    await moduleRef?.close();
  });

  beforeEach(() => {
    add.mockReset();
    sendTemplate.mockReset();
  });

  let seq = 0;
  const phone = () => `09${(Date.now() % 1e6).toString().padStart(6, '0')}${String(seq++).padStart(2, '0')}`;
  const mkUser = (until: Date) => createUser(prisma, { tierId, tierGraceUntil: until, phone: phone() });
  const logs = (userId: string, channel: 'INAPP' | 'ZNS') =>
    prisma.notificationLog.findMany({ where: { userId, templateCode: 'TIER_DROP_NOTICE', channel }, orderBy: { sentAt: 'asc' } });
  const noticeFor = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tierDropNoticeFor;
  const keyOf = (l: { payload: unknown }) => (l.payload as { dedupeKey?: string }).dedupeKey;

  it('queue.add lỗi lần đầu: lượt sau tạo log ZNS mới với khoá gốc và xếp lại; lượt kế không gửi thêm', async () => {
    const until = new Date(Date.now() + 5 * DAY);
    const user = await mkUser(until);
    add.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(undefined);

    expect(await svc.sendNotices()).toBe(0);
    expect(await noticeFor(user.id)).toBeNull();
    expect(await logs(user.id, 'INAPP')).toHaveLength(1);
    const first = await logs(user.id, 'ZNS');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ status: 'FAILED' });
    expect(keyOf(first[0]!)).not.toBe(`tier-drop:${until.toISOString()}`);
    expect(add).toHaveBeenCalledTimes(1);

    expect(await svc.sendNotices()).toBe(1);
    expect(add).toHaveBeenCalledTimes(2);
    const second = await logs(user.id, 'ZNS');
    expect(second).toHaveLength(2);
    const fresh = second.find((l) => l.status === 'PENDING');
    expect(fresh).toBeDefined();
    expect(keyOf(fresh!)).toBe(`tier-drop:${until.toISOString()}`);
    expect(await logs(user.id, 'INAPP')).toHaveLength(1);
    expect((await noticeFor(user.id))?.getTime()).toBe(until.getTime());

    expect(await svc.sendNotices()).toBe(0);
    expect(add).toHaveBeenCalledTimes(2);
    expect(await logs(user.id, 'ZNS')).toHaveLength(2);
  });

  it('5 lượt cron chạy đồng thời sau lần lỗi: đúng một log ZNS mới, đúng một job', async () => {
    const until = new Date(Date.now() + 6 * DAY);
    const user = await mkUser(until);
    add.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(undefined);
    expect(await svc.sendNotices()).toBe(0);
    expect(add).toHaveBeenCalledTimes(1);

    const results = await Promise.all(Array.from({ length: 5 }, () => svc.sendNotices()));
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(add).toHaveBeenCalledTimes(2);
    const zns = await logs(user.id, 'ZNS');
    expect(zns.filter((l) => l.status === 'PENDING')).toHaveLength(1);
    expect(zns).toHaveLength(2);
    expect(await logs(user.id, 'INAPP')).toHaveLength(1);

    expect(await svc.sendNotices()).toBe(0);
    expect(add).toHaveBeenCalledTimes(2);
  });
});
