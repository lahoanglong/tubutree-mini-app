import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { GIFT_TRIAL_CHANGED, GIFT_TRIAL_UNAVAILABLE } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CartController } from '../../src/modules/cart/cart.controller';
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
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { paidLineTotals } from '../../src/modules/affiliate/commission-base';
import { GiftTrialService } from '../../src/modules/gift-tiers/gift-trial.service';
import { GIFT_TRIAL_ENABLED_KEY, GIFT_TRIAL_MIN_ORDER_KEY, GIFT_TRIAL_OPTIONS_KEY } from '../../src/modules/gift-tiers/gift-trial';
import { createUser, pinConfig, randCode, setConfig, warmPool } from './helpers';

/**
 * Quà tặng dùng thử 0đ trên Postgres thật: quà là một dòng 0đ trong kiện Tubu, tiền đơn = báo giá = báo giá khi cờ tắt (không đổi tiền hàng,
 * nền hoa hồng, điểm tích); kho quà trừ đúng 1. Hai đơn tranh đơn vị quà cuối: đúng một đơn có quà, kho không âm; khách đã thấy quà thì đơn
 * thua nhận 409 và không có đơn nào được ghi, app cũ (không gửi trường quà) thì đơn thua vẫn đặt được nhưng không kèm quà. Chưa đủ mốc mà
 * gửi quà thì 409 GIFT_TRIAL_CHANGED, kho quà giữ nguyên.
 */
