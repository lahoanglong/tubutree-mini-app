import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from '../../src/modules/affiliate/affiliate-auto-transfer-config';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { QUEUE_NOTIFICATIONS } from '../../src/jobs/queues';
import { createOrder, createUser, setConfig, warmPool } from './helpers';

/**
 * L2-04: đơn đã RETURNED (commit) mà hoa hồng chưa kịp bị đảo thì không được vào khoản rút, cả ở nút "Chuyển vào Ví"
 * lẫn cron tự chuyển. Hoa hồng của đơn còn DELIVERED vẫn đi bình thường.
 */
describe('Rút hoa hồng bỏ qua đơn đã RETURNED (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let config: SystemConfigService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        NotificationsService,
        { provide: ZnsClient, useValue: { sendTemplate: jest.fn().mockResolvedValue({ ok: true }) } },
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: { add: jest.fn() } },
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    config = moduleRef.get(SystemConfigService);
    await setConfig(prisma, 'affiliate.pit_withhold_pct', 0.1);
    await setConfig(prisma, 'affiliate.pit_withhold_threshold', 50_000_000);
    await setConfig(prisma, AFFILIATE_AUTO_WALLET_TRANSFER_KEY, true);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function commissionFor(affiliateUserId: string, amount: number, orderStatus: 'DELIVERED' | 'RETURNED') {
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: affiliateUserId, total: amount * 10 });
    const commission = await prisma.commission.create({
      data: { affiliateUserId, orderId: order.id, orderTotal: order.total, commissionableTotal: order.total, rate: 10, amount, status: 'APPROVED', lockedAt: new Date(Date.now() - 40 * 864e5), approvedAt: new Date() },
    });
    // Đơn đổi sang RETURNED sau khi hoa hồng đã APPROVED, và chưa có ai đảo hoa hồng (khe hở cần chặn).
    if (orderStatus === 'RETURNED') await prisma.order.update({ where: { id: order.id }, data: { status: 'RETURNED' } });
    return commission;
  }

  const state = async (userId: string) => ({
    balance: (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance,
    commissions: await prisma.commission.findMany({ where: { affiliateUserId: userId } }),
  });

  it('nút Chuyển vào Ví: hoa hồng của đơn RETURNED ở lại APPROVED, đơn DELIVERED vẫn vào Ví', async () => {
    const u = await createUser(prisma, { role: 'AFFILIATE' });
    const ok = await commissionFor(u.id, 40_000, 'DELIVERED');
    const returned = await commissionFor(u.id, 60_000, 'RETURNED');
    await affiliate.requestPayout(u.id, 100_000, 'WALLET_BALANCE');
    const s = await state(u.id);
    expect(s.balance).toBe(40_000);
    expect(s.commissions.find((c) => c.id === ok.id)!.status).toBe('PAID');
    expect(s.commissions.find((c) => c.id === returned.id)!.status).toBe('APPROVED');
  });

  it('chạy cùng lúc đơn bị RETURNED: không bao giờ có hoa hồng PAID của đơn đã RETURNED nếu RETURNED commit trước câu khoá', async () => {
    const u = await createUser(prisma, { role: 'AFFILIATE' });
    await commissionFor(u.id, 30_000, 'DELIVERED');
    const target = await commissionFor(u.id, 50_000, 'DELIVERED');
    const results = await Promise.allSettled([
      prisma.order.update({ where: { id: target.orderId }, data: { status: 'RETURNED' } }),
      affiliate.requestPayout(u.id, 80_000, 'WALLET_BALANCE'),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    const s = await state(u.id);
    const paid = s.commissions.filter((c) => c.status === 'PAID').reduce((sum, c) => sum + c.amount, 0);
    expect(s.balance).toBe(paid);
  });

  it('cron tự chuyển: hoa hồng của đơn RETURNED không vào Ví (ở lại APPROVED chờ đường thu hồi)', async () => {
    const u = await createUser(prisma, { role: 'AFFILIATE' });
    await commissionFor(u.id, 25_000, 'DELIVERED');
    const returned = await commissionFor(u.id, 75_000, 'RETURNED');
    await affiliate.autoTransferApprovedToWallet();
    const s = await state(u.id);
    expect(s.balance).toBeLessThanOrEqual(25_000);
    expect(s.commissions.find((c) => c.id === returned.id)!.status).toBe('APPROVED');
  });

  it('chỉ còn hoa hồng của đơn RETURNED: cron không chọn CTV đó, nút bấm báo không còn khoản nào', async () => {
    const u = await createUser(prisma, { role: 'AFFILIATE' });
    await commissionFor(u.id, 45_000, 'RETURNED');
    const credited = await affiliate.autoTransferApprovedToWallet();
    expect(credited.has(u.id)).toBe(false);
    await expect(affiliate.requestPayout(u.id, 45_000, 'WALLET_BALANCE')).rejects.toBeDefined();
    expect((await state(u.id)).balance).toBe(0);
  });
});
