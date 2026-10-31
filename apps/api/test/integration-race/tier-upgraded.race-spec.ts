import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createOrder, createUser, deleteItData, randCode, warmPool } from './helpers';

/** Tin lên hạng trên Postgres thật: nhiều lượt tính lại hạng song song cho cùng khách chỉ báo một lần. */
describe('recalcTier tin lên hạng race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  const notifySafe = jest.fn().mockResolvedValue(true);
  const lowId = `tier-lo-${randCode(6)}`;
  const highId = `tier-hi-${randCode(6)}`;
  const baseId = `tier-base-${randCode(6)}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, { provide: NotificationsService, useValue: { notifySafe, notify: notifySafe } }],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    loyalty = moduleRef.get(LoyaltyService);
    // Ngưỡng chi tiêu thấp nhưng sortOrder cao hơn mọi hạng seed: khách có đơn giao 100k chỉ đạt hạng này khi vượt mốc.
    const base = { minPoints: 0, discountPct: 0, pointMultiplier: 1, perks: {} };
    await prisma.membershipTier.create({ data: { id: baseId, name: 'Hạng đầu thử', ...base, minSpending: null, sortOrder: 8999 } });
    await prisma.membershipTier.create({ data: { id: lowId, name: 'Hạng thấp thử', ...base, minSpending: 1, sortOrder: 9000 } });
    await prisma.membershipTier.create({ data: { id: highId, name: 'Hạng cao thử', ...base, minSpending: 1_000_000, sortOrder: 9001 } });
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds });
    await prisma.user.updateMany({ where: { tierId: { in: [baseId, lowId, highId] } }, data: { tierId: null } });
    await prisma.membershipTier.deleteMany({ where: { id: { in: [baseId, lowId, highId] } } });
    await moduleRef?.close();
  });

  const calls = (userId: string) => notifySafe.mock.calls.filter((c) => c[0] === userId);

  const userIds: string[] = [];
  async function deliver(userId: string, total: number) {
    await createOrder(prisma, { userId, status: 'DELIVERED', deliveredAt: new Date(), type: 'RETAIL', placedForCustomer: false, total });
  }

  it('5 lượt song song cùng khách lên hạng: đúng một tin, chỉ mang tên hạng', async () => {
    const user = await createUser(prisma, { tierId: lowId });
    userIds.push(user.id);
    await deliver(user.id, 2_000_000);
    await Promise.all(Array.from({ length: 5 }, () => loyalty.recalcTier(user.id)));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierId).toBe(highId);
    const c = calls(user.id);
    expect(c).toHaveLength(1);
    expect(c[0]![1]).toBe('TIER_UPGRADED');
    expect(c[0]![2]).toEqual({ tier: 'Hạng cao thử' });
    await loyalty.recalcTier(user.id);
    expect(calls(user.id)).toHaveLength(1);
  });

  it('chưa có hạng được gán đúng hạng đầu: không tin', async () => {
    const user = await createUser(prisma, { tierId: null });
    userIds.push(user.id);
    await Promise.all(Array.from({ length: 3 }, () => loyalty.recalcTier(user.id)));
    expect(calls(user.id)).toHaveLength(0);
  });

  it('chưa có hạng, đơn đầu lên thẳng hạng cao hơn hạng đầu: đúng một tin', async () => {
    const user = await createUser(prisma, { tierId: null });
    userIds.push(user.id);
    await deliver(user.id, 2_000_000);
    await Promise.all(Array.from({ length: 3 }, () => loyalty.recalcTier(user.id)));
    expect(calls(user.id)).toHaveLength(1);
  });

  it('lượt chỉ đổi ân hạn đọc cũ không kéo hạng vừa lên (ở lượt song song) về hạng cũ; vẫn đúng một tin', async () => {
    const config = moduleRef.get(SystemConfigService);
    const user = await createUser(prisma, { tierId: lowId });
    userIds.push(user.id);

    // Lượt A đã đọc hạng + chi tiêu (chưa có đơn nên chỉ đủ hạng đầu: giữ hạng thấp và đặt ân hạn) rồi dừng ở bước đọc cấu hình ân hạn.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atGate = new Promise<void>((r) => (reached = r));
    const realGet = config.get.bind(config);
    const spy = jest.spyOn(config, 'get').mockImplementation((async (key: string, def: unknown) => {
      if (key === 'loyalty.tier_grace_days') {
        reached();
        await gate;
      }
      return realGet(key, def as never);
    }) as never);
    const stale = loyalty.recalcTier(user.id);
    await atGate;
    spy.mockRestore();

    await deliver(user.id, 2_000_000);
    await loyalty.recalcTier(user.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierId).toBe(highId);

    release();
    await stale;
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.tierId).toBe(highId);
    expect(after.tierGraceUntil).toBeNull();
    await loyalty.recalcTier(user.id);
    expect(calls(user.id)).toHaveLength(1);
  });
});
