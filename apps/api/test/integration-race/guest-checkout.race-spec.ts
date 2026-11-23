import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
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
import { ReviewInviteService } from '../../src/modules/lifecycle/review-invite.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { GiftTrialService } from '../../src/modules/gift-tiers/gift-trial.service';
import { GIFT_TRIAL_ENABLED_KEY, GIFT_TRIAL_MIN_ORDER_KEY, GIFT_TRIAL_OPTIONS_KEY } from '../../src/modules/gift-tiers/gift-trial';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import type { BankTransferService } from '../../src/modules/integrations/payment/bank-transfer.service';
import { GuestCheckoutService, GUEST_LIMIT, GUEST_LIMIT_MESSAGE, GUEST_ORDER_CLAIMED_MESSAGE } from '../../src/modules/checkout/guest/guest-checkout.service';
import {
  GUEST_BLOCKED_PHONES_KEY,
  GUEST_COD_MAX_KEY,
  GUEST_COD_OVER_MAX,
  GUEST_DAILY_IP_CAP_KEY,
  WEB_GUEST_CHECKOUT_ENABLED_KEY,
} from '../../src/modules/checkout/guest/guest-checkout.config';
import type { GuestLookupDto, GuestPlaceOrderDto } from '../../src/modules/checkout/guest/dto/guest-checkout.dto';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createRealUser, createUser, pinConfig, randCode, setConfig, uniquePhone, warmPool } from './helpers';
import { buyerFlashLimitKeys, flashLimitKeys, isLegacyFlashKey } from '../../src/modules/flash-sale/flash-buyer-keys';
import { PHOTO_REWARD_POINTS_DEFAULT } from '../../src/modules/reviews/review-green-corner';

/**
 * Đặt hàng không đăng nhập trên web (tubu-w4-01) trên Postgres thật: tiền đơn khách vãng lai bằng đúng tài khoản thường không mã/điểm/hạng
 * (12 giỏ mẫu, cùng một đường tính tiền), giỏ có hàng Giờ vàng được giá Giờ vàng như tài khoản và giới hạn mua đếm thêm theo SĐT/IP
 * (tubu-w6-01 P1-b), bấm đúp ra một đơn, đơn vị cuối chỉ một
 * người được, trần theo SĐT/IP/thiết bị cùng một câu báo, khoá theo dõi (sai khoá = sai mã = 404, hết hạn 60 ngày sau giao), gộp đơn về tài
 * khoản Zalo đúng một lần và không cộng điểm, cờ tắt thì đường đặt 404 còn đường theo dõi vẫn chạy.
 */
