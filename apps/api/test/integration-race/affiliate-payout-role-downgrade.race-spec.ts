import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createOrder, createUser, randCode, sleep, warmPool } from './helpers';

describe('Hạ quyền CTV chạy song song với rút hoa hồng về Ví (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        RewardPointsService,
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

  async function ctvWithCommission(amount: number) {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: ctv.id, total: amount * 10 });
    await prisma.commission.create({
      data: {
        affiliateUserId: ctv.id,
        orderId: order.id,
        orderTotal: order.total,
        commissionableTotal: order.total,
        rate: 10,
        amount,
        status: 'APPROVED',
        lockedAt: new Date(Date.now() - 30 * 864e5),
        approvedAt: new Date(),
      },
    });
    return ctv;
  }

  async function state(userId: string) {
    const [u, payouts, paid, approved, ledger] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.payout.count({ where: { userId } }),
      prisma.commission.count({ where: { affiliateUserId: userId, status: 'PAID' } }),
      prisma.commission.count({ where: { affiliateUserId: userId, status: 'APPROVED' } }),
      prisma.walletTransaction.findMany({ where: { userId, type: 'COMMISSION_PAYOUT' } }),
    ]);
    return { balance: u.walletBalance, payouts, paid, approved, ledger: ledger.length };
  }

  it('hạ quyền đã giữ khoá dòng người dùng trước khi rút bắt đầu → rút bị 403, Ví và hoa hồng không đổi', async () => {
    const ctv = await ctvWithCommission(100_000);
    const downgrade = prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: ctv.id }, data: { role: 'CUSTOMER' } });
      await sleep(400);
    });
    await sleep(100);
    const payout = affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`);
    const [, res] = await Promise.allSettled([downgrade, payout]);
    expect(res.status).toBe('rejected');
    expect((res as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    expect(await state(ctv.id)).toEqual({ balance: 0, payouts: 0, paid: 0, approved: 1, ledger: 0 });
  });

  it('rút và hạ quyền đua nhau 20 vòng: kết quả luôn nhất quán, rút thắng thì đúng một lần', async () => {
    for (let i = 0; i < 20; i++) {
      const ctv = await ctvWithCommission(100_000);
      const [res] = await Promise.all([
        Promise.allSettled([affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE', undefined, `rd-${randCode(10)}`)]).then((r) => r[0]),
        prisma.user.update({ where: { id: ctv.id }, data: { role: 'CUSTOMER' } }),
      ]);
      const s = await state(ctv.id);
      if (res.status === 'fulfilled') {
        expect(s).toEqual({ balance: 100_000, payouts: 1, paid: 1, approved: 0, ledger: 1 });
      } else {
        expect(res.reason).toBeInstanceOf(ForbiddenException);
        expect(s).toEqual({ balance: 0, payouts: 0, paid: 0, approved: 1, ledger: 0 });
      }
    }
  });
});
