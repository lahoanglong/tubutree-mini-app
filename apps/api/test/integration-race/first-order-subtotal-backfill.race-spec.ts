import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { REFERRAL_VIRAL_ENABLED_KEY } from '../../src/modules/referral/viral-config';
import { backfillFirstOrderSubtotal } from '../../src/modules/referral/first-order-subtotal-backfill';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * Review w10-02: mốc 199k đổi từ tổng trả sang tiền hàng. Đơn A giao trước deploy (tiền hàng 199k, mã khách mới làm tổng trả 169k) bị luật
 * cũ bỏ qua; luật mới coi A là đơn đầu đạt mốc nên đơn B sau đó gặp NOT_FIRST. Bù một lần (scripts/backfill-first-order-subtotal.ts) xét lại
 * A qua đường thưởng thật: cả hai bên nhận, chạy lại không cấp thêm. Postgres thật.
 */
describe('Bù thưởng đơn đầu sau khi đổi mốc sang tiền hàng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rewards: RewardPointsService;
  let savedFlag: { key: string; value: unknown } | null = null;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, RewardPointsService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    rewards = moduleRef.get(RewardPointsService);
    savedFlag = await prisma.systemConfig.findUnique({ where: { key: REFERRAL_VIRAL_ENABLED_KEY } });
    await setConfig(prisma, REFERRAL_VIRAL_ENABLED_KEY, true);
  });

  afterAll(async () => {
    if (prisma) {
      if (savedFlag) await setConfig(prisma, savedFlag.key, savedFlag.value as never);
      else await prisma.systemConfig.deleteMany({ where: { key: REFERRAL_VIRAL_ENABLED_KEY } });
    }
    await moduleRef?.close();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const firstOrderRows = () => prisma.pointsTransaction.count({ where: { refType: 'REFERRAL', reason: { startsWith: 'REFERRAL_FIRST_ORDER_' } } });

  it('đơn đầu luật cũ bỏ qua làm đơn sau NOT_FIRST; bù xét lại đơn đầu: hai bên +100, chạy lại không cấp thêm', async () => {
    const since = new Date(Date.now() - 1000);
    const referrer = await createUser(prisma, { zaloId: `zalo_it_${randCode(10)}` });
    const friend = await createUser(prisma, { zaloId: `zalo_it_${randCode(10)}`, phone: phone(), referredById: referrer.id });
    const a = await createOrder(prisma, {
      userId: friend.id,
      status: 'DELIVERED',
      subtotal: 199_000,
      discount: 30_000,
      total: 169_000,
      deliveredAt: new Date(),
      createdAt: new Date(Date.now() - 60_000),
    });
    const b = await createOrder(prisma, { userId: friend.id, status: 'DELIVERED', subtotal: 250_000, total: 250_000, deliveredAt: new Date() });
    const before = await firstOrderRows();

    expect(await rewards.grantReferralFirstOrderReward(b.id)).toEqual({ status: 'SKIPPED', reason: 'NOT_FIRST' });

    const grant = (id: string) => rewards.grantReferralFirstOrderReward(id);
    const run = await backfillFirstOrderSubtotal({ db: prisma, grant }, { since, minOrder: 199_000, apply: true });
    expect(run).toEqual({ candidates: [a.id], outcomes: { GRANTED: 1 } });
    expect(await firstOrderRows()).toBe(before + 2);
    for (const u of [referrer.id, friend.id]) {
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u }, select: { pointsBalance: true } })).pointsBalance).toBe(100);
    }

    const again = await backfillFirstOrderSubtotal({ db: prisma, grant }, { since, minOrder: 199_000, apply: true });
    expect(again.outcomes.GRANTED).toBeUndefined();
    expect(await firstOrderRows()).toBe(before + 2);
  });
});
