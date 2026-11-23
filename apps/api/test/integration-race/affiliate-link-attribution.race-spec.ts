import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
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
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { GiftTrialService } from '../../src/modules/gift-tiers/gift-trial.service';
import { GIFT_TRIAL_ENABLED_KEY } from '../../src/modules/gift-tiers/gift-trial';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import type { BankTransferService } from '../../src/modules/integrations/payment/bank-transfer.service';
import { GuestCheckoutService } from '../../src/modules/checkout/guest/guest-checkout.service';
import { GUEST_BLOCKED_PHONES_KEY, GUEST_COD_MAX_KEY, GUEST_DAILY_IP_CAP_KEY, WEB_GUEST_CHECKOUT_ENABLED_KEY } from '../../src/modules/checkout/guest/guest-checkout.config';
import type { GuestPlaceOrderDto } from '../../src/modules/checkout/guest/dto/guest-checkout.dto';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from '../../src/modules/affiliate/affiliate-auto-transfer-config';
import { adjustLinkStats } from '../../src/modules/affiliate/affiliate-link-stats';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createUser, pinConfig, randCode, setConfig, uniquePhone, warmPool } from './helpers';

/** Mã link như AffiliateService.createLink sinh (5 byte base64url = 7 ký tự), thêm tiền tố để dễ nhận trong DB thử. */
const linkCode = () => `w24${randomBytes(5).toString('base64url')}`;

/** Số đơn/doanh số link phải bằng: đếm và cộng nền doanh số các dòng hoa hồng chưa REJECTED của đơn mang mã link (affiliate-link-stats.ts). */
async function expectLinkMatchesCommissions(prisma: PrismaService, linkId: string) {
  const link = await prisma.affiliateLink.findUniqueOrThrow({ where: { id: linkId } });
  const live = await prisma.commission.findMany({
    where: { affiliateUserId: link.userId, status: { not: 'REJECTED' }, order: { affiliateLinkCode: link.shortCode } },
    select: { commissionableTotal: true },
  });
  expect({ conversions: link.conversions, revenue: link.revenue }).toEqual({
    conversions: live.length,
    revenue: live.reduce((s, c) => s + c.commissionableTotal, 0),
  });
  return link;
}

/**
 * Số đơn và doanh số theo từng link CTV (tubu-w24-01, PO A4) trên Postgres thật, đi qua checkout thật (đăng nhập và vãng lai):
 * - đơn lưu `affiliateLinkCode` chỉ khi link có thật và thuộc đúng người giới thiệu của đơn; ghép `?l=` của CTV khác (giả link) thì bỏ;
 * - dòng hoa hồng tạo ra cộng +1 đơn / + nền doanh số vào link đúng một lần dù gọi lại hay gọi song song;
 * - huỷ đơn trừ đúng một lần dù đảo song song, không xuống dưới 0; trả một phần chỉ trừ doanh số, trả nốt trừ đơn.
 */
