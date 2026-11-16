import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { ShippingEstimateService } from '../../src/modules/checkout/shipping-estimate.service';
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
import { createOrder, createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

/**
 * GET /checkout/shipping-estimate phải ra ĐÚNG phí giao mà báo giá checkout (CheckoutService.quote) tính cho cùng giỏ, cùng khách:
 * dưới/trên ngưỡng, ba tỉnh, khách có hoặc không có địa chỉ mặc định, cộng ưu đãi đơn đầu và ngưỡng riêng của hạng. Postgres thật,
 * PricingService và SystemConfigService là bản thật.
 */
describe('Ước tính phí giao = báo giá checkout (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let estimator: ShippingEstimateService;
  let cart: CartService;
  const restores: Array<() => Promise<void>> = [];
  const userIds: string[] = [];
  const productIds: string[] = [];
  const tierIds: string[] = [];

  const PROVINCES = [
    { code: '84_VN01', name: 'Hà Nội' },
    { code: '84_VN79', name: 'Hồ Chí Minh' },
    { code: '84_VN48', name: 'Đà Nẵng' },
  ];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        ShippingEstimateService,
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
    estimator = moduleRef.get(ShippingEstimateService);
    cart = moduleRef.get(CartService);
    for (const [k, v] of [
      ['shipping.free_threshold', 200_000],
      ['shipping.flat_fee_below_threshold', 19_000],
      ['shipping.tier_freeship_overrides', {}],
      ['shipping.first_order_free_enabled', true],
      ['shipping.first_order_free_min_subtotal', 150_000],
      ['storefront.require_approval', false],
    ] as const) {
      restores.push(await pinConfig(prisma, k, v as never));
    }
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await deleteItData(prisma, { userIds, productIds });
    if (tierIds.length > 0) await prisma.membershipTier.deleteMany({ where: { id: { in: tierIds } } });
    await moduleRef?.close();
  });

  async function product(price: number) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itse-p-${tag}`,
        brand: 'IT',
        slug: `itse-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
        variations: {
          create: { pancakeId: `itse-v-${tag}`, sku: `ITSE-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock: 50 },
        },
      },
      include: { variations: true },
    });
    productIds.push(p.id);
    return p.variations[0]!.id;
  }

  /** Khách thật (SĐT + Zalo). `returning` = đã có một đơn giao xong, nên không còn ưu đãi miễn phí giao đơn đầu. */
  async function buyer(opts: { province: (typeof PROVINCES)[number]; isDefault: boolean; returning: boolean; tierId?: string }) {
    const phone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    const u = await createUser(prisma, { phone, zaloId: `z-${randCode(10)}`, tierId: opts.tierId ?? null });
    userIds.push(u.id);
    if (opts.returning) await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 30 * 86_400_000) });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Khach IT',
        phone,
        province: opts.province.name,
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: opts.province.code,
        districtCode: '',
        wardCode: '00001',
        isDefault: opts.isDefault,
      },
    });
    return { userId: u.id, addressId: addr.id };
  }

  /** Báo giá thật cho giỏ một món, rồi ước tính với đúng tiền hàng kiện Tubu của báo giá; trả cả hai để ca kiểm số kỳ vọng. */
  async function compare(b: { userId: string; addressId: string }, price: number, provinceCode?: string) {
    const v = await product(price);
    await cart.addItem(b.userId, { variationId: v, quantity: 1 });
    const quote = await checkout.quote(b.userId, { addressId: b.addressId });
    const tubu = quote.shipments.find((s) => s.fulfiller.kind === 'TUBU')!;
    const est = await estimator.estimate(b.userId, { subtotal: tubu.subtotal, provinceCode });
    expect(est.fee).toBe(quote.shippingFee);
    expect(est.feeMin).toBe(est.fee);
    expect(est.feeMax).toBe(est.fee);
    expect(est.isEstimate).toBe(true);
    return { quote, est };
  }

  const combos = PROVINCES.flatMap((province) =>
    [true, false].flatMap((isDefault) => [120_000, 250_000].map((price) => ({ province, isDefault, price }))),
  );

  it.each(combos)('khách quen $province.code, địa chỉ mặc định=$isDefault, tiền hàng $price: ước tính = báo giá', async ({ province, isDefault, price }) => {
    const b = await buyer({ province, isDefault, returning: true });
    // Có địa chỉ mặc định thì gọi không kèm tỉnh (máy chủ tự lấy tỉnh của địa chỉ mặc định); không có thì khách gửi tỉnh đã chọn.
    const { est } = await compare(b, price, isDefault ? undefined : province.code);
    expect(est.fee).toBe(price >= 200_000 ? 0 : 19_000);
    expect(est.provinceCode).toBe(province.code);
    expect(est.provinceName).toBe(isDefault ? province.name : null);
    expect(est.freeshipThreshold).toBe(200_000);
    expect(est.missingForFreeship).toBe(price >= 200_000 ? 0 : 200_000 - price);
  });

  it('đơn đầu của khách thật: miễn phí giao từ 150.000đ ở cả ước tính lẫn báo giá', async () => {
    const b = await buyer({ province: PROVINCES[1]!, isDefault: true, returning: false });
    const { est } = await compare(b, 160_000);
    expect(est.fee).toBe(0);
    expect(est.freeshipThreshold).toBe(150_000);
    const below = await buyer({ province: PROVINCES[1]!, isDefault: true, returning: false });
    const r = await compare(below, 140_000);
    expect(r.est.fee).toBe(19_000);
    expect(r.est.missingForFreeship).toBe(10_000);
  });

  it('hạng có ngưỡng riêng thấp hơn: ước tính theo hạng của khách như báo giá', async () => {
    const id = `IT_${randCode(8)}`;
    await prisma.membershipTier.create({ data: { id, name: `Hạng ${id}`, minPoints: 0, discountPct: 0, pointMultiplier: 1, perks: {} } });
    tierIds.push(id);
    restores.push(await pinConfig(prisma, 'shipping.tier_freeship_overrides', { [id]: 99_000 }));
    // SystemConfigService giữ giá trị 60 giây: xoá đệm để lần đọc kế tiếp thấy ngưỡng hạng vừa ghim.
    (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
    const b = await buyer({ province: PROVINCES[0]!, isDefault: true, returning: true, tierId: id });
    const { est } = await compare(b, 120_000);
    expect(est.fee).toBe(0);
    expect(est.freeshipThreshold).toBe(99_000);
  });

  it('gọi ẩn danh: luật chung, không đọc hay trả dữ liệu của khách nào', async () => {
    const findUser = jest.spyOn(prisma.user, 'findUnique');
    const findAddress = jest.spyOn(prisma.address, 'findFirst');
    try {
      const est = await estimator.estimate(undefined, { subtotal: 120_000 });
      expect(est).toEqual({
        fee: 19_000,
        feeMin: 19_000,
        feeMax: 19_000,
        freeshipThreshold: 200_000,
        missingForFreeship: 80_000,
        isEstimate: true,
        provinceCode: null,
        provinceName: null,
      });
      expect(findUser).not.toHaveBeenCalled();
      expect(findAddress).not.toHaveBeenCalled();
    } finally {
      findUser.mockRestore();
      findAddress.mockRestore();
    }
  });
});
