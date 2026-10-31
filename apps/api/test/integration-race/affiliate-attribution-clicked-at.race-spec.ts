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
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { COMMISSION_ELIGIBLE_ROLES_KEY } from '../../src/modules/affiliate/commission-eligibility';
import { createUser, randCode, setConfig, warmPool } from './helpers';


/**
 * Hạn ghi công tính từ lúc khách bấm link (clickedAt), trên Postgres thật: chạm bù không kéo dài hạn, không làm ngắn
 * lượt bấm mới hơn, và hai chạm đồng thời với clickedAt khác nhau cho ra đúng một CTV được hưởng hoa hồng.
 */
describe('Ghi công CTV theo lúc bấm link (real Postgres, checkout thật)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let affiliate: AffiliateService;

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
        MerchantService,
        StorefrontService,
        {
          provide: CouponsService,
          useValue: { validateAndCompute: jest.fn(), redeem: jest.fn().mockResolvedValue(undefined), release: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true), notifyMany: jest.fn().mockResolvedValue(undefined) } },
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
    affiliate = moduleRef.get(AffiliateService);
    await prisma.systemConfig.deleteMany({ where: { key: COMMISSION_ELIGIBLE_ROLES_KEY } });
    await setConfig(prisma, 'affiliate.attribution_days', 7);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function buyer(data: { referredById?: string } = {}) {
    const u = await createUser(prisma, data);
    const addr = await prisma.address.create({
      data: {
        userId: u.id, recipient: 'Khach IT', phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`, province: 'Ha Noi', district: '',
        ward: 'Phuong IT', street: '1 Duong IT', provinceCode: '84_VN01', districtCode: '', wardCode: '00001',
      },
    });
    return { u, addr };
  }

  async function tubuVariation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `itel-p-${tag}`, fulfilment: 'TUBU', brand: 'IT', slug: `itel-${tag.toLowerCase()}`, name: `SP Tubu ${tag}`, description: 'IT',
        basePrice: 200_000,
      },
    });
    return prisma.variation.create({
      data: { pancakeId: `itel-v-${tag}`, productId: product.id, sku: `ITEL-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 200_000, stock: 50, affiliateRate: 10 },
    });
  }

  /** Khách đặt 1 sản phẩm 200.000đ (hoa hồng 10% = 20.000đ nếu được hưởng) qua checkout thật. */
  async function place(b: Awaited<ReturnType<typeof buyer>>, variationId: string, extra: { referralCode?: string; storefrontSlug?: string } = {}) {
    await cart.addItem(b.u.id, { variationId, quantity: 1 });
    await checkout.placeOrder(b.u.id, { addressId: b.addr.id, paymentMethod: 'COD', ...extra } as never, `itel-${randCode(12)}`);
    return prisma.order.findFirstOrThrow({ where: { userId: b.u.id }, orderBy: { createdAt: 'desc' } });
  }


  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const commissionsOf = (orderId: string) =>
    prisma.commission.findMany({ where: { orderId }, select: { affiliateUserId: true, amount: true } });
  const touchOf = (userId: string) => prisma.referralTouch.findUniqueOrThrow({ where: { userId } });

  it('chạm bù cũ hơn lượt bấm lại: hạn giữ theo lượt bấm mới (15:00), không bị kéo về 10:00', async () => {
    const { user: a } = await ctvWithCode();
    const b = await buyer();
    await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, kind: 'ctv', clickedAgoMs: 5 * HOUR });
    const fresh = await touchOf(b.u.id);
    await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, kind: 'ctv', clickedAgoMs: 10 * HOUR });
    expect((await touchOf(b.u.id)).expiresAt.getTime()).toBe(fresh.expiresAt.getTime());
    await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, kind: 'ctv' });
    expect((await touchOf(b.u.id)).expiresAt.getTime()).toBeGreaterThan(fresh.expiresAt.getTime());
  });

  it('clickedAt xa hơn hạn (8 ngày) không ghi công; clickedAgoMs âm không kéo dài hơn now + 7 ngày', async () => {
    const { user: a } = await ctvWithCode();
    const b = await buyer();
    expect(await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, clickedAgoMs: 8 * DAY })).toEqual({ ok: false });
    expect(await prisma.referralTouch.count({ where: { userId: b.u.id } })).toBe(0);
    await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, clickedAgoMs: -3 * DAY });
    expect((await touchOf(b.u.id)).expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY);
  });

  it('hai chạm cùng lúc, hai CTV, clickedAt khác nhau: CTV bấm sau thắng, đơn và hoa hồng của CTV đó, lặp nhiều vòng', async () => {
    const v = await tubuVariation();
    for (let round = 0; round < 6; round++) {
      const { user: older } = await ctvWithCode();
      const { user: newer } = await ctvWithCode();
      const b = await buyer();
      const tasks = [
        () => affiliate.recordTouch(b.u.id, { referralCode: older.referralCode!, kind: 'ctv', clickedAgoMs: 30 * HOUR }),
        () => affiliate.recordTouch(b.u.id, { referralCode: newer.referralCode!, kind: 'ctv', clickedAgoMs: 2 * HOUR }),
      ];
      if (round % 2) tasks.reverse();
      await Promise.all(tasks.map((t) => t()));
      const t = await touchOf(b.u.id);
      expect(t.referrerUserId).toBe(newer.id);
      expect(t.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() - 2 * HOUR + 7 * DAY + 1000);
      const o = await place(b, v.id);
      expect(o.referrerUserId).toBe(newer.id);
      expect(await commissionsOf(o.id)).toEqual([{ affiliateUserId: newer.id, amount: 20_000 }]);
    }
  });

  it('chạm bù quá hạn sau khi đã có chạm hết hạn: không ghi công mới, đơn không có hoa hồng', async () => {
    const v = await tubuVariation();
    const { user: a } = await ctvWithCode();
    const b = await buyer();
    await prisma.referralTouch.create({ data: { userId: b.u.id, referrerUserId: a.id, kind: 'ctv', expiresAt: new Date(Date.now() - HOUR) } });
    expect(await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, clickedAgoMs: 9 * DAY })).toEqual({ ok: false });
    const o = await place(b, v.id);
    expect(o.referrerUserId).toBeNull();
    expect(await commissionsOf(o.id)).toEqual([]);
  });

  it('chạm bù mang clickedAt hợp lệ thay chạm đã hết hạn: hạn tính từ lúc bấm, đơn ghi công cho CTV', async () => {
    const v = await tubuVariation();
    const { user: a } = await ctvWithCode();
    const b = await buyer();
    await prisma.referralTouch.create({ data: { userId: b.u.id, referrerUserId: a.id, kind: 'ctv', expiresAt: new Date(Date.now() - HOUR) } });
    expect(await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, clickedAgoMs: DAY })).toEqual({ ok: true });
    expect((await touchOf(b.u.id)).expiresAt.getTime()).toBeLessThanOrEqual(Date.now() - DAY + 7 * DAY + 1000);
    const o = await place(b, v.id);
    expect(await commissionsOf(o.id)).toEqual([{ affiliateUserId: a.id, amount: 20_000 }]);
  });

  it('admin hạ affiliate.attribution_days (7 → 2) sau khi đã có chạm: chạm bù cũ hơn vẫn không đè lượt bấm mới hơn', async () => {
    const { user: older } = await ctvWithCode();
    const { user: newer } = await ctvWithCode();
    const b = await buyer();
    await affiliate.recordTouch(b.u.id, { referralCode: newer.referralCode!, clickedAgoMs: HOUR });
    await setConfig(prisma, 'affiliate.attribution_days', 2);
    try {
      await affiliate.recordTouch(b.u.id, { referralCode: older.referralCode!, clickedAgoMs: 20 * HOUR });
      expect((await touchOf(b.u.id)).referrerUserId).toBe(newer.id);
      expect((await touchOf(b.u.id)).clickedAt).not.toBeNull();
    } finally {
      await setConfig(prisma, 'affiliate.attribution_days', 7);
    }
  });

  it('dòng cũ chưa có clickedAt: so theo hạn - số ngày hiện tại (chạm cũ hơn không đè, chạm mới hơn thay)', async () => {
    const { user: a } = await ctvWithCode();
    const { user: c } = await ctvWithCode();
    const b = await buyer();
    await prisma.referralTouch.create({ data: { userId: b.u.id, referrerUserId: a.id, kind: 'ctv', expiresAt: new Date(Date.now() - 5 * HOUR + 7 * DAY) } });
    await affiliate.recordTouch(b.u.id, { referralCode: c.referralCode!, clickedAgoMs: 10 * HOUR });
    expect((await touchOf(b.u.id)).referrerUserId).toBe(a.id);
    await affiliate.recordTouch(b.u.id, { referralCode: c.referralCode!, clickedAgoMs: HOUR });
    const t = await touchOf(b.u.id);
    expect(t.referrerUserId).toBe(c.id);
    expect(t.clickedAt).not.toBeNull();
  });

  it('cùng người giới thiệu, chạm sau có slug gian hàng: bổ sung slug vào dòng chưa có slug', async () => {
    const { user: a, store } = await ctvWithStore();
    const b = await buyer();
    await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, kind: 'ctv', clickedAgoMs: 1000 });
    expect((await touchOf(b.u.id)).storefrontSlug).toBeNull();
    await affiliate.recordTouch(b.u.id, { referralCode: a.referralCode!, storefrontSlug: store.slug, kind: 'ctv', clickedAgoMs: 1000 });
    expect((await touchOf(b.u.id)).storefrontSlug).toBe(store.slug);
  });

  async function ctvWithStore() {
    const user = await createUser(prisma, { role: 'AFFILIATE' });
    const store = await prisma.storefront.create({
      data: { type: 'CTV', slug: user.referralCode!.toLowerCase(), ownerUserId: user.id, title: 'Shop CTV IT', isPublished: true, approvedAt: new Date() },
    });
    return { user, store };
  }

  async function ctvWithCode() {
    const user = await createUser(prisma, { role: 'AFFILIATE' });
    return { user };
  }
});