describe('Đơn và doanh số theo link CTV: checkout thật (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let affiliate: AffiliateService;
  let guest: GuestCheckoutService;
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
    affiliate = moduleRef.get(AffiliateService);
    const config = moduleRef.get(SystemConfigService);
    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-w24-link', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30, JWT_REFRESH_REUSE_GRACE_SECONDS: 30 };
    const env = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const rbac = new RbacService(prisma, new MerchantFulfilmentService(prisma, {} as never, undefined, new SystemConfigService(prisma)));
    const auth = new AuthService(prisma, new JwtService(), env, {} as ZaloService, rbac);
    const bank = { getBankQr: jest.fn() } as unknown as BankTransferService;
    guest = new GuestCheckoutService(prisma, checkout, auth, bank, config, moduleRef.get(AnalyticsEventsService), env, {} as never);

    restores.push(await pinConfig(prisma, WEB_GUEST_CHECKOUT_ENABLED_KEY, true));
    restores.push(await pinConfig(prisma, GUEST_COD_MAX_KEY, 2_000_000));
    restores.push(await pinConfig(prisma, GUEST_DAILY_IP_CAP_KEY, 50));
    restores.push(await pinConfig(prisma, GUEST_BLOCKED_PHONES_KEY, []));
    restores.push(await pinConfig(prisma, GIFT_TRIAL_ENABLED_KEY, false));
    restores.push(await pinConfig(prisma, 'shipping.free_threshold', 199_000));
    restores.push(await pinConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000));
    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await moduleRef?.close();
  });

  async function variation(price = 240_000) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itw24-p-${tag}`,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itw24-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
        variations: { create: { pancakeId: `itw24-v-${tag}`, sku: `ITW24-${tag}`, name: 'Chai', attributes: {}, retailPrice: price, stock: 500, affiliateRate: 10 } },
      },
      include: { variations: true },
    });
    return p.variations[0]!.id;
  }

  const addressOf = (phone: string) => ({
    recipient: 'Khach Link',
    phone,
    province: 'Ha Noi',
    district: '',
    ward: 'Phuong IT',
    street: '12 Ngo IT',
    provinceCode: '84_VN01',
    districtCode: '',
    wardCode: '00001',
  });

  async function buyer() {
    const phone = uniquePhone();
    const u = await createUser(prisma, { phone, zaloId: `zalo_itw24_${randCode(10)}` });
    await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 10 * 86_400_000) });
    const addr = await prisma.address.create({ data: { userId: u.id, ...addressOf(phone) } });
    return { userId: u.id, addressId: addr.id };
  }

  async function ctv(phone?: string) {
    const u = await createUser(prisma, { role: 'AFFILIATE', ...(phone ? { phone } : {}) });
    const link = await prisma.affiliateLink.create({ data: { userId: u.id, shortCode: linkCode(), targetType: 'HOMEPAGE' } });
    return { user: u, code: u.referralCode!, link };
  }

  async function placeAuth(extra: { referralCode?: string; affiliateLinkCode?: string }) {
    const b = await buyer();
    await cart.addItem(b.userId, { variationId: await variation(), quantity: 1 });
    const placed = await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', ...extra } as never, `itw24-${randCode(14)}`, 'miniapp');
    return prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
  }

  const meta = () => ({ deviceId: `w_${randomBytes(24).toString('base64url')}`, ip: `10.24.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

  async function placeGuest(phone: string, extra: Pick<GuestPlaceOrderDto, 'referralCode' | 'affiliateLinkCode'>) {
    const dto = {
      lines: [{ variationId: await variation(), quantity: 1 }],
      address: addressOf(phone),
      paymentMethod: 'COD',
      trackingKey: randomBytes(32).toString('base64url'),
      fillMs: 20_000,
      ...extra,
    } as GuestPlaceOrderDto;
    const placed = await guest.placeOrder(meta(), dto, `itw24g-${randCode(14)}`);
    return prisma.order.findUniqueOrThrow({ where: { code: placed.code } });
  }

  it('đăng nhập, ?ref= + ?l= của cùng CTV: đơn lưu mã link, link +1 đơn và + nền doanh số của dòng hoa hồng', async () => {
    const a = await ctv();
    const order = await placeAuth({ referralCode: a.code, affiliateLinkCode: a.link.shortCode });
    expect(order).toMatchObject({ referrerUserId: a.user.id, affiliateLinkCode: a.link.shortCode });
    const c = await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } });
    expect(c.commissionableTotal).toBeGreaterThan(0);
    const link = await expectLinkMatchesCommissions(prisma, a.link.id);
    expect(link).toMatchObject({ conversions: 1, revenue: c.commissionableTotal, clicks: 0 });
  });

  it('giả link: ?ref= của CTV A ghép ?l= của CTV B → đơn vẫn ghi công A nhưng không lưu mã, link của B và A không đổi', async () => {
    const a = await ctv();
    const b = await ctv();
    const order = await placeAuth({ referralCode: a.code, affiliateLinkCode: b.link.shortCode });
    expect(order).toMatchObject({ referrerUserId: a.user.id, affiliateLinkCode: null });
    expect(await prisma.commission.count({ where: { orderId: order.id, affiliateUserId: a.user.id } })).toBe(1);
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: b.link.id } })).toMatchObject({ conversions: 0, revenue: 0 });
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: a.link.id } })).toMatchObject({ conversions: 0, revenue: 0 });
  });

  it('mã link không có thật, sai khuôn, hay đơn không có người giới thiệu: đơn vẫn đặt, không lưu mã', async () => {
    const a = await ctv();
    const ghost = await placeAuth({ referralCode: a.code, affiliateLinkCode: 'khongcothat1' });
    expect(ghost).toMatchObject({ referrerUserId: a.user.id, affiliateLinkCode: null });
    const bad = await placeAuth({ referralCode: a.code, affiliateLinkCode: "x'; --" });
    expect(bad).toMatchObject({ referrerUserId: a.user.id, affiliateLinkCode: null });
    const friend = await createUser(prisma, { role: 'CUSTOMER' });
    const noRef = await placeAuth({ referralCode: friend.referralCode!, affiliateLinkCode: a.link.shortCode });
    expect(noRef).toMatchObject({ referrerUserId: null, affiliateLinkCode: null });
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: a.link.id } })).toMatchObject({ conversions: 0, revenue: 0 });
  });

  it('khách vãng lai web: ?ref= + ?l= của CTV → đơn ghi công CTV, lưu mã link, có hoa hồng, link +1', async () => {
    const a = await ctv(uniquePhone());
    const order = await placeGuest(uniquePhone(), { referralCode: a.code, affiliateLinkCode: a.link.shortCode });
    expect(order).toMatchObject({ referrerUserId: a.user.id, affiliateLinkCode: a.link.shortCode, platform: 'web' });
    expect(order.guestPhone).not.toBeNull();
    expect(await prisma.commission.count({ where: { orderId: order.id, affiliateUserId: a.user.id, status: 'PENDING' } })).toBe(1);
    expect(await expectLinkMatchesCommissions(prisma, a.link.id)).toMatchObject({ conversions: 1 });
  });

  it('khách vãng lai: giả link của CTV khác bị bỏ; SĐT đặt hàng trùng SĐT của chính CTV (kể cả lưu dạng 84…) hay CTV chưa có SĐT → không ghi công, không lưu mã, không hoa hồng', async () => {
    const a = await ctv(uniquePhone());
    const b = await ctv(uniquePhone());
    const spoof = await placeGuest(uniquePhone(), { referralCode: a.code, affiliateLinkCode: b.link.shortCode });
    expect(spoof).toMatchObject({ referrerUserId: a.user.id, affiliateLinkCode: null });
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: b.link.id } })).toMatchObject({ conversions: 0, revenue: 0 });

    const ownPhone = uniquePhone();
    const self = await ctv(ownPhone);
    const own = await placeGuest(ownPhone, { referralCode: self.code, affiliateLinkCode: self.link.shortCode });
    expect(own).toMatchObject({ referrerUserId: null, affiliateLinkCode: null });
    expect(await prisma.commission.count({ where: { orderId: own.id } })).toBe(0);
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: self.link.id } })).toMatchObject({ conversions: 0, revenue: 0 });

    const intlPhone = uniquePhone();
    const intl = await ctv(`84${intlPhone.slice(1)}`);
    const ownIntl = await placeGuest(intlPhone, { referralCode: intl.code, affiliateLinkCode: intl.link.shortCode });
    expect(ownIntl).toMatchObject({ referrerUserId: null, affiliateLinkCode: null });

    const noPhone = await ctv();
    const anon = await placeGuest(uniquePhone(), { referralCode: noPhone.code, affiliateLinkCode: noPhone.link.shortCode });
    expect(anon).toMatchObject({ referrerUserId: null, affiliateLinkCode: null });
    expect(await prisma.commission.count({ where: { orderId: anon.id } })).toBe(0);
  });

  it('tạo hoa hồng gọi lại và 8 lần song song: đúng một dòng hoa hồng, link chỉ +1', async () => {
    const a = await ctv();
    const order = await placeAuth({ referralCode: a.code, affiliateLinkCode: a.link.shortCode });
    // Gọi lại sau khi checkout đã tạo: không cộng thêm.
    await affiliate.createCommissionForOrder(order.id);
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: a.link.id } })).toMatchObject({ conversions: 1 });

    // Như chưa có hoa hồng (vd đơn được ghi công muộn): xoá dòng, trả link về 0, rồi 8 tx cùng tạo.
    await prisma.commission.deleteMany({ where: { orderId: order.id } });
    await prisma.affiliateLink.update({ where: { id: a.link.id }, data: { conversions: 0, revenue: 0 } });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => prisma.$transaction((tx) => affiliate.createCommissionForOrder(order.id, tx))));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await prisma.commission.count({ where: { orderId: order.id } })).toBe(1);
    expect(await expectLinkMatchesCommissions(prisma, a.link.id)).toMatchObject({ conversions: 1 });
  });

  it('huỷ đơn, đảo hoa hồng 5 lần song song rồi gọi lại: link trừ đúng một lần về 0; số cũ lệch không xuống dưới 0', async () => {
    const a = await ctv();
    const keep = await placeAuth({ referralCode: a.code, affiliateLinkCode: a.link.shortCode });
    const cancel = await placeAuth({ referralCode: a.code, affiliateLinkCode: a.link.shortCode });
    expect(await expectLinkMatchesCommissions(prisma, a.link.id)).toMatchObject({ conversions: 2 });

    await prisma.order.update({ where: { id: cancel.id }, data: { status: 'CANCELLED' } });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => affiliate.reverseCommissionsForOrder(cancel.id)));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    await affiliate.reverseCommissionsForOrder(cancel.id);
    expect(await prisma.commission.findFirstOrThrow({ where: { orderId: cancel.id } })).toMatchObject({ status: 'REJECTED' });
    const keepBase = (await prisma.commission.findFirstOrThrow({ where: { orderId: keep.id } })).commissionableTotal;
    expect(await expectLinkMatchesCommissions(prisma, a.link.id)).toMatchObject({ conversions: 1, revenue: keepBase });

    // Số link lệch (vd sửa tay) thấp hơn phần cần trừ: đảo đơn còn lại kẹp ở 0, không âm.
    await prisma.affiliateLink.update({ where: { id: a.link.id }, data: { conversions: 0, revenue: 1_000 } });
    await prisma.order.update({ where: { id: keep.id }, data: { status: 'CANCELLED' } });
    await affiliate.reverseCommissionsForOrder(keep.id);
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: a.link.id } })).toMatchObject({ conversions: 0, revenue: 0 });
  });

  it('adjustLinkStats: chỉ cộng vào link của đúng CTV hưởng hoa hồng, kẹp trần int4 thay vì làm hỏng tx', async () => {
    const a = await ctv();
    const b = await ctv();
    const order = await placeAuth({ referralCode: a.code, affiliateLinkCode: a.link.shortCode });
    // CTV khác người mang link: không dòng nào khớp.
    expect(await adjustLinkStats(prisma, { orderId: order.id, affiliateUserId: b.user.id, orders: 1, revenue: 5 })).toBe(0);
    await prisma.affiliateLink.update({ where: { id: a.link.id }, data: { revenue: 2_147_483_000 } });
    expect(await adjustLinkStats(prisma, { orderId: order.id, affiliateUserId: a.user.id, orders: 1, revenue: 10_000 })).toBe(1);
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: a.link.id } })).toMatchObject({ conversions: 2, revenue: 2_147_483_647 });
  });
});

