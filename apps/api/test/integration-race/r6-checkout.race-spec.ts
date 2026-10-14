import { randomInt } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService, TOTAL_CHANGED } from '../../src/modules/checkout/checkout.service';
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
import { createUser, randCode, setConfig, warmPool } from './helpers';

const NOT_ALLOWED = 'PAYMENT_METHOD_NOT_ALLOWED';

/**
 * UAT vòng 4, gói r6-checkout, trên Postgres thật với các service tiền là bản thật:
 * - R4-CHECKOUT-2: hạn mức COD 5.000.000đ xét trên từng đơn sau khi tách theo nơi giao; báo giá khoá đúng các phương thức mà
 *   đặt hàng sẽ từ chối, bằng đúng câu lý do đó.
 * - R4-CHECKOUT-3: mã gắn sản phẩm mà sản phẩm đó đang giờ vàng → báo đúng là giờ vàng.
 * - R4-CHECKOUT-4: tổng tăng vì mã bị tắt giữa báo giá và đặt → TOTAL_CHANGED nêu mã, không đổ cho giá/phí giao.
 * - R4-CHECKOUT-5: đơn CTV lên hộ trong giờ vàng tính đúng giá khách tự đặt, giữ và hoàn suất như đơn thường.
 */
describe('r6-checkout (UAT vòng 4) — real Postgres', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let affiliate: AffiliateService;
  let reversal: OrderReversalService;

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
        ComboService,
        FlashSaleService,
        OrderReversalService,
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
    affiliate = moduleRef.get(AffiliateService);
    reversal = moduleRef.get(OrderReversalService);
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const key = () => `itr6-${randCode(12)}`;

  async function shop() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    return prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itr6-${tag}`, title: `Vườn ${tag}`, ownerUserId: owner.id, isPublished: true, commissionPct: 0.1, shippingFee: 30_000 },
    });
  }

  /** Hàng Tubu (có mã Pancake) hoặc hàng gian hàng tự giao (`selfShip` = id gian hàng). */
  async function variation(price: number, selfShip?: string) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: selfShip ? null : `itr6-p-${tag}`,
        storefrontId: selfShip ?? null,
        fulfilment: selfShip ? 'MERCHANT' : 'TUBU',
        brand: 'IT',
        slug: `itr6-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: selfShip ? null : `itr6-v-${tag}`,
        productId: product.id,
        sku: `ITR6-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: price,
        stock: 100,
      },
    });
  }

  async function buyer(walletBalance = 0) {
    const u = await createUser(prisma, { phone: phone(), walletBalance });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Khach IT',
        phone: phone(),
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

  async function flashSale(variationId: string, flashPrice: number, quota = 10, perUserLimit = 5) {
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    return prisma.flashSaleItem.create({ data: { flashSaleId: sale.id, variationId, flashPrice, quota, perUserLimit } });
  }

  const placeError = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => {
        if (!(e instanceof BadRequestException)) throw e;
        return e.getResponse() as { code?: string; message: string };
      },
    );

  describe('R4-CHECKOUT-2: hạn mức COD theo từng đơn sau khi tách', () => {
    it('hàng Tubu 2.600.000đ + hàng gian hàng tự giao 3.000.000đ + phí giao 30.000đ (tổng 5.630.000đ): báo giá không khoá COD, đặt COD được hai đơn đều dưới mức', async () => {
      const store = await shop();
      const t = await variation(260_000);
      const m = await variation(150_000, store.id);
      const u = await buyer();
      await cart.addItem(u.userId, { variationId: t.id, quantity: 10 });
      await cart.addItem(u.userId, { variationId: m.id, quantity: 20 });

      const q = await checkout.quote(u.userId, { addressId: u.addressId });
      expect(q.total).toBe(5_630_000);
      expect(q.blockedPaymentMethods.COD).toBeUndefined();
      expect(Object.keys(q.blockedPaymentMethods).sort()).toEqual(['BANK_TRANSFER', 'ZALOPAY']);

      await checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', expectedTotal: q.total } as never, key());
      const orders = await prisma.order.findMany({ where: { userId: u.userId }, orderBy: { fulfiller: 'asc' } });
      expect(orders.map((o) => [o.fulfiller, o.paymentMethod, o.total])).toEqual([
        ['TUBU', 'COD', 2_600_000],
        ['MERCHANT', 'COD', 3_030_000],
      ]);
    });

    it('phần gian hàng 5.230.000đ (một đơn vượt mức): báo giá khoá COD kèm lý do; đặt COD bị từ chối bằng đúng câu đó, không tạo đơn, không giữ kho', async () => {
      const store = await shop();
      const t = await variation(100_000);
      const m = await variation(260_000, store.id);
      const u = await buyer();
      await cart.addItem(u.userId, { variationId: t.id, quantity: 1 });
      await cart.addItem(u.userId, { variationId: m.id, quantity: 20 });

      const q = await checkout.quote(u.userId, { addressId: u.addressId });
      expect(q.blockedPaymentMethods.COD).toBe(
        `Thanh toán khi nhận hàng (COD) chỉ nhận mỗi đơn tối đa 5.000.000đ, mà đơn do ${store.title} giao là 5.230.000đ. ` +
          `Bạn có thể trả bằng Ví Tubu nếu số dư đủ, hoặc bớt số lượng hàng của ${store.title} để đơn không quá 5.000.000đ.`,
      );
      const err = await placeError(
        checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', expectedTotal: q.total } as never, key()),
      );
      expect(err).toMatchObject({ code: NOT_ALLOWED, message: q.blockedPaymentMethods.COD });
      expect(await prisma.order.count({ where: { userId: u.userId } })).toBe(0);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: m.id } })).stock).toBe(100);
    });

    it('mọi giỏ thử: phương thức báo giá khoá thì đặt bị từ chối đúng câu đó, không khoá thì đặt được', async () => {
      const store = await shop();
      const tSmall = await variation(100_000);
      const tBig = await variation(600_000);
      const mSmall = await variation(150_000, store.id);
      const mBig = await variation(270_000, store.id);
      const carts: Array<Array<[string, number]>> = [
        [[tSmall.id, 1]],
        [[tBig.id, 9]],
        [[tSmall.id, 2], [mSmall.id, 20]],
        [[tBig.id, 9], [mSmall.id, 1]],
        [[mBig.id, 20]],
      ];
      for (const lines of carts) {
        for (const method of ['COD', 'BANK_TRANSFER', 'ZALOPAY', 'WALLET']) {
          const u = await buyer(100_000_000);
          for (const [variationId, quantity] of lines) await cart.addItem(u.userId, { variationId, quantity });
          const q = await checkout.quote(u.userId, { addressId: u.addressId });
          const err = await placeError(
            checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: method, expectedTotal: q.total } as never, key()),
          );
          const blocked = (q.blockedPaymentMethods as Record<string, string>)[method] ?? null;
          expect([lines.length, method, err?.message ?? null]).toEqual([lines.length, method, blocked]);
          if (blocked) expect(err?.code).toBe(NOT_ALLOWED);
          else expect(await prisma.order.count({ where: { userId: u.userId } })).toBe(q.shipments.length);
        }
      }
    });
  });

  it('R4-CHECKOUT-3: mã gắn sản phẩm mà sản phẩm đó trong giỏ đang giờ vàng → báo đang giờ vàng, không nói giỏ chưa có sản phẩm', async () => {
    const granola = await variation(140_000);
    const other = await variation(90_000);
    await flashSale(granola.id, 120_000);
    const code = `PSG${randCode(6)}`;
    await prisma.coupon.create({
      data: {
        code, type: 'AMOUNT', value: 20_000, scope: 'PUBLIC', applyTo: { productIds: [granola.productId] },
        startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000),
      },
    });
    const u = await buyer();
    await cart.addItem(u.userId, { variationId: granola.id, quantity: 1 });
    await cart.addItem(u.userId, { variationId: other.id, quantity: 1 });
    expect((await cart.getCart(u.userId)).items.find((l) => l.variationId === granola.id)).toMatchObject({ isFlash: true, unitPrice: 120_000 });
    await expect(cart.applyCoupon(u.userId, code)).rejects.toThrow(
      'Sản phẩm áp dụng mã đang có giá giờ vàng. Giá giờ vàng là giá ưu đãi cuối nên không giảm thêm theo mã, bạn dùng được mã này khi giờ vàng kết thúc.',
    );
    expect((await prisma.cart.findUniqueOrThrow({ where: { userId: u.userId } })).couponCode).toBeNull();
  });

  it('R4-CHECKOUT-4: admin tắt mã giữa lúc báo giá và lúc đặt → TOTAL_CHANGED nêu mã và lý do; không tạo đơn', async () => {
    const t = await variation(260_000);
    const code = `GIAM${randCode(6)}`;
    const coupon = await prisma.coupon.create({
      data: { code, type: 'AMOUNT', value: 50_000, scope: 'PUBLIC', startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) },
    });
    const u = await buyer();
    await cart.addItem(u.userId, { variationId: t.id, quantity: 1 });
    await cart.applyCoupon(u.userId, code);
    const q = await checkout.quote(u.userId, { addressId: u.addressId });
    expect([q.couponApplied, q.total]).toEqual([true, 210_000]);

    await prisma.coupon.update({ where: { id: coupon.id }, data: { isActive: false } });
    const err = await placeError(
      checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', expectedTotal: q.total } as never, key()),
    );
    expect(err).toEqual(
      expect.objectContaining({
        code: TOTAL_CHANGED,
        message: `Tổng tiền đơn vừa thay đổi từ 210.000đ thành 260.000đ vì mã ${code} không còn được áp dụng. Lý do: Mã giảm giá đã ngừng áp dụng. Vui lòng xem lại trước khi đặt.`,
      }),
    );
    expect(await prisma.order.count({ where: { userId: u.userId } })).toBe(0);
  });

  describe('R4-CHECKOUT-5: đơn CTV lên hộ tính giá như khách tự đặt', () => {
    const CUSTOMER = {
      recipient: 'Khách của CTV', province: 'Ha Noi', district: '', ward: 'Phuong IT', street: '9 Duong IT',
      provinceCode: '84_VN01', districtCode: '', wardCode: '00001',
    };

    it('trong giờ vàng: cùng lúc khách tự đặt và CTV lên hộ cùng món ra cùng đơn giá, cùng tổng; đơn hộ giữ suất, huỷ thì trả suất', async () => {
      const granola = await variation(140_000);
      const item = await flashSale(granola.id, 120_000, 10, 2);
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: phone() });

      const self = await buyer();
      await cart.addItem(self.userId, { variationId: granola.id, quantity: 2 });
      await checkout.placeOrder(self.userId, { addressId: self.addressId, paymentMethod: 'COD' } as never, key());
      const own = await prisma.order.findFirstOrThrow({ where: { userId: self.userId }, include: { items: true } });

      const quote = await affiliate.quoteOrderForCustomer(ctv.id, { items: [{ variationId: granola.id, quantity: 2 }] });
      const placed = await affiliate.placeOrderForCustomer(ctv.id, {
        items: [{ variationId: granola.id, quantity: 2 }],
        customer: { ...CUSTOMER, phone: phone() },
        paymentMethod: 'COD',
      } as never);
      const assisted = await prisma.order.findUniqueOrThrow({ where: { id: placed.id }, include: { items: true } });

      expect([assisted.items[0]!.unitPrice, assisted.subtotal, assisted.total]).toEqual([own.items[0]!.unitPrice, own.subtotal, own.total]);
      expect([assisted.items[0]!.unitPrice, assisted.items[0]!.flashSaleItemId]).toEqual([120_000, item.id]);
      expect([quote.items[0]!.unitPrice, quote.total]).toEqual([120_000, assisted.total]);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(4);
      expect((await prisma.flashSalePurchase.findUniqueOrThrow({ where: { flashSaleItemId_userId: { flashSaleItemId: item.id, userId: ctv.id } } })).quantity).toBe(2);

      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: assisted.id }, data: { status: 'CANCELLED' } });
        await reversal.reverseFinancials(tx, assisted);
      });
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(2);
      expect((await prisma.flashSalePurchase.findUniqueOrThrow({ where: { flashSaleItemId_userId: { flashSaleItemId: item.id, userId: ctv.id } } })).quantity).toBe(0);
    });

    it('CTV đã dùng hết suất giờ vàng của mình → báo giá và đơn hộ cùng tính giá thường, kèm lý do ở báo giá; không giữ suất', async () => {
      const granola = await variation(140_000);
      const item = await flashSale(granola.id, 120_000, 10, 2);
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: phone() });
      const order = (qty: number) =>
        affiliate.placeOrderForCustomer(ctv.id, {
          items: [{ variationId: granola.id, quantity: qty }],
          customer: { ...CUSTOMER, phone: phone() },
          paymentMethod: 'COD',
        } as never);
      await order(2);
      const quote = await affiliate.quoteOrderForCustomer(ctv.id, { items: [{ variationId: granola.id, quantity: 1 }] });
      expect(quote.items[0]).toMatchObject({ unitPrice: 140_000, isFlash: false, flashLimitNotice: expect.stringContaining('hết suất giờ vàng') });
      const second = await order(1);
      const items = await prisma.orderItem.findMany({ where: { orderId: second.id } });
      expect(items.map((i) => [i.unitPrice, i.flashSaleItemId])).toEqual([[140_000, null]]);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(2);
    });
  });
});
