import { randomInt } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { CouponsService, NEW_CUSTOMER_ONLY_MSG } from '../../src/modules/coupons/coupons.service';
import { CouponClaimService } from '../../src/modules/coupons/coupon-claim.service';
import { FIRST_ORDER_FREESHIP_TAKEN_MSG, PricingService } from '../../src/modules/pricing/pricing.service';
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
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { AdminCouponBatchService } from '../../src/modules/admin/admin-coupon-batch.service';
import { REAL_USER_REQUIRED_MSG } from '../../src/common/real-user';
import { barrierOnFirstCalls, createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * Thẻ hộp hàng sàn (D2-03) và freeship đơn đầu (D2-08) trên Postgres thật: nhận mã song song, mã chỉ khách mới khi hai lần đặt
 * song song cùng tính là đơn đầu, freeship đơn đầu bật/tắt, gộp tài khoản khách, tạo lô mã. CartService, CheckoutService,
 * CouponsService, CouponClaimService, LoyaltyService là bản thật; chỉ stub thông báo, Pancake, Gomdon, combo.
 */
describe('claim-first-order: mã thẻ hộp hàng + freeship đơn đầu (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let coupons: CouponsService;
  let claims: CouponClaimService;
  let loyalty: LoyaltyService;
  let config: SystemConfigService;
  let batches: AdminCouponBatchService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        CouponClaimService,
        FlashSaleService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        AdminCouponBatchService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: GomdonOrderService,
          useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() },
        },
        { provide: ComboService, useValue: { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    coupons = moduleRef.get(CouponsService);
    claims = moduleRef.get(CouponClaimService);
    loyalty = moduleRef.get(LoyaltyService);
    config = moduleRef.get(SystemConfigService);
    batches = moduleRef.get(AdminCouponBatchService);
    await config.set('shipping.free_threshold', 200_000, 'it-claim');
    await config.set('shipping.flat_fee_below_threshold', 19_000, 'it-claim');
    await config.set('shipping.first_order_free_enabled', false, 'it-claim');
    await config.set('shipping.first_order_free_min_subtotal', 0, 'it-claim');
  });

  afterAll(async () => {
    // DB race dùng chung giữa các spec: trả cờ về mặc định (tắt) để spec khác tính phí giao như cũ.
    await config?.set('shipping.first_order_free_enabled', false, 'it-claim');
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const realUser = () => createUser(prisma, { phone: phone() });
  const guestUser = () => createUser(prisma, { zaloId: `guest_${randCode(12)}` });

  async function product(price: number, stock = 50) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `cl-p-${tag}`, brand: 'IT', slug: `cl-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `cl-v-${tag}`, productId: p.id, sku: `CL-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock },
    });
    return { productId: p.id, variationId: v.id };
  }

  async function address(userId: string) {
    return prisma.address.create({
      data: {
        userId,
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
  }

  async function coupon(data: Partial<Parameters<PrismaService['coupon']['create']>[0]['data']> = {}) {
    const now = Date.now();
    return prisma.coupon.create({
      data: {
        code: `CL${randCode(8)}`,
        type: 'AMOUNT',
        value: 30_000,
        minOrder: 50_000,
        startAt: new Date(now - 3_600_000),
        endAt: new Date(now + 86_400_000),
        usageLimit: 1,
        perUserLimit: 1,
        scope: 'CLAIM',
        newCustomerOnly: true,
        ...data,
      },
    });
  }

  /** Giỏ hai dòng 100k (tách được thành hai lần đặt tập con song song), kèm địa chỉ. */
  async function twoLineCart(userId: string) {
    const a = await product(100_000);
    const b = await product(100_000);
    await cart.addItem(userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(userId, { variationId: b.variationId, quantity: 1 });
    const lines = await prisma.cartItem.findMany({ where: { cart: { userId } }, orderBy: { id: 'asc' }, select: { id: true } });
    return { addr: await address(userId), lineIds: lines.map((l) => l.id) };
  }

  /** Hai lần đặt tập con song song; rào sau compute để cả hai cùng tính giá (cùng thấy "chưa có đơn") trước khi vào tx. */
  async function placeInParallel(userId: string, addrId: string, lineIds: string[]) {
    const spy = barrierOnFirstCalls(checkout as unknown as { compute: unknown }, 'compute', 2);
    try {
      return await Promise.allSettled(
        lineIds.map((id) => checkout.placeOrder(userId, { addressId: addrId, paymentMethod: 'COD', itemIds: [id] } as never)),
      );
    } finally {
      spy.mockRestore();
    }
  }

  describe('nhận mã (POST /coupons/claim)', () => {
    it('một khách quét thẻ 10 lần song song → đúng 1 dòng nhận, mọi lần đều trả thông tin mã', async () => {
      const u = await realUser();
      const c = await coupon();
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => claims.claim(u.id, c.code)));
      const s = summarize(results);
      expect(s.errors).toEqual([]);
      expect(await prisma.couponClaim.count({ where: { couponId: c.id } })).toBe(1);
      expect(s.fulfilled.filter((r) => !r.value.alreadyClaimed)).toHaveLength(1);
    });

    it('6 khách cùng nhận một thẻ riêng (1 lượt) song song → đúng 1 người nhận, còn lại báo đã có tài khoản khác nhận', async () => {
      const c = await coupon();
      const users = await Promise.all(Array.from({ length: 6 }, () => realUser()));
      const s = summarize(await Promise.allSettled(users.map((u) => claims.claim(u.id, c.code))));
      expect(s.fulfilled).toHaveLength(1);
      expect(new Set(s.errors)).toEqual(new Set(['BadRequestException: Mã ưu đãi này đã được tài khoản khác nhận.']));
      expect(await prisma.couponClaim.count({ where: { couponId: c.id } })).toBe(1);
    });

    it('mã chung 3 lượt, 8 khách nhận song song → đúng 3 dòng nhận', async () => {
      const c = await coupon({ usageLimit: 3 });
      const users = await Promise.all(Array.from({ length: 8 }, () => realUser()));
      const s = summarize(await Promise.allSettled(users.map((u) => claims.claim(u.id, c.code))));
      expect(s.fulfilled).toHaveLength(3);
      expect(await prisma.couponClaim.count({ where: { couponId: c.id } })).toBe(3);
    });

    it('mã không giới hạn tổng lượt: một khách nhận 10 lần song song → 1 dòng (ON CONFLICT DO NOTHING)', async () => {
      const u = await realUser();
      const c = await coupon({ usageLimit: null, perUserLimit: 1 });
      const s = summarize(await Promise.allSettled(Array.from({ length: 10 }, () => claims.claim(u.id, c.code))));
      expect(s.errors).toEqual([]);
      expect(await prisma.couponClaim.count({ where: { couponId: c.id } })).toBe(1);
    });

    it('khách vãng lai không nhận được; khách đã có đơn không giữ chỗ thẻ chỉ-khách-mới', async () => {
      const c = await coupon();
      await expect(claims.claim((await guestUser()).id, c.code)).rejects.toThrow(REAL_USER_REQUIRED_MSG);
      const old = await realUser();
      await createOrder(prisma, { userId: old.id, status: 'DELIVERED' });
      await expect(claims.claim(old.id, c.code)).rejects.toThrow(NEW_CUSTOMER_ONLY_MSG);
      expect(await prisma.couponClaim.count({ where: { couponId: c.id } })).toBe(0);
    });

    it('mã CLAIM chỉ vào ví người đã nhận; khách đã có đơn (khác đơn huỷ) không thấy mã chỉ-khách-mới', async () => {
      const u = await realUser();
      const other = await realUser();
      const c = await coupon({ usageLimit: null });
      const codes = async (userId: string) => (await loyalty.getAvailableCoupons(userId)).map((x) => x.code);
      expect(await codes(u.id)).not.toContain(c.code);
      await claims.claim(u.id, c.code);
      expect(await codes(u.id)).toContain(c.code);
      expect(await codes(other.id)).not.toContain(c.code);
      await createOrder(prisma, { userId: u.id, status: 'CANCELLED' });
      expect(await codes(u.id)).toContain(c.code);
      await createOrder(prisma, { userId: u.id, status: 'CONFIRMED' });
      expect(await codes(u.id)).not.toContain(c.code);
    });

    it('khách gõ mã thẻ ở giỏ thay vì quét QR → nhận luôn và áp được; đặt đơn ghi 1 lượt dùng', async () => {
      const u = await realUser();
      const c = await coupon();
      const p = await product(100_000);
      const addr = await address(u.id);
      await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });
      await cart.applyCoupon(u.id, c.code.toLowerCase());
      expect(await prisma.couponClaim.count({ where: { couponId: c.id, userId: u.id } })).toBe(1);
      const order = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(saved.couponCode).toBe(c.code);
      expect(saved.discount).toBe(30_000);
      expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(1);
    });

    it('mã CLAIM chưa nhận không áp được qua validateAndCompute (không lách bằng gọi thẳng)', async () => {
      const u = await realUser();
      const c = await coupon();
      await expect(coupons.validateAndCompute(c.code, u.id, 100_000)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('mã chỉ khách mới (newCustomerOnly)', () => {
    it('hai lần đặt song song cùng mã chỉ-khách-mới (không giới hạn lượt/khách) → đúng 1 đơn, đơn kia bị từ chối', async () => {
      const u = await realUser();
      const c = await coupon({ usageLimit: null, perUserLimit: 0 });
      await claims.claim(u.id, c.code);
      const { addr, lineIds } = await twoLineCart(u.id);
      await prisma.cart.update({ where: { userId: u.id }, data: { couponCode: c.code } });

      const s = summarize(await placeInParallel(u.id, addr.id, lineIds));
      console.log('[newCustomerOnly] fulfilled=%d errors=%j', s.fulfilled.length, s.errors);
      expect(s.fulfilled).toHaveLength(1);
      expect(s.errors).toEqual([`BadRequestException: ${NEW_CUSTOMER_ONLY_MSG}`]);
      expect(await prisma.order.count({ where: { userId: u.id } })).toBe(1);
      expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(1);
    });

    it('đơn huỷ không tính: khách có đơn huỷ vẫn dùng được; đơn chờ thanh toán thì tính', async () => {
      const c = await coupon({ usageLimit: null, scope: 'PUBLIC' });
      const cancelled = await realUser();
      await createOrder(prisma, { userId: cancelled.id, status: 'CANCELLED' });
      await expect(coupons.validateAndCompute(c.code, cancelled.id, 100_000)).resolves.toMatchObject({ discount: 30_000 });
      const pending = await realUser();
      await createOrder(prisma, { userId: pending.id, status: 'PENDING_PAYMENT' });
      await expect(coupons.validateAndCompute(c.code, pending.id, 100_000)).rejects.toThrow(NEW_CUSTOMER_ONLY_MSG);
    });
  });

  describe('freeship đơn đầu (D2-08)', () => {
    afterEach(async () => {
      await config.set('shipping.first_order_free_enabled', false, 'it-claim');
      await config.set('shipping.first_order_free_min_subtotal', 0, 'it-claim');
    });

    it('mặc định tắt: đơn đầu 100k vẫn phí giao 19k như cũ', async () => {
      const u = await realUser();
      const p = await product(100_000);
      const addr = await address(u.id);
      await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });
      const q = (await checkout.quote(u.id, { addressId: addr.id } as never)) as { shippingFee: number; firstOrderShipWaived: number };
      expect(q).toMatchObject({ shippingFee: 19_000, firstOrderShipWaived: 0 });
      const order = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).shippingFee).toBe(19_000);
    });

    it('bật: đơn đầu miễn phí giao, đơn thứ hai tính phí như thường; khách vãng lai không được', async () => {
      await config.set('shipping.first_order_free_enabled', true, 'it-claim');
      const u = await realUser();
      const addr = await address(u.id);
      const p = await product(100_000);
      await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });
      expect((await cart.getCart(u.id)).freeshipThreshold).toBe(0);
      const first = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
      expect((await prisma.order.findUniqueOrThrow({ where: { id: first.id } })).shippingFee).toBe(0);
      await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });
      const second = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
      expect((await prisma.order.findUniqueOrThrow({ where: { id: second.id } })).shippingFee).toBe(19_000);

      const g = await guestUser();
      const gAddr = await address(g.id);
      await cart.addItem(g.id, { variationId: p.variationId, quantity: 1 });
      const gq = (await checkout.quote(g.id, { addressId: gAddr.id } as never)) as { shippingFee: number };
      expect(gq.shippingFee).toBe(19_000);
    });

    it('bật với ngưỡng 150k: đơn đầu 100k chưa đạt ngưỡng → tính phí như thường', async () => {
      await config.set('shipping.first_order_free_enabled', true, 'it-claim');
      await config.set('shipping.first_order_free_min_subtotal', 150_000, 'it-claim');
      const u = await realUser();
      const addr = await address(u.id);
      const p = await product(100_000);
      await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });
      const q = (await checkout.quote(u.id, { addressId: addr.id } as never)) as { shippingFee: number };
      expect(q.shippingFee).toBe(19_000);
    });

    it('bật: hai lần đặt song song cùng tính là đơn đầu → đúng 1 đơn miễn phí giao, lần kia bị từ chối để khách tải lại', async () => {
      await config.set('shipping.first_order_free_enabled', true, 'it-claim');
      const u = await realUser();
      const { addr, lineIds } = await twoLineCart(u.id);
      const s = summarize(await placeInParallel(u.id, addr.id, lineIds));
      console.log('[firstOrderFreeship] fulfilled=%d errors=%j', s.fulfilled.length, s.errors);
      expect(s.fulfilled).toHaveLength(1);
      expect(s.errors).toEqual([`BadRequestException: ${FIRST_ORDER_FREESHIP_TAKEN_MSG}`]);
      const orders = await prisma.order.findMany({ where: { userId: u.id }, select: { shippingFee: true } });
      expect(orders).toEqual([{ shippingFee: 0 }]);
    });

    it('bật + mã freeship: đơn đầu đã miễn phí giao nên mã không được tiêu', async () => {
      await config.set('shipping.first_order_free_enabled', true, 'it-claim');
      const u = await realUser();
      const c = await coupon({ type: 'FREESHIP', value: 0, minOrder: null, scope: 'PUBLIC', newCustomerOnly: false, usageLimit: null });
      const addr = await address(u.id);
      const p = await product(100_000);
      await cart.addItem(u.id, { variationId: p.variationId, quantity: 1 });
      await prisma.cart.update({ where: { userId: u.id }, data: { couponCode: c.code } });
      const order = (await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD' } as never)) as { id: string };
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(saved.shippingFee).toBe(0);
      expect(saved.couponCode).toBeNull();
      expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);
    });
  });

  it('gộp tài khoản khách vào tài khoản Zalo: lượt nhận mã đi theo, trùng mã thì giữ dòng của tài khoản đích', async () => {
    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-claim', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const targetZalo = `zalo_${randCode(10)}`;
    const zalo = {
      getUserInfo: async () => ({ zaloId: targetZalo, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    const auth = new AuthService(prisma, new JwtService(), { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>, zalo, rbac);

    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khách' });
    const target = await createUser(prisma, { zaloId: targetZalo });
    const both = await coupon({ usageLimit: null });
    const onlyGuest = await coupon({ usageLimit: null });
    await prisma.couponClaim.createMany({
      data: [
        { couponId: both.id, userId: guest.id },
        { couponId: onlyGuest.id, userId: guest.id },
        { couponId: both.id, userId: target.id },
      ],
    });
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    const mine = await prisma.couponClaim.findMany({ where: { userId: target.id }, select: { couponId: true } });
    expect(mine.map((r) => r.couponId).sort()).toEqual([both.id, onlyGuest.id].sort());
  });

  it('tạo lô mã thẻ hộp hàng trên DB thật: N mã CLAIM duy nhất, xuất lại kèm link, thống kê lô, tắt cả lô', async () => {
    await config.set('app.miniapp_base_url', 'https://zalo.me/s/123456/', 'it-claim');
    const prefix = `IT${randCode(6)}`;
    const now = Date.now();
    const input = {
      prefix,
      quantity: 25,
      type: 'AMOUNT' as const,
      value: 30_000,
      minOrder: 99_000,
      startAt: new Date(now - 60_000).toISOString(),
      endAt: new Date(now + 30 * 86_400_000).toISOString(),
      newCustomerOnly: true,
    };
    const made = await batches.create(input);
    expect(made.created).toBe(25);
    expect(new Set(made.codes.map((c) => c.code)).size).toBe(25);
    expect(made.codes[0]!.url).toBe(`https://zalo.me/s/123456/?claim=${made.codes[0]!.code}`);
    await expect(batches.create(input)).rejects.toThrow(`Tiền tố ${prefix} đã dùng`);

    const u = await realUser();
    await claims.claim(u.id, made.codes[0]!.code);
    const listed = (await batches.list()).find((b) => b.batch === prefix);
    expect(listed).toMatchObject({ total: 25, claimed: 1, used: 0, active: 25, type: 'AMOUNT', value: 30_000, minOrder: 99_000, newCustomerOnly: true });
    const exported = await batches.codes(prefix.toLowerCase());
    expect(exported.codes.filter((c) => c.claimed)).toHaveLength(1);

    await expect(batches.setActive(prefix, false)).resolves.toEqual({ batch: prefix, updated: 25 });
    await expect(claims.claim((await realUser()).id, made.codes[1]!.code)).rejects.toThrow('Mã ưu đãi đã ngừng áp dụng.');
    await config.set('app.miniapp_base_url', '', 'it-claim');
  });
});
