import { Test, type TestingModule } from '@nestjs/testing';
import type { MembershipTier } from '@prisma/client';
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
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from '../../src/modules/affiliate/affiliate-auto-transfer-config';
import { createOrder, createUser, pinConfig, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * Trả một phần (D3) phải đi hết các chỗ lấy đơn đã giao làm nền:
 * - MONEY-2: hoa hồng CTV PENDING/LOCKED giảm cả `amount` lẫn `commissionableTotal` (nền doanh số mốc thưởng tháng) theo đúng
 *   dòng trả; sau khi duyệt, doanh số đã chốt chỉ còn phần hàng khách giữ.
 * - MONEY-4: hạng thành viên (chi tiêu 12 tháng + điểm xét hạng) trừ phần đã trả của đơn còn DELIVERED, và không trừ hai lần
 *   khi lần trả nốt đưa đơn sang RETURNED.
 * Chạy qua OrderReturnsService, AffiliateService, LoyaltyService thật trên Postgres.
 */
describe('Trả một phần: hoa hồng CTV / doanh số mốc và hạng thành viên (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let affiliate: AffiliateService;
  let loyalty: LoyaltyService;
  const notify = jest.fn().mockResolvedValue(undefined);
  let restoreAutoWallet: (() => Promise<void>) | undefined;

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
    returns = moduleRef.get(OrderReturnsService);
    affiliate = moduleRef.get(AffiliateService);
    loyalty = moduleRef.get(LoyaltyService);
    await setConfig(prisma, 'returns.window_days', 7);
    // Cờ tắt: duyệt xong commission nằm ở APPROVED, assert đúng một trạng thái (không phụ thuộc cờ của DB dùng chung).
    restoreAutoWallet = await pinConfig(prisma, AFFILIATE_AUTO_WALLET_TRANSFER_KEY, false);
    (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
  });

  afterAll(async () => {
    await restoreAutoWallet?.();
    await moduleRef?.close();
  });

  async function variation(price: number, affiliateRate: number | null) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-ptr-p-${tag}`, brand: 'IT', slug: `it-ptr-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-ptr-v-${tag}`, productId: product.id, sku: `ITPTR-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, affiliateRate, stock: 50 },
    });
  }

  const ask = (buyerId: string, code: string, items: { orderItemId: string; quantity: number }[]) =>
    returns.request(buyerId, code, { reasonCode: 'DEFECTIVE', items, refundMethod: 'WALLET' });

  async function partialReturn(adminId: string, buyerId: string, code: string, items: { orderItemId: string; quantity: number }[]) {
    const req = await ask(buyerId, code, items);
    await returns.review(adminId, req.id, { approve: true });
    return prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
  }

  describe('MONEY-2: commissionableTotal giảm theo dòng trả', () => {
    /**
     * Đơn CTV đã giao, tiền hàng thực trả 210.000 (giảm 15.000):
     * a: 3 × 35.000 (thực trả 100.000, 10% → hoa hồng 10.000), b: 2 × 50.000 (95.000, 5% → 4.750), c: 1 × 20.000 (15.000, không hoa hồng).
     * Hoa hồng 14.750, nền doanh số 195.000.
     */
    async function ctvOrder() {
      const ctv = await createUser(prisma, { role: 'AFFILIATE' });
      const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const [a, b, c] = await Promise.all([variation(35_000, 10), variation(50_000, 5), variation(20_000, 0)]);
      const order = await createOrder(prisma, {
        userId: buyer.id,
        referrerUserId: ctv.id,
        status: 'DELIVERED',
        deliveredAt: new Date(),
        subtotal: 225_000,
        total: 210_000,
        items: {
          create: [
            { variationId: a.id, productName: 'A', variationName: 'Mặc định', unitPrice: 35_000, quantity: 3, total: 105_000, paidTotal: 100_000 },
            { variationId: b.id, productName: 'B', variationName: 'Mặc định', unitPrice: 50_000, quantity: 2, total: 100_000, paidTotal: 95_000 },
            { variationId: c.id, productName: 'C', variationName: 'Mặc định', unitPrice: 20_000, quantity: 1, total: 20_000, paidTotal: 15_000 },
          ],
        },
      });
      await affiliate.createCommissionForOrder(order.id);
      await affiliate.lockCommissionsForOrder(order.id);
      const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
      const by = (v: { id: string }) => items.find((i) => i.variationId === v.id)!;
      const admin = await createUser(prisma, { role: 'ADMIN' });
      return { ctv, buyer, order, admin, a: by(a), b: by(b), c: by(c) };
    }

    const commissionOf = (orderId: string) => prisma.commission.findFirstOrThrow({ where: { orderId } });

    /** Cron duyệt hoa hồng sau hold: đưa commission của đơn này qua mốc hold rồi chạy cron thật. */
    async function approve(orderId: string) {
      await prisma.commission.updateMany({ where: { orderId }, data: { lockedAt: new Date(Date.now() - 40 * 864e5) } });
      await affiliate.approveDueCommissions();
    }

    it('hoa hồng lúc tạo: amount 14.750, nền 195.000 (chỉ hai dòng có hoa hồng, tính trên tiền thực trả)', async () => {
      const o = await ctvOrder();
      expect(await commissionOf(o.order.id)).toMatchObject({ amount: 14_750, commissionableTotal: 195_000, status: 'LOCKED' });
    });

    it('trả ba lần (1/3 dòng a; thêm 1/3 a + nửa b; phần còn lại a và b, giữ c không hoa hồng): amount và nền đúng ở từng bước, cuối cùng 0 / 0', async () => {
      const o = await ctvOrder();

      const r1 = await partialReturn(o.admin.id, o.buyer.id, o.order.code, [{ orderItemId: o.a.id, quantity: 1 }]);
      expect(r1).toMatchObject({ fullReturn: false, commissionReversed: 3_333 });
      expect(await commissionOf(o.order.id)).toMatchObject({ amount: 11_417, commissionableTotal: 161_667 });

      const r2 = await partialReturn(o.admin.id, o.buyer.id, o.order.code, [
        { orderItemId: o.a.id, quantity: 1 },
        { orderItemId: o.b.id, quantity: 1 },
      ]);
      expect(r2.commissionReversed).toBe(5_709);
      // Giữ lại: 1 đơn vị a (33.333) + 1 đơn vị b (47.500).
      expect(await commissionOf(o.order.id)).toMatchObject({ amount: 5_708, commissionableTotal: 80_833 });

      const r3 = await partialReturn(o.admin.id, o.buyer.id, o.order.code, [
        { orderItemId: o.a.id, quantity: 1 },
        { orderItemId: o.b.id, quantity: 1 },
      ]);
      expect(r3).toMatchObject({ fullReturn: false, commissionReversed: 5_708 });
      expect(await commissionOf(o.order.id)).toMatchObject({ amount: 0, commissionableTotal: 0, status: 'LOCKED' });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('DELIVERED');
    });

    it('rate chốt lúc đặt: đổi mặc định sau khi tạo đơn rồi trả một phần → cắt theo lineAmounts đã lưu, không theo mặc định mới', async () => {
      const key = 'affiliate.default_rate_pct';
      const before = await prisma.systemConfig.findUnique({ where: { key } });
      try {
        const ctv = await createUser(prisma, { role: 'AFFILIATE' });
        const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
        const admin = await createUser(prisma, { role: 'ADMIN' });
        // a chưa có % (hưởng mặc định 8% = 8.000), b có 10% riêng (10.000).
        const [a, b] = await Promise.all([variation(100_000, null), variation(100_000, 10)]);
        const order = await createOrder(prisma, {
          userId: buyer.id,
          referrerUserId: ctv.id,
          status: 'DELIVERED',
          deliveredAt: new Date(),
          subtotal: 200_000,
          total: 200_000,
          items: {
            create: [
              { variationId: a.id, productName: 'A', variationName: 'Mặc định', unitPrice: 100_000, quantity: 1, total: 100_000, paidTotal: 100_000 },
              { variationId: b.id, productName: 'B', variationName: 'Mặc định', unitPrice: 100_000, quantity: 1, total: 100_000, paidTotal: 100_000 },
            ],
          },
        });
        await affiliate.createCommissionForOrder(order.id);
        await affiliate.lockCommissionsForOrder(order.id);
        expect(await commissionOf(order.id)).toMatchObject({ amount: 18_000 });

        await setConfig(prisma, key, 20);
        const itemA = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id, variationId: a.id } });
        const r = await partialReturn(admin.id, buyer.id, order.code, [{ orderItemId: itemA.id, quantity: 1 }]);
        expect(r.commissionReversed).toBe(8_000);
        expect(await commissionOf(order.id)).toMatchObject({ amount: 10_000, commissionableTotal: 100_000 });
      } finally {
        if (before) await prisma.systemConfig.update({ where: { key }, data: { value: before.value as never } });
        else await prisma.systemConfig.deleteMany({ where: { key } });
      }
    });

    it('trả món không hoa hồng không đổi gì; trả nốt cả đơn → commission bị huỷ (REJECTED), không còn tính vào doanh số', async () => {
      const o = await ctvOrder();
      await partialReturn(o.admin.id, o.buyer.id, o.order.code, [{ orderItemId: o.c.id, quantity: 1 }]);
      expect(await commissionOf(o.order.id)).toMatchObject({ amount: 14_750, commissionableTotal: 195_000 });

      await partialReturn(o.admin.id, o.buyer.id, o.order.code, [{ orderItemId: o.a.id, quantity: 3 }]);
      expect(await commissionOf(o.order.id)).toMatchObject({ amount: 4_750, commissionableTotal: 95_000 });

      const last = await partialReturn(o.admin.id, o.buyer.id, o.order.code, [{ orderItemId: o.b.id, quantity: 2 }]);
      expect(last.fullReturn).toBe(true);
      expect(await commissionOf(o.order.id)).toMatchObject({ status: 'REJECTED' });
      await approve(o.order.id);
      expect((await affiliate.getMilestones(o.ctv.id)).currentRevenue).toBe(0);
    });

    it('duyệt sau hai lần trả: doanh số đã chốt của CTV chỉ là phần hàng khách giữ (80.833), không phải 195.000', async () => {
      const o = await ctvOrder();
      await partialReturn(o.admin.id, o.buyer.id, o.order.code, [{ orderItemId: o.a.id, quantity: 1 }]);
      await partialReturn(o.admin.id, o.buyer.id, o.order.code, [
        { orderItemId: o.a.id, quantity: 1 },
        { orderItemId: o.b.id, quantity: 1 },
      ]);
      const before = await affiliate.getMilestones(o.ctv.id);
      expect(before).toMatchObject({ currentRevenue: 0, pendingRevenue: 80_833 });

      await approve(o.order.id);

      const after = await affiliate.getMilestones(o.ctv.id);
      expect(after).toMatchObject({ currentRevenue: 80_833, pendingRevenue: 0 });
      expect(await commissionOf(o.order.id)).toMatchObject({ status: 'APPROVED', amount: 5_708, commissionableTotal: 80_833 });
    });

    it('hai admin duyệt cùng một yêu cầu cùng lúc: hoa hồng và nền chỉ giảm một lần', async () => {
      const o = await ctvOrder();
      const second = await createUser(prisma, { role: 'ADMIN' });
      const req = await ask(o.buyer.id, o.order.code, [{ orderItemId: o.a.id, quantity: 1 }]);
      const s = summarize(await Promise.allSettled([returns.review(o.admin.id, req.id, { approve: true }), returns.review(second.id, req.id, { approve: true })]));
      expect(s.fulfilled).toHaveLength(1);
      expect(await commissionOf(o.order.id)).toMatchObject({ amount: 11_417, commissionableTotal: 161_667 });
    });

    it('đơn tạo trước khi có lineAmounts (hoa hồng cũ): nền vẫn giảm theo các dòng có hoa hồng', async () => {
      const o = await ctvOrder();
      await prisma.$executeRaw`UPDATE commissions SET "lineAmounts" = NULL WHERE "orderId" = ${o.order.id}`;
      await partialReturn(o.admin.id, o.buyer.id, o.order.code, [{ orderItemId: o.a.id, quantity: 3 }]);
      expect(await commissionOf(o.order.id)).toMatchObject({ amount: 4_750, commissionableTotal: 95_000 });
    });
  });

  describe('MONEY-4: hạng thành viên sau trả một phần', () => {
    const past = () => new Date(Date.now() - 60_000);
    let l0: MembershipTier;
    let spend: MembershipTier;
    let points: MembershipTier;
    let spendSet: MembershipTier[];
    let pointsSet: MembershipTier[];

    beforeAll(async () => {
      const tag = randCode(6);
      const make = (key: string, sortOrder: number, minPoints: number, minSpending: number | null) =>
        prisma.membershipTier.create({
          data: { id: `ITPTR_${tag}_${key}`, name: `Hạng ${key}`, sortOrder, minPoints, minSpending, discountPct: 0, pointMultiplier: 1, perks: {} },
        });
      // Mỗi hạng chỉ xét bằng MỘT tiêu chí để biết đúng đường nào làm rớt hạng: `spend` chỉ theo chi tiêu 20 triệu
      // (minPoints không bao giờ đạt), `points` chỉ theo điểm 2.000 (không có mốc chi tiêu).
      l0 = await make('base', 0, 0, null);
      spend = await make('spend', 1, 1_000_000_000, 20_000_000);
      points = await make('points', 2, 2_000, null);
      spendSet = [l0, spend];
      pointsSet = [l0, points];
    });

    /** Đơn COD đã giao `qty` × 3.000.000 (không giảm giá), tích `earned` điểm, đã cộng điểm như lúc giao. */
    async function deliveredOrder(userId: string, qty: number, earned: number) {
      const v = await variation(3_000_000, null);
      const total = qty * 3_000_000;
      const order = await createOrder(prisma, {
        userId,
        status: 'DELIVERED',
        deliveredAt: new Date(),
        subtotal: total,
        total,
        pointsEarned: earned,
        items: {
          create: [{ variationId: v.id, productName: 'Quà', variationName: 'Mặc định', unitPrice: 3_000_000, quantity: qty, total, paidTotal: total }],
        },
      });
      await loyalty.creditOrderPoints(order.id);
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      return { order, item };
    }

    async function buyer() {
      const admin = await createUser(prisma, { role: 'ADMIN' });
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      return { admin, user };
    }

    /** Tính lại hạng như cron đêm với đúng bộ hạng của test, khách đang ở `tierId` và đã hết ân hạn; trả về id hạng sau đó. */
    async function recalc(userId: string, set: MembershipTier[], tierId: string) {
      await prisma.user.update({ where: { id: userId }, data: { tierId, tierGraceUntil: past() } });
      await loyalty.recalcTier(userId, set);
      return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tierId;
    }

    const tierPoints = async (userId: string) => (await loyalty.getOverview(userId)).tierPoints;
    const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;

    it('chi tiêu: đơn 30 triệu trả 3 rồi thêm 1 đơn vị (giữ 21 rồi 18 triệu) → vẫn hạng chi tiêu 20 triệu, rồi rớt về hạng nền', async () => {
      const b = await buyer();
      const { order, item } = await deliveredOrder(b.user.id, 10, 0);
      expect(await recalc(b.user.id, spendSet, l0.id)).toBe(spend.id);

      await partialReturn(b.admin.id, b.user.id, order.code, [{ orderItemId: item.id, quantity: 3 }]);
      expect(await recalc(b.user.id, spendSet, spend.id)).toBe(spend.id); // giữ 21.000.000

      await partialReturn(b.admin.id, b.user.id, order.code, [{ orderItemId: item.id, quantity: 1 }]);
      expect(await recalc(b.user.id, spendSet, spend.id)).toBe(l0.id); // giữ 18.000.000 < 20.000.000
    });

    it('chi tiêu: đơn 30 triệu trả 9/10 → hạng theo 3 triệu còn giữ, không còn hạng theo 30 triệu', async () => {
      const b = await buyer();
      const { order, item } = await deliveredOrder(b.user.id, 10, 0);
      expect(await recalc(b.user.id, spendSet, l0.id)).toBe(spend.id);
      await partialReturn(b.admin.id, b.user.id, order.code, [{ orderItemId: item.id, quantity: 9 }]);
      expect(await recalc(b.user.id, spendSet, spend.id)).toBe(l0.id);
    });

    it('điểm xét hạng: đơn tích 3.000 điểm trả 3 rồi thêm 1 đơn vị (còn 2.100 rồi 1.800) → giữ hạng điểm 2.000, rồi rớt', async () => {
      const b = await buyer();
      const { order, item } = await deliveredOrder(b.user.id, 10, 3_000);
      expect(await recalc(b.user.id, pointsSet, l0.id)).toBe(points.id);
      expect(await tierPoints(b.user.id)).toBe(3_000);

      await partialReturn(b.admin.id, b.user.id, order.code, [{ orderItemId: item.id, quantity: 3 }]);
      expect(await tierPoints(b.user.id)).toBe(2_100);
      expect(await recalc(b.user.id, pointsSet, points.id)).toBe(points.id);

      await partialReturn(b.admin.id, b.user.id, order.code, [{ orderItemId: item.id, quantity: 1 }]);
      expect(await tierPoints(b.user.id)).toBe(1_800);
      expect(await recalc(b.user.id, pointsSet, points.id)).toBe(l0.id);
    });

    it('điểm xét hạng trừ theo phần đã trả dù khách đã tiêu hết điểm (thu hồi điểm bị chặn bởi số dư): vẫn rớt hạng', async () => {
      const b = await buyer();
      const { order, item } = await deliveredOrder(b.user.id, 10, 3_000);
      expect(await recalc(b.user.id, pointsSet, l0.id)).toBe(points.id);
      // Khách đã dùng hết số dư (đổi quà, thanh toán đơn khác…): lần trả không thu hồi được điểm nào khỏi số dư.
      await prisma.user.update({ where: { id: b.user.id }, data: { pointsBalance: 0 } });
      await partialReturn(b.admin.id, b.user.id, order.code, [{ orderItemId: item.id, quantity: 9 }]);
      expect(await prisma.pointsTransaction.count({ where: { userId: b.user.id, reason: { startsWith: 'RETURN_REVERSED:' } } })).toBe(0);
      expect(await tierPoints(b.user.id)).toBe(300);
      expect(await recalc(b.user.id, pointsSet, points.id)).toBe(l0.id);
    });

    it('trả một phần, rồi một phần nữa: điểm xét hạng trừ đúng phần đã trả của đơn còn DELIVERED, đơn khác giữ nguyên', async () => {
      const b = await buyer();
      const big = await deliveredOrder(b.user.id, 10, 3_000); // 30.000.000 / 3.000 điểm
      await deliveredOrder(b.user.id, 2, 600); // 6.000.000 / 600 điểm, không trả
      expect(await tierPoints(b.user.id)).toBe(3_600);
      expect(await recalc(b.user.id, pointsSet, l0.id)).toBe(points.id);

      await partialReturn(b.admin.id, b.user.id, big.order.code, [{ orderItemId: big.item.id, quantity: 3 }]);
      expect(await tierPoints(b.user.id)).toBe(2_700); // 3.600 − 900
      expect(await balance(b.user.id)).toBe(2_700);
      expect(await recalc(b.user.id, pointsSet, points.id)).toBe(points.id);

      await partialReturn(b.admin.id, b.user.id, big.order.code, [{ orderItemId: big.item.id, quantity: 4 }]);
      expect(await tierPoints(b.user.id)).toBe(1_500); // 3.600 − 2.100
      expect(await balance(b.user.id)).toBe(1_500);
      expect(await recalc(b.user.id, pointsSet, points.id)).toBe(l0.id);
    });

    it('partial → partial → trả nốt: đơn chuyển RETURNED, ORDER_REVERSED loại nguyên đơn — điểm xét hạng chỉ còn đơn giữ (không trừ thêm các lần trả trước)', async () => {
      const b = await buyer();
      const big = await deliveredOrder(b.user.id, 10, 3_000);
      const kept = await deliveredOrder(b.user.id, 2, 600);

      await partialReturn(b.admin.id, b.user.id, big.order.code, [{ orderItemId: big.item.id, quantity: 3 }]);
      await partialReturn(b.admin.id, b.user.id, big.order.code, [{ orderItemId: big.item.id, quantity: 4 }]);
      expect(await tierPoints(b.user.id)).toBe(1_500);

      const final = await partialReturn(b.admin.id, b.user.id, big.order.code, [{ orderItemId: big.item.id, quantity: 3 }]);
      expect(final.fullReturn).toBe(true);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: big.order.id } })).status).toBe('RETURNED');

      // 3.000 điểm tích của đơn đã thu hồi đủ qua ba lần (900 + 1.200 + 900); đơn giữ 600 điểm còn nguyên.
      expect(await balance(b.user.id)).toBe(600);
      expect(await tierPoints(b.user.id)).toBe(600);
      expect(await prisma.pointsTransaction.count({ where: { userId: b.user.id, reason: `ORDER_REVERSED:${big.order.code}` } })).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: kept.order.id } })).status).toBe('DELIVERED');
      expect(await recalc(b.user.id, pointsSet, points.id)).toBe(l0.id);
    });

    it('partial → partial → trả nốt: chi tiêu của đơn RETURNED không bị trừ lần nữa khỏi các đơn khác (đơn giữ 6 triệu ≥ hạng chi tiêu 5 triệu vẫn giữ hạng)', async () => {
      const tag = randCode(6);
      const small = await prisma.membershipTier.create({
        data: { id: `ITPTR_${tag}_s5`, name: 'Chi tiêu 5 triệu', sortOrder: 1, minPoints: 1_000_000_000, minSpending: 5_000_000, discountPct: 0, pointMultiplier: 1, perks: {} },
      });
      const set = [l0, small];
      const b = await buyer();
      const big = await deliveredOrder(b.user.id, 10, 0);
      await deliveredOrder(b.user.id, 2, 0);
      expect(await recalc(b.user.id, set, l0.id)).toBe(small.id);

      await partialReturn(b.admin.id, b.user.id, big.order.code, [{ orderItemId: big.item.id, quantity: 3 }]);
      await partialReturn(b.admin.id, b.user.id, big.order.code, [{ orderItemId: big.item.id, quantity: 4 }]);
      expect(await recalc(b.user.id, set, small.id)).toBe(small.id); // 36 − 21 = 15 triệu

      const final = await partialReturn(b.admin.id, b.user.id, big.order.code, [{ orderItemId: big.item.id, quantity: 3 }]);
      expect(final.fullReturn).toBe(true);
      // Chỉ còn đơn 6 triệu: nếu các lần trả trước của đơn RETURNED vẫn bị trừ khỏi đơn khác thì chi tiêu về 0 và rớt hạng.
      expect(await recalc(b.user.id, set, small.id)).toBe(small.id);
    });
  });
});
