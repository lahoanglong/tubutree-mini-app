import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { computeReturnShares } from '../../src/modules/orders/refund-allocation';
import { GroupBuyService } from '../../src/modules/groupbuy/groupbuy.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { createDealer, createUser, randCode, pinConfig, setConfig, warmPool } from './helpers';

/**
 * Hồi quy phía người mua cho nhánh Q8: đơn KHÔNG có hàng đối tác phải ra đúng số tiền như code trước nhánh (uat/integration
 * @056430e5). `fixtures/buyer-totals-baseline.json` được ghi bằng chính spec này chạy trên code cũ
 * (RECORD_BUYER_BASELINE=1); spec so từng đơn, từng dòng với bản ghi đó.
 *
 * `placement`: số ghi lúc đặt (Order, OrderItem, ví, điểm) — phải khớp tuyệt đối.
 * `perLine`: hoàn tiền từng dòng khi trả một phần và hoa hồng CTV từng dòng — từ M1 đọc OrderItem.paidTotal thay vì chia
 * theo giá trị dòng. Mọi khác biệt so với bản ghi phải nằm trong PER_LINE_CHANGES (kèm lý do), không thì spec đỏ.
 */
const RECORD = process.env.RECORD_BUYER_BASELINE === '1';
const FIXTURE = join(__dirname, 'fixtures', 'buyer-totals-baseline.json');

type Json = Record<string, unknown>;
type Snapshot = { placement: Json; perLine: Json };

/**
 * Khác biệt có chủ đích của M1 so với code cũ, theo `<kịch bản>.<đường dẫn>` trong perLine: giá trị mới kỳ vọng + lý do.
 * Đường dẫn không có ở đây phải khớp bản ghi cũ.
 */
const ROUNDING = 'làm tròn theo từng dòng (paidTotal) thay vì theo tỉ lệ cả đơn, lệch 1đ';
const FLASH = 'hàng giờ vàng không gánh mã giảm giá: hoàn đúng giá giờ vàng đã trả (trừ phần Điểm Xanh), dòng thường hoàn ít hơn';
const SCOPED = 'mã gắn sản phẩm chỉ trừ vào dòng sản phẩm đó: dòng đó hoàn ít hơn, dòng khác hoàn nhiều hơn';
const POINTS = 'Điểm Xanh hoàn theo đúng phần điểm của dòng (OrderItem.pointsDiscount) thay vì theo giá trị dòng: tiền hoàn + điểm hoàn của một dòng khớp giá trị dòng đó';
const EARNED =
  'Điểm Xanh tích thu hồi theo tiền khách thực trả của các đơn vị trả (OrderItem.paidTotal), đúng cơ sở lúc cộng điểm, thay vì theo giá trị dòng: dòng gánh mã trả ít tiền nên thu ít điểm hơn';
const PER_LINE_CHANGES: Record<string, { now: unknown; why: string }> = {
  'wallet-flash-coupon-points.orders[0].refunds.1 × F.pointsUsedBack': { now: 13, why: POINTS },
  'wallet-flash-coupon-points.orders[0].refunds.1 × A.pointsUsedBack': { now: 7, why: POINTS },
  'wallet-flash-coupon-points.orders[0].refunds.1 × B.pointsUsedBack': { now: 2, why: POINTS },
  'transfer-scoped-coupon-tier.orders[0].refunds.1 × A.pointsUsedBack': { now: 12, why: POINTS },
  'transfer-scoped-coupon-tier.orders[0].refunds.1 × B.pointsUsedBack': { now: 5, why: POINTS },
  'transfer-scoped-coupon-tier.orders[0].refunds.1 × C.pointsUsedBack': { now: 3, why: POINTS },
  'cod-coupon-tier-points.orders[0].refunds.1 × A.goods': { now: 21_861, why: ROUNDING },
  'wallet-flash-coupon-points.orders[0].refunds.1 × F.goods': { now: 86_080, why: FLASH },
  'wallet-flash-coupon-points.orders[0].refunds.1 × A.goods': { now: 46_987, why: FLASH },
  'wallet-flash-coupon-points.orders[0].refunds.1 × B.goods': { now: 15_784, why: FLASH },
  'transfer-scoped-coupon-tier.orders[0].refunds.1 × A.goods': { now: 73_750, why: SCOPED },
  'transfer-scoped-coupon-tier.orders[0].refunds.1 × B.goods': { now: 34_194, why: SCOPED },
  'transfer-scoped-coupon-tier.orders[0].refunds.1 × C.goods': { now: 16_678, why: SCOPED },
  'ctv-combo-coupon-points.orders[0].refunds.1 × B.goods': { now: 47_849, why: ROUNDING },
  'ctv-combo-coupon-points.orders[0].commissions[0].commissionableTotal': {
    now: 177_412,
    why: 'nền hoa hồng = tổng paidTotal (đúng tiền hàng thực trả) thay vì cộng các dòng đã làm tròn xuống; số hoa hồng không đổi',
  },
  'groupbuy-coupon.orders[0].refunds.1 × G.goods': { now: 145_154, why: `mã mua chung là ${SCOPED}` },
  'groupbuy-coupon.orders[0].refunds.1 × A.goods': { now: 39_846, why: `mã mua chung là ${SCOPED}` },
  'transfer-scoped-coupon-tier.orders[0].refunds.1 × A.pointsEarnedBack': { now: 11_062, why: EARNED },
  'transfer-scoped-coupon-tier.orders[0].refunds.1 × B.pointsEarnedBack': { now: 5_129, why: EARNED },
  'groupbuy-coupon.orders[0].refunds.1 × G.pointsEarnedBack': { now: 14_515, why: EARNED },
  'groupbuy-coupon.orders[0].refunds.1 × A.pointsEarnedBack': { now: 3_985, why: EARNED },
};

