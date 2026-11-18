import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { computeReturnShares } from '../../src/modules/orders/refund-allocation';
import { paidLineTotals } from '../../src/modules/affiliate/commission-base';
import { TOTAL_CHANGED } from '../../src/modules/checkout/total-changed';
import { GREEN_BOX_ENABLED_KEY, GREEN_BOX_TIERS_KEY } from '../../src/modules/bundles/green-box';
import { createUser, pinConfig, randCode, setConfig, summarize, warmPool } from './helpers';

const TIERS = [
  { minItems: 3, pct: 3 },
  { minItems: 5, pct: 5 },
  { minItems: 7, pct: 7 },
];

/**
 * Hộp Xanh trên Postgres thật: khoản giảm đi chung đường combo nên giỏ = báo giá = đơn từng đồng, Σ paidTotal = tiền hàng (nền hoa hồng
 * CTV và hoàn tiền), điểm tích tính trên số sau giảm, hoàn một phần và huỷ không lệch; đặt đơn đồng thời chỉ ra một đơn; tụt bậc giữa báo
 * giá và đặt đơn thì TOTAL_CHANGED. Cờ tắt: 10 giỏ mẫu không có trường mới và ra đúng số của đường cũ.
 */
describe('Hộp Xanh: giỏ = báo giá = đơn, hoàn một phần, huỷ, hoa hồng, điểm (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let cartApi: CartController;
  let config: SystemConfigService;
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
    config = moduleRef.get(SystemConfigService);
    cartApi = new CartController(cart, { listPending: async () => [] } as never);
    // Cờ và bảng bậc ghim rồi trả lại giá trị cũ: DB race dùng chung giữa các suite.
    restores.push(await pinConfig(prisma, GREEN_BOX_ENABLED_KEY, false));
    restores.push(await pinConfig(prisma, GREEN_BOX_TIERS_KEY, TIERS));
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await moduleRef?.close();
  });

  /** Bật/tắt qua SystemConfigService.set (xoá cache 60 giây của service), như admin bấm công tắc. */
  async function flag(on: boolean) {
    await config.set(GREEN_BOX_ENABLED_KEY, on, 'it-green-box');
  }

  async function product(price: number, opts: { storefrontId?: string; stock?: number } = {}) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itgb-p-${tag}`,
        storefrontId: opts.storefrontId ?? null,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itgb-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
        variations: {
          create: { pancakeId: `itgb-v-${tag}`, sku: `ITGB-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock: opts.stock ?? 50 },
        },
      },
      include: { variations: true },
    });
    return { productId: p.id, variationId: p.variations[0]!.id };
  }

  async function flashProduct(price: number, flashPrice: number) {
    const f = await product(price);
    await prisma.flashSale.create({
      data: {
        title: 'IT giờ vàng',
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 3_600_000),
        createdBy: 'it',
        items: { create: { variationId: f.variationId, flashPrice, quota: 100, perUserLimit: 5 } },
      },
    });
    return f;
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

  async function percentCoupon(userId: string, value: number) {
    const c = await prisma.coupon.create({
      data: {
        code: `ITGB${randCode(10)}`,
        type: 'PERCENT',
        value,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId },
      },
    });
    return c.code;
  }

  async function amountCoupon(userId: string, value: number, minOrder: number) {
    const c = await prisma.coupon.create({
      data: {
        code: `ITGBA${randCode(10)}`,
        type: 'AMOUNT',
        value,
        minOrder,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId },
      },
    });
    return c.code;
  }

  async function comboStore(a: string, c: string, pct: number) {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const slug = `itgbc-${randCode(8).toLowerCase()}`;
    await prisma.storefront.create({
      data: {
        type: 'CTV',
        slug,
        title: `Gian hàng ${slug}`,
        ownerUserId: ctv.id,
        isPublished: true,
        approvedAt: new Date(),
        collections: { create: { title: 'Combo IT', kind: 'COMBO', comboDiscountPct: pct, items: { create: [{ productId: a }, { productId: c }] } } },
      },
    });
    return slug;
  }

  async function partnerStore() {
    const owner = await createUser(prisma, { role: 'AFFILIATE' });
    return prisma.storefront.create({
      data: { type: 'CTV', slug: `itgbp-${randCode(8).toLowerCase()}`, title: 'Gian hàng IT', ownerUserId: owner.id, isPublished: true, approvedAt: new Date() },
    });
  }

  type Line = { variationId: string; quantity: number };
  async function fill(userId: string, lines: Line[]) {
    for (const l of lines) await cart.addItem(userId, l);
  }
  const products = async (prices: number[]) => Promise.all(prices.map((p) => product(p)));
  const one = (ps: { variationId: string }[], qty = 1): Line[] => ps.map((p) => ({ variationId: p.variationId, quantity: qty }));

  /** Một lần mua đọc ba nơi (GET /cart, báo giá, đơn thật) rồi kiểm mọi bất biến tiền của đơn. */
  async function cartQuoteOrder(b: { userId: string; addressId: string }, slug?: string) {
    const c = await cartApi.get(b.userId, { storefrontSlug: slug } as never);
    const q = await checkout.quote(b.userId, { addressId: b.addressId, storefrontSlug: slug });
    await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', storefrontSlug: slug, expectedTotal: q.total } as never, `itgb-${randCode(12)}`);
    const o = await prisma.order.findFirstOrThrow({ where: { userId: b.userId }, orderBy: { createdAt: 'desc' }, include: { items: true } });
    const goods = o.total - o.shippingFee;
    expect(c.subtotal - c.comboDiscount - c.discount - (c.tierDiscount ?? 0)).toBe(q.total - q.shippingFee);
    expect(q.total - q.shippingFee).toBe(goods);
    expect({ combo: c.comboDiscount, coupon: c.discount }).toEqual({ combo: o.comboDiscount, coupon: o.couponDiscount });
    expect(c.greenBoxDiscount).toBe(q.greenBoxDiscount);
    // Nền hoa hồng CTV và hoàn tiền: tiền khách thực trả từng dòng cộng lại đúng tiền hàng của đơn.
    expect(o.items.reduce((s, i) => s + (i.paidTotal ?? 0), 0)).toBe(goods);
    const commissionBase = paidLineTotals(o, o.items);
    expect(commissionBase).toEqual(o.items.map((i) => i.paidTotal));
    expect(commissionBase.reduce((s, v) => s + v, 0)).toBe(goods);
    // Điểm tích tính trên tiền hàng sau mọi giảm (gồm Hộp Xanh), đơn một kiện hàng Tubu.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: b.userId }, select: { tierId: true } });
    const multiplier = await moduleRef.get(LoyaltyService).getTierMultiplier(user.tierId);
    expect(o.pointsEarned).toBe(await moduleRef.get(PricingService).calcPointsEarned(goods, multiplier));
    return { c, q, o };
  }

  const lineOf = <T extends { variationId: string }>(o: { items: T[] }, variationId: string) => o.items.find((i) => i.variationId === variationId)!;

  describe('cờ bật', () => {
    beforeAll(() => flag(true));
    afterAll(() => flag(false));

    it('3 món Tubu khác nhau, giá thường: giảm 3%, dòng 3 đơn vị chỉ giảm 2; giỏ = báo giá = đơn; hoa hồng, điểm đúng', async () => {
      const b = await buyer();
      const [a, c, d] = await products([50_000, 40_000, 30_000]);
      await fill(b.userId, [...one([a!, d!]), { variationId: c!.variationId, quantity: 3 }]);
      const { c: got, o } = await cartQuoteOrder(b);
      // 1.500 + 2.400 (40.000 × 2 × 3%) + 900
      expect(got.greenBoxDiscount).toBe(4_800);
      expect(got.greenBox).toMatchObject({ items: 3, tier: { minItems: 3, pct: 3 }, next: { minItems: 5, pct: 5 }, discount: 4_800 });
      expect(got.comboDiscount).toBe(4_800);
      expect(o.comboDiscount).toBe(4_800);
      expect([lineOf(o, a!.variationId).total, lineOf(o, c!.variationId).total, lineOf(o, d!.variationId).total]).toEqual([48_500, 117_600, 29_100]);
    });

    it('mã đạt đơn tối thiểu chỉ khi chưa trừ Hộp Xanh: Hộp Xanh nhường, khách được mã như cờ tắt ở giỏ, ví mã, báo giá và đơn', async () => {
      const b = await buyer();
      // 305.000đ, Hộp Xanh 3% = 9.150đ kéo phần hàng xuống 295.850đ, dưới đơn tối thiểu 300.000đ của mã −50.000đ.
      await fill(b.userId, one(await products([105_000, 100_000, 100_000])));
      const code = await amountCoupon(b.userId, 50_000, 300_000);
      await cart.applyCoupon(b.userId, code);
      const preview = await checkout.couponPreviews(b.userId, {} as never);
      expect(preview.coupons.find((x) => x.code === code)).toMatchObject({ eligible: true, discount: 50_000 });
      const { c: got, q, o } = await cartQuoteOrder(b);
      expect(got.greenBox).toBeUndefined();
      expect(got.discount).toBe(50_000);
      expect(q.greenBoxDiscount).toBeUndefined();
      expect(q.total - q.shippingFee).toBe(255_000);
      expect({ combo: o.comboDiscount, coupon: o.couponDiscount }).toEqual({ combo: 0, coupon: 50_000 });
    });

    it('mã hụt đơn tối thiểu cả khi chưa trừ Hộp Xanh: giữ Hộp Xanh, mã không được nhận', async () => {
      const b = await buyer();
      await fill(b.userId, one(await products([105_000, 100_000, 100_000])));
      const code = await amountCoupon(b.userId, 50_000, 400_000);
      await expect(cart.applyCoupon(b.userId, code)).rejects.toThrow();
      const { c: got } = await cartQuoteOrder(b);
      expect(got.greenBoxDiscount).toBe(9_150);
      expect(got.discount).toBe(0);
    });

    it('hoàn một phần: trả 1 đơn vị của dòng có giảm, rồi trả nốt, cộng đúng tiền hàng đã trả; không đồng nào lệch', async () => {
      const b = await buyer();
      const [a, c, d] = await products([50_000, 40_000, 30_000]);
      await fill(b.userId, [...one([a!, d!]), { variationId: c!.variationId, quantity: 3 }]);
      const { o } = await cartQuoteOrder(b);
      const order = {
        total: o.total,
        shippingFee: o.shippingFee,
        pointsUsed: o.pointsUsed,
        pointsUsedConverted: o.pointsUsedConverted,
        pointsEarned: o.pointsEarned,
        items: o.items.map((i) => ({ id: i.id, total: i.total, quantity: i.quantity, paidTotal: i.paidTotal, pointsDiscount: i.pointsDiscount })),
      };
      const lc = lineOf(o, c!.variationId);
      const first = computeReturnShares(order, new Map(), new Map([[lc.id, 1]]), { shopFault: false, priorShipping: 0 });
      expect(first.goods).toBe(39_200);
      const rest = computeReturnShares(
        order,
        new Map([[lc.id, 1]]),
        new Map(o.items.map((i) => [i.id, i.id === lc.id ? i.quantity - 1 : i.quantity])),
        { shopFault: false, priorShipping: 0 },
      );
      expect(first.goods + rest.goods).toBe(o.total - o.shippingFee);
    });

    it('huỷ đơn: kho trả về đủ, đơn COD không hoàn tiền, khoản giảm trên đơn giữ nguyên để đối soát', async () => {
      const b = await buyer();
      const ps = await products([50_000, 40_000, 30_000]);
      await fill(b.userId, one(ps, 2));
      const { o } = await cartQuoteOrder(b);
      expect(o.comboDiscount).toBe(7_200);
      const full = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
      const result = await prisma.$transaction(async (tx) => {
        const flipped = await tx.order.updateMany({ where: { id: full.id, status: full.status }, data: { status: 'CANCELLED' } });
        expect(flipped.count).toBe(1);
        return moduleRef.get(OrderReversalService).reverseFinancials(tx, full);
      });
      expect(result.moneyRefunded).toBe(false);
      const stocks = await prisma.variation.findMany({ where: { id: { in: ps.map((p) => p.variationId) } }, select: { stock: true } });
      expect(stocks.map((s) => s.stock)).toEqual([50, 50, 50]);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).comboDiscount).toBe(7_200);
    });

    it('đặt đơn đồng thời từ cùng một giỏ: chỉ một đơn, kho trừ một lần, đơn đó vẫn đủ bất biến tiền', async () => {
      const b = await buyer();
      const ps = await products([30_000, 30_000, 30_000, 30_000, 30_000]);
      await fill(b.userId, one(ps));
      const q = await checkout.quote(b.userId, { addressId: b.addressId });
      expect(q.greenBoxDiscount).toBe(7_500);
      const results = await Promise.allSettled(
        [0, 1, 2].map(() =>
          checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', expectedTotal: q.total } as never, `itgb-${randCode(12)}`),
        ),
      );
      expect(summarize(results).fulfilled.length).toBeGreaterThanOrEqual(1);
      const orders = await prisma.order.findMany({ where: { userId: b.userId }, include: { items: true } });
      expect(orders).toHaveLength(1);
      const o = orders[0]!;
      expect(o.total).toBe(q.total);
      expect(o.comboDiscount).toBe(7_500);
      expect(o.items.reduce((sum, i) => sum + (i.paidTotal ?? 0), 0)).toBe(o.total - o.shippingFee);
      const stocks = await prisma.variation.findMany({ where: { id: { in: ps.map((p) => p.variationId) } }, select: { stock: true } });
      expect(stocks.map((st) => st.stock)).toEqual([49, 49, 49, 49, 49]);
    });

    it('tụt bậc giữa báo giá và đặt đơn (bảng bậc đổi): TOTAL_CHANGED, không tạo đơn; xem lại báo giá rồi đặt thì đi tiếp', async () => {
      const b = await buyer();
      const ps = await products([40_000, 40_000, 40_000]);
      await fill(b.userId, one(ps));
      const before = await checkout.quote(b.userId, { addressId: b.addressId });
      expect(before.greenBoxDiscount).toBe(3_600);
      await config.set(GREEN_BOX_TIERS_KEY, [{ minItems: 5, pct: 5 }], 'it-green-box');
      try {
        const after = await checkout.quote(b.userId, { addressId: b.addressId });
        expect(after.greenBoxDiscount).toBe(0);
        expect(after.total).toBeGreaterThan(before.total);
        const rejected = await checkout
          .placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', expectedTotal: before.total } as never, `itgb-${randCode(12)}`)
          .catch((e: unknown) => e);
        expect(rejected).toBeInstanceOf(BadRequestException);
        expect((rejected as BadRequestException).getResponse()).toMatchObject({ code: TOTAL_CHANGED });
        expect(await prisma.order.count({ where: { userId: b.userId } })).toBe(0);
        await checkout.placeOrder(b.userId, { addressId: b.addressId, paymentMethod: 'COD', expectedTotal: after.total } as never, `itgb-${randCode(12)}`);
        expect((await prisma.order.findFirstOrThrow({ where: { userId: b.userId } })).comboDiscount).toBe(0);
      } finally {
        await config.set(GREEN_BOX_TIERS_KEY, TIERS, 'it-green-box');
      }
    });

    it('món Giờ vàng, món thuộc combo đang áp và hàng gian hàng đối tác không được đếm, không được giảm', async () => {
      const b = await buyer();
      const [a, c, x, y] = await products([60_000, 40_000, 30_000, 30_000]);
      const flash = await flashProduct(50_000, 35_000);
      const sf = await partnerStore();
      const partner = await product(45_000, { storefrontId: sf.id });
      const slug = await comboStore(a!.productId, c!.productId, 10);
      await fill(b.userId, [...one([a!, c!, x!, y!]), { variationId: flash.variationId, quantity: 1 }, { variationId: partner.variationId, quantity: 1 }]);
      const { c: got, o } = await cartQuoteOrder(b, slug);
      // Đủ điều kiện chỉ còn x, y: chưa tới bậc đầu.
      expect(got.greenBox).toMatchObject({ items: 2, tier: null, next: { minItems: 3, pct: 3 }, discount: 0 });
      expect(got.greenBoxDiscount).toBe(0);
      expect(o.comboDiscount).toBe(10_000);
    });
  });

  it('cờ tắt: 10 giỏ mẫu không có trường Hộp Xanh và ra đúng số đường cũ; bật lên thì chỉ phần Hộp Xanh đổi', async () => {
    type Built = { userId: string; addressId: string; slug?: string };
    const withLines = async (lines: Line[], extra?: (userId: string) => Promise<string | undefined>): Promise<Built> => {
      const b = await buyer();
      await fill(b.userId, lines);
      const slug = extra ? await extra(b.userId) : undefined;
      return { ...b, slug };
    };
    const samples: { name: string; build: () => Promise<Built> }[] = [
      { name: '1 món 60.000đ', build: async () => withLines(one(await products([60_000]))) },
      { name: '2 món', build: async () => withLines(one(await products([60_000, 40_000]))) },
      {
        name: '3 món, một dòng 3 đơn vị',
        build: async () => {
          const [a, c, d] = await products([50_000, 40_000, 30_000]);
          return withLines([...one([a!, d!]), { variationId: c!.variationId, quantity: 3 }]);
        },
      },
      {
        name: '3 món, một món Giờ vàng',
        build: async () => {
          const f = await flashProduct(50_000, 35_000);
          return withLines([...one(await products([40_000, 30_000])), { variationId: f.variationId, quantity: 1 }]);
        },
      },
      { name: '5 món 30.000đ', build: async () => withLines(one(await products([30_000, 30_000, 30_000, 30_000, 30_000]))) },
      { name: '7 món 20.000đ', build: async () => withLines(one(await products([20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000]))) },
      {
        name: 'combo gian hàng 2 món + 3 món lẻ',
        build: async () => {
          const [a, c, x, y, z] = await products([60_000, 40_000, 30_000, 30_000, 30_000]);
          return withLines(one([a!, c!, x!, y!, z!]), async () => comboStore(a!.productId, c!.productId, 10));
        },
      },
      {
        name: '3 món Tubu + 1 món gian hàng đối tác',
        build: async () => {
          const sf = await partnerStore();
          const partner = await product(45_000, { storefrontId: sf.id });
          return withLines([...one(await products([50_000, 40_000, 30_000])), { variationId: partner.variationId, quantity: 1 }]);
        },
      },
      {
        name: '3 món + mã PERCENT 10%',
        build: async () =>
          withLines(one(await products([50_000, 40_000, 30_000])), async (userId) => {
            await cart.applyCoupon(userId, await percentCoupon(userId, 10));
            return undefined;
          }),
      },
      { name: '8 món × 2 đơn vị', build: async () => withLines(one(await products([25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000]), 2)) },
    ];

    const rows: string[] = [];
    for (const s of samples) {
      const b = await s.build();
      await flag(false);
      const offCart = await cartApi.get(b.userId, { storefrontSlug: b.slug } as never);
      const off = await checkout.quote(b.userId, { addressId: b.addressId, storefrontSlug: b.slug });
      const at = (v: unknown) => ({ [s.name]: v });
      expect(at('greenBoxDiscount' in offCart || 'greenBox' in offCart)).toEqual(at(false));
      expect(at('greenBoxDiscount' in off)).toEqual(at(false));
      // Đường cũ: tiền hàng − combo − mã − hạng + phí giao, giỏ cùng số với báo giá.
      expect(at(off.total)).toEqual(at(off.subtotal - off.comboDiscount - off.discount - (off.tierDiscount ?? 0) + off.shippingFee));
      expect(at(offCart.subtotal - offCart.comboDiscount - offCart.discount - (offCart.tierDiscount ?? 0))).toEqual(at(off.total - off.shippingFee));

      await flag(true);
      const on = await checkout.quote(b.userId, { addressId: b.addressId, storefrontSlug: b.slug });
      const onCart = await cartApi.get(b.userId, { storefrontSlug: b.slug } as never);
      const gb = on.greenBoxDiscount ?? 0;
      expect(at(onCart.greenBoxDiscount)).toEqual(at(gb));
      expect(at(on.comboDiscount - gb)).toEqual(at(off.comboDiscount));
      expect(at(on.subtotal)).toEqual(at(off.subtotal));
      expect(at(gb === 0 ? on.total === off.total : on.total < off.total)).toEqual(at(true));
      rows.push(`| ${s.name} | ${off.subtotal} | ${off.comboDiscount} | ${off.discount} | ${off.shippingFee} | ${off.total} | ${gb} | ${on.discount} | ${on.shippingFee} | ${on.total} |`);
      await flag(false);
    }
    // Bảng dán vào báo cáo wave.
    console.log(
      [
        '| Giỏ | Tiền hàng | Combo (tắt) | Mã (tắt) | Phí giao (tắt) | Tổng (tắt) | Hộp Xanh (bật) | Mã (bật) | Phí giao (bật) | Tổng (bật) |',
        '|---|---|---|---|---|---|---|---|---|---|',
        ...rows,
      ].join('\n'),
    );
  });
});