describe('Đặt hàng không đăng nhập trên web (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let config: SystemConfigService;
  let auth: AuthService;
  let loyalty: LoyaltyService;
  let guest: GuestCheckoutService;
  const restores: (() => Promise<void>)[] = [];
  let giftVariationId = '';
  let adminId = '';

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
    loyalty = moduleRef.get(LoyaltyService);
    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-guest-checkout', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30, JWT_REFRESH_REUSE_GRACE_SECONDS: 30 };
    const env = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const rbac = new RbacService(prisma, new MerchantFulfilmentService(prisma, {} as never, undefined, new SystemConfigService(prisma)));
    auth = new AuthService(prisma, new JwtService(), env, {} as ZaloService, rbac);
    const bank = { getBankQr: jest.fn(async (code: string, userId: string) => ({ code, userId })) } as unknown as BankTransferService;
    guest = new GuestCheckoutService(prisma, checkout, auth, bank, config, moduleRef.get(AnalyticsEventsService), env, {} as never);

    adminId = (await createRealUser(prisma, { role: 'ADMIN' })).id;
    giftVariationId = (await product(35_000, 500)).variationId;
    restores.push(await pinConfig(prisma, WEB_GUEST_CHECKOUT_ENABLED_KEY, true));
    restores.push(await pinConfig(prisma, GUEST_COD_MAX_KEY, 500_000));
    restores.push(await pinConfig(prisma, GUEST_DAILY_IP_CAP_KEY, 5));
    restores.push(await pinConfig(prisma, GUEST_BLOCKED_PHONES_KEY, []));
    restores.push(await pinConfig(prisma, GIFT_TRIAL_ENABLED_KEY, true));
    restores.push(await pinConfig(prisma, GIFT_TRIAL_MIN_ORDER_KEY, 299_000));
    restores.push(await pinConfig(prisma, GIFT_TRIAL_OPTIONS_KEY, [{ variationId: giftVariationId }]));
    restores.push(await pinConfig(prisma, 'shipping.free_threshold', 199_000));
    restores.push(await pinConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000));
    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await moduleRef?.close();
  });

  async function setFlag(key: string, value: unknown) {
    await config.set(key, value as never, 'it-guest-checkout');
  }

  async function product(price: number, stock = 50) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itgc-p-${tag}`,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itgc-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
        variations: { create: { pancakeId: `itgc-v-${tag}`, sku: `ITGC-${tag}`, name: 'Chai', attributes: {}, retailPrice: price, stock } },
      },
      include: { variations: true },
    });
    return { productId: p.id, variationId: p.variations[0]!.id };
  }

  async function flashOn(variationId: string, flashPrice: number, perUserLimit = 10) {
    const s = await prisma.flashSale.create({
      data: { title: `IT ${randCode(4)}`, startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + 3_600_000), createdBy: adminId },
    });
    return prisma.flashSaleItem.create({ data: { flashSaleId: s.id, variationId, flashPrice, quota: 50, perUserLimit } });
  }

  const addressOf = (phone: string) => ({
    recipient: 'Khach Vang Lai',
    phone,
    province: 'Ha Noi',
    district: '',
    ward: 'Phuong IT',
    street: '12 Ngo IT',
    provinceCode: '84_VN01',
    districtCode: '',
    wardCode: '00001',
  });

  /** Tài khoản Zalo thường, đã có đơn giao trước (không còn freeship đơn đầu), không hạng, không điểm. */
  async function account(phone = uniquePhone()) {
    const u = await createUser(prisma, { phone, zaloId: `zalo_it_${randCode(10)}` });
    await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 10 * 86_400_000) });
    const addr = await prisma.address.create({ data: { userId: u.id, ...addressOf(phone) } });
    return { userId: u.id, addressId: addr.id };
  }

  const device = () => `w_${randomBytes(24).toString('base64url')}`;
  const trackingKey = () => randomBytes(32).toString('base64url');
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const idem = () => `itgc-${randCode(16)}`;

  function placeDto(lines: { variationId: string; quantity: number }[], phone: string, over: Partial<GuestPlaceOrderDto> = {}): GuestPlaceOrderDto {
    return { lines, address: addressOf(phone), paymentMethod: 'COD', trackingKey: trackingKey(), fillMs: 20_000, ...over } as GuestPlaceOrderDto;
  }

  const codeOf = (r: PromiseSettledResult<unknown>) => {
    if (r.status !== 'rejected' || !(r.reason instanceof HttpException)) return undefined;
    const body = r.reason.getResponse();
    return typeof body === 'object' ? (body as { code?: string }).code : undefined;
  };

  describe('tiền: một đường tính, bằng tài khoản thường tới từng đồng', () => {
    // 12 giỏ mẫu: dưới mốc freeship 199k, đúng mốc, trên mốc, chạm mốc quà 299k, nhiều món, số lượng lớn.
    const CARTS: number[][] = [
      [45_000],
      [99_000, 1],
      [150_000],
      [199_000],
      [120_000, 79_000],
      [210_000],
      [298_000],
      [299_000],
      [180_000, 150_000],
      [60_000, 60_000, 60_000, 60_000],
      [35_000, 2],
      [250_000, 120_000, 45_000],
    ];

    it.each(CARTS.map((c, i) => [i + 1, c] as const))('giỏ mẫu %i: báo giá và đơn của khách vãng lai = tài khoản thường', async (_n, spec) => {
      const lines: { variationId: string; quantity: number }[] = [];
      if (spec.length === 2 && spec[1]! < 10) {
        lines.push({ variationId: (await product(spec[0]!)).variationId, quantity: spec[1]! === 1 ? 1 : spec[1]! });
      } else {
        for (const price of spec) lines.push({ variationId: (await product(price)).variationId, quantity: 1 });
      }
      const acc = await account();
      for (const l of lines) await cart.addItem(acc.userId, { variationId: l.variationId, quantity: l.quantity });
      const accQuote = await checkout.quote(acc.userId, { addressId: acc.addressId });

      const phone = uniquePhone();
      const meta = { deviceId: device(), ip: ip() };
      const gq = await guest.quote(meta, { lines, address: addressOf(phone) });
      expect({ subtotal: gq.subtotal, discount: gq.discount, shippingFee: gq.shippingFee, total: gq.total }).toEqual({
        subtotal: accQuote.subtotal,
        discount: accQuote.discount,
        shippingFee: accQuote.shippingFee,
        total: accQuote.total,
      });
      expect(gq.giftTrial?.selectedVariationId ?? null).toBe(accQuote.giftTrial?.selectedVariationId ?? null);

      const pm = gq.total > 500_000 ? 'BANK_TRANSFER' : 'COD';
      await checkout.placeOrder(acc.userId, { addressId: acc.addressId, paymentMethod: pm, expectedTotal: accQuote.total } as never, idem(), 'web');
      const placed = await guest.placeOrder(meta, placeDto(lines, phone, { paymentMethod: pm, expectedTotal: gq.total }), idem());
      const [accOrder] = await prisma.order.findMany({ where: { userId: acc.userId, idempotencyKey: { not: null } }, include: { items: true } });
      const guestOrder = await prisma.order.findUniqueOrThrow({ where: { code: placed.code }, include: { items: true } });
      const money = (o: typeof guestOrder) => ({
        subtotal: o.subtotal,
        discount: o.discount,
        couponDiscount: o.couponDiscount,
        comboDiscount: o.comboDiscount,
        tierDiscount: o.tierDiscount,
        pointsDiscount: o.pointsDiscount,
        shippingFee: o.shippingFee,
        total: o.total,
        gift: o.items.filter((i) => i.isGift).map((i) => [i.variationId, i.unitPrice]),
      });
      expect(money(guestOrder)).toEqual(money(accOrder!));
      expect(guestOrder.total).toBe(gq.total);
      expect(guestOrder).toMatchObject({ pointsEarned: 0, pointsUsed: 0, couponCode: null, guestPhone: phone, platform: 'web', referrerUserId: null });
      expect(guestOrder.guestTokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('2 giỏ có hàng Giờ vàng: khách vãng lai được đúng giá Giờ vàng như tài khoản, trừ suất một lần, đếm theo thiết bị + SĐT + IP', async () => {
      for (const [regular, flashPrice] of [[150_000, 99_000], [320_000, 240_000]] as const) {
        const v = (await product(regular)).variationId;
        const item = await flashOn(v, flashPrice);
        const acc = await account();
        await cart.addItem(acc.userId, { variationId: v, quantity: 1 });
        const accQuote = await checkout.quote(acc.userId, { addressId: acc.addressId });
        expect(accQuote.subtotal).toBe(flashPrice);

        const meta = { deviceId: device(), ip: ip() };
        const phone = uniquePhone();
        const gq = await guest.quote(meta, { lines: [{ variationId: v, quantity: 1 }], address: addressOf(phone) });
        expect({ subtotal: gq.subtotal, shippingFee: gq.shippingFee, total: gq.total }).toEqual({
          subtotal: accQuote.subtotal,
          shippingFee: accQuote.shippingFee,
          total: accQuote.total,
        });
        expect(gq.flashNotice).toBe(false);
        expect(gq.items[0]).toMatchObject({ unitPrice: flashPrice, isFlash: true });
        const placed = await guest.placeOrder(meta, placeDto([{ variationId: v, quantity: 1 }], phone, { expectedTotal: gq.total }), idem());
        const o = await prisma.order.findUniqueOrThrow({ where: { code: placed.code }, include: { items: true } });
        expect(o.items.find((i) => !i.isGift)).toMatchObject({ unitPrice: flashPrice, flashSaleItemId: item.id });
        expect(o).toMatchObject({ pointsEarned: 0, pointsUsed: 0, couponCode: null });
        expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(1);
        const holders = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: item.id }, select: { userId: true, quantity: true } });
        const keys = flashLimitKeys({ phone, ipHash: o.guestIpHash });
        expect(keys).toHaveLength(2);
        expect(holders.map((h) => h.userId).sort()).toEqual([o.userId, ...keys].sort());
        expect(holders.every((h) => h.quantity === 1)).toBe(true);
        expect(o.flashLimitKeys).toEqual(keys);
      }
    });

    it('mốc kinh tế: 198.000đ còn phí giao, 199.000đ miễn phí giao; quà dùng thử chỉ mở từ 299.000đ', async () => {
      const meta = { deviceId: device(), ip: ip() };
      const phone = uniquePhone();
      const quoteAt = async (price: number) =>
        guest.quote(meta, { lines: [{ variationId: (await product(price)).variationId, quantity: 1 }], address: addressOf(phone) });
      const q198 = await quoteAt(198_000);
      const q199 = await quoteAt(199_000);
      const q298 = await quoteAt(298_000);
      const q299 = await quoteAt(299_000);
      expect(q198.shippingFee).toBe(19_000);
      expect(q198.total).toBe(198_000 + 19_000);
      expect(q199.shippingFee).toBe(0);
      expect(q199.total).toBe(199_000);
      expect(q198.flashNotice).toBe(false);
      expect(q298.giftTrial?.selectedVariationId ?? null).toBeNull();
      expect(q298.giftTrial?.shortfall).toBe(1_000);
      expect(q299.giftTrial?.selectedVariationId).toBe(giftVariationId);
      expect(q299.total).toBe(299_000);
    });

    it('COD trên trần 500.000đ: báo giá khoá COD kèm lý do, đặt COD bị từ chối GUEST_COD_OVER_MAX, chuyển khoản thì được', async () => {
      const v = (await product(260_000)).variationId;
      const meta = { deviceId: device(), ip: ip() };
      const phone = uniquePhone();
      const lines = [{ variationId: v, quantity: 2 }];
      const q = await guest.quote(meta, { lines, address: addressOf(phone) });
      expect(q.total).toBeGreaterThan(500_000);
      expect(q.blockedPaymentMethods.COD).toContain('500.000đ');
      const [cod] = await Promise.allSettled([guest.placeOrder(meta, placeDto(lines, phone), idem())]);
      expect(codeOf(cod!)).toBe(GUEST_COD_OVER_MAX);
      expect(await prisma.order.count({ where: { guestPhone: phone } })).toBe(0);
      const ok = await guest.placeOrder(meta, placeDto(lines, phone, { paymentMethod: 'BANK_TRANSFER' }), idem());
      expect(ok).toMatchObject({ paymentMethod: 'BANK_TRANSFER', status: 'PENDING_PAYMENT', keyAccepted: true });
    });
  });

  describe('đồng thời', () => {
    it('bấm đúp (cùng Idempotency-Key, cùng khoá theo dõi) gửi chồng: đúng một đơn, hai lần trả cùng mã', async () => {
      const v = (await product(120_000)).variationId;
      const meta = { deviceId: device(), ip: ip() };
      const phone = uniquePhone();
      const dto = placeDto([{ variationId: v, quantity: 1 }], phone);
      const key = idem();
      const [a, b] = await Promise.all([guest.placeOrder(meta, dto, key), guest.placeOrder(meta, dto, key)]);
      expect(a.code).toBe(b.code);
      expect(a.keyAccepted && b.keyAccepted).toBe(true);
      expect(await prisma.order.count({ where: { guestPhone: phone } })).toBe(1);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: v } })).stock).toBe(49);
    });

    it('bấm đúp khi SĐT đang ở sát trần (1 đơn mở): cả hai lần trả cùng một đơn, lần đến sau không bị báo chặn', async () => {
      const v = (await product(120_000)).variationId;
      const phone = uniquePhone();
      await guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], phone), idem());
      const meta = { deviceId: device(), ip: ip() };
      const dto = placeDto([{ variationId: v, quantity: 2 }], phone);
      const key = idem();
      const [a, b] = await Promise.all([guest.placeOrder(meta, dto, key), guest.placeOrder(meta, dto, key)]);
      expect(a.code).toBe(b.code);
      expect(await prisma.order.count({ where: { guestPhone: phone } })).toBe(2);
    });

    it('tab thứ hai (khoá khác) gửi đúng các món vừa đặt: trả lại đơn đó, không đặt thêm, khoá theo dõi của tab hai không thay khoá đã có', async () => {
      const v = (await product(120_000)).variationId;
      const meta = { deviceId: device(), ip: ip() };
      const phone = uniquePhone();
      const first = await guest.placeOrder(meta, placeDto([{ variationId: v, quantity: 1 }], phone), idem());
      const second = await guest.placeOrder(meta, placeDto([{ variationId: v, quantity: 1 }], phone), idem());
      expect(second.code).toBe(first.code);
      expect(second.keyAccepted).toBe(false);
      expect(await prisma.order.count({ where: { guestPhone: phone } })).toBe(1);
    });

    it('hai khách vãng lai tranh đơn vị cuối: đúng một đơn, tồn về 0, không âm', async () => {
      const v = (await product(90_000, 1)).variationId;
      const results = await Promise.allSettled(
        [uniquePhone(), uniquePhone()].map((phone) =>
          guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], phone), idem()),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: v } })).stock).toBe(0);
      expect(await prisma.orderItem.count({ where: { variationId: v } })).toBe(1);
    });
  });

  describe('chống lạm dụng: cùng một câu, không lộ lớp nào chặn', () => {
    const limitOf = async (p: Promise<unknown>) => {
      const [r] = await Promise.allSettled([p]);
      expect(r!.status).toBe('rejected');
      const err = (r as PromiseRejectedResult).reason as ForbiddenException;
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: GUEST_LIMIT, message: GUEST_LIMIT_MESSAGE });
    };

    it('một SĐT: tối đa 2 đơn chưa xong cùng lúc (khác thiết bị, khác IP); hai lần thứ ba gửi chồng đều bị chặn', async () => {
      const v = (await product(80_000, 100)).variationId;
      const phone = uniquePhone();
      const place = () => guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], phone), idem());
      await place();
      await place();
      const extra = await Promise.allSettled([place(), place()]);
      expect(extra.every((r) => codeOf(r) === GUEST_LIMIT)).toBe(true);
      expect(await prisma.order.count({ where: { guestPhone: phone } })).toBe(2);
    });

    it('một SĐT: tối đa 4 đơn trong 30 ngày kể cả đơn đã giao', async () => {
      const v = (await product(80_000, 100)).variationId;
      const phone = uniquePhone();
      const place = () => guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], phone), idem());
      for (let i = 0; i < 4; i++) {
        const o = await place();
        await prisma.order.update({ where: { code: o.code }, data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredEffectsAt: new Date() } });
      }
      await limitOf(place());
    });

    it('một IP: tối đa checkout.guest_daily_ip_cap đơn/24 giờ (khác SĐT, khác thiết bị)', async () => {
      await setFlag(GUEST_DAILY_IP_CAP_KEY, 2);
      try {
        const v = (await product(80_000, 100)).variationId;
        const sameIp = ip();
        const place = () => guest.placeOrder({ deviceId: device(), ip: sameIp }, placeDto([{ variationId: v, quantity: 1 }], uniquePhone()), idem());
        await place();
        await place();
        await limitOf(place());
      } finally {
        await setFlag(GUEST_DAILY_IP_CAP_KEY, 5);
      }
    });

    it('một thiết bị: tối đa 3 đơn/24 giờ (lớp phụ)', async () => {
      const v = (await product(80_000, 100)).variationId;
      const meta = { deviceId: device(), ip: ip() };
      for (let i = 0; i < 3; i++) {
        const o = await guest.placeOrder({ ...meta, ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], uniquePhone()), idem());
        expect(o.keyAccepted).toBe(true);
        await new Promise((r) => setTimeout(r, 5));
      }
      await limitOf(guest.placeOrder({ ...meta, ip: ip() }, placeDto([{ variationId: v, quantity: 2 }], uniquePhone()), idem()));
    });

    it('ô bẫy có giá trị, điền dưới 3 giây, SĐT trong danh sách chặn: cùng câu báo, không ghi đơn', async () => {
      const v = (await product(80_000)).variationId;
      const blocked = uniquePhone();
      await setFlag(GUEST_BLOCKED_PHONES_KEY, [blocked]);
      try {
        const lines = [{ variationId: v, quantity: 1 }];
        await limitOf(guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto(lines, uniquePhone(), { website: 'http://spam' }), idem()));
        await limitOf(guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto(lines, uniquePhone(), { fillMs: 900 }), idem()));
        await limitOf(guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto(lines, blocked), idem()));
        expect(await prisma.orderItem.count({ where: { variationId: v } })).toBe(0);
      } finally {
        await setFlag(GUEST_BLOCKED_PHONES_KEY, []);
      }
    });

    it('thiếu Idempotency-Key: 400, không ghi đơn', async () => {
      const v = (await product(80_000)).variationId;
      await expect(guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], uniquePhone()), undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('thiết bị đã gắn tài khoản thật (dòng khách đã có SĐT): 409 mời đăng nhập, không đặt đơn khách', async () => {
      const d = device();
      const u = await auth.ensureGuestUser(d);
      await prisma.user.update({ where: { id: u.id }, data: { phone: uniquePhone() } });
      const v = (await product(80_000)).variationId;
      await expect(guest.quote({ deviceId: d, ip: ip() }, { lines: [{ variationId: v, quantity: 1 }], address: addressOf(uniquePhone()) })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('theo dõi đơn bằng khoá', () => {
    it('đúng khoá: thấy trạng thái, món, SĐT che 4 số giữa, chỉ phường và tỉnh; sai khoá, sai mã, thiếu khoá: cùng 404', async () => {
      const v = (await product(130_000)).variationId;
      const phone = uniquePhone();
      const dto = placeDto([{ variationId: v, quantity: 1 }], phone);
      const o = await guest.placeOrder({ deviceId: device(), ip: ip() }, dto, idem());
      const view = await guest.track(o.code, dto.trackingKey);
      expect(view).toMatchObject({ code: o.code, status: 'CONFIRMED', phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-3)}`, area: { ward: 'Phuong IT', province: 'Ha Noi' } });
      expect(JSON.stringify(view)).not.toContain('12 Ngo IT');
      expect(JSON.stringify(view)).not.toContain('Khach Vang Lai');
      expect(JSON.stringify(view)).not.toContain(phone);
      const errs = await Promise.allSettled([guest.track(o.code, trackingKey()), guest.track(`${o.code}X`, dto.trackingKey), guest.track(o.code, undefined)]);
      for (const r of errs) {
        expect(r.status).toBe('rejected');
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(NotFoundException);
        expect(((r as PromiseRejectedResult).reason as NotFoundException).message).toBe('Không tìm thấy đơn hàng.');
      }
      const accOrder = await createOrder(prisma, { userId: (await account()).userId });
      await expect(guest.track(accOrder.code, dto.trackingKey)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hết hạn 60 ngày sau giao: 404; 59 ngày: còn xem được', async () => {
      const v = (await product(130_000)).variationId;
      const dto = placeDto([{ variationId: v, quantity: 1 }], uniquePhone());
      const o = await guest.placeOrder({ deviceId: device(), ip: ip() }, dto, idem());
      await prisma.order.update({ where: { code: o.code }, data: { status: 'DELIVERED', deliveredAt: new Date(Date.now() - 59 * 86_400_000), deliveredEffectsAt: new Date() } });
      await expect(guest.track(o.code, dto.trackingKey)).resolves.toMatchObject({ status: 'DELIVERED' });
      await prisma.order.update({ where: { code: o.code }, data: { deliveredAt: new Date(Date.now() - 61 * 86_400_000) } });
      await expect(guest.track(o.code, dto.trackingKey)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('chuyển khoản: QR mở bằng khoá đơn, sai khoá 404', async () => {
      const v = (await product(130_000)).variationId;
      const dto = placeDto([{ variationId: v, quantity: 1 }], uniquePhone(), { paymentMethod: 'BANK_TRANSFER' });
      const o = await guest.placeOrder({ deviceId: device(), ip: ip() }, dto, idem());
      await expect(guest.bankQr(o.code, dto.trackingKey)).resolves.toMatchObject({ code: o.code });
      await expect(guest.bankQr(o.code, trackingKey())).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('tra đơn bằng mã đơn + SĐT (tubu-w16-02)', () => {
    const lookupOf = (orderCode: string, phone: string) => guest.lookup({ orderCode, phone } as GuestLookupDto);
    const LOOKUP_404 = 'Không tìm thấy đơn khớp mã đơn và số điện thoại này.';

    it('khớp: bản xem đã che + khoá tạm 43 ký tự mở được trang theo dõi; khoá gốc của trình duyệt vẫn dùng được; COD không có bankPath', async () => {
      const v = (await product(130_000)).variationId;
      const phone = uniquePhone();
      const dto = placeDto([{ variationId: v, quantity: 1 }], phone);
      const o = await guest.placeOrder({ deviceId: device(), ip: ip() }, dto, idem());
      const res = await lookupOf(o.code, phone);
      expect(res.order).toMatchObject({ code: o.code, phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-3)}`, area: { ward: 'Phuong IT', province: 'Ha Noi' } });
      expect(JSON.stringify(res)).not.toContain(phone);
      expect(JSON.stringify(res)).not.toContain('12 Ngo IT');
      expect(JSON.stringify(res)).not.toContain('Khach Vang Lai');
      expect(res.trackingKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.trackPath).toBe(`/don/${o.code}#k=${res.trackingKey}`);
      expect(res.bankPath).toBeNull();
      expect(new Date(res.linkExpiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
      await expect(guest.track(o.code, res.trackingKey)).resolves.toMatchObject({ code: o.code });
      await expect(guest.track(o.code, dto.trackingKey)).resolves.toMatchObject({ code: o.code });
    });

    it('chuyển khoản chờ tiền: bankPath mở lại QR bằng khoá tạm', async () => {
      const v = (await product(130_000)).variationId;
      const phone = uniquePhone();
      const o = await guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], phone, { paymentMethod: 'BANK_TRANSFER' }), idem());
      const res = await lookupOf(o.code, phone);
      expect(res.order.status).toBe('PENDING_PAYMENT');
      expect(res.bankPath).toBe(`/thanh-toan/chuyen-khoan/${o.code}#k=${res.trackingKey}`);
      await expect(guest.bankQr(o.code, res.trackingKey)).resolves.toMatchObject({ code: o.code });
    });

    it('sai SĐT, mã không có, đơn của tài khoản thường (đúng SĐT): cùng một 404, cùng câu', async () => {
      const v = (await product(130_000)).variationId;
      const phone = uniquePhone();
      const o = await guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], phone), idem());
      const acc = await account(phone);
      const accOrder = await createOrder(prisma, { userId: acc.userId });
      const errs = await Promise.allSettled([lookupOf(o.code, uniquePhone()), lookupOf(`${o.code}9`, phone), lookupOf(accOrder.code, phone)]);
      for (const r of errs) {
        expect(r.status).toBe('rejected');
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(NotFoundException);
        expect(((r as PromiseRejectedResult).reason as NotFoundException).message).toBe(LOOKUP_404);
      }
    });

    it('khoá tạm của đơn A không mở đơn B cùng SĐT; đơn giao quá 60 ngày: tra cứu 404', async () => {
      const v = (await product(130_000)).variationId;
      const phone = uniquePhone();
      const a = await guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], phone), idem());
      const b = await guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 2 }], phone), idem());
      const keyA = (await lookupOf(a.code, phone)).trackingKey;
      await expect(guest.track(b.code, keyA)).rejects.toBeInstanceOf(NotFoundException);
      await expect(guest.bankQr(b.code, keyA)).rejects.toBeInstanceOf(NotFoundException);
      await prisma.order.update({ where: { code: b.code }, data: { status: 'DELIVERED', deliveredAt: new Date(Date.now() - 61 * 86_400_000), deliveredEffectsAt: new Date() } });
      await expect(lookupOf(b.code, phone)).rejects.toMatchObject({ message: LOOKUP_404 });
    });
  });

  describe('gộp đơn về tài khoản Zalo', () => {
    it('đăng nhập trên cùng trình duyệt: đơn sang tài khoản đúng một lần, không thêm điểm; gọi lại hay gọi chồng không gộp lần hai', async () => {
      const v = (await product(130_000)).variationId;
      const d = device();
      const dto = placeDto([{ variationId: v, quantity: 1 }], uniquePhone());
      const o = await guest.placeOrder({ deviceId: d, ip: ip() }, dto, idem());
      const target = await createRealUser(prisma, { phone: uniquePhone() });
      const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { pointsBalance: true } });
      const [a, b] = await Promise.all([guest.claim(target.id, d), guest.claim(target.id, d)]);
      expect(a.claimed + b.claimed).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { code: o.code } })).userId).toBe(target.id);
      await expect(guest.claim(target.id, d)).resolves.toEqual({ claimed: 0 });
      await prisma.order.update({ where: { code: o.code }, data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredEffectsAt: new Date() } });
      await loyalty.creditOrderPoints((await prisma.order.findUniqueOrThrow({ where: { code: o.code } })).id);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { pointsBalance: true } })).pointsBalance).toBe(before.pointsBalance);
      expect(await prisma.analyticsEvent.count({ where: { eventName: 'guest_order_claimed', userId: target.id } })).toBeGreaterThanOrEqual(1);
      await expect(guest.track(o.code, dto.trackingKey)).resolves.toMatchObject({ code: o.code });
    });

    it('mời đánh giá: đơn vãng lai chưa gộp và đơn của tài khoản guest_ Mini không được mời, đơn đã gộp về tài khoản Zalo thật thì được mời', async () => {
      const v = (await product(140_000)).variationId;
      const keep = await guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], uniquePhone()), idem());
      // Đơn của tài khoản guest_ không qua checkout/guest (như phiên khách Mini chưa có SĐT): không có guestPhone.
      const mini = await guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], uniquePhone()), idem());
      await prisma.order.update({ where: { code: mini.code }, data: { guestPhone: null } });
      const d = device();
      const moved = await guest.placeOrder({ deviceId: d, ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], uniquePhone()), idem());
      const target = await createRealUser(prisma, { phone: uniquePhone() });
      await expect(guest.claim(target.id, d)).resolves.toEqual({ claimed: 1 });
      const deliveredAt = new Date(Date.now() - 3 * 86_400_000);
      await prisma.order.updateMany({
        where: { code: { in: [keep.code, mini.code, moved.code] } },
        data: { status: 'DELIVERED', deliveredAt, deliveredEffectsAt: deliveredAt },
      });
      const notify = jest.fn().mockResolvedValue(undefined);
      await new ReviewInviteService(prisma, config, { notify } as unknown as NotificationsService).sendReviewInvites();
      const invited = async (code: string) => (await prisma.order.findUniqueOrThrow({ where: { code } })).reviewInvitedAt;
      expect(await invited(keep.code)).toBeNull();
      expect(await invited(mini.code)).toBeNull();
      expect(await invited(moved.code)).not.toBeNull();
      expect(notify.mock.calls.some(([userId]) => userId === target.id)).toBe(true);
    });

    it('tubu-w18-01: đơn đã về tài khoản Zalo thì tra mã + SĐT ra 403 GUEST_ORDER_CLAIMED, không bản xem, không khoá; khoá tạm cũ thôi mở được', async () => {
      const v = (await product(130_000)).variationId;
      const phone = uniquePhone();
      const d = device();
      const dto = placeDto([{ variationId: v, quantity: 1 }], phone, { paymentMethod: 'BANK_TRANSFER' });
      const o = await guest.placeOrder({ deviceId: d, ip: ip() }, dto, idem());
      const before = await guest.lookup({ orderCode: o.code, phone } as GuestLookupDto);
      const target = await createRealUser(prisma, { phone: uniquePhone() });
      await expect(guest.claim(target.id, d)).resolves.toEqual({ claimed: 1 });

      const err = await guest.lookup({ orderCode: o.code, phone } as GuestLookupDto).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse();
      expect(body).toEqual({ statusCode: 403, error: 'Forbidden', code: 'GUEST_ORDER_CLAIMED', message: GUEST_ORDER_CLAIMED_MESSAGE });

      // Sai SĐT trên đơn đã nhận: vẫn cùng một 404 như mọi lần không khớp, không lộ đơn đã về tài khoản.
      await expect(guest.lookup({ orderCode: o.code, phone: uniquePhone() } as GuestLookupDto)).rejects.toMatchObject({
        message: 'Không tìm thấy đơn khớp mã đơn và số điện thoại này.',
      });
      // Khoá tạm cấp trước khi nhận đơn: theo dõi và QR đều 404; khoá trình duyệt gốc (người đặt) vẫn mở được.
      await expect(guest.track(o.code, before.trackingKey)).rejects.toBeInstanceOf(NotFoundException);
      await expect(guest.bankQr(o.code, before.trackingKey)).rejects.toBeInstanceOf(NotFoundException);
      await expect(guest.track(o.code, dto.trackingKey)).resolves.toMatchObject({ code: o.code });

      // Tài khoản nhận đơn bị xoá (zaloId, SĐT về null): đơn vẫn không mở lại cho tra cứu khách, khoá tạm cũ vẫn 404.
      await prisma.user.update({ where: { id: target.id }, data: { zaloId: null, phone: null, isBlocked: true } });
      await expect(guest.lookup({ orderCode: o.code, phone } as GuestLookupDto)).rejects.toMatchObject({ response: { code: 'GUEST_ORDER_CLAIMED' } });
      await expect(guest.track(o.code, before.trackingKey)).rejects.toBeInstanceOf(NotFoundException);
      // Quá hạn theo dõi (giao hơn 60 ngày): cùng 404 như đơn chưa nhận, không báo đã về tài khoản.
      await prisma.order.update({ where: { code: o.code }, data: { status: 'DELIVERED', deliveredAt: new Date(Date.now() - 61 * 86_400_000), deliveredEffectsAt: new Date() } });
      await expect(guest.lookup({ orderCode: o.code, phone } as GuestLookupDto)).rejects.toMatchObject({
        message: 'Không tìm thấy đơn khớp mã đơn và số điện thoại này.',
      });
    });

    it('tubu-w18-01: dòng khách được nâng tại chỗ thành tài khoản Zalo (zaloId thật): tra cứu cũng ra GUEST_ORDER_CLAIMED', async () => {
      const v = (await product(130_000)).variationId;
      const phone = uniquePhone();
      const o = await guest.placeOrder({ deviceId: device(), ip: ip() }, placeDto([{ variationId: v, quantity: 1 }], phone), idem());
      const owner = (await prisma.order.findUniqueOrThrow({ where: { code: o.code }, select: { userId: true } })).userId;
      await prisma.user.update({ where: { id: owner }, data: { zaloId: `zalo_it_${randCode(10)}` } });
      await expect(guest.lookup({ orderCode: o.code, phone } as GuestLookupDto)).rejects.toMatchObject({ response: { code: 'GUEST_ORDER_CLAIMED' } });
    });

    it('thiết bị không có đơn vãng lai: không gộp gì', async () => {
      const d = device();
      await auth.ensureGuestUser(d);
      const target = await createRealUser(prisma, { phone: uniquePhone() });
      await expect(guest.claim(target.id, d)).resolves.toEqual({ claimed: 0 });
    });
  });

  describe('Giờ vàng cho người mua chưa xác thực (tubu-w6-01 P1-b): giá đúng, hạn mức giữ theo thiết bị, SĐT và IP', () => {
    /** Tài khoản guest_ của Mini (đăng nhập theo deviceId, không SĐT, không Zalo thật) có địa chỉ giao với `phone`. */
    async function miniGuest(phone: string) {
      const u = await auth.ensureGuestUser(`m_${randomBytes(18).toString('base64url')}`);
      const addr = await prisma.address.create({ data: { userId: u.id, ...addressOf(phone) } });
      return { userId: u.id, addressId: addr.id };
    }

    it('Mini guest_: báo giá và đơn theo giá Giờ vàng; thiết bị khác cùng SĐT đã hết suất thì báo giá giá thường kèm lý do, đặt đơn không trừ suất', async () => {
      const v = (await product(150_000)).variationId;
      const item = await flashOn(v, 99_000, 1);
      const phone = uniquePhone();

      const a = await miniGuest(phone);
      await cart.addItem(a.userId, { variationId: v, quantity: 1 });
      const qa = await checkout.quote(a.userId, { addressId: a.addressId });
      expect(qa.subtotal).toBe(99_000);
      expect(qa.items[0]).toMatchObject({ isFlash: true, flashLimitNotice: null });
      const oa = await checkout.placeOrder(a.userId, { addressId: a.addressId, paymentMethod: 'COD', expectedTotal: qa.total } as never, idem(), 'miniapp');
      expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: oa.id, isGift: false } })).unitPrice).toBe(99_000);

      // Cùng SĐT, thiết bị mới (tài khoản guest_ mới): suất 1/khách đã dùng hết theo SĐT.
      const b = await miniGuest(phone);
      await cart.addItem(b.userId, { variationId: v, quantity: 1 });
      const qb = await checkout.quote(b.userId, { addressId: b.addressId });
      expect(qb.subtotal).toBe(150_000);
      expect(qb.items[0]).toMatchObject({ isFlash: false });
      expect(qb.items[0]!.flashLimitNotice).toContain('hết suất Giờ vàng');
      await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', expectedTotal: qb.total } as never, idem(), 'miniapp');
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(1);

      // SĐT khác thì vẫn được giá Giờ vàng.
      const c = await miniGuest(uniquePhone());
      await cart.addItem(c.userId, { variationId: v, quantity: 1 });
      expect((await checkout.quote(c.userId, { addressId: c.addressId })).subtotal).toBe(99_000);
    });

    it('Mini guest_: hai thiết bị cùng SĐT đặt CHỒNG khi còn 1 suất của SĐT → đúng một đơn giá Giờ vàng, lần kia báo FLASH_LIMIT, suất không âm không dư', async () => {
      const v = (await product(150_000)).variationId;
      const item = await flashOn(v, 99_000, 1);
      const phone = uniquePhone();
      const buyers = [await miniGuest(phone), await miniGuest(phone)];
      const quotes = [];
      for (const g of buyers) {
        await cart.addItem(g.userId, { variationId: v, quantity: 1 });
        quotes.push(await checkout.quote(g.userId, { addressId: g.addressId }));
      }
      expect(quotes.map((q) => q.subtotal)).toEqual([99_000, 99_000]);
      const results = await Promise.allSettled(
        buyers.map((g, i) => checkout.placeOrder(g.userId, { addressId: g.addressId, paymentMethod: 'COD', expectedTotal: quotes[i]!.total } as never, idem(), 'miniapp')),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(codeOf(rejected)).toBe('FLASH_LIMIT');
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(1);
      const [phoneKey] = flashLimitKeys({ phone });
      expect((await prisma.flashSalePurchase.findUniqueOrThrow({ where: { flashSaleItemId_userId: { flashSaleItemId: item.id, userId: phoneKey! } } })).quantity).toBe(1);
      // Lần thua không để lại dòng của tài khoản đã bị trả.
      const loser = buyers[results.findIndex((r) => r.status === 'rejected')]!;
      const loserRow = await prisma.flashSalePurchase.findUnique({ where: { flashSaleItemId_userId: { flashSaleItemId: item.id, userId: loser.userId } } });
      expect(loserRow?.quantity ?? 0).toBe(0);
    });

    it('Mini guest_: huỷ đơn hoàn suất ở cả tài khoản và SĐT, thiết bị khác cùng SĐT lại được giá Giờ vàng', async () => {
      const v = (await product(150_000)).variationId;
      const item = await flashOn(v, 99_000, 1);
      const phone = uniquePhone();
      const a = await miniGuest(phone);
      await cart.addItem(a.userId, { variationId: v, quantity: 1 });
      const qa = await checkout.quote(a.userId, { addressId: a.addressId });
      const oa = await checkout.placeOrder(a.userId, { addressId: a.addressId, paymentMethod: 'COD', expectedTotal: qa.total } as never, idem(), 'miniapp');
      const order = await prisma.order.findUniqueOrThrow({ where: { id: oa.id }, include: { items: true } });
      expect(order.flashLimitKeys).toEqual(flashLimitKeys({ phone }));
      await prisma.$transaction((tx) => moduleRef.get(OrderReversalService).reverseFinancials(tx, order));
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(0);
      const rows = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: item.id } });
      expect(rows.every((r) => r.quantity === 0)).toBe(true);
      const b = await miniGuest(phone);
      await cart.addItem(b.userId, { variationId: v, quantity: 1 });
      expect((await checkout.quote(b.userId, { addressId: b.addressId })).subtotal).toBe(99_000);
    });

    it('tubu-w11-01: lượt mua dưới khoá SĐT cũ (sha256 trần, trước HMAC) vẫn được đếm; không ghi dòng khoá cũ mới; đơn cũ huỷ thì hoàn vào khoá cũ', async () => {
      const v = (await product(150_000)).variationId;
      const item = await flashOn(v, 99_000, 1);
      const phone = uniquePhone();
      const legacy = buyerFlashLimitKeys(null, { phone }).find(isLegacyFlashKey)!;
      expect(legacy).toMatch(/^fsk:p:[0-9a-f]{64}$/);
      // Đơn đặt trước khi deploy: dòng khoá cũ đã có 1 (= perUserLimit).
      await prisma.flashSalePurchase.create({ data: { flashSaleItemId: item.id, userId: legacy, quantity: 1 } });
      await prisma.flashSaleItem.update({ where: { id: item.id }, data: { soldCount: 1 } });

      const a = await miniGuest(phone);
      await cart.addItem(a.userId, { variationId: v, quantity: 1 });
      // SQL đọc giá (SUM khoá SĐT mới + cũ) trên Postgres thật: hết suất của SĐT nên không còn giá Giờ vàng.
      expect((await checkout.quote(a.userId, { addressId: a.addressId })).subtotal).toBe(150_000);
      const flash = moduleRef.get(FlashSaleService);
      const keys = buyerFlashLimitKeys(null, { phone });
      expect(await prisma.$transaction((tx) => flash.consumeQuotas(tx, a.userId, [{ flashSaleItemId: item.id, quantity: 1 }], new Date(), keys))).toEqual(['OVER_LIMIT']);
      const rows = await prisma.flashSalePurchase.findMany({ where: { flashSaleItemId: item.id }, orderBy: { userId: 'asc' } });
      expect(rows.filter((r) => r.quantity > 0).map((r) => [r.userId, r.quantity])).toEqual([[legacy, 1]]);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(1);

      // Đơn cũ (ghi khoá cũ) bị huỷ: hoàn vào khoá cũ, SĐT lại được giá Giờ vàng và lần mua mới chỉ cộng khoá HMAC.
      await prisma.$transaction((tx) => flash.restore(tx, item.id, `old-${randCode(6)}`, 1, [legacy]));
      expect((await checkout.quote(a.userId, { addressId: a.addressId })).subtotal).toBe(99_000);
      const qa = await checkout.quote(a.userId, { addressId: a.addressId });
      const oa = await checkout.placeOrder(a.userId, { addressId: a.addressId, paymentMethod: 'COD', expectedTotal: qa.total } as never, idem(), 'miniapp');
      const order = await prisma.order.findUniqueOrThrow({ where: { id: oa.id } });
      expect(order.flashLimitKeys).toEqual(flashLimitKeys({ phone }));
      expect(order.flashLimitKeys.some(isLegacyFlashKey)).toBe(false);
      const byKey = async (userId: string) =>
        (await prisma.flashSalePurchase.findUnique({ where: { flashSaleItemId_userId: { flashSaleItemId: item.id, userId } } }))?.quantity ?? 0;
      expect(await byKey(flashLimitKeys({ phone })[0]!)).toBe(1);
      expect(await byKey(legacy)).toBe(0);
    });

    it('đơn đặt trước khi có cột flashLimitKeys (mảng rỗng): huỷ chỉ hoàn suất của tài khoản, không hoàn khoá SĐT mà đơn chưa từng trừ', async () => {
      const v = (await product(150_000)).variationId;
      const item = await flashOn(v, 99_000, 2);
      const phone = uniquePhone();
      const a = await miniGuest(phone);
      await cart.addItem(a.userId, { variationId: v, quantity: 1 });
      const qa = await checkout.quote(a.userId, { addressId: a.addressId });
      const oa = await checkout.placeOrder(a.userId, { addressId: a.addressId, paymentMethod: 'COD', expectedTotal: qa.total } as never, idem(), 'miniapp');
      const order = await prisma.order.update({ where: { id: oa.id }, data: { flashLimitKeys: [] }, include: { items: true } });
      await prisma.$transaction((tx) => moduleRef.get(OrderReversalService).reverseFinancials(tx, order));
      const [phoneKey] = flashLimitKeys({ phone });
      const byKey = async (userId: string) =>
        (await prisma.flashSalePurchase.findUnique({ where: { flashSaleItemId_userId: { flashSaleItemId: item.id, userId } } }))?.quantity ?? 0;
      expect(await byKey(a.userId)).toBe(0);
      expect(await byKey(phoneKey!)).toBe(1);
    });

    it('Mini guest_: một IP (nhiều máy sau cùng NAT) được tối đa 3 lần giới hạn mỗi khách dù đổi SĐT và thiết bị', async () => {
      const v = (await product(150_000)).variationId;
      const item = await flashOn(v, 99_000, 1);
      const ipHash = `it-${randCode(10)}`;
      for (let i = 0; i < 3; i += 1) {
        const g = await miniGuest(uniquePhone());
        await cart.addItem(g.userId, { variationId: v, quantity: 1 });
        const q = await checkout.quote(g.userId, { addressId: g.addressId }, false, ipHash);
        expect(q.subtotal).toBe(99_000);
        const o = await checkout.placeOrder(g.userId, { addressId: g.addressId, paymentMethod: 'COD', expectedTotal: q.total } as never, idem(), 'miniapp', undefined, ipHash);
        expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).flashLimitKeys).toContain(`fsk:i:${ipHash}`);
      }
      const late = await miniGuest(uniquePhone());
      await cart.addItem(late.userId, { variationId: v, quantity: 1 });
      const q4 = await checkout.quote(late.userId, { addressId: late.addressId }, false, ipHash);
      expect(q4.subtotal).toBe(150_000);
      expect(q4.items[0]!.flashLimitNotice).toContain('hết suất Giờ vàng');
      // Cùng máy đó, IP khác thì lại được giá Giờ vàng.
      expect((await checkout.quote(late.userId, { addressId: late.addressId }, false, `it-${randCode(10)}`)).subtotal).toBe(99_000);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(3);
    });

    it('Web vãng lai: một SĐT không mua quá giới hạn dù đổi thiết bị và IP; một IP (nhiều máy sau NAT) tối đa 3 lần giới hạn dù đổi SĐT và thiết bị', async () => {
      const v = (await product(150_000)).variationId;
      const item = await flashOn(v, 99_000, 1);
      const lines = [{ variationId: v, quantity: 1 }];
      const phone = uniquePhone();
      const sharedIp = ip();
      const first = { deviceId: device(), ip: sharedIp };
      const q1 = await guest.quote(first, { lines, address: addressOf(phone) });
      expect(q1).toMatchObject({ subtotal: 99_000, flashNotice: false });
      await guest.placeOrder(first, placeDto(lines, phone, { expectedTotal: q1.total }), idem());

      // Cùng SĐT, thiết bị + IP mới: giá thường kèm câu hết suất.
      const samePhone = await guest.quote({ deviceId: device(), ip: ip() }, { lines, address: addressOf(phone) });
      expect(samePhone).toMatchObject({ subtotal: 150_000, flashNotice: true });
      expect(samePhone.items[0]).toMatchObject({ isFlash: false, unitPrice: 150_000 });
      // Cùng IP, SĐT + thiết bị mới: IP mới dùng 1/3 nên vẫn giá Giờ vàng; đặt thêm 2 đơn thì IP đủ 3.
      for (let n = 0; n < 2; n += 1) {
        const meta = { deviceId: device(), ip: sharedIp };
        const p = uniquePhone();
        const q = await guest.quote(meta, { lines, address: addressOf(p) });
        expect(q).toMatchObject({ subtotal: 99_000, flashNotice: false });
        await guest.placeOrder(meta, placeDto(lines, p, { expectedTotal: q.total }), idem());
      }
      const sameIp = await guest.quote({ deviceId: device(), ip: sharedIp }, { lines, address: addressOf(uniquePhone()) });
      expect(sameIp).toMatchObject({ subtotal: 150_000, flashNotice: true });
      // SĐT, IP, thiết bị đều mới: giá Giờ vàng.
      const fresh = await guest.quote({ deviceId: device(), ip: ip() }, { lines, address: addressOf(uniquePhone()) });
      expect(fresh).toMatchObject({ subtotal: 99_000, flashNotice: false });
      // Đặt theo giá thường cùng SĐT thì đơn giá thường, suất không đổi.
      const meta2 = { deviceId: device(), ip: ip() };
      const placed = await guest.placeOrder(meta2, placeDto(lines, phone, { expectedTotal: samePhone.total }), idem());
      const o = await prisma.order.findUniqueOrThrow({ where: { code: placed.code }, include: { items: true } });
      expect(o.items.find((i) => !i.isGift)).toMatchObject({ unitPrice: 150_000, flashSaleItemId: null });
      expect(o.flashLimitKeys).toEqual([]);
      expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(3);
    });

    it('4 mốc kinh tế với hàng Giờ vàng: giá Giờ vàng chạm 199.000đ thì miễn phí giao, 299.000đ thì mở quà 0đ; khách vãng lai không tích, không dùng điểm hay mã; thưởng ảnh vẫn +100', async () => {
      const at = async (regular: number, flashPrice: number) => {
        const v = (await product(regular)).variationId;
        await flashOn(v, flashPrice);
        const meta = { deviceId: device(), ip: ip() };
        const phone = uniquePhone();
        const lines = [{ variationId: v, quantity: 1 }];
        const q = await guest.quote(meta, { lines, address: addressOf(phone) });
        return { q, meta, phone, lines };
      };
      const below = await at(260_000, 198_000);
      expect(below.q).toMatchObject({ subtotal: 198_000, shippingFee: 19_000, total: 217_000, discount: 0 });
      const free = await at(260_000, 199_000);
      expect(free.q).toMatchObject({ subtotal: 199_000, shippingFee: 0, total: 199_000, discount: 0 });
      const noGift = await at(400_000, 298_000);
      expect(noGift.q.giftTrial?.selectedVariationId ?? null).toBeNull();
      const gift = await at(400_000, 299_000);
      expect(gift.q.giftTrial?.selectedVariationId).toBe(giftVariationId);
      const placed = await guest.placeOrder(gift.meta, placeDto(gift.lines, gift.phone, { expectedTotal: gift.q.total }), idem());
      const o = await prisma.order.findUniqueOrThrow({ where: { code: placed.code }, include: { items: true } });
      expect(o).toMatchObject({ subtotal: 299_000, total: 299_000, shippingFee: 0, discount: 0, pointsUsed: 0, pointsEarned: 0, couponCode: null });
      expect(o.items.filter((i) => i.isGift).map((i) => [i.variationId, i.unitPrice])).toEqual([[giftVariationId, 0]]);
      // Trần gộp mã + Điểm Xanh: khách vãng lai không có đường giảm nào ngoài giá Giờ vàng, nên giảm từ mã/điểm = 0 ≤ 20%.
      expect(o.discount + o.pointsDiscount).toBeLessThanOrEqual(Math.floor(o.subtotal * 0.2));
      expect(PHOTO_REWARD_POINTS_DEFAULT).toBe(100);
    });
  });

  describe('cờ tắt', () => {
    it('báo giá và đặt đơn 404; theo dõi đơn đã đặt vẫn chạy; tài khoản vãng lai vẫn được giá Giờ vàng', async () => {
      const v = (await product(150_000)).variationId;
      const dto = placeDto([{ variationId: v, quantity: 1 }], uniquePhone());
      const meta = { deviceId: device(), ip: ip() };
      const o = await guest.placeOrder(meta, dto, idem());
      await setFlag(WEB_GUEST_CHECKOUT_ENABLED_KEY, false);
      try {
        await expect(guest.quote(meta, { lines: dto.lines, address: dto.address })).rejects.toBeInstanceOf(NotFoundException);
        await expect(guest.placeOrder(meta, { ...dto, trackingKey: trackingKey() }, idem())).rejects.toBeInstanceOf(NotFoundException);
        await expect(guest.track(o.code, dto.trackingKey)).resolves.toMatchObject({ code: o.code });
        const fv = (await product(150_000)).variationId;
        await flashOn(fv, 99_000);
        const g = await auth.ensureGuestUser(device());
        const flash = await moduleRef.get(FlashSaleService).resolveEffective([fv], new Date(), g.id);
        expect(flash.get(fv)?.flashPrice).toBe(99_000);
      } finally {
        await setFlag(WEB_GUEST_CHECKOUT_ENABLED_KEY, true);
      }
    });
  });
});
