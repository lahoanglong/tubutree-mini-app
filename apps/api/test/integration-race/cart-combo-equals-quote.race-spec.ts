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
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  afterAll(async () => {
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

  it('combo kéo phần hàng dưới đơn tối thiểu (không giờ vàng): lời báo của giỏ = báo giá (nói về combo), áp mã bị từ chối', async () => {
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
      const msg = await expectApplyRejected(b.userId, code, slug, 'phần giảm combo', 'Đơn tối thiểu 95.000đ');
      expect(msg).not.toContain('giờ vàng');
      await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: code } });
      const { c: got } = await expectCartEqualsQuote(b.userId, b.addressId, slug);
      expect(got.couponNotice).toContain('phần giảm combo');
      expect(got.couponNotice).not.toContain('giờ vàng');
      expect(got.couponCode).toBe(code);
    }
    // Không gửi gian hàng (không combo): 100.000đ đạt 95.000đ nên áp được như cũ.
    await cart.applyCoupon(b.userId, amount);
    expect((await cart.getCart(b.userId)).discount).toBe(10_000);
  });

  it('giờ vàng + combo: lời báo nêu cả hai, đúng chữ báo giá; áp mã bị từ chối cùng lý do', async () => {
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
      await expectApplyRejected(b.userId, code, slug, 'hàng giờ vàng và phần giảm combo');
      await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: code } });
      const { c: got } = await expectCartEqualsQuote(b.userId, b.addressId, slug);
      expect(got.couponNotice).toContain('hàng giờ vàng và phần giảm combo');
      expect(got.discount).toBe(0);
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
});