describe('Quà tặng dùng thử 0đ: dòng quà 0đ, kho quà, đặt đơn đồng thời (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let cartApi: CartController;
  let config: SystemConfigService;
  const restores: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        ComboService,
        FlashSaleService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        GiftTrialService,
        { provide: LifecycleService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    config = moduleRef.get(SystemConfigService);
    cartApi = new CartController(cart, { listPending: async () => [] } as never, moduleRef.get(GiftTrialService));
    // DB race dùng chung giữa các suite: ghim cờ và mốc rồi trả lại giá trị cũ.
    restores.push(await pinConfig(prisma, GIFT_TRIAL_ENABLED_KEY, false));
    restores.push(await pinConfig(prisma, GIFT_TRIAL_MIN_ORDER_KEY, 299_000));
    restores.push(await pinConfig(prisma, GIFT_TRIAL_OPTIONS_KEY, []));
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await moduleRef?.close();
  });

  /** Ghi qua SystemConfigService.set (xoá cache 60 giây và chạy luật ghi), như admin sửa ở tab Cấu hình. */
  async function giftConfig(on: boolean, giftVariationId?: string) {
    if (giftVariationId) await config.set(GIFT_TRIAL_OPTIONS_KEY, [{ variationId: giftVariationId }], 'it-gift-trial');
    await config.set(GIFT_TRIAL_ENABLED_KEY, on, 'it-gift-trial');
  }

  async function product(price: number, stock = 50) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itgt-p-${tag}`,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itgt-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
        variations: { create: { pancakeId: `itgt-v-${tag}`, sku: `ITGT-${tag}`, name: 'Gói bỏ túi', attributes: {}, retailPrice: price, stock } },
      },
      include: { variations: true },
    });
    return { productId: p.id, variationId: p.variations[0]!.id };
  }

  async function buyer() {
    const phone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    const u = await createUser(prisma, { phone, zaloId: `z-${randCode(10)}` });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Khach IT',
        phone,
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
    });
    return { userId: u.id, addressId: addr.id };
  }

  async function buyerWithCart(prices: number[]) {
    const b = await buyer();
    for (const price of prices) await cart.addItem(b.userId, { variationId: (await product(price)).variationId, quantity: 1 });
    return b;
  }

  const stockOf = async (variationId: string) => (await prisma.variation.findUniqueOrThrow({ where: { id: variationId }, select: { stock: true } })).stock;
  const ordersOf = (userId: string) => prisma.order.findMany({ where: { userId }, include: { items: true } });
  const place = (b: { userId: string; addressId: string }, expectedTotal: number, giftVariationId?: string | null) =>
    checkout.placeOrder(
      b.userId,
      { addressId: b.addressId, paymentMethod: 'COD', expectedTotal, ...(giftVariationId !== undefined ? { giftVariationId } : {}) } as never,
      `itgt-${randCode(12)}`,
    );
  const conflictCode = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' && r.reason instanceof ConflictException ? (r.reason.getResponse() as { code?: string }).code : undefined;

  afterEach(() => giftConfig(false));

  it('đủ mốc: giỏ = báo giá chọn sẵn quà; đơn có dòng quà 0đ trong kiện Tubu, tiền hàng, nền hoa hồng, điểm như cờ tắt; kho quà −1; lựa chọn quà về mặc định', async () => {
    const gift = await product(35_000, 5);
    const b = await buyerWithCart([180_000, 150_000]);
    const off = await checkout.quote(b.userId, { addressId: b.addressId });
    expect(off.giftTrial).toBeUndefined();

    await giftConfig(true, gift.variationId);
    const c = await cartApi.get(b.userId, {} as never);
    expect(c.giftTrial).toMatchObject({ base: 330_000, minOrder: 299_000, selectedVariationId: gift.variationId, declined: false });
    const q = await checkout.quote(b.userId, { addressId: b.addressId });
    expect(q.giftTrial?.selectedVariationId).toBe(gift.variationId);
    expect({ total: q.total, shippingFee: q.shippingFee, pointsEarned: q.pointsEarned }).toEqual({
      total: off.total,
      shippingFee: off.shippingFee,
      pointsEarned: off.pointsEarned,
    });
    await cartApi.setGift(b.userId, { variationId: gift.variationId } as never, {} as never);

    await place(b, q.total, gift.variationId);
    const [o] = await ordersOf(b.userId);
    expect(o!.total).toBe(q.total);
    const goods = o!.total - o!.shippingFee;
    const giftLines = o!.items.filter((i) => i.isGift);
    expect(giftLines).toHaveLength(1);
    expect(giftLines[0]).toMatchObject({ variationId: gift.variationId, unitPrice: 0, quantity: 1, total: 0, paidTotal: 0, pointsDiscount: 0, flashSaleItemId: null });
    expect(o!.items.reduce((s, i) => s + (i.paidTotal ?? 0), 0)).toBe(goods);
    expect(paidLineTotals(o!, o!.items).reduce((s, v) => s + v, 0)).toBe(goods);
    expect(o!.pointsEarned).toBe(q.pointsEarned);
    expect(await stockOf(gift.variationId)).toBe(4);
    expect((await prisma.cart.findUnique({ where: { userId: b.userId }, select: { giftChoice: true } }))?.giftChoice ?? null).toBeNull();
  });

  it('khách chọn "Không nhận quà" (null): đơn không có dòng quà, kho quà giữ nguyên', async () => {
    const gift = await product(35_000, 5);
    const b = await buyerWithCart([180_000, 150_000]);
    await giftConfig(true, gift.variationId);
    const q = await checkout.quote(b.userId, { addressId: b.addressId });
    await place(b, q.total, null);
    const [o] = await ordersOf(b.userId);
    expect(o!.items.some((i) => i.isGift)).toBe(false);
    expect(await stockOf(gift.variationId)).toBe(5);
  });

  it('chưa đủ mốc mà gửi quà: 409 GIFT_TRIAL_CHANGED, không ghi đơn, kho quà giữ nguyên', async () => {
    const gift = await product(35_000, 5);
    const b = await buyerWithCart([150_000, 100_000]);
    await giftConfig(true, gift.variationId);
    const q = await checkout.quote(b.userId, { addressId: b.addressId });
    expect(q.giftTrial).toMatchObject({ base: 250_000, shortfall: 49_000, selectedVariationId: null });
    const [r] = await Promise.allSettled([place(b, q.total, gift.variationId)]);
    expect(conflictCode(r!)).toBe(GIFT_TRIAL_CHANGED);
    expect(await ordersOf(b.userId)).toHaveLength(0);
    expect(await stockOf(gift.variationId)).toBe(5);
  });

  it('hai khách đã thấy quà cùng đặt đơn vị quà cuối: đúng một đơn có quà, đơn kia 409 và không ghi; kho quà 0, không âm', async () => {
    const gift = await product(35_000, 1);
    const [b1, b2] = await Promise.all([buyerWithCart([180_000, 150_000]), buyerWithCart([200_000, 120_000])]);
    await giftConfig(true, gift.variationId);
    const [q1, q2] = await Promise.all([checkout.quote(b1.userId, { addressId: b1.addressId }), checkout.quote(b2.userId, { addressId: b2.addressId })]);
    expect([q1.giftTrial?.selectedVariationId, q2.giftTrial?.selectedVariationId]).toEqual([gift.variationId, gift.variationId]);

    const results = await Promise.allSettled([place(b1, q1.total, gift.variationId), place(b2, q2.total, gift.variationId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected')!;
    expect([GIFT_TRIAL_UNAVAILABLE, GIFT_TRIAL_CHANGED]).toContain(conflictCode(lost));
    const orders = [...(await ordersOf(b1.userId)), ...(await ordersOf(b2.userId))];
    expect(orders).toHaveLength(1);
    expect(orders[0]!.items.filter((i) => i.isGift)).toHaveLength(1);
    expect(await stockOf(gift.variationId)).toBe(0);
  });

  it('quà trùng món khách đang mua: tồn chỉ đủ phần giỏ thì không đưa quà (không 409 lặp); tồn dư 1 thì đơn có cả dòng mua lẫn dòng quà', async () => {
    const gift = await product(35_000, 1);
    const b = await buyerWithCart([300_000]);
    await cart.addItem(b.userId, { variationId: gift.variationId, quantity: 1 });
    await giftConfig(true, gift.variationId);
    const q = await checkout.quote(b.userId, { addressId: b.addressId });
    expect(q.giftTrial ?? null).toBeNull();
    await place(b, q.total, null);
    expect((await ordersOf(b.userId))[0]!.items.some((i) => i.isGift)).toBe(false);
    expect(await stockOf(gift.variationId)).toBe(0);

    await prisma.variation.update({ where: { id: gift.variationId }, data: { stock: 2 } });
    const b2 = await buyerWithCart([300_000]);
    await cart.addItem(b2.userId, { variationId: gift.variationId, quantity: 1 });
    const q2 = await checkout.quote(b2.userId, { addressId: b2.addressId });
    expect(q2.giftTrial?.selectedVariationId).toBe(gift.variationId);
    await place(b2, q2.total, gift.variationId);
    const [o] = await ordersOf(b2.userId);
    expect(o!.items.filter((i) => i.variationId === gift.variationId).map((i) => [i.isGift, i.unitPrice]).sort()).toEqual([
      [false, 35_000],
      [true, 0],
    ]);
    expect(await stockOf(gift.variationId)).toBe(0);
  });

  it('app cũ (không gửi trường quà) cùng đặt đơn vị quà cuối: cả hai đơn đặt được, đúng một đơn kèm quà; kho quà 0', async () => {
    const gift = await product(35_000, 1);
    const [b1, b2] = await Promise.all([buyerWithCart([180_000, 150_000]), buyerWithCart([200_000, 120_000])]);
    await giftConfig(true, gift.variationId);
    const [q1, q2] = await Promise.all([checkout.quote(b1.userId, { addressId: b1.addressId }), checkout.quote(b2.userId, { addressId: b2.addressId })]);

    const results = await Promise.allSettled([place(b1, q1.total), place(b2, q2.total)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const orders = [...(await ordersOf(b1.userId)), ...(await ordersOf(b2.userId))];
    expect(orders).toHaveLength(2);
    expect(orders.flatMap((o) => o.items.filter((i) => i.isGift))).toHaveLength(1);
    expect(orders.map((o) => o.total).sort()).toEqual([q1.total, q2.total].sort());
    expect(await stockOf(gift.variationId)).toBe(0);
  });
});
