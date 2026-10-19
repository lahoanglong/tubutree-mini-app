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
import { REFERRAL_ORDER2_PREFIX } from '../../src/modules/wallet/referral-reward';
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

const REFERRAL_REWARD = 5;

/**
 * Chỉ CTV/đại lý hưởng hoa hồng (`affiliate.commission_eligible_roles`, mặc định AFFILIATE + DEALER). Checkout thật trên Postgres:
 * - đơn ghi công cho khách thường (chạm ghi từ trước) không sinh dòng hoa hồng;
 * - mã của khách thường (link chia sẻ sản phẩm, mua chung) không ghi chạm và không được chọn làm người giới thiệu của đơn, nên
 *   không cướp ghi công của CTV;
 * - thưởng "giới thiệu bạn bè" bằng điểm vẫn chạy vì đi theo `User.referredById` (gán lúc tạo tài khoản), không theo đơn.
 */
describe('Chỉ CTV/đại lý hưởng hoa hồng (real Postgres, checkout thật)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let affiliate: AffiliateService;
  let orderStatus: OrderStatusService;

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
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifyMany: jest.fn().mockResolvedValue(undefined) } },
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
    orderStatus = moduleRef.get(OrderStatusService);
    await prisma.systemConfig.deleteMany({ where: { key: COMMISSION_ELIGIBLE_ROLES_KEY } });
    // Spec khác đổi các khoá này trên cùng DB: đặt đúng mức mặc định để ca "giới thiệu bạn bè" đọc ra 5 điểm.
    await setConfig(prisma, 'referral.referrer_reward_points', REFERRAL_REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.min_order_amount', 200_000);
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

  const commissionsOf = (orderId: string) =>
    prisma.commission.findMany({ where: { orderId }, select: { affiliateUserId: true, amount: true } });

  /** Chạm giới thiệu có sẵn trong DB (vd ghi trước khi chặn mã khách thường) — đường fallback của checkout. */
  const legacyTouch = (userId: string, referrerUserId: string) =>
    prisma.referralTouch.create({ data: { userId, referrerUserId, kind: 'ctv', expiresAt: new Date(Date.now() + 86_400_000) } });

  it('chạm còn hạn của khách thường (ghi trước bản sửa) → đơn không ghi công ai, không có hoa hồng; CTV và đại lý (CTV lên đại lý) → có hoa hồng', async () => {
    const v = await tubuVariation();
    const friend = await createUser(prisma, { role: 'CUSTOMER' });
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const dealer = await createUser(prisma, { role: 'AFFILIATE' });
    await prisma.user.update({ where: { id: dealer.id }, data: { role: 'DEALER' } });

    const b1 = await buyer();
    await legacyTouch(b1.u.id, friend.id);
    const o1 = await place(b1, v.id);
    expect(o1.referrerUserId).toBeNull();
    expect(await commissionsOf(o1.id)).toEqual([]);

    const b2 = await buyer();
    await legacyTouch(b2.u.id, ctv.id);
    const o2 = await place(b2, v.id);
    expect(o2.referrerUserId).toBe(ctv.id);
    expect(await commissionsOf(o2.id)).toEqual([{ affiliateUserId: ctv.id, amount: 20_000 }]);

    const b3 = await buyer();
    await legacyTouch(b3.u.id, dealer.id);
    const o3 = await place(b3, v.id);
    expect(await commissionsOf(o3.id)).toEqual([{ affiliateUserId: dealer.id, amount: 20_000 }]);
  });

  it('giới thiệu bạn bè bằng điểm không đổi: bạn (khách thường) mời khách, khách có 2 đơn giao xong → bạn nhận điểm, không có hoa hồng', async () => {
    const v = await tubuVariation();
    const friend = await createUser(prisma, { role: 'CUSTOMER' });
    const invited = await buyer({ referredById: friend.id });
    const orders = [];
    for (let i = 0; i < 2; i++) {
      const o = await place(invited, v.id, { referralCode: friend.referralCode! });
      await prisma.order.update({ where: { id: o.id }, data: { status: 'SHIPPING' } });
      await orderStatus.setStatus(o.id, 'DELIVERED');
      orders.push(o);
    }
    expect(await prisma.commission.count({ where: { affiliateUserId: friend.id } })).toBe(0);
    const rewards = await prisma.pointsTransaction.findMany({
      where: { userId: friend.id, reason: `${REFERRAL_ORDER2_PREFIX}${invited.u.id}` },
      select: { delta: true },
    });
    expect(rewards).toEqual([{ delta: REFERRAL_REWARD }]);
  });

  // storefront.require_approval mặc định bật: gian hàng CTV đang bán trong các ca này là gian hàng đã duyệt.
  async function ctvWithStore() {
    const user = await createUser(prisma, { role: 'AFFILIATE' });
    const store = await prisma.storefront.create({
      data: { type: 'CTV', slug: user.referralCode!.toLowerCase(), ownerUserId: user.id, title: 'Shop CTV IT', isPublished: true, approvedAt: new Date() },
    });
    return { user, store };
  }

  it('link chia sẻ của khách thường không cướp ghi công: chạm CTV còn hạn → mở ?ref=bạn → mua kèm mã bạn → đơn và hoa hồng vẫn của CTV', async () => {
    const v = await tubuVariation();
    const { user: ctv, store } = await ctvWithStore();
    const friend = await createUser(prisma, { role: 'CUSTOMER' });
    const c = await buyer();

    // Khách vào từ gian hàng CTV (trong Zalo: mã = slug viết thường).
    expect(await affiliate.recordTouch(c.u.id, { referralCode: store.slug, storefrontSlug: store.slug, kind: 'ctv' })).toEqual({ ok: true });
    // Bạn (khách thường) gửi link sản phẩm ?ref=<mã bạn>: không ghi chạm, không đè chạm CTV.
    expect(await affiliate.recordTouch(c.u.id, { referralCode: friend.referralCode!, kind: 'ctv' })).toEqual({ ok: false });
    expect((await prisma.referralTouch.findUniqueOrThrow({ where: { userId: c.u.id } })).referrerUserId).toBe(ctv.id);

    // Khách mua với mã của bạn còn trong phiên: mã bị bỏ qua, rơi về chạm CTV.
    const o = await place(c, v.id, { referralCode: friend.referralCode! });
    expect(o.referrerUserId).toBe(ctv.id);
    expect(await commissionsOf(o.id)).toEqual([{ affiliateUserId: ctv.id, amount: 20_000 }]);
  });

  it('đang mua trong gian hàng CTV kèm mã khách thường → chủ gian hàng được ghi công; chỉ có mã khách thường → không ai được ghi công', async () => {
    const v = await tubuVariation();
    const { user: ctv, store } = await ctvWithStore();
    const friend = await createUser(prisma, { role: 'CUSTOMER' });

    const inStore = await buyer();
    const o1 = await place(inStore, v.id, { referralCode: friend.referralCode!, storefrontSlug: store.slug });
    expect(o1.referrerUserId).toBe(ctv.id);
    expect(await commissionsOf(o1.id)).toEqual([{ affiliateUserId: ctv.id, amount: 20_000 }]);

    const plain = await buyer();
    const o2 = await place(plain, v.id, { referralCode: friend.referralCode! });
    expect(o2.referrerUserId).toBeNull();
    expect(await commissionsOf(o2.id)).toEqual([]);

    // Mã CTV/đại lý gửi kèm đơn vẫn thắng chạm cũ của CTV khác như trước.
    const other = await ctvWithStore();
    const switched = await buyer();
    await affiliate.recordTouch(switched.u.id, { referralCode: other.store.slug, storefrontSlug: other.store.slug, kind: 'ctv' });
    const o3 = await place(switched, v.id, { referralCode: ctv.referralCode! });
    expect(o3.referrerUserId).toBe(ctv.id);
  });

  it('mua trong gian hàng CTV do ADMIN tạo mà còn chạm của CTV B → B được ghi công và hưởng hoa hồng (chủ gian hàng không đủ vai trò thì xét bậc kế)', async () => {
    const v = await tubuVariation();
    const adminOwner = await createUser(prisma, { role: 'ADMIN' });
    const adminStore = await prisma.storefront.create({
      data: { type: 'CTV', slug: adminOwner.referralCode!.toLowerCase(), ownerUserId: adminOwner.id, title: 'Shop admin IT', isPublished: true, approvedAt: new Date() },
    });
    const ctvB = await createUser(prisma, { role: 'AFFILIATE' });
    const c = await buyer();
    await legacyTouch(c.u.id, ctvB.id);
    const o = await place(c, v.id, { storefrontSlug: adminStore.slug });
    expect(o).toMatchObject({ referrerUserId: ctvB.id, storefrontId: adminStore.id });
    expect(await commissionsOf(o.id)).toEqual([{ affiliateUserId: ctvB.id, amount: 20_000 }]);

    // Không có chạm nào: gian hàng của ADMIN không ghi công cho ADMIN.
    const d = await buyer();
    const o2 = await place(d, v.id, { storefrontSlug: adminStore.slug });
    expect(o2.referrerUserId).toBeNull();
  });

  it('admin thêm CUSTOMER vào khoá → khách thường được hưởng (chủ dự án quyết); giá trị sai bị từ chối lúc ghi', async () => {
    const v = await tubuVariation();
    const friend = await createUser(prisma, { role: 'CUSTOMER' });
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const config = moduleRef.get(SystemConfigService);
    await expect(config.set(COMMISSION_ELIGIBLE_ROLES_KEY, ['CTV'], adminUser.id)).rejects.toThrow('không hợp lệ');
    await config.set(COMMISSION_ELIGIBLE_ROLES_KEY, ['AFFILIATE', 'DEALER', 'CUSTOMER'], adminUser.id);
    try {
      const b = await buyer();
      await legacyTouch(b.u.id, friend.id);
      const o = await place(b, v.id);
      expect(await commissionsOf(o.id)).toEqual([{ affiliateUserId: friend.id, amount: 20_000 }]);
    } finally {
      await config.set(COMMISSION_ELIGIBLE_ROLES_KEY, ['AFFILIATE', 'DEALER'], adminUser.id);
    }
    expect([...(await affiliate.commissionEligibleRoles())]).toEqual(['AFFILIATE', 'DEALER']);
  });
});