describe('Đơn và doanh số theo link CTV: trả một phần rồi trả nốt (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let affiliate: AffiliateService;
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
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    affiliate = moduleRef.get(AffiliateService);
    await setConfig(prisma, 'returns.window_days', 7);
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
      data: { pancakeId: `it-w24r-p-${tag}`, brand: 'IT', slug: `it-w24r-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-w24r-v-${tag}`, productId: product.id, sku: `ITW24R-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, affiliateRate, stock: 50 },
    });
  }

  async function partialReturn(adminId: string, buyerId: string, code: string, items: { orderItemId: string; quantity: number }[]) {
    const req = await returns.request(buyerId, code, { reasonCode: 'DEFECTIVE', items, refundMethod: 'WALLET' });
    await returns.review(adminId, req.id, { approve: true });
    return prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
  }

  it('trả một phần: link giữ 1 đơn, doanh số giảm đúng phần nền bị cắt; trả nốt cả đơn: link về 0 đơn / 0đ', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const link = await prisma.affiliateLink.create({ data: { userId: ctv.id, shortCode: linkCode(), targetType: 'PRODUCT' } });
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    // a: 3 × 35.000 (thực trả 100.000, 10%), b: 2 × 50.000 (95.000, 5%), c: 1 × 20.000 (15.000, 0%) → nền doanh số 195.000.
    const [a, b, c] = await Promise.all([variation(35_000, 10), variation(50_000, 5), variation(20_000, 0)]);
    const order = await createOrder(prisma, {
      userId: buyer.id,
      referrerUserId: ctv.id,
      affiliateLinkCode: link.shortCode,
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
    expect(await expectLinkMatchesCommissions(prisma, link.id)).toMatchObject({ conversions: 1, revenue: 195_000 });

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    const by = (v: { id: string }) => items.find((i) => i.variationId === v.id)!;
    await partialReturn(admin.id, buyer.id, order.code, [{ orderItemId: by(a).id, quantity: 1 }]);
    expect(await expectLinkMatchesCommissions(prisma, link.id)).toMatchObject({ conversions: 1, revenue: 161_667 });

    const last = await partialReturn(admin.id, buyer.id, order.code, [
      { orderItemId: by(a).id, quantity: 2 },
      { orderItemId: by(b).id, quantity: 2 },
      { orderItemId: by(c).id, quantity: 1 },
    ]);
    expect(last.fullReturn).toBe(true);
    expect(await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'REJECTED' });
    expect(await expectLinkMatchesCommissions(prisma, link.id)).toMatchObject({ conversions: 0, revenue: 0 });
  });
});
