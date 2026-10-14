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
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { GroupBuyService, groupBuyCouponCode } from '../../src/modules/groupbuy/groupbuy.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { TOTAL_CHANGED } from '../../src/modules/checkout/checkout.service';
import { createDealer, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const NOT_ELIGIBLE = { response: { code: 'PARTNER_GOODS_NOT_ELIGIBLE' } };

/**
 * Q8 S2: hàng của gian hàng đối tác (tự giao hoặc Tubu giao hộ) chỉ bán giá lẻ niêm yết cộng mã giảm giá của khách — không
 * giá đại lý, không giảm giá định kỳ, không combo CTV, không mua chung; giá giờ vàng do admin đặt thì giữ, phiếu đối soát
 * tính trên đúng giá khách đã trả. Chạy trên Postgres thật, các service tiền đều là bản thật.
 */
describe('Hàng của gian hàng đối tác không hưởng chương trình khác của Tubu (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let storefronts: StorefrontService;
  let groupBuy: GroupBuyService;
  let dealer: DealerService;
  let subs: SubscriptionsService;
  let settlement: MerchantFulfilmentService;
  let returns: OrderReturnsService;

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
        OrderReturnsService,
        MerchantFulfilmentService,
        ComboService,
        StorefrontService,
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
    storefronts = moduleRef.get(StorefrontService);
    groupBuy = moduleRef.get(GroupBuyService);
    dealer = moduleRef.get(DealerService);
    subs = moduleRef.get(SubscriptionsService);
    settlement = moduleRef.get(MerchantFulfilmentService);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    await setConfig(prisma, 'storefront.max_combo_pct', 30);
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
    await setConfig(prisma, 'loyalty.vnd_per_point_redeem', 1_000);
    await setConfig(prisma, 'loyalty.max_redeem_pct', 0.2);
    await setConfig(prisma, 'groupbuy.max_open_per_user', 3);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function shop() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    return prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itpg-${tag}`, title: `Vườn ${tag}`, ownerUserId: owner.id, isPublished: true, commissionPct: 0.1, shippingFee: 30_000 },
    });
  }

  /** `consignment`: sản phẩm của gian hàng, Tubu giao hộ (có mã Pancake, đã liên kết); `selfShip`: gian hàng tự giao. */
  async function variation(price: number, owner: { consignment?: string; selfShip?: string } = {}) {
    const tag = randCode(8);
    const storefrontId = owner.consignment ?? owner.selfShip ?? null;
    const pancake = !owner.selfShip;
    const product = await prisma.product.create({
      data: {
        pancakeId: pancake ? `itpg-p-${tag}` : null,
        storefrontId,
        fulfilment: owner.selfShip ? 'MERCHANT' : 'TUBU',
        brand: 'IT',
        slug: `itpg-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
      },
    });
    const v = await prisma.variation.create({
      data: {
        pancakeId: pancake ? `itpg-v-${tag}` : null,
        productId: product.id,
        sku: `ITPG-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: price,
        stock: 50,
      },
    });
    if (owner.consignment) {
      await prisma.merchantPancakeLink.create({ data: { storefrontId: owner.consignment, productId: product.id, variationId: v.id, linkedAt: ago(60) } });
    }
    return v;
  }

  async function buyer(data: { pointsBalance?: number; pointsConvertedBalance?: number } = {}) {
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

  it('đại lý: bảng giá không có hàng giao hộ lẫn hàng tự giao của gian hàng; đặt theo giá đại lý bị từ chối', async () => {
    const store = await shop();
    const t = await variation(120_000);
    const c = await variation(90_000, { consignment: store.id });
    const m = await variation(80_000, { selfShip: store.id });
    const tag = randCode(6);
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${tag}`, name: `Bậc ${tag}`, minOrderVolume: 0, discountRules: { default: 0.25 } } });
    const d = await createDealer(prisma, { metadata: { dealerTierId: tier.id } });
    const ids = (await dealer.pricelist(d.id)).map((p) => p.variationId);
    expect(ids).toContain(t.id);
    expect(ids).not.toContain(c.id);
    expect(ids).not.toContain(m.id);
    await expect(
      dealer.placeOrder(d.id, { items: [{ variationId: t.id, quantity: 1 }, { variationId: c.id, quantity: 2 }], paymentMethod: 'PREPAID' } as never),
    ).rejects.toMatchObject(NOT_ELIGIBLE);
    expect(await prisma.order.count({ where: { userId: d.id } })).toBe(0);
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: c.id } })).stock).toBe(50);
  });

  it('định kỳ: hàng Tubu giao hộ của gian hàng không đăng ký được', async () => {
    const store = await shop();
    const c = await variation(90_000, { consignment: store.id });
    const u = await buyer();
    await expect(
      subs.create(u.userId, { variationId: c.id, quantity: 1, intervalWeeks: 4, addressId: u.addressId, paymentMethod: 'COD' }),
    ).rejects.toMatchObject(NOT_ELIGIBLE);
    expect(await prisma.subscription.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('mua chung: hàng Tubu giao hộ của gian hàng không mở được nhóm', async () => {
    const store = await shop();
    const c = await variation(90_000, { consignment: store.id });
    const u = await buyer();
    await expect(groupBuy.create(u.userId, c.productId)).rejects.toMatchObject(NOT_ELIGIBLE);
  });

  it('mua chung: nhóm đã mở từ trước trên hàng giao hộ của gian hàng → không tham gia được, nhóm đóng và thành viên được báo; nhóm đủ người chưa phát mã thì không phát (review vòng 3 S2)', async () => {
    const notify = moduleRef.get(NotificationsService).notify as jest.Mock;
    const store = await shop();
    const c = await variation(80_000, { consignment: store.id });
    const [opener, member, joiner] = [await buyer(), await buyer(), await buyer()];
    const open = await prisma.groupBuy.create({
      data: { productId: c.productId, initiatorId: opener.userId, targetSize: 3, currentSize: 2, unitPrice: 68_000, basePrice: 80_000, expiresAt: ago(-1) },
    });
    await prisma.groupBuyMember.createMany({ data: [opener, member].map((u) => ({ groupBuyId: open.id, userId: u.userId })) });
    notify.mockClear();
    await expect(groupBuy.join(joiner.userId, open.id)).rejects.toMatchObject(NOT_ELIGIBLE);
    expect((await prisma.groupBuy.findUniqueOrThrow({ where: { id: open.id } })).status).toBe('FAILED');
    expect(await prisma.groupBuyMember.count({ where: { groupBuyId: open.id } })).toBe(2);
    expect(notify.mock.calls.filter((call) => call[1] === 'GROUP_BUY_FAILED').map((call) => call[0]).sort()).toEqual([opener.userId, member.userId].sort());
    expect((await groupBuy.listOpen(joiner.userId)).some((g) => g.id === open.id)).toBe(false);

    const done = await prisma.groupBuy.create({
      data: { productId: c.productId, initiatorId: opener.userId, targetSize: 2, currentSize: 2, unitPrice: 68_000, basePrice: 80_000, status: 'SUCCESS', expiresAt: ago(-1) },
    });
    await prisma.groupBuyMember.createMany({ data: [opener, member].map((u) => ({ groupBuyId: done.id, userId: u.userId })) });
    await groupBuy.reconcileSuccessfulGroups();
    expect((await prisma.groupBuy.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('FAILED');
    const codes = [opener, member].map((u) => groupBuyCouponCode(done.id, u.userId));
    expect(await prisma.coupon.count({ where: { code: { in: codes } } })).toBe(0);
  });

  it('combo CTV: không thêm hàng đối tác vào combo; hàng đối tác đã nằm trong combo thì không được giảm, hàng Tubu vẫn được', async () => {
    const store = await shop();
    const owner = await createUser(prisma, { role: 'AFFILIATE', phone: phone() });
    const t1 = await variation(100_000);
    const t2 = await variation(60_000);
    const c = await variation(80_000, { consignment: store.id });
    const sf = await storefronts.getOrCreateMine(owner.id);
    await prisma.storefront.update({ where: { id: sf.id }, data: { isPublished: true } });
    const combo = await prisma.storefrontCollection.create({
      data: {
        storefrontId: sf.id,
        title: 'Combo',
        kind: 'COMBO',
        comboDiscountPct: 10,
        items: { create: [{ productId: t1.productId, sortOrder: 0 }, { productId: t2.productId, sortOrder: 1 }] },
      },
    });
    await expect(storefronts.addItem(owner.id, combo.id, { productId: c.productId })).rejects.toMatchObject(NOT_ELIGIBLE);
    await prisma.storefrontItem.create({ data: { collectionId: combo.id, productId: c.productId, sortOrder: 2 } });

    const view = await storefronts.getPublicBySlug(sf.slug);
    expect(view.collections.find((col) => col.id === combo.id)!.items.map((i) => i.product.id)).toEqual([t1.productId, t2.productId]);

    const u = await buyer();
    for (const v of [t1, t2, c]) await cart.addItem(u.userId, { variationId: v.id, quantity: 1 });
    await checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', storefrontSlug: sf.slug } as never, `itpg-${randCode(12)}`);
    const [order] = await prisma.order.findMany({ where: { userId: u.userId }, include: { items: true } });
    expect(order!.comboDiscount).toBe(16_000);
    const item = (id: string) => order!.items.find((i) => i.variationId === id)!;
    expect([item(t1.id).total, item(t2.id).total, item(c.id).total]).toEqual([90_000, 54_000, 80_000]);
    expect(item(c.id).paidTotal).toBe(80_000);
    expect(view.collections.find((col) => col.id === combo.id)!.comboDiscountPct).toBe(10);

    // Combo 1 hàng Tubu + 1 hàng đối tác: còn 1 sản phẩm được giảm nên checkout không giảm combo, trang gian hàng không hứa mức giảm.
    const half = await prisma.storefrontCollection.create({
      data: { storefrontId: sf.id, title: 'Combo nửa', kind: 'COMBO', comboDiscountPct: 20, items: { create: [{ productId: t1.productId, sortOrder: 0 }, { productId: c.productId, sortOrder: 1 }] } },
    });
    const halfView = (await storefronts.getPublicBySlug(sf.slug)).collections.find((col) => col.id === half.id)!;
    expect([halfView.comboDiscountPct, halfView.items.map((i) => i.product.id)]).toEqual([null, [t1.productId]]);
    const u2 = await buyer();
    for (const v of [t1, c]) await cart.addItem(u2.userId, { variationId: v.id, quantity: 1 });
    const q = await checkout.quote(u2.userId, { addressId: u2.addressId, storefrontSlug: sf.slug } as never);
    expect(q.comboDiscount).toBe(0);
  });

  it('giờ vàng do admin đặt vẫn áp cho hàng giao hộ; phiếu đối soát tính trên đúng giá giờ vàng khách đã trả', async () => {
    const store = await shop();
    const t = await variation(150_000);
    const c = await variation(100_000, { consignment: store.id });
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: { title: `Giờ vàng ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    await prisma.flashSaleItem.create({ data: { flashSaleId: sale.id, variationId: c.id, flashPrice: 80_000, quota: 10, perUserLimit: 2 } });
    const u = await buyer();
    await cart.addItem(u.userId, { variationId: t.id, quantity: 1 });
    await cart.addItem(u.userId, { variationId: c.id, quantity: 1 });
    await checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD' } as never, `itpg-${randCode(12)}`);
    const [order] = await prisma.order.findMany({ where: { userId: u.userId }, include: { items: true } });
    const ic = order!.items.find((i) => i.variationId === c.id)!;
    expect([ic.unitPrice, ic.total, ic.paidTotal, ic.flashSaleItemId != null]).toEqual([80_000, 80_000, 80_000, true]);
    await prisma.order.update({ where: { id: order!.id }, data: { status: 'DELIVERED', deliveredAt: ago(10) } });
    const st = await settlement.statementFor(store.id);
    expect(st.lines.map((l) => [l.refKey, l.goodsAmount, l.commissionAmount, l.netAmount])).toEqual([[`ITEM:${ic.id}`, 80_000, 8_000, 72_000]]);
  });

  describe('Q8 S7: Điểm Xanh chỉ trả cho hàng của Tubu', () => {
    const NOTE = 'Điểm Xanh chỉ dùng cho hàng của Tubu, không dùng cho hàng của gian hàng đối tác';
    const key = () => `itpg-${randCode(12)}`;

    it('giỏ Tubu + hàng giao hộ: trần điểm = giá trị hàng Tubu; báo giá kẹp kèm lời giải thích; đặt đúng số đã báo; dòng giao hộ không nhận điểm', async () => {
      const store = await shop();
      const t = await variation(100_000);
      const c = await variation(100_000, { consignment: store.id });
      const u = await buyer({ pointsConvertedBalance: 300 });
      await cart.addItem(u.userId, { variationId: t.id, quantity: 1 });
      await cart.addItem(u.userId, { variationId: c.id, quantity: 1 });

      const q = await checkout.quote(u.userId, { addressId: u.addressId, pointsToUse: 300 } as never);
      expect(q).toMatchObject({ pointsUsed: 100, pointsDiscount: 100_000, pointsMax: 100, pointsPartnerNote: NOTE });
      expect(q.pointsNotice).toBe(`Đơn này dùng được tối đa 100 Điểm Xanh. ${NOTE}.`);
      expect(q.total).toBe(100_000 + q.shippingFee);

      await expect(
        checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', pointsToUse: 300, expectedTotal: q.total - 1 } as never, key()),
      ).rejects.toMatchObject({ response: { code: TOTAL_CHANGED } });
      await checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', pointsToUse: 300, expectedTotal: q.total } as never, key());
      const [order] = await prisma.order.findMany({ where: { userId: u.userId }, include: { items: true } });
      expect(order).toMatchObject({ pointsUsed: 100, pointsUsedConverted: 100, pointsDiscount: 100_000, total: q.total });
      const it = (id: string) => order!.items.find((i) => i.variationId === id)!;
      expect([it(t.id).paidTotal, it(t.id).pointsDiscount, it(c.id).paidTotal, it(c.id).pointsDiscount]).toEqual([0, 100_000, 100_000, 0]);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).pointsConvertedBalance).toBe(200);

      const admin = await createUser(prisma, { role: 'ADMIN' });
      await prisma.order.update({ where: { id: order!.id }, data: { status: 'DELIVERED', deliveredAt: ago(10) } });
      const st = await settlement.statementFor(store.id);
      expect(st.lines.map((l) => [l.refKey, l.goodsAmount, l.commissionAmount, l.netAmount])).toEqual([[`ITEM:${it(c.id).id}`, 100_000, 10_000, 90_000]]);

      await prisma.order.update({ where: { id: order!.id }, data: { deliveredAt: ago(2) } });
      const rc = await returns.request(u.userId, order!.code, { reasonCode: 'OTHER', reason: 'Không cần nữa', items: [{ orderItemId: it(c.id).id, quantity: 1 }] });
      expect(await returns.preview(rc.id)).toMatchObject({ goods: 100_000, pointsUsedBack: 0 });
      await returns.review(admin.id, rc.id, { approve: true, expectedRefund: 100_000 });
      const rt = await returns.request(u.userId, order!.code, { reasonCode: 'OTHER', reason: 'Không cần nữa', items: [{ orderItemId: it(t.id).id, quantity: 1 }] });
      expect(await returns.preview(rt.id)).toMatchObject({ goods: 0, pointsUsedBack: 100 });
    });

    it('dùng ít hơn trần: có lời giải thích nhưng không có lời báo kẹp', async () => {
      const store = await shop();
      const t = await variation(100_000);
      const c = await variation(100_000, { consignment: store.id });
      const u = await buyer({ pointsConvertedBalance: 30 });
      await cart.addItem(u.userId, { variationId: t.id, quantity: 1 });
      await cart.addItem(u.userId, { variationId: c.id, quantity: 1 });
      const q = await checkout.quote(u.userId, { addressId: u.addressId, pointsToUse: 30 } as never);
      expect(q).toMatchObject({ pointsUsed: 30, pointsMax: 30, pointsPartnerNote: NOTE, pointsNotice: null });
    });

    it('giỏ chỉ có hàng của gian hàng (giao hộ hoặc tự giao): không dùng được điểm nào, báo giá nói rõ', async () => {
      const store = await shop();
      const c = await variation(100_000, { consignment: store.id });
      const m = await variation(70_000, { selfShip: store.id });
      for (const v of [c, m]) {
        const u = await buyer({ pointsBalance: 50, pointsConvertedBalance: 50 });
        await cart.addItem(u.userId, { variationId: v.id, quantity: 1 });
        const q = await checkout.quote(u.userId, { addressId: u.addressId, pointsToUse: 100 } as never);
        expect(q).toMatchObject({ pointsUsed: 0, pointsDiscount: 0, pointsMax: 0, pointsPartnerNote: NOTE });
        expect(q.pointsNotice).toBe(`Đơn này không dùng được Điểm Xanh. ${NOTE}.`);
        await checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', pointsToUse: 100, expectedTotal: q.total } as never, key());
        const orders = await prisma.order.findMany({ where: { userId: u.userId } });
        expect(orders.map((o) => o.pointsUsed)).toEqual([0]);
      }
    });

    it('giỏ chỉ hàng Tubu: báo giá như cũ, không có lời giải thích hàng đối tác', async () => {
      const t = await variation(100_000);
      const u = await buyer({ pointsBalance: 50 });
      await cart.addItem(u.userId, { variationId: t.id, quantity: 1 });
      const q = await checkout.quote(u.userId, { addressId: u.addressId, pointsToUse: 50 } as never);
      expect(q).toMatchObject({ pointsUsed: 20, pointsMax: 20, pointsPartnerNote: null, pointsNotice: null });
    });
  });
});
