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
import { GuestCheckoutService, GUEST_LIMIT, GUEST_LIMIT_MESSAGE } from '../../src/modules/checkout/guest/guest-checkout.service';
import {
  GUEST_BLOCKED_PHONES_KEY,
  GUEST_COD_MAX_KEY,
  GUEST_COD_OVER_MAX,
  GUEST_DAILY_IP_CAP_KEY,
  WEB_GUEST_CHECKOUT_ENABLED_KEY,
} from '../../src/modules/checkout/guest/guest-checkout.config';
import type { GuestPlaceOrderDto } from '../../src/modules/checkout/guest/dto/guest-checkout.dto';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createRealUser, createUser, pinConfig, randCode, setConfig, uniquePhone, warmPool } from './helpers';

/**
 * Đặt hàng không đăng nhập trên web (tubu-w4-01) trên Postgres thật: tiền đơn khách vãng lai bằng đúng tài khoản thường không mã/điểm/hạng
 * (12 giỏ mẫu, cùng một đường tính tiền), giỏ có hàng Giờ vàng tính giá thường và không trừ suất, bấm đúp ra một đơn, đơn vị cuối chỉ một
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
    guest = new GuestCheckoutService(prisma, checkout, auth, bank, config, moduleRef.get(AnalyticsEventsService), env, moduleRef.get(FlashSaleService));

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

  async function flashOn(variationId: string, flashPrice: number) {
    const s = await prisma.flashSale.create({
      data: { title: `IT ${randCode(4)}`, startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + 3_600_000), createdBy: adminId },
    });
    return prisma.flashSaleItem.create({ data: { flashSaleId: s.id, variationId, flashPrice, quota: 50, perUserLimit: 10 } });
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

    it('2 giỏ có hàng Giờ vàng: tài khoản được giá flash, khách vãng lai trả giá thường, không trừ suất, không có dòng mua flash', async () => {
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
        expect(gq.subtotal).toBe(regular);
        expect(gq.flashNotice).toBe(true);
        const placed = await guest.placeOrder(meta, placeDto([{ variationId: v, quantity: 1 }], phone, { expectedTotal: gq.total }), idem());
        const o = await prisma.order.findUniqueOrThrow({ where: { code: placed.code }, include: { items: true } });
        expect(o.items.find((i) => !i.isGift)).toMatchObject({ unitPrice: regular, flashSaleItemId: null });
        expect((await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } })).soldCount).toBe(0);
        expect(await prisma.flashSalePurchase.count({ where: { flashSaleItemId: item.id } })).toBe(0);
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

    it('thiết bị không có đơn vãng lai: không gộp gì', async () => {
      const d = device();
      await auth.ensureGuestUser(d);
      const target = await createRealUser(prisma, { phone: uniquePhone() });
      await expect(guest.claim(target.id, d)).resolves.toEqual({ claimed: 0 });
    });
  });

  describe('cờ tắt', () => {
    it('báo giá và đặt đơn 404; theo dõi đơn đã đặt vẫn chạy; giá Giờ vàng của tài khoản vãng lai như cũ', async () => {
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
