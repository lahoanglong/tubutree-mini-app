import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { CTV_MONTHLY_MILESTONES } from '../../src/modules/affiliate/ctv-milestones';
import { CoinsService } from '../../src/modules/wallet/coins.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/** AffiliateService.claimMilestone trên Postgres thật — CoinsService thật, chỉ stub Pricing/Pancake (không dùng). */
describe('AffiliateService.claimMilestone race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        CoinsService,
        // Real class (Task 10) — AffiliateService giờ đòi analytics là tham số BẮT BUỘC.
        // AnalyticsModule là @Global() nên app thật luôn wiring được; ở đây khai module không
        // import nó (chỉ PrismaModule) nên phải khai trực tiếp, giống CoinsService/AffiliateService.
        // AnalyticsEventsService.record() ghi analytics_events — bảng đã có sau migration, không
        // cần mock.
        AnalyticsEventsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('(d) 5 concurrent claims of the first milestone -> 1 claim row, coins +once == SUM(coin deltas), wallet unchanged', async () => {
    const milestone = CTV_MONTHLY_MILESTONES[0]!;
    const ctv = await createUser(prisma, { role: 'AFFILIATE', walletBalance: 12_345, coinsBalance: 0 });
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, {
      userId: buyer.id,
      status: 'DELIVERED',
      referrerUserId: ctv.id,
      total: milestone.threshold,
      subtotal: milestone.threshold,
    });
    await prisma.commission.create({
      data: {
        affiliateUserId: ctv.id,
        orderId: order.id,
        orderTotal: order.total,
        commissionableTotal: milestone.threshold,
        rate: 10,
        amount: Math.floor(milestone.threshold / 10),
        status: 'APPROVED',
        lockedAt: new Date(Date.now() - 30 * 864e5),
        approvedAt: new Date(), // trong tháng VN hiện tại
      },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => affiliate.claimMilestone(ctv.id, milestone.id)),
    );
    const s = summarize(results);

    const claims = await prisma.ctvMilestoneClaim.findMany({ where: { userId: ctv.id } });
    const coinAgg = await prisma.coinTransaction.aggregate({ where: { userId: ctv.id }, _sum: { delta: true }, _count: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: ctv.id } });

    // eslint-disable-next-line no-console
    console.log(
      '[d] fulfilled=%d rejected=%d coins=%d sumDelta=%d wallet=%d errors=%j',
      s.fulfilled.length,
      s.rejected.length,
      after.coinsBalance,
      coinAgg._sum.delta ?? 0,
      after.walletBalance,
      [...new Set(s.errors)],
    );

    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(4);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.milestoneId).toBe(milestone.id);
    expect(coinAgg._count).toBe(1);
    expect(after.coinsBalance).toBe(milestone.rewardXu);
    expect(after.coinsBalance).toBe(coinAgg._sum.delta ?? 0);
    expect(after.walletBalance).toBe(12_345);
  });
});
