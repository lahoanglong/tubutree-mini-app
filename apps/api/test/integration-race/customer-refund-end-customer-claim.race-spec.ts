import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';


/** RC-01 trên Postgres THẬT: khoản khách cuối đơn CTV (userId null) cũng phải khoá trước khi chuyển tiền. */
describe('RC-01 khoản khách cuối đơn CTV: khoá "Bắt đầu chuyển khoản" (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refunds: CustomerRefundsService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        CustomerRefundsService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify, notifySafe: notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    refunds = moduleRef.get(CustomerRefundsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function endCustomerRow(amount: number) {
    const owner = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, { userId: owner.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', total: amount });
    return prisma.orderCustomerRefund.create({
      data: {
        orderId: order.id,
        orderCode: order.code,
        kind: 'END_CUSTOMER',
        userId: null,
        phone: `09${randCode(8).replace(/\D/g, '7').padEnd(8, '1').slice(0, 8)}`,
        recipientName: 'Khách cuối',
        amount,
        method: 'MANUAL_TRANSFER',
        status: 'PENDING',
        reason: 'CANCELLED',
      },
    });
  }

  it('hai admin claim song song một dòng END_CUSTOMER → đúng một PROCESSING, người thua nghe "đang do ... chuyển khoản"', async () => {
    for (let round = 0; round < 6; round++) {
      const a = await createUser(prisma, { role: 'ADMIN', fullName: 'Admin An' });
      const b = await createUser(prisma, { role: 'ADMIN', fullName: 'Admin Binh' });
      const row = await endCustomerRow(500_000);
      const results = await Promise.allSettled([refunds.claim(a.id, row.id), refunds.claim(b.id, row.id)]);
      const s = summarize(results);
      expect(s.fulfilled).toHaveLength(1);
      expect(s.rejected).toHaveLength(1);
      const after = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } });
      const winner = results[0]!.status === 'fulfilled' ? a : b;
      const loser = winner === a ? b : a;
      expect(after).toMatchObject({ status: 'PROCESSING', claimedBy: winner.id });
      await expect(refunds.markPaid(loser.id, row.id, { bankRef: `FTL${round}` })).rejects.toThrow('đang do');
      await refunds.markPaid(winner.id, row.id, { bankRef: `FTW${round}` });
      expect(await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'COMPLETED', completedBy: winner.id });
    }
  });

  it('markPaid thẳng từ hàng chờ (chưa claim) bị từ chối, dòng vẫn PENDING', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const row = await endCustomerRow(120_000);
    await expect(refunds.markPaid(admin.id, row.id, { bankRef: 'FT-DIRECT' })).rejects.toThrow('Bắt đầu chuyển khoản');
    expect(await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'PENDING', claimedBy: null });
  });
});