describe('Hồi quy người mua: đơn không có hàng đối tác ra đúng số như trước nhánh Q8 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let groupBuy: GroupBuyService;
  let dealer: DealerService;
  let subs: SubscriptionsService;
  let affiliate: AffiliateService;
  const actual: Record<string, Snapshot> = {};
  const baseline: Record<string, Snapshot> = !RECORD && existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {};

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
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        WalletLedgerService,
        CashbackService,
        OrderReversalService,
        OrderStatusService,
        ComboService,
        FlashSaleService,
        GroupBuyService,
        DealerService,
        SubscriptionsService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    groupBuy = moduleRef.get(GroupBuyService);
    dealer = moduleRef.get(DealerService);
    subs = moduleRef.get(SubscriptionsService);
    affiliate = moduleRef.get(AffiliateService);
    const config: [string, unknown][] = [
      ['shipping.free_threshold', 200_000],
      ['shipping.flat_fee_below_threshold', 19_000],
      ['shipping.tier_freeship_overrides', {}],
      ['loyalty.earn_pct', 10],
      ['loyalty.vnd_per_point_redeem', 1_000],
      ['loyalty.max_redeem_pct', 0.2],
      ['storefront.require_approval', false],
      ['storefront.max_combo_pct', 30],
      ['groupbuy.discount_pct', 15],
      ['groupbuy.target_size', 1],
      ['groupbuy.max_open_per_user', 3],
      ['subscribe.discount_pct', 0.05],
      ['dealer.max_discount_pct', 0.45],
      ['dealer.min_order_value_vnd', 0],
      ['dealer.shipping_fee_below_threshold_vnd', 0],
      ['flashsale.min_discount_pct', 0],
      ['flashsale.default_per_user_limit', 5],
    ];
    for (const [k, v] of config) restores.push(await pinConfig(prisma, k, v as never));
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    if (RECORD && Object.keys(actual).length > 0) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    }
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function product(label: string, price: number, opts: { salePrice?: number; affiliateRate?: number } = {}) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itbr-p-${tag}`,
        brand: 'IT',
        slug: `itbr-${tag.toLowerCase()}`,
        name: `SP ${label} ${tag}`,
        description: 'IT',
        basePrice: price,
        salePrice: opts.salePrice ?? null,
      },
    });
    const v = await prisma.variation.create({
      data: {
        pancakeId: `itbr-v-${tag}`,
        productId: p.id,
        sku: `ITBR-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: price,
        salePrice: opts.salePrice ?? null,
        affiliateRate: opts.affiliateRate ?? null,
        stock: 100,
      },
    });
    return { label, productId: p.id, variationId: v.id };
  }

  async function buyer(data: { tierId?: string; pointsBalance?: number; pointsConvertedBalance?: number; walletBalance?: number } = {}) {
    const u = await createUser(prisma, { phone: phone(), ...data });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
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
    return { userId: u.id, addressId: addr.id };
  }

  async function tier(discountPct: number) {
    const id = `IT_${randCode(8)}`;
    await prisma.membershipTier.create({
      data: { id, name: `Hạng ${id}`, minPoints: 0, discountPct, pointMultiplier: 1.5, perks: {} },
    });
    return id;
  }

  async function coupon(data: { type: 'PERCENT' | 'AMOUNT' | 'FREESHIP'; value: number; maxDiscount?: number; productIds?: string[] }) {
    const code = `ITBR${randCode(8)}`;
    await prisma.coupon.create({
      data: {
        code,
        type: data.type,
        value: data.value,
        maxDiscount: data.maxDiscount ?? null,
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 86_400_000),
        perUserLimit: 1,
        scope: 'PUBLIC',
        applyTo: data.productIds ? { productIds: data.productIds } : undefined,
      },
    });
    return code;
  }

  async function flash(variationId: string, flashPrice: number) {
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    await prisma.flashSaleItem.create({ data: { flashSaleId: sale.id, variationId, flashPrice, quota: 50, perUserLimit: 5 } });
  }

  type Line = Awaited<ReturnType<typeof product>>;

  async function placeCart(
    b: { userId: string; addressId: string },
    lines: [Line, number][],
    opts: { paymentMethod: 'COD' | 'WALLET' | 'BANK_TRANSFER'; couponCode?: string; pointsToUse?: number; storefrontSlug?: string },
  ) {
    for (const [l, q] of lines) await cart.addItem(b.userId, { variationId: l.variationId, quantity: q });
    if (opts.couponCode) await prisma.cart.update({ where: { userId: b.userId }, data: { couponCode: opts.couponCode } });
    const quote = await checkout.quote(b.userId, {
      addressId: b.addressId,
      pointsToUse: opts.pointsToUse,
      storefrontSlug: opts.storefrontSlug,
    } as never);
    await checkout.placeOrder(
      b.userId,
      {
        addressId: b.addressId,
        paymentMethod: opts.paymentMethod,
        pointsToUse: opts.pointsToUse,
        storefrontSlug: opts.storefrontSlug,
        expectedTotal: quote.total,
      } as never,
      `itbr-${randCode(12)}`,
    );
    return quote.total;
  }

  const ORDER_FIELDS = [
    'type',
    'status',
    'paymentMethod',
    'paymentStatus',
    'fulfiller',
    'subtotal',
    'discount',
    'couponDiscount',
    'comboDiscount',
    'tierDiscount',
    'pointsDiscount',
    'shippingFee',
    'total',
    'pointsEarned',
    'pointsUsed',
    'pointsUsedConverted',
    'commission',
  ] as const;

  /** Số của các đơn người mua vừa đặt, khoá theo nhãn dòng (id ngẫu nhiên không vào bản ghi). */
  async function snapshot(userId: string, lines: Line[]): Promise<Snapshot> {
    const label = new Map(lines.map((l) => [l.variationId, l.label]));
    const orders = await prisma.order.findMany({
      where: { userId },
      include: { items: true, commissions: true },
      orderBy: { createdAt: 'asc' },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { walletBalance: true, pointsBalance: true, pointsConvertedBalance: true },
    });
    const placement: Json = { buyer: user, orders: [] as Json[] };
    const perLine: Json = { orders: [] as Json[] };
    for (const o of orders) {
      const name = (variationId: string) => label.get(variationId) ?? 'ngoài kịch bản';
      const byItemId = new Map(o.items.map((i) => [i.id, name(i.variationId)]));
      const head: Json = {};
      for (const f of ORDER_FIELDS) head[f] = o[f];
      head.couponCode = o.couponCode != null;
      head.items = Object.fromEntries(
        o.items.map((i) => [name(i.variationId), { unitPrice: i.unitPrice, quantity: i.quantity, total: i.total, flash: i.flashSaleItemId != null }]),
      );
      (placement.orders as Json[]).push(head);

      const alloc = {
        total: o.total,
        shippingFee: o.shippingFee,
        pointsUsed: o.pointsUsed,
        pointsUsedConverted: o.pointsUsedConverted,
        pointsEarned: o.pointsEarned,
        items: o.items.map((i) => {
          const stored = i as { paidTotal?: number | null; pointsDiscount?: number | null };
          return { id: i.id, total: i.total, quantity: i.quantity, paidTotal: stored.paidTotal, pointsDiscount: stored.pointsDiscount };
        }),
      };
      const refunds: Json = {};
      for (const i of o.items) {
        const share = computeReturnShares(alloc, new Map(), new Map([[i.id, 1]]), { shopFault: false, priorShipping: 0 });
        refunds[`1 × ${name(i.variationId)}`] = {
          goods: share.goods,
          pointsUsedBack: share.pointsUsedBack,
          convertedBack: share.convertedBack,
          pointsEarnedBack: share.pointsEarnedBack,
        };
      }
      const all = computeReturnShares(alloc, new Map(), new Map(o.items.map((i) => [i.id, i.quantity])), {
        shopFault: false,
        priorShipping: 0,
      });
      refunds['cả đơn'] = { goods: all.goods, shipping: all.shipping, pointsUsedBack: all.pointsUsedBack, pointsEarnedBack: all.pointsEarnedBack };
      const commissions = o.commissions.map((c) => ({
        amount: c.amount,
        commissionableTotal: c.commissionableTotal,
        lines: Object.fromEntries(
          Object.entries((c.lineAmounts ?? {}) as Record<string, number>).map(([id, amt]) => [byItemId.get(id) ?? id, amt]),
        ),
      }));
      (perLine.orders as Json[]).push({ refunds, commissions });
    }
    return { placement, perLine };
  }

  function flatten(value: unknown, prefix: string, out: Map<string, unknown>) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    } else {
      out.set(prefix, value);
    }
    return out;
  }

  function check(name: string, snap: Snapshot) {
    actual[name] = snap;
    if (RECORD) return;
    const before = baseline[name];
    expect(before).toBeDefined();
    expect(snap.placement).toEqual(before!.placement);
    const was = flatten(before!.perLine, name, new Map());
    const now = flatten(snap.perLine, name, new Map());
    const diffs: Record<string, { was: unknown; now: unknown }> = {};
    for (const key of new Set([...was.keys(), ...now.keys()])) {
      const expected = key in PER_LINE_CHANGES ? PER_LINE_CHANGES[key]!.now : was.get(key);
      if (expected !== now.get(key)) diffs[key] = { was: was.get(key), now: now.get(key) };
    }
    expect(diffs).toEqual({});
  }

  it('COD, không giảm gì, đủ ngưỡng miễn phí giao', async () => {
    const a = await product('A', 120_000);
    const b = await product('B', 45_000);
    const u = await buyer();
    await placeCart(u, [[a, 1], [b, 2]], { paymentMethod: 'COD' });
    check('cod-plain', await snapshot(u.userId, [a, b]));
  });

  it('COD, mã % không gắn sản phẩm + giảm hạng + Điểm Xanh hai lô, giá lẻ', async () => {
    const a = await product('A', 33_333);
    const b = await product('B', 77_777);
    const c = await product('C', 12_345);
    const u = await buyer({ tierId: await tier(0.05), pointsBalance: 30, pointsConvertedBalance: 15 });
    const code = await coupon({ type: 'PERCENT', value: 10, maxDiscount: 50_000 });
    await placeCart(u, [[a, 1], [b, 2], [c, 3]], { paymentMethod: 'COD', couponCode: code, pointsToUse: 45 });
    check('cod-coupon-tier-points', await snapshot(u.userId, [a, b, c]));
  });

  it('Ví Tubu, một dòng giờ vàng + hai dòng thường, mã trừ tiền + Điểm Xanh', async () => {
    const f = await product('F', 150_000);
    await flash(f.variationId, 99_000);
    const a = await product('A', 64_000);
    const b = await product('B', 21_500);
    const u = await buyer({ pointsBalance: 40, walletBalance: 2_000_000 });
    const code = await coupon({ type: 'AMOUNT', value: 20_000 });
    await placeCart(u, [[f, 2], [a, 1], [b, 3]], { paymentMethod: 'WALLET', couponCode: code, pointsToUse: 40 });
    check('wallet-flash-coupon-points', await snapshot(u.userId, [f, a, b]));
  });

  it('Chuyển khoản, mã gắn một sản phẩm + giảm hạng + Điểm Xanh', async () => {
    const a = await product('A', 88_000);
    const b = await product('B', 51_000);
    const c = await product('C', 19_900);
    const u = await buyer({ tierId: await tier(0.03), pointsBalance: 25 });
    const code = await coupon({ type: 'PERCENT', value: 20, productIds: [b.productId] });
    await placeCart(u, [[a, 1], [b, 2], [c, 1]], { paymentMethod: 'BANK_TRANSFER', couponCode: code, pointsToUse: 25 });
    check('transfer-scoped-coupon-tier', await snapshot(u.userId, [a, b, c]));
  });

  it('Gian hàng CTV: combo + mã + Điểm Xanh, hoa hồng CTV', async () => {
    const owner = await createUser(prisma, { role: 'AFFILIATE', phone: phone() });
    const a = await product('A', 110_000, { affiliateRate: 10 });
    const b = await product('B', 70_000, { affiliateRate: 8 });
    const c = await product('C', 35_000, { affiliateRate: 5 });
    const slug = `itbr-${randCode(8).toLowerCase()}`;
    const sf = await prisma.storefront.create({ data: { type: 'CTV', slug, title: `CTV ${slug}`, ownerUserId: owner.id, isPublished: true } });
    await prisma.storefrontCollection.create({
      data: {
        storefrontId: sf.id,
        title: 'Combo',
        kind: 'COMBO',
        comboDiscountPct: 12,
        items: { create: [{ productId: a.productId, sortOrder: 0 }, { productId: b.productId, sortOrder: 1 }] },
      },
    });
    const u = await buyer({ pointsBalance: 35 });
    const code = await coupon({ type: 'PERCENT', value: 7 });
    await placeCart(u, [[a, 1], [b, 1], [c, 2]], { paymentMethod: 'COD', couponCode: code, pointsToUse: 35, storefrontSlug: slug });
    check('ctv-combo-coupon-points', await snapshot(u.userId, [a, b, c]));
  });

  it('Mua chung: mã của nhóm áp đúng sản phẩm, kèm một sản phẩm khác', async () => {
    const g = await product('G', 180_000);
    const a = await product('A', 42_000);
    const u = await buyer({ pointsBalance: 10 });
    const view = (await groupBuy.create(u.userId, g.productId)) as { id: string };
    const granted = await prisma.coupon.findFirstOrThrow({
      where: { scopeMeta: { path: ['groupBuyId'], equals: view.id } },
      select: { code: true },
    });
    await placeCart(u, [[g, 1], [a, 1]], { paymentMethod: 'COD', couponCode: granted.code, pointsToUse: 10 });
    check('groupbuy-coupon', await snapshot(u.userId, [g, a]));
  });

  it('COD dưới ngưỡng: có phí giao, Điểm Xanh không trừ vào phí giao', async () => {
    const a = await product('A', 55_000);
    const b = await product('B', 23_000);
    const u = await buyer({ pointsBalance: 50 });
    await placeCart(u, [[a, 1], [b, 2]], { paymentMethod: 'COD', pointsToUse: 50 });
    check('cod-shipping-points', await snapshot(u.userId, [a, b]));
  });

  it('Mã miễn phí giao dưới ngưỡng', async () => {
    const a = await product('A', 59_000);
    const u = await buyer();
    const code = await coupon({ type: 'FREESHIP', value: 0 });
    await placeCart(u, [[a, 2]], { paymentMethod: 'COD', couponCode: code });
    check('cod-freeship', await snapshot(u.userId, [a]));
  });

  it('Đại lý: giá theo bậc, trả trước', async () => {
    const a = await product('A', 230_000);
    const b = await product('B', 99_000);
    const tag = randCode(6);
    const t = await prisma.dealerTier.create({ data: { id: `tier_${tag}`, name: `Bậc ${tag}`, minOrderVolume: 0, discountRules: { default: 0.25 } } });
    const d = await createDealer(prisma, { metadata: { dealerTierId: t.id } });
    await dealer.placeOrder(d.id, { items: [{ variationId: a.variationId, quantity: 4 }, { variationId: b.variationId, quantity: 10 }], paymentMethod: 'PREPAID' } as never);
    const prices = (await dealer.pricelist(d.id)).filter((p) => p.variationId === a.variationId || p.variationId === b.variationId);
    const snap = await snapshot(d.id, [a, b]);
    snap.placement.pricelist = prices.map((p) => ({ label: p.variationId === a.variationId ? 'A' : 'B', dealerPrice: p.dealerPrice, discountPct: p.discountPct }));
    check('dealer-prepaid', snap);
  });

  it('Gói định kỳ: đơn đầu giao ngay, COD', async () => {
    const a = await product('A', 145_000);
    const u = await buyer();
    await subs.create(u.userId, { variationId: a.variationId, quantity: 2, intervalWeeks: 4, addressId: u.addressId, paymentMethod: 'COD' });
    check('subscription-first-order', await snapshot(u.userId, [a]));
  });

  it('CTV lên đơn hộ khách: giá lẻ, hoa hồng theo dòng', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: phone() });
    const a = await product('A', 150_000, { affiliateRate: 10 });
    const b = await product('B', 39_000, { affiliateRate: 6 });
    await affiliate.placeOrderForCustomer(ctv.id, {
      paymentMethod: 'COD',
      items: [{ variationId: a.variationId, quantity: 1 }, { variationId: b.variationId, quantity: 2 }],
      customer: { recipient: 'Khach IT', phone: phone(), province: 'Ha Noi', ward: 'Phuong IT', street: '1 Duong IT', provinceCode: '84_VN01', wardCode: '00001' },
    } as never);
    check('ctv-assisted', await snapshot(ctv.id, [a, b]));
  });
});
