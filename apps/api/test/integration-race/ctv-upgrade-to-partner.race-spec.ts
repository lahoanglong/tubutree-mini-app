import { randomInt } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
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
import { AdminService } from '../../src/modules/admin/admin.service';
import { createUser, randCode, setConfig, warmPool } from './helpers';

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

/**
 * CTV đã mở gian hàng (Storefront.type = CTV, mỗi người một gian hàng) rồi được duyệt làm đại lý/đối tác: gian hàng GIỮ loại
 * CTV để hoa hồng giới thiệu không đổi, vẫn dùng đủ Cổng người bán cho sản phẩm riêng. Đơn nào của gian hàng (giới thiệu hay
 * hàng của đối tác) nằm đúng màn của nó, không lẫn sang nhau.
 */
describe('CTV được duyệt làm đối tác giữ gian hàng CTV (real Postgres, checkout thật)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let merchant: MerchantService;
  let fulfilment: MerchantFulfilmentService;
  let storefrontSvc: StorefrontService;
  let admin: AdminService;

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
    merchant = moduleRef.get(MerchantService);
    fulfilment = moduleRef.get(MerchantFulfilmentService);
    storefrontSvc = moduleRef.get(StorefrontService);
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, { notify: jest.fn().mockResolvedValue(undefined) } as never, none, none, none, none, none);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function ctvWithStore() {
    const tag = randCode(8).toLowerCase();
    const user = await createUser(prisma, { role: 'AFFILIATE' });
    const store = await prisma.storefront.create({
      data: {
        type: 'CTV', slug: user.referralCode!.toLowerCase(), subdomain: `itup-${tag}`, ownerUserId: user.id, title: 'Shop CTV', isPublished: true,
        collections: { create: { title: 'Sản phẩm nổi bật', sortOrder: 0 } },
      },
    });
    return { user, store, tag };
  }

  async function approveAsDealer(userId: string, tag: string) {
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${tag}`, name: `Bậc ${tag}`, minOrderVolume: 0, discountRules: {} } });
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const app = await prisma.dealerApplication.create({
      data: { userId, businessName: 'DN IT', ownerName: 'IT', phone: '0900000000', address: 'HN', cccdFrontUrl: 'a', cccdBackUrl: 'b' },
    });
    await admin.reviewDealerApplication(adminUser.id, app.id, true, tier.id);
  }

  async function buyer() {
    const u = await createUser(prisma);
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
        pancakeId: `itup-p-${tag}`, fulfilment: 'TUBU', brand: 'IT', slug: `itup-${tag.toLowerCase()}`, name: `SP Tubu ${tag}`, description: 'IT',
        basePrice: 200_000,
      },
    });
    return prisma.variation.create({
      data: { pancakeId: `itup-v-${tag}`, productId: product.id, sku: `ITUP-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 200_000, stock: 20, affiliateRate: 0.1 },
    });
  }

  async function place(userId: string, addressId: string, storefrontSlug?: string) {
    await checkout.placeOrder(userId, { addressId, paymentMethod: 'COD', ...(storefrontSlug ? { storefrontSlug } : {}) } as never, `itup-${randCode(12)}`);
    return prisma.order.findMany({ where: { userId }, include: { items: true } });
  }

  const checkOwnProducts = (m: MerchantService, userId: string) => m.checkPancakeVariation(userId, `khong-co-${randCode(6)}`);

  it('duyệt làm đối tác giữ nguyên loại CTV, slug, bộ sưu tập, mã giới thiệu ở trang công khai; đăng được sản phẩm', async () => {
    const { user, store, tag } = await ctvWithStore();
    await approveAsDealer(user.id, tag);

    const after = await prisma.storefront.findUniqueOrThrow({ where: { id: store.id }, include: { collections: true } });
    expect(after.type).toBe('CTV');
    expect(after.slug).toBe(store.slug);
    expect(after.collections).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('DEALER');

    const publicPage = await storefrontSvc.getPublicBySlug(store.slug);
    expect(publicPage.referralCode).toBe(user.referralCode);

    await expect(checkOwnProducts(merchant, user.id)).rejects.toBeInstanceOf(NotFoundException);
    const product = await merchant.createProduct(user.id, { name: `Cây IT ${tag}`, description: 'IT', basePrice: 100_000, stock: 10 });
    expect(product.storefrontId).toBe(store.id);
    const mine = await merchant.listMyProducts(user.id);
    expect(mine.ownProducts.map((p) => p.id)).toContain(product.id);
    expect((await prisma.storefront.findUniqueOrThrow({ where: { id: store.id } })).type).toBe('CTV');
  });

  it('đơn mua hàng của đối tác hiện ở /merchant và giao/đối soát được; đơn giới thiệu qua gian hàng vẫn ghi hoa hồng cho chủ và KHÔNG lẫn vào /merchant', async () => {
    const { user, store, tag } = await ctvWithStore();
    await approveAsDealer(user.id, tag);
    const own = await merchant.createProduct(user.id, { name: `Cây IT ${tag}`, description: 'IT', basePrice: 100_000, stock: 10 });
    await prisma.product.update({ where: { id: own.id }, data: { approvalStatus: 'APPROVED' } });
    const ownVar = own.variations[0]!;
    const tubuVar = await tubuVariation();

    const b1 = await buyer();
    await cart.addItem(b1.u.id, { variationId: ownVar.id, quantity: 1 });
    const [merchantOrder] = await place(b1.u.id, b1.addr.id);
    expect(merchantOrder).toMatchObject({ fulfiller: 'MERCHANT', fulfillerStorefrontId: store.id, referrerUserId: null });

    const b2 = await buyer();
    await cart.addItem(b2.u.id, { variationId: tubuVar.id, quantity: 1 });
    const [referredOrder] = await place(b2.u.id, b2.addr.id, store.slug);
    expect(referredOrder).toMatchObject({ referrerUserId: user.id, storefrontId: store.id, fulfiller: 'TUBU' });
    const commissions = await prisma.commission.findMany({ where: { orderId: referredOrder!.id } });
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({ affiliateUserId: user.id });
    expect(commissions[0]!.amount).toBeGreaterThan(0);

    const list = await merchant.listMerchantOrders(user.id);
    expect(list.data.map((o) => o.id)).toEqual([merchantOrder!.id]);

    const toShip = await fulfilment.listOrders(user.id, undefined);
    expect(toShip.data.map((o) => o.id)).toEqual([merchantOrder!.id]);
    await fulfilment.accept(user.id, merchantOrder!.id);
    await fulfilment.pack(user.id, merchantOrder!.id);
    await fulfilment.ship(user.id, merchantOrder!.id, { carrier: 'GHN', trackingCode: `IT${randCode(6)}` });
    await fulfilment.deliver(user.id, merchantOrder!.id);
    await prisma.order.update({ where: { id: merchantOrder!.id }, data: { deliveredAt: ago(10) } });
    const st = await fulfilment.myStatement(user.id);
    expect(st.lines.map((l) => l.kind)).toEqual(['SALE']);
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const payout = await fulfilment.createPayout(adminUser.id, store.id);
    expect(payout.lines).toHaveLength(1);

    expect((await prisma.storefront.findUniqueOrThrow({ where: { id: store.id } })).type).toBe('CTV');
  });

  it('CTV thường (chưa được duyệt) vẫn bị chặn đăng sản phẩm riêng và không có đơn cần giao', async () => {
    const { user } = await ctvWithStore();
    await expect(checkOwnProducts(merchant, user.id)).rejects.toMatchObject({ status: 403 });
    await expect(fulfilment.listOrders(user.id, undefined)).rejects.toMatchObject({ status: 403 });
  });

  it('đại lý có gian hàng CTV: không cuộc gọi cổng người bán nào đổi loại gian hàng', async () => {
    const { user, store } = await ctvWithStore();
    await prisma.user.update({ where: { id: user.id }, data: { role: 'DEALER' } });

    const got = await merchant.getOrCreateStore(user.id);
    await merchant.listMyProducts(user.id);
    await merchant.listMerchantOrders(user.id);
    await merchant.updateStore(user.id, { title: 'Shop mới IT', shippingFee: 20_000 });
    await merchant.setOrdersPaused(user.id, false);
    await checkOwnProducts(merchant, user.id).catch(() => undefined);

    expect(got.id).toBe(store.id);
    expect((await prisma.storefront.findUniqueOrThrow({ where: { id: store.id } })).type).toBe('CTV');
  });
});
