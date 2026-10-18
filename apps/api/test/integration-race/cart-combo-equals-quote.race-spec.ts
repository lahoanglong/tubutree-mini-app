import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
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
import { BadRequestException } from '@nestjs/common';
import { createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * Trang giỏ (CartService.getCart, có gửi gian hàng ghi công) phải ra ĐÚNG số báo giá checkout trừ: combo gian hàng, mức giảm của mã
 * (tính trên phần hàng SAU combo) và tiền hàng sau giảm. Postgres thật; ComboService, CouponsService là bản thật.
 */
describe('Trang giỏ = báo giá checkout: combo, mã, tiền hàng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let cartApi: CartController;

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
        { provide: LifecycleService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: GomdonOrderService,
          useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() },
        },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    cartApi = new CartController(cart);
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  // Bảng hạng là dữ liệu chung của cả bộ race: recalcTier gán hạng thấp nhất cho mọi khách, nên hạng giảm % để lại sẽ làm
  // đơn của suite khác bị giảm giá (vd. rớt dưới mức tối thiểu của thưởng giới thiệu).
  const tierIds: string[] = [];

  afterAll(async () => {
    if (tierIds.length) {
      await prisma.user.updateMany({ where: { tierId: { in: tierIds } }, data: { tierId: null } });
      await prisma.membershipTier.deleteMany({ where: { id: { in: tierIds } } });
    }
    await moduleRef?.close();
  });

  async function product(price: number, opts: { storefrontId?: string; fulfilment?: 'TUBU' | 'MERCHANT' } = {}) {
    const tag = randCode(8);
    const fulfilment = opts.fulfilment ?? 'TUBU';
    const p = await prisma.product.create({
      data: {
        pancakeId: fulfilment === 'TUBU' ? `itcp-p-${tag}` : null,
        storefrontId: opts.storefrontId ?? null,
        fulfilment,
        brand: 'IT',
        slug: `itcp-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
        variations: {
          create: {
            pancakeId: fulfilment === 'TUBU' ? `itcp-v-${tag}` : null,
            sku: `ITCP-${tag}`,
            name: 'Mặc định',
            attributes: {},
            retailPrice: price,
            stock: 50,
          },
        },
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

  async function coupon(
    userId: string,
    type: 'PERCENT' | 'AMOUNT' | 'FREESHIP',
    value: number,
    extra: { minOrder?: number; maxDiscount?: number; productIds?: string[]; usageLimit?: number; tierId?: string } = {},
  ) {
    const c = await prisma.coupon.create({
      data: {
        code: `ITCP${randCode(10)}`,
        type,
        value,
        minOrder: extra.minOrder ?? null,
        maxDiscount: extra.maxDiscount ?? null,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
        perUserLimit: 1,
        usageLimit: extra.usageLimit ?? null,
        scope: extra.tierId ? 'TIER' : 'USER_GROUP',
        scopeMeta: extra.tierId ? { tierId: extra.tierId } : { userId },
        applyTo: extra.productIds ? { productIds: extra.productIds } : undefined,
      },
    });
    return c.code;
  }


  async function comboStore(a: string, c: string, pct: number) {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const slug = `itcc-${randCode(8).toLowerCase()}`;
    await prisma.storefront.create({
      data: {
        type: 'CTV',
        slug,
        title: `Gian hàng ${slug}`,
        ownerUserId: ctv.id,
        isPublished: true,
        // storefront.require_approval mặc định bật: gian hàng chưa duyệt bị ẩn, combo của gian hàng không áp.
        approvedAt: new Date(),
        collections: {
          create: {
            title: 'Combo IT',
            kind: 'COMBO',
            comboDiscountPct: pct,
            items: { create: [{ productId: a }, { productId: c }] },
          },
        },
      },
    });
    return slug;
  }

  /** Số tiền hàng của giỏ trang giỏ hiện ra phải bằng số báo giá trừ (chưa hạng, chưa điểm): tiền hàng − combo − mã. */
  async function expectCartEqualsQuote(userId: string, addressId: string, slug: string | undefined) {
    const c = await cart.getCart(userId, slug);
    const q = await checkout.quote(userId, { addressId, storefrontSlug: slug });
    expect(c.subtotal).toBe(q.subtotal);
    expect(c.comboDiscount).toBe(q.comboDiscount);
    expect(c.discount).toBe(q.discount);
    expect(c.couponNotice).toBe(q.couponNotice);
    expect(c.subtotal - c.comboDiscount - c.discount).toBe(q.total - q.shippingFee);
    return { c, q };
  }

  it('giỏ có combo + mã PERCENT: giảm combo, giảm mã và tiền hàng của giỏ đúng từng đồng số báo giá', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 2 }); // 140.000đ, combo 10% = 14.000đ
    const code = await coupon(b.userId, 'PERCENT', 10);
    await cart.applyCoupon(b.userId, code);

    const { c: got } = await expectCartEqualsQuote(b.userId, b.addressId, slug);
    expect(got.comboDiscount).toBe(14_000);
    expect(got.discount).toBe(12_600); // 10% × (140.000 − 14.000), không phải 14.000 trên giá chưa trừ combo
    expect(got.subtotal).toBe(140_000);
  });

  it('giỏ có combo + mã AMOUNT bị kẹp theo phần hàng sau combo', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const slug = await comboStore(a.productId, c.productId, 30);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 }); // 100.000đ, combo 30% = 30.000đ
    const code = await coupon(b.userId, 'AMOUNT', 1_000_000);
    await cart.applyCoupon(b.userId, code);

    const { c: got } = await expectCartEqualsQuote(b.userId, b.addressId, slug);
    expect(got.comboDiscount).toBe(30_000);
    expect(got.discount).toBe(70_000);
  });

  it('mã đạt đơn tối thiểu trên giá chưa trừ combo nhưng không đạt sau combo: giỏ và báo giá cùng không giảm', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 }); // 100.000đ, sau combo 90.000đ
    const code = await coupon(b.userId, 'AMOUNT', 10_000, { minOrder: 95_000 });
    await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: code } });

    const { c: got } = await expectCartEqualsQuote(b.userId, b.addressId, slug);
    expect(got.comboDiscount).toBe(10_000);
    expect(got.discount).toBe(0);
    expect(got.couponCode).toBe(code);
  });

  it('giỏ không combo: không có combo, số giảm của mã như cũ, kể cả khi gửi gian hàng không có combo', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 2 }); // 140.000đ
    const code = await coupon(b.userId, 'PERCENT', 10);
    await cart.applyCoupon(b.userId, code);
    const d = await product(30_000);
    const noCombo = await comboStore(a.productId, d.productId, 0);

    const plain = await expectCartEqualsQuote(b.userId, b.addressId, undefined);
    expect(plain.c).toMatchObject({ comboDiscount: 0, discount: 14_000, subtotal: 140_000 });
    const withStore = await expectCartEqualsQuote(b.userId, b.addressId, noCombo);
    expect(withStore.c).toMatchObject({ comboDiscount: 0, discount: 14_000, subtotal: 140_000 });
    // Không gửi gian hàng (đường cũ) vẫn không có combo dù gian hàng có combo.
    const slug = await comboStore(a.productId, c.productId, 10);
    expect(await cart.getCart(b.userId)).toMatchObject({ comboDiscount: 0, discount: 14_000 });
    expect((await cart.getCart(b.userId, slug)).comboDiscount).toBe(14_000);
  });

  async function flashProduct(price: number, flashPrice: number) {
    const f = await product(price);
    const sale = await prisma.flashSale.create({
      data: {
        title: 'IT giờ vàng',
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 3_600_000),
        createdBy: 'it',
        items: { create: { variationId: f.variationId, flashPrice, quota: 100, perUserLimit: 5 } },
      },
    });
    return { ...f, saleId: sale.id };
  }

  async function expectApplyRejected(userId: string, code: string, slug: string, ...parts: string[]) {
    const err = await cart.applyCoupon(userId, code, slug).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    for (const part of parts) expect((err as BadRequestException).message).toContain(part);
    expect((await cart.getCart(userId, slug)).couponCode).toBeNull();
    return (err as BadRequestException).message;
  }

  it('combo kéo phần hàng dưới đơn tối thiểu (không giờ vàng): giữ mã trong giỏ, giảm 0đ kèm lời báo về combo = báo giá', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 }); // 100.000đ, sau combo 90.000đ
    const amount = await coupon(b.userId, 'AMOUNT', 10_000, { minOrder: 95_000 });
    const freeship = await coupon(b.userId, 'FREESHIP', 0, { minOrder: 95_000 });

    for (const code of [amount, freeship]) {
      await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: null } });
      // Cả giỏ chỉ hụt vì combo: mã đạt 95.000đ trên giá chưa trừ combo nên được giữ (có thể mua một phần giỏ không có combo).
      const applied = await cart.applyCoupon(b.userId, code, slug);
      expect(applied.couponCode).toBe(code);
      expect(applied.discount).toBe(0);
      expect(applied.couponNotice).toContain('phần giảm combo');
      expect(applied.couponNotice).toContain('Đơn tối thiểu 95.000đ');
      expect(applied.couponNotice).not.toContain('giờ vàng');
      const { c: got, q } = await expectCartEqualsQuote(b.userId, b.addressId, slug);
      expect(got.couponNotice).toContain('phần giảm combo');
      expect(got.couponCode).toBe(code);
      expect(q.couponApplied).toBe(false);
    }
    // Không gửi gian hàng (không combo): 100.000đ đạt 95.000đ nên áp được như cũ.
    await cart.applyCoupon(b.userId, amount);
    expect((await cart.getCart(b.userId)).discount).toBe(10_000);
  });

  it('combo giữ lại một mã mà cả giỏ chưa dùng được: mua một phần giỏ (không đủ bộ combo) thì xem trước = áp mã = báo giá', async () => {
    const b = await buyer();
    const a = await product(100_000);
    const c = await product(5_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 }); // 105.000đ, combo 10.500đ, sau combo 94.500đ
    const code = await coupon(b.userId, 'AMOUNT', 10_000, { minOrder: 95_000 });
    const lineA = await prisma.cartItem.findFirstOrThrow({ where: { cart: { userId: b.userId }, variationId: a.variationId } });

    const preview = await checkout.couponPreviews(b.userId, { storefrontSlug: slug, itemIds: [lineA.id] });
    expect(preview.coupons.find((p) => p.code === code)).toMatchObject({ eligible: true, discount: 10_000 });
    const applied = await cart.applyCoupon(b.userId, code, slug);
    expect(applied.couponCode).toBe(code);
    const sub = await checkout.quote(b.userId, { addressId: b.addressId, storefrontSlug: slug, itemIds: [lineA.id] });
    expect(sub.discount).toBe(10_000);
    expect(sub.couponApplied).toBe(true);

    // Cả giỏ: giỏ và báo giá cùng giảm 0đ, lời báo nói về combo.
    expect(applied.discount).toBe(0);
    expect(applied.comboDiscount).toBe(10_500);
    expect(applied.couponNotice).toContain('phần giảm combo');
    const { q } = await expectCartEqualsQuote(b.userId, b.addressId, slug);
    expect(q.discount).toBe(0);
    expect(q.couponNotice).toContain('phần giảm combo');
  });

  it('giờ vàng + combo: hàng thường (100.000đ) đạt 95.000đ trước combo nên giữ mã; lời báo nêu cả hai, đúng chữ báo giá', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const f = await flashProduct(100_000, 50_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    try {
      await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: f.variationId, quantity: 1 }); // thường 100.000đ − combo 10.000đ = 90.000đ; giờ vàng 50.000đ
      const code = await coupon(b.userId, 'AMOUNT', 10_000, { minOrder: 95_000 });
      const applied = await cart.applyCoupon(b.userId, code, slug);
      expect(applied.couponCode).toBe(code);
      expect(applied.couponNotice).toContain('hàng giờ vàng và phần giảm combo');
      const { c: got } = await expectCartEqualsQuote(b.userId, b.addressId, slug);
      expect(got.couponNotice).toContain('hàng giờ vàng và phần giảm combo');
      expect(got.discount).toBe(0);

      // Hàng thường trước combo (100.000đ) cũng chưa đạt 120.000đ, chỉ cả giỏ có giờ vàng mới đạt: từ chối như cũ, nêu cả hai lý do.
      await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: null } });
      const high = await coupon(b.userId, 'AMOUNT', 10_000, { minOrder: 120_000 });
      await expectApplyRejected(b.userId, high, slug, 'hàng giờ vàng và phần giảm combo');
    } finally {
      await prisma.flashSale.update({ where: { id: f.saleId }, data: { isActive: false } });
    }
  });

  it('giờ vàng + mã gắn sản phẩm: giỏ = báo giá (lời báo, mức giảm) cả khi có combo; mã gắn hàng thường vẫn giảm sau combo', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const f = await flashProduct(100_000, 50_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    try {
      await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: f.variationId, quantity: 1 });
      const onFlash = await coupon(b.userId, 'PERCENT', 20, { productIds: [f.productId] });
      await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: onFlash } });
      const r1 = await expectCartEqualsQuote(b.userId, b.addressId, slug);
      expect(r1.c.discount).toBe(0);
      expect(r1.c.couponNotice).toContain('giờ vàng');

      const onA = await coupon(b.userId, 'PERCENT', 50, { productIds: [a.productId] });
      await cart.applyCoupon(b.userId, onA, slug);
      const r2 = await expectCartEqualsQuote(b.userId, b.addressId, slug);
      expect(r2.c.discount).toBe(27_000); // 50% × (60.000 − 6.000)
      expect(r2.c.comboDiscount).toBe(10_000);
    } finally {
      await prisma.flashSale.update({ where: { id: f.saleId }, data: { isActive: false } });
    }
  });

  async function tierUser(userId: string, discountPct: number) {
    const tier = await prisma.membershipTier.create({
      data: { id: `itcp-tier-${randCode(8)}`, name: 'Hạng IT', minPoints: 999_999_999, discountPct, perks: [] },
    });
    tierIds.push(tier.id);
    await prisma.user.update({ where: { id: userId }, data: { tierId: tier.id } });
  }

  /**
   * Cùng một lần mua đọc ba nơi: GET /cart (qua controller, đúng đường trang giỏ gọi), báo giá và đơn thật được tạo. Tiền hàng sau
   * mọi giảm (chưa phí giao, chưa điểm) phải bằng nhau từng đồng; trả thêm số liệu từng khoản để test khẳng định.
   */
  async function cartQuoteOrder(b: { userId: string; addressId: string }, opts: { cartSlug?: string; quoteSlug?: string; orderSlug?: string; itemIds?: string[] } = {}) {
    const c = await cartApi.get(b.userId, { storefrontSlug: opts.cartSlug, ...(opts.itemIds ? { itemIds: opts.itemIds } : {}) } as never);
    const q = await checkout.quote(b.userId, { addressId: b.addressId, storefrontSlug: opts.quoteSlug, itemIds: opts.itemIds });
    await checkout.placeOrder(
      b.userId,
      { addressId: b.addressId, paymentMethod: 'COD', storefrontSlug: opts.orderSlug, itemIds: opts.itemIds } as never,
      `itcp-${randCode(12)}`,
    );
    const o = await prisma.order.findFirstOrThrow({ where: { userId: b.userId }, orderBy: { createdAt: 'desc' } });
    const cartGoods = c.subtotal - c.comboDiscount - c.discount - ((c as { tierDiscount?: number }).tierDiscount ?? 0);
    const numbers = { cart: cartGoods, quote: q.total - q.shippingFee, order: o.total - o.shippingFee };
    expect(numbers.quote).toBe(numbers.order);
    expect(numbers.cart).toBe(numbers.quote);
    expect({ combo: c.comboDiscount, coupon: c.discount, tier: (c as { tierDiscount?: number }).tierDiscount ?? 0 }).toEqual({
      combo: o.comboDiscount,
      coupon: o.couponDiscount,
      tier: o.tierDiscount,
    });
    return { c, q, o, numbers };
  }

  it('giảm theo hạng thành viên: giỏ = báo giá = đơn (combo, rồi mã, rồi hạng làm tròn xuống trên phần còn lại)', async () => {
    const b = await buyer();
    await tierUser(b.userId, 0.05);
    const a = await product(60_000);
    const c = await product(40_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 2 }); // 140.000đ, combo 14.000đ
    const code = await coupon(b.userId, 'PERCENT', 10);
    await cart.applyCoupon(b.userId, code, slug); // mã 12.600đ → còn 113.400đ, hạng 5% = 5.670đ

    const r = await cartQuoteOrder(b, { cartSlug: slug, quoteSlug: slug, orderSlug: slug });
    expect(r.c).toMatchObject({ comboDiscount: 14_000, discount: 12_600, tierDiscount: 5_670 });
    expect(r.numbers).toEqual({ cart: 107_730, quote: 107_730, order: 107_730 });
  });

  it('hạng làm tròn xuống: phần lẻ không bị thiệt thêm 1đ giữa giỏ, báo giá và đơn', async () => {
    const b = await buyer();
    await tierUser(b.userId, 0.07);
    const a = await product(33_333);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 }); // 7% × 33.333 = 2.333,31

    const r = await cartQuoteOrder(b);
    expect(r.c).toMatchObject({ comboDiscount: 0, discount: 0, tierDiscount: 2_333 });
    expect(r.numbers).toEqual({ cart: 31_000, quote: 31_000, order: 31_000 });
  });

  it('"chạm" giới thiệu còn hạn (phiên mất slug gian hàng): giỏ, báo giá và đơn cùng lấy gian hàng của chạm nên cùng combo', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    const store = await prisma.storefront.findUniqueOrThrow({ where: { slug } });
    await prisma.referralTouch.create({
      data: { userId: b.userId, referrerUserId: store.ownerUserId!, storefrontSlug: slug, kind: 'ctv', expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 2 }); // 140.000đ, combo 14.000đ
    const code = await coupon(b.userId, 'PERCENT', 10);
    await cart.applyCoupon(b.userId, code);

    const r = await cartQuoteOrder(b); // không bên nào gửi slug
    expect(r.c.comboDiscount).toBe(14_000);
    expect(r.numbers).toEqual({ cart: 113_400, quote: 113_400, order: 113_400 });
  });

  it('chạm hết hạn hoặc kind=brand: không ai áp combo (cả ba cùng không combo)', async () => {
    const a = await product(60_000);
    const c = await product(40_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    const store = await prisma.storefront.findUniqueOrThrow({ where: { slug } });
    for (const touch of [
      { kind: 'ctv', expiresAt: new Date(Date.now() - 1_000) },
      { kind: 'brand', expiresAt: new Date(Date.now() + 86_400_000) },
    ]) {
      const b = await buyer();
      await prisma.referralTouch.create({ data: { userId: b.userId, referrerUserId: store.ownerUserId!, storefrontSlug: touch.kind === 'brand' ? null : slug, ...touch } });
      await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
      const r = await cartQuoteOrder(b);
      expect(r.c.comboDiscount).toBe(0);
      expect(r.numbers).toEqual({ cart: 100_000, quote: 100_000, order: 100_000 });
    }
  });

  it('chọn một phần giỏ: giỏ (itemIds) = báo giá = đơn, combo chỉ khi đủ bộ trong phần chọn, mã và hạng trên phần còn lại', async () => {
    const b = await buyer();
    await tierUser(b.userId, 0.05);
    const a = await product(60_000);
    const c = await product(40_000);
    const d = await product(30_000);
    const slug = await comboStore(a.productId, c.productId, 10);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: d.variationId, quantity: 1 });
    const code = await coupon(b.userId, 'PERCENT', 10);
    await cart.applyCoupon(b.userId, code, slug);
    const line = async (variationId: string) => (await prisma.cartItem.findFirstOrThrow({ where: { cart: { userId: b.userId }, variationId } })).id;
    const ids = [await line(a.variationId), await line(c.variationId)];

    // a + c: 100.000đ, combo 10.000đ, mã 10% × 90.000đ = 9.000đ, hạng 5% × 81.000đ = 4.050đ.
    const r = await cartQuoteOrder(b, { cartSlug: slug, quoteSlug: slug, orderSlug: slug, itemIds: ids });
    expect(r.c).toMatchObject({ subtotal: 100_000, comboDiscount: 10_000, discount: 9_000, tierDiscount: 4_050, itemCount: 2 });
    expect(r.numbers).toEqual({ cart: 76_950, quote: 76_950, order: 76_950 });
    // Đơn chỉ lấy hai dòng đã chọn; dòng còn lại ở lại giỏ, mã giữ nguyên.
    expect(r.c.items).toHaveLength(2);
    expect((await cartApi.get(b.userId, { storefrontSlug: slug } as never)).items).toHaveLength(1);
  });

  it('chọn một phần giỏ: mã hụt đơn tối thiểu trên phần chọn không bị gỡ khỏi giỏ (chỉ xem giá, không ghi)', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const d = await product(30_000);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: d.variationId, quantity: 1 });
    const code = await coupon(b.userId, 'AMOUNT', 10_000, { minOrder: 80_000 });
    await cart.applyCoupon(b.userId, code); // cả giỏ 90.000đ đạt 80.000đ
    const lineD = await prisma.cartItem.findFirstOrThrow({ where: { cart: { userId: b.userId }, variationId: d.variationId } });

    const sub = await cartApi.get(b.userId, { itemIds: [lineD.id] } as never);
    expect(sub.discount).toBe(0);
    expect(sub.couponCode).toBe(code);
    expect((await prisma.cart.findUniqueOrThrow({ where: { userId: b.userId } })).couponCode).toBe(code);
    const q = await checkout.quote(b.userId, { addressId: b.addressId, itemIds: [lineD.id] });
    expect(q.discount).toBe(0);
    expect(sub.subtotal - sub.discount).toBe(q.total - q.shippingFee);
  });

  it('chọn dòng đã ngừng bán: giỏ từ chối đúng câu báo giá; id không thuộc giỏ thì bỏ qua im lặng', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const d = await product(30_000);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: d.variationId, quantity: 1 });
    const line = async (variationId: string) => (await prisma.cartItem.findFirstOrThrow({ where: { cart: { userId: b.userId }, variationId } })).id;
    const lineA = await line(a.variationId);
    const lineD = await line(d.variationId);
    await prisma.product.update({ where: { id: d.productId }, data: { isActive: false } });

    const quoteErr = await checkout.quote(b.userId, { addressId: b.addressId, itemIds: [lineD] }).catch((e: unknown) => e);
    expect(quoteErr).toBeInstanceOf(BadRequestException);
    const cartErr = await cartApi.get(b.userId, { itemIds: [lineD] } as never).catch((e: unknown) => e);
    expect(cartErr).toBeInstanceOf(BadRequestException);
    expect((cartErr as BadRequestException).message).toBe((quoteErr as BadRequestException).message);

    const ok = await cartApi.get(b.userId, { itemIds: [lineA, 'khong-co-trong-gio'] } as never);
    expect(ok.items.map((l) => l.id)).toEqual([lineA]);
    expect((await cartApi.get(b.userId, { itemIds: ['khong-co-trong-gio'] } as never)).items).toEqual([]);
  });

  it('đọc giỏ gỡ mã hết hạn X trong lúc tab khác vừa áp mã Y: Y không bị gỡ nhầm', async () => {
    const b = await buyer();
    const a = await product(60_000);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    const x = await coupon(b.userId, 'AMOUNT', 5_000);
    const y = await coupon(b.userId, 'AMOUNT', 3_000);
    await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: x } });
    await prisma.coupon.update({ where: { code: x }, data: { endAt: new Date(Date.now() - 1_000) } });
    const couponsSvc = moduleRef.get(CouponsService);
    const real = couponsSvc.validateAndCompute.bind(couponsSvc);
    // Tab B áp Y ngay sau khi tab A đã đọc giỏ (còn mã X) và thấy X hỏng, trước khi A ghi lệnh gỡ.
    const spy = jest.spyOn(couponsSvc, 'validateAndCompute').mockImplementation(async (...args) => {
      try {
        return await real(...args);
      } catch (e) {
        if (args[0] === x) await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: y } });
        throw e;
      }
    });
    try {
      const got = await cart.getCart(b.userId);
      expect(got.couponRemoved).toBeNull();
      // Mã và mức giảm trả về phải thuộc cùng một mã: Y với mức giảm thật của nó, không phải Y kèm 0đ chưa kiểm.
      expect(got.couponCode).toBe(y);
      expect(got.discount).toBe(3_000);
      expect(got.couponNotice).toBeNull();
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.cart.findUniqueOrThrow({ where: { userId: b.userId } })).couponCode).toBe(y);
  });
});
