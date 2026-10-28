import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { TierDropNoticeService } from '../../src/modules/loyalty/tier-drop-notice.service';
import { createUser, randCode, warmPool } from './helpers';

/** Báo trước hạ hạng trên Postgres thật: nhiều lượt cron song song (hoặc hai instance) chỉ báo một lần mỗi kỳ giữ hạng. */
describe('TierDropNoticeService race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: TierDropNoticeService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const tierId = `tier-${randCode(6)}`;
  const DAY = 864e5;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        LoyaltyService,
        TierDropNoticeService,
        { provide: NotificationsService, useValue: { notify } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(TierDropNoticeService);
    await prisma.membershipTier.create({
      data: { id: tierId, name: 'Hạng thử báo', minPoints: 0, minSpending: 1_000_000, discountPct: 0, pointMultiplier: 1, perks: {}, sortOrder: 99 },
    });
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { tierId }, data: { tierId: null } });
    await prisma.membershipTier.deleteMany({ where: { id: tierId } });
    await moduleRef?.close();
  });

  const callsFor = (userId: string) => notify.mock.calls.filter((c) => c[0] === userId);

  it('5 lượt song song cùng kỳ: báo đúng một lần, ghi lại hạn đã báo; kỳ giữ hạng mới thì báo lại', async () => {
    const until = new Date(Date.now() + 5 * DAY);
    const user = await createUser(prisma, { tierId, tierGraceUntil: until });
    await Promise.all(Array.from({ length: 5 }, () => svc.sendNotices()));
    const calls = callsFor(user.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe('TIER_DROP_NOTICE');
    expect(calls[0]![2]).toMatchObject({ tier: 'Hạng thử báo', need: 'Mua thêm 1.000.000đ đơn giao thành công' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierDropNoticeFor).toEqual(until);

    await svc.sendNotices();
    expect(callsFor(user.id)).toHaveLength(1);

    await prisma.user.update({ where: { id: user.id }, data: { tierGraceUntil: new Date(Date.now() + 9 * DAY) } });
    await svc.sendNotices();
    expect(callsFor(user.id)).toHaveLength(2);
  });

  it('hạn còn xa hơn ngưỡng hoặc đã qua: không báo', async () => {
    const far = await createUser(prisma, { tierId, tierGraceUntil: new Date(Date.now() + 40 * DAY) });
    const past = await createUser(prisma, { tierId, tierGraceUntil: new Date(Date.now() - DAY) });
    await svc.sendNotices();
    expect(callsFor(far.id)).toHaveLength(0);
    expect(callsFor(past.id)).toHaveLength(0);
  });
});
