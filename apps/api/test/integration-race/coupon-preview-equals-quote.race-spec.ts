import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { CouponType } from '@prisma/client';
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
import {
  COUPON_FREESHIP_NOTHING_REASON,
  couponFreeshipThresholdReason,
  couponFreeshipTubuPartReason,
  COUPON_PRODUCT_FLASH_REASON,
} from '../../src/modules/coupons/coupon-notice';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * POST /checkout/coupon-previews phải ra ĐÚNG số báo giá checkout trừ khi khách áp chính mã đó: với từng mã trong ví, gọi xem
 * trước rồi gắn mã vào giỏ và gọi báo giá thật (CheckoutService.quote), so mức giảm, có áp hay không, và phí giao mã freeship miễn
 * được (phí giao không mã − phí giao có mã). Postgres thật; CouponsService, ComboService, giá giờ vàng là bản thật.
 */
describe('Xem trước mã giảm giá = báo giá checkout (real Postgres)', () => {
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
    // Gian hàng CTV fixture chưa duyệt; mặc định mới bật duyệt sẽ ẩn nó nên combo không áp. Ghim tắt vì spec không kiểm duyệt.
    await setConfig(prisma, 'storefront.require_approval', false);
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
    type: CouponType,
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

  type Ctx = { userId: string; addressId: string; storefrontSlug?: string; itemIds?: string[] };

  async function usageSnapshot() {
    const [redemptions, used] = await Promise.all([
      prisma.couponRedemption.count(),
      prisma.coupon.aggregate({ _sum: { usedCount: true } }),
    ]);
    return { redemptions, usedCount: used._sum.usedCount ?? 0 };
  }

  /**
   * Với mọi mã trong ví: xem trước (có phí giao) rồi báo giá thật với mã đó trên giỏ, so từng số. Trả kết quả xem trước theo mã
   * để ca kiểm thêm con số kỳ vọng tính tay.
   */
  async function expectPreviewEqualsQuote(ctx: Ctx) {
    const quoteArgs = { addressId: ctx.addressId, storefrontSlug: ctx.storefrontSlug, itemIds: ctx.itemIds };
    const usageBefore = await usageSnapshot();
    await prisma.cart.update({ where: { userId: ctx.userId }, data: { couponCode: null } });
    const noCoupon = await checkout.quote(ctx.userId, quoteArgs);
    const preview = await checkout.couponPreviews(ctx.userId, quoteArgs);
    const cartPreview = await checkout.couponPreviews(ctx.userId, { storefrontSlug: ctx.storefrontSlug, itemIds: ctx.itemIds });
    const byCode = new Map(preview.coupons.map((p) => [p.code, p]));
    expect(preview.coupons.length).toBeGreaterThan(0);

    for (const p of preview.coupons) {
      // Gắn thẳng vào giỏ (không qua applyCoupon) để báo giá tự xét mã, kể cả mã applyCoupon sẽ từ chối.
      await prisma.cart.update({ where: { userId: ctx.userId }, data: { couponCode: p.code } });
      const q = await checkout.quote(ctx.userId, quoteArgs);
      const shipSaved = noCoupon.shippingFee - q.shippingFee;
      console.log('[preview=quote] %s preview=%j quote.discount=%d applied=%s shipSaved=%d', p.code, p, q.discount, q.couponApplied, shipSaved);
      expect(p.discount).toBe(q.discount);
      expect(p.eligible).toBe(q.couponApplied);
      if (p.freeshipSaving !== undefined) expect(p.freeshipSaving).toBe(shipSaved);
      else expect(shipSaved).toBe(0);
      if (!p.eligible) {
        expect(p.reason).toBeTruthy();
        if (q.couponNotice) expect(q.couponNotice.endsWith(p.reason!)).toBe(true);
      }
      // Trang giỏ (không phí giao): cùng mức giảm tiền hàng, không có số freeship.
      const c = cartPreview.coupons.find((x) => x.code === p.code)!;
      expect(c.discount).toBe(p.discount);
      expect(c.freeshipSaving).toBeUndefined();
    }
    await prisma.cart.update({ where: { userId: ctx.userId }, data: { couponCode: null } });

    // Chỉ đọc: không thêm lượt dùng nào, bộ đếm không đổi; điểm không đổi (sổ = số dư).
    expect(await usageSnapshot()).toEqual(usageBefore);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    const ledger = await prisma.pointsTransaction.aggregate({ where: { userId: ctx.userId }, _sum: { delta: true } });
    expect(ledger._sum.delta ?? 0).toBe(u.pointsBalance);
    return { byCode, cartByCode: new Map(cartPreview.coupons.map((p) => [p.code, p])) };
  }

  it('(a)(f)(g)(e)(h) hàng thường dưới ngưỡng freeship: PERCENT, có/không trần, >100%, AMOUNT > tiền hàng, đơn tối thiểu, freeship kho Tubu', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 2 }); // 140.000đ
    const p10 = await coupon(b.userId, 'PERCENT', 10);
    const p15max = await coupon(b.userId, 'PERCENT', 15, { maxDiscount: 5_000 });
    const p150 = await coupon(b.userId, 'PERCENT', 150);
    const amtBig = await coupon(b.userId, 'AMOUNT', 1_000_000);
    const minLo = await coupon(b.userId, 'AMOUNT', 20_000, { minOrder: 100_000 });
    const minHi = await coupon(b.userId, 'AMOUNT', 20_000, { minOrder: 150_000 });
    const fs = await coupon(b.userId, 'FREESHIP', 10_000);

    const { byCode, cartByCode } = await expectPreviewEqualsQuote(b);
    expect(byCode.get(p10)).toMatchObject({ eligible: true, discount: 14_000 });
    expect(byCode.get(p15max)).toMatchObject({ eligible: true, discount: 5_000 });
    expect(byCode.get(p150)).toMatchObject({ eligible: true, discount: 140_000 });
    expect(byCode.get(amtBig)).toMatchObject({ eligible: true, discount: 140_000 });
    expect(byCode.get(minLo)).toMatchObject({ eligible: true, discount: 20_000 });
    expect(byCode.get(minHi)).toMatchObject({ eligible: false, discount: 0, reason: 'Đơn tối thiểu 150.000đ để dùng mã này.' });
    // Giá trị mã freeship không phải trần: miễn đủ 19.000đ phí kho Tubu.
    expect(byCode.get(fs)).toMatchObject({ eligible: true, discount: 0, freeshipSaving: 19_000 });
    expect(cartByCode.get(fs)).toEqual({ code: fs, eligible: true, discount: 0 });
  });

  it('(b) giờ vàng + hàng thường: mã chỉ tính trên hàng thường, mã gắn sản phẩm đang giờ vàng không dùng được', async () => {
    const b = await buyer();
    const normal = await product(60_000);
    const flash = await product(100_000);
    const sale = await prisma.flashSale.create({
      data: {
        title: 'IT giờ vàng',
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 3_600_000),
        createdBy: 'it',
        items: { create: { variationId: flash.variationId, flashPrice: 50_000, quota: 100, perUserLimit: 5 } },
      },
    });
    await cart.addItem(b.userId, { variationId: normal.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: flash.variationId, quantity: 1 });
    const p10 = await coupon(b.userId, 'PERCENT', 10);
    const onFlash = await coupon(b.userId, 'PERCENT', 20, { productIds: [flash.productId] });
    const min100 = await coupon(b.userId, 'AMOUNT', 10_000, { minOrder: 100_000 });

    try {
      const { byCode } = await expectPreviewEqualsQuote(b);
      expect(byCode.get(p10)).toMatchObject({ eligible: true, discount: 6_000 });
      expect(byCode.get(onFlash)).toMatchObject({ eligible: false, discount: 0, reason: COUPON_PRODUCT_FLASH_REASON });
      expect(byCode.get(min100)).toMatchObject({ eligible: false, discount: 0 });
    } finally {
      await prisma.flashSale.update({ where: { id: sale.id }, data: { isActive: false } });
    }
  });

  it('(c)(d)(e) combo gian hàng + mã gắn sản phẩm (khớp / không khớp) + đơn tối thiểu trên phần hàng của sản phẩm', async () => {
    const b = await buyer();
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const a = await product(60_000);
    const c = await product(40_000);
    const other = await product(30_000);
    const slug = `itcp-${randCode(8).toLowerCase()}`;
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
            comboDiscountPct: 10,
            items: { create: [{ productId: a.productId }, { productId: c.productId }] },
          },
        },
      },
    });
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 2 }); // 140.000đ, combo 10% = 14.000đ
    const p10 = await coupon(b.userId, 'PERCENT', 10);
    const scopedA = await coupon(b.userId, 'PERCENT', 50, { productIds: [a.productId] });
    const scopedOther = await coupon(b.userId, 'AMOUNT', 10_000, { productIds: [other.productId] });
    const scopedMinHi = await coupon(b.userId, 'AMOUNT', 10_000, { productIds: [a.productId], minOrder: 60_000 });
    const scopedMinLo = await coupon(b.userId, 'AMOUNT', 10_000, { productIds: [c.productId], minOrder: 70_000 });

    const ctx = { ...b, storefrontSlug: slug };
    const q = await checkout.quote(b.userId, { addressId: b.addressId, storefrontSlug: slug });
    expect(q.comboDiscount).toBe(14_000);
    const { byCode } = await expectPreviewEqualsQuote(ctx);
    expect(byCode.get(p10)).toMatchObject({ eligible: true, discount: 12_600 }); // 10% × (140.000 − 14.000)
    expect(byCode.get(scopedA)).toMatchObject({ eligible: true, discount: 27_000 }); // 50% × (60.000 − 6.000)
    expect(byCode.get(scopedOther)).toMatchObject({ eligible: false, discount: 0 });
    // Phần hàng của A sau combo 54.000đ < 60.000đ dù cả giỏ 140.000đ.
    expect(byCode.get(scopedMinHi)).toMatchObject({ eligible: false, discount: 0, reason: 'Đơn tối thiểu 60.000đ để dùng mã này.' });
    expect(byCode.get(scopedMinLo)).toMatchObject({ eligible: true, discount: 10_000 }); // 80.000 − 8.000 = 72.000đ ≥ 70.000đ

    // Tập con đã chọn (chỉ dòng C): combo không đủ bộ, mã gắn A không còn dòng nào.
    const items = await prisma.cartItem.findMany({ where: { cart: { userId: b.userId }, variationId: c.variationId } });
    const sub = await expectPreviewEqualsQuote({ ...ctx, itemIds: items.map((i) => i.id) });
    expect(sub.byCode.get(p10)).toMatchObject({ eligible: true, discount: 8_000 });
    expect(sub.byCode.get(scopedA)).toMatchObject({ eligible: false, discount: 0 });
  });

  it('(h) freeship: kiện đối tác tự giao không có gì để miễn; kiện Tubu đã miễn phí giao vì đạt ngưỡng thì câu lý do nêu ngưỡng', async () => {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itcp-m-${tag}`, title: `Shop ${tag}`, ownerUserId: owner.id, isPublished: true },
    });
    const shopGoods = await product(80_000, { storefrontId: store.id, fulfilment: 'MERCHANT' });

    const selfShip = await buyer();
    await cart.addItem(selfShip.userId, { variationId: shopGoods.variationId, quantity: 1 });
    const fsSelf = await coupon(selfShip.userId, 'FREESHIP', 0);
    const r1 = await expectPreviewEqualsQuote(selfShip);
    expect(r1.byCode.get(fsSelf)).toEqual({
      code: fsSelf,
      eligible: false,
      reason: COUPON_FREESHIP_NOTHING_REASON,
      discount: 0,
      freeshipSaving: 0,
    });

    const free = await buyer();
    const big = await product(250_000);
    await cart.addItem(free.userId, { variationId: big.variationId, quantity: 1 });
    const fsFree = await coupon(free.userId, 'FREESHIP', 30_000);
    const r2 = await expectPreviewEqualsQuote(free);
    // Ngưỡng 200.000đ do beforeAll đặt; câu phải nêu ngưỡng chứ không nói "không có phí giao đó" (giỏ 250.000đ đạt ngưỡng).
    expect(r2.byCode.get(fsFree)).toMatchObject({ eligible: false, freeshipSaving: 0, reason: couponFreeshipThresholdReason(200_000) });

    // Giỏ trộn: kiện Tubu 60.000đ (phí 19.000đ) + kiện đối tác: chỉ phí kho Tubu được miễn.
    const mixed = await buyer();
    const small = await product(60_000);
    await cart.addItem(mixed.userId, { variationId: small.variationId, quantity: 1 });
    await cart.addItem(mixed.userId, { variationId: shopGoods.variationId, quantity: 1 });
    const fsMixed = await coupon(mixed.userId, 'FREESHIP', 0);
    const r3 = await expectPreviewEqualsQuote(mixed);
    expect(r3.byCode.get(fsMixed)).toMatchObject({ eligible: true, freeshipSaving: 19_000 });

    // Giỏ trộn mà kiện Tubu đã đạt ngưỡng còn kiện đối tác có phí giao: câu nói rõ mã chỉ miễn phần hàng Tubu, giỏ và báo giá cùng câu.
    const mixedFree = await buyer();
    await cart.addItem(mixedFree.userId, { variationId: big.variationId, quantity: 1 });
    await cart.addItem(mixedFree.userId, { variationId: shopGoods.variationId, quantity: 1 });
    const fsMixedFree = await coupon(mixedFree.userId, 'FREESHIP', 0);
    const r4 = await expectPreviewEqualsQuote(mixedFree);
    expect(r4.byCode.get(fsMixedFree)).toMatchObject({
      eligible: false,
      freeshipSaving: 0,
      reason: couponFreeshipTubuPartReason({ threshold: 200_000 }),
    });
  });

  it('hết tổng lượt (usageLimit), mã theo hạng, và chọn rỗng (itemIds [] = cả giỏ như báo giá)', async () => {
    const tier = await prisma.membershipTier.create({
      data: { id: `itcp-tier-${randCode(8)}`, name: 'Hạng IT', minPoints: 999_999_999, perks: [] },
    });
    const b = await buyer();
    await prisma.user.update({ where: { id: b.userId }, data: { tierId: tier.id } });
    const a = await product(70_000);
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 2 }); // 140.000đ
    const usedUp = await coupon(b.userId, 'AMOUNT', 15_000, { usageLimit: 1 });
    const other = await createUser(prisma);
    const order = await createOrder(prisma, { userId: other.id });
    const usedUpRow = await prisma.coupon.findUniqueOrThrow({ where: { code: usedUp } });
    await prisma.couponRedemption.create({ data: { couponId: usedUpRow.id, userId: other.id, orderId: order.id } });
    const forTier = await coupon(b.userId, 'PERCENT', 20, { tierId: tier.id });

    const { byCode } = await expectPreviewEqualsQuote(b);
    expect(byCode.get(usedUp)).toMatchObject({ eligible: false, discount: 0, reason: 'Mã giảm giá đã hết lượt sử dụng.' });
    expect(byCode.get(forTier)).toMatchObject({ eligible: true, discount: 28_000 });

    const empty = await expectPreviewEqualsQuote({ ...b, itemIds: [] });
    expect(empty.byCode.get(forTier)).toMatchObject({ eligible: true, discount: 28_000 });

    // Đếm lượt của mã hết lượt chỉ là lượt có sẵn của khách khác, xem trước/báo giá không ghi thêm.
    expect(await prisma.couponRedemption.count({ where: { couponId: usedUpRow.id } })).toBe(1);
    await prisma.user.update({ where: { id: b.userId }, data: { tierId: null } });
  });
});
