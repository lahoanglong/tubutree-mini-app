import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CartController } from '../../src/modules/cart/cart.controller';
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
import { BundlesService } from '../../src/modules/bundles/bundles.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { BadRequestException } from '@nestjs/common';
import { computeReturnShares } from '../../src/modules/orders/refund-allocation';
import { TOTAL_CHANGED } from '../../src/modules/checkout/total-changed';
import { createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * Combo và mua kèm toàn sàn (Bundle, P15): cùng một lần mua đọc ba nơi — trang giỏ, báo giá, đơn thật — phải ra đúng từng đồng khi
 * có Giờ vàng, bundle, combo gian hàng và mã giảm giá cùng lúc; bundle hết hạn giữa báo giá và đặt đơn bị `TOTAL_CHANGED` chặn;
 * trả một món của bộ hoàn đúng `paidTotal` của dòng. Postgres thật; ComboService, CouponsService, CheckoutService là bản thật.
 */
describe('Bundle toàn sàn: giỏ = báo giá = đặt đơn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let cartApi: CartController;
  let publicBundles: BundlesService;

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
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
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
    cartApi = new CartController(cart);
    publicBundles = new BundlesService(prisma, new CatalogService(prisma), moduleRef.get(SystemConfigService));
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  // Bảng hạng là dữ liệu chung của cả bộ race: recalcTier gán hạng thấp nhất cho mọi khách, nên hạng giảm % để lại sẽ làm
  // đơn của suite khác bị giảm giá (vd. rớt dưới mức tối thiểu của thưởng giới thiệu).
  const tierIds: string[] = [];

  afterAll(async () => {
    if (tierIds.length) {
      await prisma.user.updateMany({ where: { tierId: { in: tierIds } }, data: { tierId: null } });
      await prisma.membershipTier.deleteMany({ where: { id: { in: tierIds } } });
    }
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
    return { productId: p.id, variationId: p.variations[0]!.id, slug: p.slug };
  }

  /** Phân loại thứ hai của một sản phẩm đã có (cùng sản phẩm, giá khác): thứ làm giá kèm cố định thành lỗ nếu không ghim phân loại. */
  async function addVariation(productId: string, price: number) {
    const tag = randCode(8);
    const v = await prisma.variation.create({
      data: { productId, pancakeId: `itcp-v-${tag}`, sku: `ITCP-${tag}`, name: `Lớn ${price}`, attributes: {}, retailPrice: price, stock: 50 },
    });
    return v.id;
  }

  async function buyer(role?: 'STAFF' | 'ADMIN') {
    const phone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    const u = await createUser(prisma, { phone, zaloId: `z-${randCode(10)}`, ...(role ? { role } : {}) });
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


  async function comboStore(a: string, c: string, pct: number, ownerId?: string) {
    const ctv = ownerId ? { id: ownerId } : await createUser(prisma, { role: 'AFFILIATE' });
    const slug = `itcc-${randCode(8).toLowerCase()}`;
    await prisma.storefront.create({
      data: {
        type: 'CTV',
        slug,
        title: `Gian hàng ${slug}`,
        ownerUserId: ctv.id,
        isPublished: true,
        // storefront.require_approval mặc định bật: gian hàng chưa duyệt bị ẩn, combo của gian hàng không áp.
        approvedAt: new Date(),
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

  const bundleIds: string[] = [];
  afterAll(async () => {
    if (bundleIds.length) await prisma.bundle.deleteMany({ where: { id: { in: bundleIds } } });
  });

  /** `refPrice` bỏ trống = giá đang bán của phân loại ghim lúc tạo bộ (đúng thứ admin ghi); `null` = dòng ghi tay không có giá tham chiếu. */
  type ItemSeed = { productId: string; variationId?: string; addonPrice?: number; maxQty?: number; refPrice?: number | null };
  async function refPriceOf(kind: 'BUNDLE_PCT' | 'ADDON', i: ItemSeed): Promise<number | null> {
    if (i.refPrice !== undefined) return i.refPrice;
    if (kind !== 'ADDON' || !i.variationId) return null;
    const v = await prisma.variation.findUniqueOrThrow({ where: { id: i.variationId }, select: { retailPrice: true, salePrice: true } });
    return v.salePrice ?? v.retailPrice;
  }
  async function bundle(
    kind: 'BUNDLE_PCT' | 'ADDON',
    items: ItemSeed[],
    o: { pct?: number; anchor?: string; startAt?: Date; endAt?: Date; isActive?: boolean; createdById?: string } = {},
  ) {
    const refPrices = await Promise.all(items.map((i) => refPriceOf(kind, i)));
    const b = await prisma.bundle.create({
      data: {
        kind,
        title: `Bộ IT ${randCode(4)}`,
        pct: kind === 'BUNDLE_PCT' ? (o.pct ?? 10) : null,
        anchorProductId: o.anchor ?? null,
        isActive: o.isActive ?? true,
        createdById: o.createdById ?? null,
        startAt: o.startAt ?? new Date(Date.now() - 2 * 3_600_000),
        endAt: o.endAt ?? new Date(Date.now() + 3_600_000),
        items: { create: items.map((i, k) => ({ productId: i.productId, variationId: i.variationId ?? null, addonPrice: i.addonPrice ?? null, refPrice: refPrices[k] ?? null, maxQty: i.maxQty ?? 1, sortOrder: k })) },
      },
    });
    bundleIds.push(b.id);
    return b;
  }

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

  /** Cùng một lần mua đọc ba nơi: GET /cart (đúng đường trang giỏ gọi), báo giá và đơn thật; tiền hàng sau mọi giảm phải bằng nhau từng đồng. */
  async function cartQuoteOrder(b: { userId: string; addressId: string }, slug?: string) {
    const c = await cartApi.get(b.userId, { storefrontSlug: slug } as never);
    const q = await checkout.quote(b.userId, { addressId: b.addressId, storefrontSlug: slug });
    await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', storefrontSlug: slug, expectedTotal: q.total } as never, `itbp-${randCode(12)}`);
    const o = await prisma.order.findFirstOrThrow({ where: { userId: b.userId }, orderBy: { createdAt: 'desc' }, include: { items: true } });
    const cartGoods = c.subtotal - c.comboDiscount - c.discount - ((c as { tierDiscount?: number }).tierDiscount ?? 0);
    const numbers = { cart: cartGoods, quote: q.total - q.shippingFee, order: o.total - o.shippingFee };
    expect(numbers.quote).toBe(numbers.order);
    expect(numbers.cart).toBe(numbers.quote);
    expect({ combo: c.comboDiscount, coupon: c.discount }).toEqual({ combo: o.comboDiscount, coupon: o.couponDiscount });
    expect(q.comboDiscount).toBe(o.comboDiscount);
    // Tiền khách thực trả từng dòng cộng lại đúng tiền hàng của đơn: nền hoa hồng và hoàn tiền không lệch đồng nào.
    expect(o.items.reduce((s, i) => s + (i.paidTotal ?? 0), 0)).toBe(o.total - o.shippingFee);
    return { c, q, o, numbers };
  }

  const paidOf = (o: { items: { variationId: string; paidTotal: number | null }[] }, variationId: string) => o.items.find((i) => i.variationId === variationId)!.paidTotal;

  it('BUNDLE_PCT + mã PERCENT: giảm bộ chỉ cho maxQty đơn vị mỗi món, mã tính trên phần sau bộ; giỏ = báo giá = đơn', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { pct: 10 });
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 2 }); // 140.000đ; bộ 10% cho 1 đơn vị mỗi món = 6.000 + 4.000
    const code = await coupon(b.userId, 'PERCENT', 10);
    await cart.applyCoupon(b.userId, code);

    const r = await cartQuoteOrder(b);
    expect(r.c).toMatchObject({ comboDiscount: 10_000, discount: 13_000, subtotal: 140_000 }); // 10% × (140.000 − 10.000)
    expect(r.numbers).toEqual({ cart: 117_000, quote: 117_000, order: 117_000 });
    expect(r.o.comboDiscount).toBe(10_000);
  });

  it('Giờ vàng + bundle + mã cùng lúc: dòng Giờ vàng không nhận bundle lẫn mã, giỏ = báo giá = đơn', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const f = await flashProduct(100_000, 50_000);
    await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { pct: 10 });
    try {
      await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: f.variationId, quantity: 1 });
      const code = await coupon(b.userId, 'PERCENT', 10);
      await cart.applyCoupon(b.userId, code);

      const r = await cartQuoteOrder(b);
      expect(r.c.comboDiscount).toBe(10_000); // 6.000 + 4.000, không đụng 50.000 của Giờ vàng
      expect(r.c.discount).toBe(9_000); // 10% × (100.000 − 10.000), không tính dòng Giờ vàng
      expect(r.numbers).toEqual({ cart: 131_000, quote: 131_000, order: 131_000 });
      expect(paidOf(r.o, f.variationId)).toBe(50_000);
      expect(paidOf(r.o, a.variationId)! + paidOf(r.o, c.variationId)!).toBe(81_000);
    } finally {
      await prisma.flashSale.update({ where: { id: f.saleId }, data: { isActive: false } });
    }
  });

  it('món của bộ đang Giờ vàng thì bộ không đủ (cùng luật combo gian hàng): không giảm', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const f = await flashProduct(100_000, 50_000);
    await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: f.productId }], { pct: 20 });
    try {
      await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: f.variationId, quantity: 1 });
      const r = await cartQuoteOrder(b);
      expect(r.c.comboDiscount).toBe(0);
      expect(r.numbers).toEqual({ cart: 110_000, quote: 110_000, order: 110_000 });
    } finally {
      await prisma.flashSale.update({ where: { id: f.saleId }, data: { isActive: false } });
    }
  });

  it('bundle và combo gian hàng cùng dòng: lấy khoản lớn hơn, không cộng dồn', async () => {
    const a = await product(60_000);
    const c = await product(40_000);
    const strong = await comboStore(a.productId, c.productId, 30);
    const weak = await comboStore(a.productId, c.productId, 5);
    const bun = await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { pct: 10 });

    const b1 = await buyer();
    await cart.addItem(b1.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b1.userId, { variationId: c.variationId, quantity: 1 });
    const r1 = await cartQuoteOrder(b1, strong);
    expect(r1.c.comboDiscount).toBe(30_000); // combo gian hàng 30% > bundle 10%

    const b2 = await buyer();
    await cart.addItem(b2.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b2.userId, { variationId: c.variationId, quantity: 1 });
    const r2 = await cartQuoteOrder(b2, weak);
    expect(r2.c.comboDiscount).toBe(10_000); // bundle 10% > combo gian hàng 5%, không phải 15%

    // Chủ gian hàng không được combo gian hàng ở chính gian hàng mình, nhưng bundle toàn sàn vẫn áp cho họ.
    const owner = await buyer();
    await prisma.user.update({ where: { id: owner.userId }, data: { role: 'AFFILIATE' } });
    const own = await comboStore(a.productId, c.productId, 30, owner.userId);
    await cart.addItem(owner.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(owner.userId, { variationId: c.variationId, quantity: 1 });
    const r3 = await cartQuoteOrder(owner, own);
    expect(r3.c.comboDiscount).toBe(10_000);
    expect(bun.pct).toBe(10);
  });

  it('ADDON: mua sản phẩm chính thì món kèm về giá kèm; giỏ = báo giá = đơn', async () => {
    const b = await buyer();
    const main = await product(80_000);
    const side = await product(50_000);
    await bundle('ADDON', [{ productId: side.productId, variationId: side.variationId, addonPrice: 39_000 }], { anchor: main.productId });
    await cart.addItem(b.userId, { variationId: main.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: side.variationId, quantity: 1 });

    const r = await cartQuoteOrder(b);
    expect(r.c.comboDiscount).toBe(11_000);
    expect(paidOf(r.o, side.variationId)).toBe(39_000);
    expect(paidOf(r.o, main.variationId)).toBe(80_000);
  });

  it('ADDON không có sản phẩm chính trong giỏ: món kèm giá thường', async () => {
    const b = await buyer();
    const main = await product(80_000);
    const side = await product(50_000);
    await bundle('ADDON', [{ productId: side.productId, variationId: side.variationId, addonPrice: 39_000 }], { anchor: main.productId });
    await cart.addItem(b.userId, { variationId: side.variationId, quantity: 1 });
    const r = await cartQuoteOrder(b);
    expect(r.c.comboDiscount).toBe(0);
    expect(r.numbers.order).toBe(50_000);
  });

  it('ADDON giá kèm là của MỘT phân loại: khách chọn phân loại đắt hơn của cùng sản phẩm không được giá kèm, giảm không vượt giá gốc − giá kèm', async () => {
    const main = await product(80_000);
    const side = await product(50_000);
    const large = await addVariation(side.productId, 500_000);
    await bundle('ADDON', [{ productId: side.productId, variationId: side.variationId, addonPrice: 39_000, maxQty: 2 }], { anchor: main.productId });

    const onlyLarge = await buyer();
    await cart.addItem(onlyLarge.userId, { variationId: main.variationId, quantity: 1 });
    await cart.addItem(onlyLarge.userId, { variationId: large, quantity: 2 }); // 1.000.000đ: không được về 78.000đ
    const r1 = await cartQuoteOrder(onlyLarge);
    expect(r1.c.comboDiscount).toBe(0);
    expect(paidOf(r1.o, large)).toBe(1_000_000);

    const both = await buyer();
    await cart.addItem(both.userId, { variationId: main.variationId, quantity: 1 });
    await cart.addItem(both.userId, { variationId: side.variationId, quantity: 1 });
    await cart.addItem(both.userId, { variationId: large, quantity: 1 });
    const r2 = await cartQuoteOrder(both);
    expect(r2.c.comboDiscount).toBe(11_000); // đúng 50.000 − 39.000 trên phân loại ghim, phân loại lớn giữ 500.000đ
    expect(paidOf(r2.o, side.variationId)).toBe(39_000);
    expect(paidOf(r2.o, large)).toBe(500_000);
  });

  it('nhân viên tạo bộ rồi tự mua: không giảm (giỏ = báo giá = đơn); ADMIN tạo thì được; khách khác vẫn giảm; trang công khai vẫn quảng cáo', async () => {
    const staff = await buyer('STAFF');
    const admin = await buyer('ADMIN');
    const a = await product(60_000);
    const c = await product(40_000);
    const main = await product(80_000);
    const side = await product(50_000);
    const staffPct = await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { pct: 10, createdById: staff.userId });
    const staffAddon = await bundle('ADDON', [{ productId: side.productId, variationId: side.variationId, addonPrice: 39_000 }], { anchor: main.productId, createdById: staff.userId });
    const fill = async (userId: string, lines: { variationId: string }[]) => {
      for (const l of lines) await cart.addItem(userId, { variationId: l.variationId, quantity: 1 });
    };

    await fill(staff.userId, [a, c]);
    const own = await cartQuoteOrder(staff);
    expect(own.c.comboDiscount).toBe(0);
    expect(own.numbers).toEqual({ cart: 100_000, quote: 100_000, order: 100_000 });

    const stranger = await buyer();
    await fill(stranger.userId, [a, c]);
    expect((await cartQuoteOrder(stranger)).c.comboDiscount).toBe(10_000);

    const strangerAddon = await buyer();
    await fill(strangerAddon.userId, [main, side]);
    expect((await cartQuoteOrder(strangerAddon)).c.comboDiscount).toBe(11_000);
    const ownAddon = await buyer('STAFF');
    await prisma.bundle.update({ where: { id: staffAddon.id }, data: { createdById: ownAddon.userId } });
    await fill(ownAddon.userId, [main, side]);
    const addonOwn = await cartQuoteOrder(ownAddon);
    expect(addonOwn.c.comboDiscount).toBe(0);
    expect(addonOwn.numbers.order).toBe(130_000);

    // Cùng bộ do ADMIN tạo thì ADMIN tự mua vẫn được giảm (miễn như mã giảm giá).
    await prisma.bundle.update({ where: { id: staffPct.id }, data: { createdById: admin.userId } });
    await fill(admin.userId, [a, c]);
    expect((await cartQuoteOrder(admin)).c.comboDiscount).toBe(10_000);

    // API công khai không biết người mua (cache chung) nên vẫn quảng cáo cả hai bộ.
    expect((await publicBundles.forProduct(a.slug)).combos.some((x) => x.id === staffPct.id)).toBe(true);
    expect((await publicBundles.forProduct(main.slug)).addons).toHaveLength(1);
  });

  it('thứ tự dòng trong giỏ (heap Postgres) không đổi khoản giảm: hai khách cùng nội dung, thêm món theo thứ tự ngược nhau, ra cùng số ở giỏ, báo giá và đơn', async () => {
    const p1 = await product(100_000);
    const p1Large = await addVariation(p1.productId, 300_000);
    const p2 = await product(100_000);
    await bundle('BUNDLE_PCT', [{ productId: p1.productId }, { productId: p2.productId }], { pct: 10 }); // maxQty 1: chỉ một phân loại của p1 được giảm

    const forward = await buyer();
    for (const v of [p1.variationId, p1Large, p2.variationId]) await cart.addItem(forward.userId, { variationId: v, quantity: 1 });
    const backward = await buyer();
    for (const v of [p2.variationId, p1Large, p1.variationId]) await cart.addItem(backward.userId, { variationId: v, quantity: 1 });

    const a = await cartQuoteOrder(forward);
    const b = await cartQuoteOrder(backward);
    expect(b.c.comboDiscount).toBe(a.c.comboDiscount);
    expect(b.numbers).toEqual(a.numbers);
    for (const v of [p1.variationId, p1Large, p2.variationId]) expect(paidOf(b.o, v)).toBe(paidOf(a.o, v));
  });

  it('ADDON: phân loại ghim tăng giá sau khi tạo bộ (50.000đ → 500.000đ): khoản giảm vẫn là 11.000đ, giá kèm công khai = giá dòng giỏ = báo giá = đơn (489.000đ)', async () => {
    const main = await product(80_000);
    const side = await product(50_000);
    await bundle('ADDON', [{ productId: side.productId, variationId: side.variationId, addonPrice: 39_000 }], { anchor: main.productId }); // refPrice = 50.000 lúc tạo
    await prisma.variation.update({ where: { id: side.variationId }, data: { retailPrice: 500_000 } }); // sửa tay hay đồng bộ Pancake về sau

    const shown = (await publicBundles.forProduct(main.slug)).addons;
    expect(shown).toHaveLength(1);
    expect(shown[0]!.items[0]).toMatchObject({ variationId: side.variationId, addonPrice: 489_000 });

    const b = await buyer();
    await cart.addItem(b.userId, { variationId: main.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: side.variationId, quantity: 1 });
    const r = await cartQuoteOrder(b);
    expect(r.c.comboDiscount).toBe(11_000); // không phải 461.000đ
    expect(paidOf(r.o, side.variationId)).toBe(shown[0]!.items[0]!.addonPrice);
    expect(r.numbers.order).toBe(80_000 + 489_000);

    // Giá tụt xuống dưới giá tham chiếu (sale mới): giảm theo giá hiện tại, không bao giờ làm giá tăng, công khai vẫn khớp giỏ.
    await prisma.variation.update({ where: { id: side.variationId }, data: { retailPrice: 500_000, salePrice: 45_000 } });
    expect((await publicBundles.forProduct(main.slug)).addons[0]!.items[0]!.addonPrice).toBe(39_000);
    const sale = await buyer();
    await cart.addItem(sale.userId, { variationId: main.variationId, quantity: 1 });
    await cart.addItem(sale.userId, { variationId: side.variationId, quantity: 1 });
    expect(paidOf((await cartQuoteOrder(sale)).o, side.variationId)).toBe(39_000);
  });

  it('ADDON thiếu giá tham chiếu (dòng cũ/ghi tay có ghim phân loại): giỏ không giảm VÀ công khai không quảng cáo, không lệch giá', async () => {
    const main = await product(80_000);
    const side = await product(50_000);
    await bundle('ADDON', [{ productId: side.productId, variationId: side.variationId, addonPrice: 39_000, refPrice: null }], { anchor: main.productId });
    expect((await publicBundles.forProduct(main.slug)).addons).toEqual([]);
    const b = await buyer();
    await cart.addItem(b.userId, { variationId: main.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: side.variationId, quantity: 1 });
    const r = await cartQuoteOrder(b);
    expect(r.c.comboDiscount).toBe(0);
    expect(paidOf(r.o, side.variationId)).toBe(50_000);
  });

  it('ADDON ghi tay không ghim phân loại (qua mặt admin): giỏ không giảm đồng nào, công khai không quảng cáo', async () => {
    const b = await buyer();
    const main = await product(80_000);
    const side = await product(50_000);
    const large = await addVariation(side.productId, 500_000);
    await bundle('ADDON', [{ productId: side.productId, addonPrice: 39_000, maxQty: 2 }], { anchor: main.productId });
    await cart.addItem(b.userId, { variationId: main.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: large, quantity: 2 });
    const r = await cartQuoteOrder(b);
    expect(r.c.comboDiscount).toBe(0);
    expect((await publicBundles.forProduct(main.slug)).addons).toEqual([]);
  });

  it('ADDON: sản phẩm chính hết hàng thì công khai không hiện Mua kèm (món chính không vào giỏ được); còn hàng lại thì hiện', async () => {
    const main = await product(80_000);
    const side = await product(50_000);
    await bundle('ADDON', [{ productId: side.productId, variationId: side.variationId, addonPrice: 39_000 }], { anchor: main.productId });
    expect((await publicBundles.forProduct(main.slug)).addons).toHaveLength(1);
    await prisma.variation.update({ where: { id: main.variationId }, data: { stock: 0 } });
    expect((await publicBundles.forProduct(main.slug)).addons).toEqual([]);
    await prisma.variation.update({ where: { id: main.variationId }, data: { stock: 3, isActive: false } });
    expect((await publicBundles.forProduct(main.slug)).addons).toEqual([]);
    await prisma.variation.update({ where: { id: main.variationId }, data: { stock: 3, isActive: true } });
    expect((await publicBundles.forProduct(main.slug)).addons).toHaveLength(1);
  });

  it('ADDON: sản phẩm chính đang Giờ vàng thì công khai không quảng cáo và giỏ không giảm; hết Giờ vàng thì cả hai cùng giảm 11.000đ', async () => {
    const side = await product(50_000);
    const anchor = await flashProduct(100_000, 50_000);
    await bundle('ADDON', [{ productId: side.productId, variationId: side.variationId, addonPrice: 39_000 }], { anchor: anchor.productId });
    const slug = (await prisma.product.findUniqueOrThrow({ where: { id: anchor.productId }, select: { slug: true } })).slug;

    const during = await buyer();
    await cart.addItem(during.userId, { variationId: anchor.variationId, quantity: 1 });
    await cart.addItem(during.userId, { variationId: side.variationId, quantity: 1 });
    expect((await publicBundles.forProduct(slug)).addons).toEqual([]); // trang sản phẩm không hiện "Mua kèm 39.000đ"
    const r1 = await cartQuoteOrder(during);
    expect(r1.c.comboDiscount).toBe(0); // và giỏ tính đúng như trang đã nói: món kèm giá thường
    expect(r1.numbers.order).toBe(100_000);

    await prisma.flashSale.update({ where: { id: anchor.saleId }, data: { isActive: false } });
    const after = await publicBundles.forProduct(slug);
    expect(after.addons).toHaveLength(1);
    expect(after.addons[0]!.items[0]).toMatchObject({ variationId: side.variationId, addonPrice: 39_000 });
    const normal = await buyer();
    await cart.addItem(normal.userId, { variationId: anchor.variationId, quantity: 1 });
    await cart.addItem(normal.userId, { variationId: side.variationId, quantity: 1 });
    expect((await cartQuoteOrder(normal)).c.comboDiscount).toBe(11_000);
  });

  it('combo có món đang Giờ vàng: Trang chủ và trang sản phẩm không quảng cáo, giỏ không giảm (cùng một câu trả lời)', async () => {
    const a = await product(60_000);
    const f = await flashProduct(100_000, 50_000);
    const bun = await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: f.productId }], { pct: 20 });
    const slugA = (await prisma.product.findUniqueOrThrow({ where: { id: a.productId }, select: { slug: true } })).slug;
    try {
      expect((await publicBundles.forProduct(slugA)).combos.some((c) => c.id === bun.id)).toBe(false);
      expect((await publicBundles.homeCombos(8)).some((c) => c.id === bun.id)).toBe(false);
      const b = await buyer();
      await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
      await cart.addItem(b.userId, { variationId: f.variationId, quantity: 1 });
      expect((await cartQuoteOrder(b)).c.comboDiscount).toBe(0);
    } finally {
      await prisma.flashSale.update({ where: { id: f.saleId }, data: { isActive: false } });
    }
    expect((await publicBundles.forProduct(slugA)).combos.some((c) => c.id === bun.id)).toBe(true);
  });

  it('bundle hết hạn giữa báo giá và đặt đơn: báo giá mới không giảm, đặt với tổng cũ bị TOTAL_CHANGED, không tạo đơn', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const bun = await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { pct: 10 });
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });

    const before = await checkout.quote(b.userId, { addressId: b.addressId });
    expect(before.comboDiscount).toBe(10_000);
    await prisma.bundle.update({ where: { id: bun.id }, data: { endAt: new Date(Date.now() - 60_000) } }); // hết hạn: giờ VN hay UTC đều là một mốc tuyệt đối
    const after = await checkout.quote(b.userId, { addressId: b.addressId });
    expect(after.comboDiscount).toBe(0);
    expect(after.total).toBeGreaterThan(before.total);

    const rejected = await checkout
      .placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', expectedTotal: before.total } as never, `itbp-${randCode(12)}`)
      .catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(BadRequestException);
    expect((rejected as BadRequestException).getResponse()).toMatchObject({ code: TOTAL_CHANGED });
    expect(await prisma.order.count({ where: { userId: b.userId } })).toBe(0);
    const stillInCart = await cart.getCart(b.userId);
    expect(stillInCart.items).toHaveLength(2);
    expect(stillInCart.comboDiscount).toBe(0);

    // Khách xem lại báo giá mới rồi đặt thì đơn đi tiếp, không giảm.
    await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', expectedTotal: after.total } as never, `itbp-${randCode(12)}`);
    expect((await prisma.order.findFirstOrThrow({ where: { userId: b.userId } })).comboDiscount).toBe(0);
  });

  it('bundle bị tắt (isActive=false) hoặc chưa tới giờ: không giảm ở giỏ và báo giá', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { isActive: false });
    await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { startAt: new Date(Date.now() + 3_600_000), endAt: new Date(Date.now() + 7_200_000) });
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
    expect((await cart.getCart(b.userId)).comboDiscount).toBe(0);
    expect((await checkout.quote(b.userId, { addressId: b.addressId })).comboDiscount).toBe(0);
  });

  it('tổng giảm giữa hai lần (bundle vừa bật): đơn đi tiếp với giá rẻ hơn', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    const bun = await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { pct: 10, isActive: false });
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
    const before = await checkout.quote(b.userId, { addressId: b.addressId });
    await prisma.bundle.update({ where: { id: bun.id }, data: { isActive: true } });
    await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', expectedTotal: before.total } as never, `itbp-${randCode(12)}`);
    const o = await prisma.order.findFirstOrThrow({ where: { userId: b.userId } });
    expect(o.comboDiscount).toBe(10_000);
    expect(o.total).toBeLessThan(before.total);
  });

  it('bộ có món là hàng gian hàng đối tác: không giảm cả bộ (partner-goods.ts), bộ toàn hàng Tubu vẫn giảm', async () => {
    const owner = await createUser(prisma, { role: 'AFFILIATE' });
    const sf = await prisma.storefront.create({ data: { type: 'CTV', slug: `itbp-${randCode(8).toLowerCase()}`, title: 'Gian hàng IT', ownerUserId: owner.id, isPublished: true, approvedAt: new Date() } });
    const b = await buyer();
    const a = await product(60_000);
    const partner = await product(40_000, { storefrontId: sf.id });
    const c = await product(40_000);
    await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: partner.productId }], { pct: 10 });
    await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { pct: 10 });
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: partner.variationId, quantity: 1 });
    expect((await cart.getCart(b.userId)).comboDiscount).toBe(0);
    expect((await checkout.quote(b.userId, { addressId: b.addressId })).comboDiscount).toBe(0);
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
    expect((await cart.getCart(b.userId)).comboDiscount).toBe(10_000); // chỉ bộ hàng Tubu (a + c): 6.000 + 4.000
  });

  it('trả một món của bộ: hoàn đúng paidTotal của dòng, không thu lại phần giảm của món còn giữ', async () => {
    const b = await buyer();
    const a = await product(60_000);
    const c = await product(40_000);
    await bundle('BUNDLE_PCT', [{ productId: a.productId }, { productId: c.productId }], { pct: 10 });
    await cart.addItem(b.userId, { variationId: a.variationId, quantity: 1 });
    await cart.addItem(b.userId, { variationId: c.variationId, quantity: 1 });
    const r = await cartQuoteOrder(b);
    const itemA = r.o.items.find((i) => i.variationId === a.variationId)!;
    const itemC = r.o.items.find((i) => i.variationId === c.variationId)!;
    expect([itemA.paidTotal, itemC.paidTotal]).toEqual([54_000, 36_000]);

    const order = {
      total: r.o.total,
      shippingFee: r.o.shippingFee,
      pointsUsed: r.o.pointsUsed,
      pointsUsedConverted: r.o.pointsUsedConverted,
      pointsEarned: r.o.pointsEarned,
      items: r.o.items.map((i) => ({ id: i.id, total: i.total, quantity: i.quantity, paidTotal: i.paidTotal, pointsDiscount: i.pointsDiscount })),
    };
    const shares = computeReturnShares(order, new Map(), new Map([[itemA.id, itemA.quantity]]), { shopFault: false, priorShipping: 0 });
    expect(shares.lines).toEqual([{ orderItemId: itemA.id, quantity: 1, refundAmount: 54_000 }]);
    expect(shares.goods).toBe(54_000);
    // Trả nốt món còn lại thì cộng đúng tiền hàng đã trả, không lệch đồng nào.
    const rest = computeReturnShares(order, new Map([[itemA.id, 1]]), new Map([[itemC.id, 1]]), { shopFault: false, priorShipping: 0 });
    expect(shares.goods + rest.goods).toBe(r.o.total - r.o.shippingFee);
  });
});
