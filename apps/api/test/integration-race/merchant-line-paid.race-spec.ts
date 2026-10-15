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
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * Q8 review M1 qua checkout THẬT: mã giảm giá gắn sản phẩm chỉ trừ vào dòng sản phẩm đó, nên hàng của đối tác (giao hộ hoặc
 * tự giao) không gánh đồng nào. Checkout lưu tiền thực trả từng dòng (OrderItem.paidTotal); phiếu đối soát và hoàn tiền khách
 * đọc cùng số đó. Phí sàn 10%, mã 50.000 chỉ cho hàng Tubu.
 *   (a) T 2 × 100.000 (Tubu) + C 100.000 (Tubu giao hộ cho gian hàng): C 100.000, phí sàn 10.000, thực nhận 90.000
 *       (chia đều mã theo giá trị dòng: 83.333 / 75.000). Khách trả C → hoàn 100.000 = dòng đảo −100.000.
 *   (c) P 200.000 (Tubu) + M 100.000 (gian hàng tự giao, phí giao 30.000, COD): đơn gian hàng 130.000, hàng 100.000
 *       (chia đều: mã 16.667 → đơn 113.333, gian hàng thu thiếu 16.667).
 */
describe('Mã giảm giá gắn sản phẩm Tubu không trừ vào hàng đối tác (real Postgres, checkout thật)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let returns: OrderReturnsService;
  let settlement: MerchantFulfilmentService;
  const coupon = { productIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        MerchantFulfilmentService,
        {
          provide: CouponsService,
          useValue: {
            validateAndCompute: jest.fn(async () => ({ code: 'TUBUONLY', discount: 50_000, freeship: false, productIds: coupon.productIds })),
            redeem: jest.fn().mockResolvedValue(undefined),
            release: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: ComboService, useValue: { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) } },
        {
          provide: FlashSaleService,
          useValue: {
            resolveEffective: jest.fn().mockResolvedValue(new Map()),
            consumeQuota: jest.fn(),
            restore: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    returns = moduleRef.get(OrderReturnsService);
    settlement = moduleRef.get(MerchantFulfilmentService);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function shop() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itlp-${tag}`, title: `Vườn ${tag}`, ownerUserId: owner.id, isPublished: true, commissionPct: 0.1, shippingFee: 30_000 },
    });
    return store;
  }

  async function variation(data: { storefrontId?: string; fulfilment: 'TUBU' | 'MERCHANT'; price: number }) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: data.fulfilment === 'TUBU' ? `itlp-p-${tag}` : null,
        storefrontId: data.storefrontId ?? null,
        fulfilment: data.fulfilment,
        brand: 'IT',
        slug: `itlp-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: data.price,
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: data.fulfilment === 'TUBU' ? `itlp-v-${tag}` : null,
        productId: product.id,
        sku: `ITLP-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: data.price,
        stock: 20,
      },
    });
  }

  async function buyerWithAddress() {
    const u = await createUser(prisma);
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Khach IT',
        phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
    });
    return { u, addr };
  }

  async function place(userId: string, addressId: string) {
    await prisma.cart.update({ where: { userId }, data: { couponCode: 'TUBUONLY' } });
    await checkout.placeOrder(userId, { addressId, paymentMethod: 'COD' } as never, `itlp-${randCode(12)}`);
    return prisma.order.findMany({ where: { userId }, include: { items: true }, orderBy: { fulfiller: 'asc' } });
  }

  it('(c) đơn gian hàng tự giao: không bị trừ mã của hàng Tubu — tổng 130.000, phiếu tính trên 100.000', async () => {
    const store = await shop();
    const p = await variation({ fulfilment: 'TUBU', price: 200_000 });
    const m = await variation({ fulfilment: 'MERCHANT', storefrontId: store.id, price: 100_000 });
    coupon.productIds = [p.productId];
    const { u, addr } = await buyerWithAddress();
    await cart.addItem(u.id, { variationId: p.id, quantity: 1 });
    await cart.addItem(u.id, { variationId: m.id, quantity: 1 });
    const [tubuOrder, shopOrder] = await place(u.id, addr.id);

    expect(tubuOrder!.couponDiscount).toBe(50_000);
    expect(tubuOrder!.items.map((i) => [i.total, i.paidTotal])).toEqual([[200_000, 150_000]]);
    expect(shopOrder).toMatchObject({ fulfiller: 'MERCHANT', couponDiscount: 0, discount: 0, shippingFee: 30_000, total: 130_000 });
    expect(shopOrder!.items.map((i) => [i.total, i.paidTotal])).toEqual([[100_000, 100_000]]);

    await prisma.order.update({ where: { id: shopOrder!.id }, data: { status: 'DELIVERED', deliveredAt: ago(10) } });
    const st = await settlement.statementFor(store.id);
    expect(st.lines.map((l) => [l.kind, l.goodsAmount, l.shippingFee, l.commissionAmount, l.codCollected, l.netAmount])).toEqual([
      ['SALE', 100_000, 30_000, 10_000, 130_000, -10_000],
    ]);
  });

  it('(a) hàng Tubu giao hộ: C tính trên 100.000, thực nhận 90.000; khách trả C được hoàn 100.000 = dòng đảo của gian hàng', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const store = await shop();
    const t = await variation({ fulfilment: 'TUBU', price: 100_000 });
    const c = await variation({ fulfilment: 'TUBU', storefrontId: store.id, price: 100_000 });
    await prisma.merchantPancakeLink.create({ data: { storefrontId: store.id, productId: c.productId, variationId: c.id, linkedAt: ago(60) } });
    coupon.productIds = [t.productId];
    const { u, addr } = await buyerWithAddress();
    await cart.addItem(u.id, { variationId: t.id, quantity: 2 });
    await cart.addItem(u.id, { variationId: c.id, quantity: 1 });
    const orders = await place(u.id, addr.id);
    expect(orders).toHaveLength(1);
    const order = orders[0]!;
    const iT = order.items.find((i) => i.variationId === t.id)!;
    const iC = order.items.find((i) => i.variationId === c.id)!;
    expect([iT.total, iT.paidTotal, iC.total, iC.paidTotal]).toEqual([200_000, 150_000, 100_000, 100_000]);
    expect(order.total).toBe(250_000 + order.shippingFee);

    await prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: ago(10) } });
    const st = await settlement.statementFor(store.id);
    expect(st.lines.map((l) => [l.refKey, l.goodsAmount, l.commissionAmount, l.netAmount])).toEqual([[`ITEM:${iC.id}`, 100_000, 10_000, 90_000]]);
    const payout = await settlement.createPayout(admin.id, store.id);
    expect(payout.amount).toBe(90_000);

    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: ago(2) } });
    const r = await returns.request(u.id, order.code, { reasonCode: 'OTHER', reason: 'Không cần nữa', items: [{ orderItemId: iC.id, quantity: 1 }] });
    const preview = await returns.preview(r.id);
    expect(preview.refund).toBe(100_000);
    await returns.review(admin.id, r.id, { approve: true, expectedRefund: preview.refund });
    const after = await settlement.statementFor(store.id);
    expect(after.lines.map((l) => [l.kind, l.refKey, l.goodsAmount, l.commissionAmount, l.netAmount])).toEqual([
      ['REVERSAL', `RETURN:${r.id}:ITEM:${iC.id}`, -100_000, -10_000, -90_000],
    ]);
  });
});
