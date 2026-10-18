import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * R5-CHECKOUT-7: Điểm Xanh tích được cộng trên tiền hàng khách thực trả (sau giảm điểm), nên trả một phần phải thu hồi theo
 * phần tiền thực trả của các đơn vị trả (OrderItem.paidTotal), không theo tỉ lệ giá gốc. Ca UAT: giảm điểm chỉ nằm ở dòng Tubu
 * được giữ lại, trả hàng ký gửi → thu thiếu điểm. Chạy qua CheckoutService, LoyaltyService và OrderReturnsService thật.
 */
describe('Thu hồi Điểm Xanh tích khi trả một phần theo tiền thực trả (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let loyalty: LoyaltyService;
  let returns: OrderReturnsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        WalletLedgerService,
        CashbackService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        MerchantFulfilmentService,
        ComboService,
        FlashSaleService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    loyalty = moduleRef.get(LoyaltyService);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
    await setConfig(prisma, 'shipping.tier_freeship_overrides', {});
    await setConfig(prisma, 'loyalty.earn_pct', 2);
    await setConfig(prisma, 'loyalty.vnd_per_point_redeem', 1);
    await setConfig(prisma, 'loyalty.max_redeem_pct', 0.2);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function consignmentStore() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    return prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itr7-${tag}`, title: `Vườn ${tag}`, ownerUserId: owner.id, isPublished: true, commissionPct: 0.1 },
    });
  }

  async function variation(price: number, consignment?: string) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `itr7-p-${tag}`,
        storefrontId: consignment ?? null,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itr7-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
      },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `itr7-v-${tag}`, productId: product.id, sku: `ITR7-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock: 50 },
    });
    if (consignment) {
      await prisma.merchantPancakeLink.create({ data: { storefrontId: consignment, productId: product.id, variationId: v.id, linkedAt: ago(60) } });
    }
    return v;
  }

  /**
   * T 300.000 (Tubu) + mật ong 200.000 + trà 2 × 150.000 (ký gửi, Tubu giao hộ), dùng 100.000 Điểm Xanh (chỉ trừ vào T): tiền hàng
   * thực trả 700.000 → 14.000 điểm tích (2%), cộng khi giao.
   */
  async function deliveredOrder() {
    const store = await consignmentStore();
    const t = await variation(300_000);
    const honey = await variation(200_000, store.id);
    const tea = await variation(150_000, store.id);
    const tierId = `IT_${randCode(8)}`;
    await prisma.membershipTier.create({ data: { id: tierId, name: `Hạng ${tierId}`, minPoints: 0, discountPct: 0, pointMultiplier: 1, perks: {} } });
    const u = await createUser(prisma, { phone: phone(), pointsConvertedBalance: 100_000, tierId });
    const addr = await prisma.address.create({
      data: { userId: u.id, recipient: 'Khach IT', phone: phone(), province: 'Ha Noi', district: '', ward: 'Phuong IT', street: '1 Duong IT', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });
    await cart.addItem(u.id, { variationId: t.id, quantity: 1 });
    await cart.addItem(u.id, { variationId: honey.id, quantity: 1 });
    await cart.addItem(u.id, { variationId: tea.id, quantity: 2 });
    const q = await checkout.quote(u.id, { addressId: addr.id, pointsToUse: 100_000 } as never);
    await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 100_000, expectedTotal: q.total } as never, `itr7-${randCode(12)}`);
    const order = await prisma.order.findFirstOrThrow({ where: { userId: u.id }, include: { items: true } });
    const item = (vid: string) => order.items.find((i) => i.variationId === vid)!;
    expect(order).toMatchObject({ subtotal: 800_000, pointsUsed: 100_000, pointsDiscount: 100_000, shippingFee: 0, total: 700_000, pointsEarned: 14_000 });
    expect([item(t.id), item(honey.id), item(tea.id)].map((i) => [i.paidTotal, i.pointsDiscount])).toEqual([
      [200_000, 100_000],
      [200_000, 0],
      [300_000, 0],
    ]);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: ago(2) } });
    await loyalty.creditOrderPoints(order.id);
    const admin = await createUser(prisma, { role: 'ADMIN' });
    return { userId: u.id, order, admin, t: item(t.id), honey: item(honey.id), tea: item(tea.id) };
  }

  const earnedReversed = async (userId: string, code: string) =>
    (await prisma.pointsTransaction.findMany({ where: { userId, reason: { in: [`RETURN_REVERSED:${code}`, `ORDER_REVERSED:${code}`] } } })).reduce(
      (s, r) => s + r.delta,
      0,
    );

  it('trả mật ong + 1 trà (khách trả 350.000 trên 700.000) thu đúng 7.000 điểm tích, cả lúc xem trước lẫn lúc duyệt (trước: 6.200 theo giá gốc)', async () => {
    const o = await deliveredOrder();
    const req = await returns.request(o.userId, o.order.code, {
      reasonCode: 'OTHER',
      reason: 'Không cần nữa',
      items: [{ orderItemId: o.honey.id, quantity: 1 }, { orderItemId: o.tea.id, quantity: 1 }],
    });
    expect(await returns.preview(req.id)).toMatchObject({ goods: 350_000, pointsUsedBack: 0, pointsEarnedBack: 7_000 });
    await returns.review(o.admin.id, req.id, { approve: true });
    expect(await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ pointsReversed: 7_000, pointsRefunded: 0 });
    expect(await earnedReversed(o.userId, o.order.code)).toBe(-7_000);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: o.userId } })).pointsBalance).toBe(7_000);
  });

  it('hai admin duyệt cùng lúc một yêu cầu: chỉ một lần thu 7.000 điểm', async () => {
    const o = await deliveredOrder();
    const req = await returns.request(o.userId, o.order.code, {
      reasonCode: 'OTHER',
      reason: 'Không cần nữa',
      items: [{ orderItemId: o.honey.id, quantity: 1 }, { orderItemId: o.tea.id, quantity: 1 }],
    });
    const second = await createUser(prisma, { role: 'ADMIN' });
    const s = summarize(await Promise.allSettled([returns.review(o.admin.id, req.id, { approve: true }), returns.review(second.id, req.id, { approve: true })]));
    expect(s.fulfilled).toHaveLength(1);
    expect(await earnedReversed(o.userId, o.order.code)).toBe(-7_000);
  });

  it('trả ba lần (mật ong + 1 trà, trà còn lại, rồi T): 7.000 + 3.000 + 4.000, cộng lại đúng 14.000 điểm đã tích', async () => {
    const o = await deliveredOrder();
    const ask = (items: { orderItemId: string; quantity: number }[]) =>
      returns.request(o.userId, o.order.code, { reasonCode: 'OTHER', reason: 'Không cần nữa', items });

    const r1 = await ask([{ orderItemId: o.honey.id, quantity: 1 }, { orderItemId: o.tea.id, quantity: 1 }]);
    await returns.review(o.admin.id, r1.id, { approve: true });
    const r2 = await ask([{ orderItemId: o.tea.id, quantity: 1 }]);
    expect(await returns.preview(r2.id)).toMatchObject({ goods: 150_000, pointsEarnedBack: 3_000 });
    await returns.review(o.admin.id, r2.id, { approve: true });
    expect(await earnedReversed(o.userId, o.order.code)).toBe(-10_000);

    const r3 = await ask([{ orderItemId: o.t.id, quantity: 1 }]);
    expect(await returns.preview(r3.id)).toMatchObject({ isFull: true, pointsEarnedBack: 4_000 });
    await returns.review(o.admin.id, r3.id, { approve: true });
    expect(await earnedReversed(o.userId, o.order.code)).toBe(-14_000);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: o.userId } })).pointsBalance).toBe(0);
  });
});
