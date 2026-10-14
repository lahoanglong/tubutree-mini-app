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
import { recordCumulativeLatePayment, recordLatePaymentRefund } from '../../src/modules/orders/refund-queue';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * Q1 (UAT vòng 2) trên Postgres THẬT:
 * - R2-LIFECYCLE-2: "Đang chuyển khoản" khoá nơi nhận — khách đổi sang Ví và admin nhận chuyển khoản loại trừ nhau,
 *   đã khoá thì khách không rút về Ví được nữa; xác nhận "Đã chuyển khoản" chỉ sau khi khoá.
 * - R2-LIFECYCLE-3: tiền về muộn theo số cộng dồn của Pancake chỉ hoàn phần tăng thêm, kể cả webhook đồng thời.
 * - R2-MONEY-1: trả một phần cắt hoa hồng CTV theo đúng dòng trả và mức % của dòng đó.
 */
describe('Q1 hoàn tiền: khoá nơi nhận, tiền về muộn cộng dồn, hoa hồng theo dòng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refunds: CustomerRefundsService;
  let returns: OrderReturnsService;
  let affiliate: AffiliateService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const ctx = () => ({ prisma, notifications: { notify }, logger: { warn: jest.fn(), log: jest.fn() } });

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
        { provide: NotificationsService, useValue: { notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    refunds = moduleRef.get(CustomerRefundsService);
    returns = moduleRef.get(OrderReturnsService);
    affiliate = moduleRef.get(AffiliateService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  async function walletOf(userId: string) {
    return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;
  }

  /** Khoản chờ chuyển khoản khách đã chọn ngân hàng (đơn đã huỷ, tiền về muộn). */
  async function bankRefund(amount: number) {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', total: amount });
    await recordLatePaymentRefund(ctx(), order, { amount, source: 'PANCAKE', refKey: `q1-${randCode(6)}` });
    const row = await prisma.orderCustomerRefund.findFirstOrThrow({ where: { orderId: order.id } });
    await refunds.chooseDestination(user.id, row.id, { refundMethod: 'BANK', bankName: 'MB', accountNumber: '0123456789', accountName: 'Le Van C' });
    return { user, order, row };
  }

  describe('R2-LIFECYCLE-2: "Đang chuyển khoản" khoá nơi nhận', () => {
    it('khách đổi sang Ví đúng lúc admin bấm "Bắt đầu chuyển khoản" → đúng một bên thắng; bên thua được nói rõ; Ví chỉ cộng khi Ví thắng', async () => {
      const outcomes = new Set<string>();
      for (let round = 0; round < 8; round++) {
        const admin = await createUser(prisma, { role: 'ADMIN' });
        const { user, row } = await bankRefund(205_000);

        const [wallet, claim] = await Promise.allSettled([
          refunds.chooseDestination(user.id, row.id, { refundMethod: 'WALLET' }),
          refunds.claim(admin.id, row.id),
        ]);
        expect(summarize([wallet, claim]).fulfilled).toHaveLength(1);
        const after = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } });

        if (wallet.status === 'fulfilled') {
          outcomes.add('wallet');
          expect(after).toMatchObject({ method: 'WALLET', status: 'COMPLETED' });
          expect(await walletOf(user.id)).toBe(205_000);
          expect(String((claim as PromiseRejectedResult).reason?.message)).toContain('Khách đã chọn nhận khoản này về Ví Tubu');
          await expect(refunds.markPaid(admin.id, row.id, { bankRef: `FT${round}` })).rejects.toThrow('KHÔNG chuyển khoản');
        } else {
          outcomes.add('claim');
          expect(after).toMatchObject({ method: 'MANUAL_TRANSFER', status: 'PROCESSING', claimedBy: admin.id });
          expect(await walletOf(user.id)).toBe(0);
          expect(String((wallet as PromiseRejectedResult).reason?.message)).toContain('Tubu đang chuyển khoản');
          await refunds.markPaid(admin.id, row.id, { bankRef: `FT${round}` });
          expect(await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'COMPLETED', bankRef: `FT${round}` });
          expect(await walletOf(user.id)).toBe(0);
        }
      }
      console.log('[claim vs wallet] outcomes=%j', [...outcomes]);
    });

    it('đã khoá: khách bấm Ví đồng thời admin bấm "Đã chuyển khoản" → Ví luôn thua, tiền chỉ đi một đường', async () => {
      for (let round = 0; round < 5; round++) {
        const admin = await createUser(prisma, { role: 'ADMIN' });
        const { user, row } = await bankRefund(19_500);
        await refunds.claim(admin.id, row.id);

        const [wallet, paid] = await Promise.allSettled([
          refunds.chooseDestination(user.id, row.id, { refundMethod: 'WALLET' }),
          refunds.markPaid(admin.id, row.id, { bankRef: `FT26287${round}` }),
        ]);
        expect(wallet.status).toBe('rejected');
        expect(paid.status).toBe('fulfilled');
        expect(await walletOf(user.id)).toBe(0);
        expect(await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
          method: 'MANUAL_TRANSFER',
          status: 'COMPLETED',
        });
      }
    });

    it('chưa khoá thì không xác nhận được; khách vẫn đổi sang Ví được; admin trả về hàng chờ thì khách lại đổi được', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN' });
      const { user, row } = await bankRefund(60_000);
      await expect(refunds.markPaid(admin.id, row.id, { bankRef: 'FT1' })).rejects.toThrow('Bắt đầu chuyển khoản');

      await refunds.claim(admin.id, row.id);
      const mine = await refunds.listMine(user.id, row.orderId);
      expect(mine.find((r) => r.id === row.id)).toMatchObject({ status: 'PROCESSING', canChooseDestination: false });

      await refunds.release(admin.id, row.id);
      await refunds.chooseDestination(user.id, row.id, { refundMethod: 'WALLET' });
      expect(await walletOf(user.id)).toBe(60_000);
    });

    it('hai admin cùng bấm "Bắt đầu chuyển khoản" → một người nhận, người kia được báo đang có người chuyển', async () => {
      const [a1, a2] = await Promise.all([createUser(prisma, { role: 'ADMIN' }), createUser(prisma, { role: 'ADMIN' })]);
      const { row } = await bankRefund(80_000);
      const s = summarize(await Promise.allSettled([refunds.claim(a1.id, row.id), refunds.claim(a2.id, row.id)]));
      expect(s.fulfilled).toHaveLength(1);
      expect(s.errors.join()).toContain('một quản trị viên khác');
    });
  });

  describe('R2-LIFECYCLE-3: tiền về muộn theo số cộng dồn của Pancake', () => {
    async function cancelledOrder(total: number) {
      const user = await createUser(prisma, { role: 'CUSTOMER' });
      const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', total });
      return { user, order };
    }
    const lateSum = async (orderId: string) =>
      (await prisma.orderCustomerRefund.aggregate({ where: { orderId, kind: 'LATE_PAYMENT' }, _sum: { amount: true } }))._sum.amount ?? 0;

    it('Pancake báo 118.000 rồi 236.000 (khách chuyển nhầm lần hai) → tổng khoản hoàn = 236.000, không phải 354.000', async () => {
      const { order } = await cancelledOrder(118_000);
      expect(await recordCumulativeLatePayment(ctx(), order, { reportedTotal: 118_000, source: 'PANCAKE' })).toBe(118_000);
      expect(await recordCumulativeLatePayment(ctx(), order, { reportedTotal: 236_000, source: 'PANCAKE' })).toBe(118_000);
      expect(await recordCumulativeLatePayment(ctx(), order, { reportedTotal: 236_000, source: 'PANCAKE' })).toBe(0);
      expect(await lateSum(order.id)).toBe(236_000);
      expect(notify.mock.calls.filter(([, code]) => code === 'REFUND_LATE_PAYMENT')).toHaveLength(2);
    });

    it('webhook 118.000 và 236.000 tới đồng thời (kèm bản gửi lại) → tổng đúng bằng số cộng dồn lớn nhất', async () => {
      for (let round = 0; round < 5; round++) {
        const { order } = await cancelledOrder(118_000);
        await Promise.allSettled(
          [118_000, 236_000, 236_000, 118_000, 236_000].map((reportedTotal) =>
            recordCumulativeLatePayment(ctx(), order, { reportedTotal, source: 'PANCAKE' }),
          ),
        );
        expect(await lateSum(order.id)).toBe(236_000);
      }
    });

    it('khoản cũ ghi theo khoá kiểu trước (PANCAKE:<id>:<số>) vẫn được tính vào phần đã ghi', async () => {
      const { order } = await cancelledOrder(118_000);
      await recordLatePaymentRefund(ctx(), order, { amount: 118_000, source: 'PANCAKE', refKey: 'p1:118000' });
      expect(await recordCumulativeLatePayment(ctx(), order, { reportedTotal: 236_000, source: 'PANCAKE' })).toBe(118_000);
      expect(await lateSum(order.id)).toBe(236_000);
    });
  });

  describe('R2-MONEY-1: hoa hồng CTV cắt theo dòng trả', () => {
    async function variation(price: number, affiliateRate: number | null) {
      const tag = randCode(8);
      const product = await prisma.product.create({
        data: { pancakeId: `it-q1-p-${tag}`, brand: 'IT', slug: `it-q1-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
      });
      return prisma.variation.create({
        data: { pancakeId: `it-q1-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, affiliateRate, stock: 20 },
      });
    }

    /** Đơn COD đã giao: son 95.000 (10%) + phấn 185.000 (không hoa hồng) = 280.000, CTV hưởng 9.500. */
    async function deliveredWithCommission() {
      const ctv = await createUser(prisma, { role: 'AFFILIATE' });
      const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const lip = await variation(95_000, 10);
      const powder = await variation(185_000, null);
      const order = await createOrder(prisma, {
        userId: buyer.id,
        referrerUserId: ctv.id,
        status: 'DELIVERED',
        deliveredAt: new Date(),
        subtotal: 280_000,
        total: 280_000,
        items: {
          create: [
            { variationId: lip.id, productName: 'Son', variationName: 'Mặc định', unitPrice: 95_000, quantity: 1, total: 95_000 },
            { variationId: powder.id, productName: 'Phấn', variationName: 'Mặc định', unitPrice: 185_000, quantity: 1, total: 185_000 },
          ],
        },
      });
      await affiliate.createCommissionForOrder(order.id);
      await affiliate.lockCommissionsForOrder(order.id);
      const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
      const lipItem = items.find((i) => i.variationId === lip.id)!;
      const powderItem = items.find((i) => i.variationId === powder.id)!;
      const commission = await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } });
      return { buyer, order, lipItem, powderItem, commission, lip };
    }

    const commissionOf = async (orderId: string) => (await prisma.commission.findFirstOrThrow({ where: { orderId } })).amount;

    async function returnLine(buyerId: string, code: string, orderItemId: string) {
      return returns.request(buyerId, code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId, quantity: 1 }], refundMethod: 'WALLET' });
    }

    it('lưu hoa hồng từng dòng lúc tạo; trả món 10% → cắt đúng 9.500 (CTV không giữ hoa hồng món đã trả)', async () => {
      const { buyer, order, lipItem, commission } = await deliveredWithCommission();
      expect(commission.amount).toBe(9_500);
      expect(commission.lineAmounts).toEqual({ [lipItem.id]: 9_500 });

      const admins = await Promise.all([createUser(prisma, { role: 'ADMIN' }), createUser(prisma, { role: 'ADMIN' })]);
      const req = await returnLine(buyer.id, order.code, lipItem.id);
      const s = summarize(await Promise.allSettled(admins.map((a) => returns.review(a.id, req.id, { approve: true }))));
      expect(s.fulfilled).toHaveLength(1);

      expect(await commissionOf(order.id)).toBe(0);
      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).commissionReversed).toBe(9_500);
    });

    it('trả món không hoa hồng → không cắt đồng nào; trả tiếp món 10% → cắt 9.500', async () => {
      const { buyer, order, lipItem, powderItem } = await deliveredWithCommission();
      const admin = await createUser(prisma, { role: 'ADMIN' });

      const r1 = await returnLine(buyer.id, order.code, powderItem.id);
      await returns.review(admin.id, r1.id, { approve: true });
      expect(await commissionOf(order.id)).toBe(9_500);
      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: r1.id } })).commissionReversed).toBe(0);

      const r2 = await returnLine(buyer.id, order.code, lipItem.id);
      await returns.review(admin.id, r2.id, { approve: true });
      const after = await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } });
      expect(after.status).toBe('REJECTED');
      expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: r2.id } })).fullReturn).toBe(true);
    });

    it('hoa hồng tạo trước khi có lineAmounts → chia theo mức % hiện tại của từng dòng', async () => {
      const { buyer, order, lipItem, commission } = await deliveredWithCommission();
      await prisma.$executeRaw`UPDATE commissions SET "lineAmounts" = NULL WHERE id = ${commission.id}`;
      const admin = await createUser(prisma, { role: 'ADMIN' });
      const req = await returnLine(buyer.id, order.code, lipItem.id);
      await returns.review(admin.id, req.id, { approve: true });
      expect(await commissionOf(order.id)).toBe(0);
    });
  });
});
