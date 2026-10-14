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
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { storedLinePaid } from '../../src/modules/orders/refund-allocation';
import { createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * Q8 review vòng 3 M1: trần Điểm Xanh và phép chia từng dòng phải dùng CÙNG một phép chia (cùng thứ tự dòng, cùng cách phá
 * hoà). Trước đây trần tính trên giỏ theo thứ tự thêm vào giỏ còn phép chia đi theo từng kiện (kiện Tubu trước) nên lệch
 * 1-2đ: dòng Tubu ra paidTotal −1, cả đơn rơi về cách chia theo giá trị, điểm tràn sang dòng hàng đối tác, đối tác bị trừ
 * và khách hoàn sai. Hai ca dưới là ca reviewer tìm được, chạy qua CheckoutService, OrderReturnsService và bảng kê thật.
 */
describe('Trần Điểm Xanh và phép chia từng dòng dùng chung một phép chia (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
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
        FlashSaleService,
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
    settlement = moduleRef.get(MerchantFulfilmentService);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    await setConfig(prisma, 'shipping.free_threshold', 200_000);
    await setConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000);
    await setConfig(prisma, 'shipping.tier_freeship_overrides', {});
    await setConfig(prisma, 'loyalty.vnd_per_point_redeem', 1_000);
    await setConfig(prisma, 'loyalty.max_redeem_pct', 0.2);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const key = () => `itcap-${randCode(12)}`;

  async function shop() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    return prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itcap-${tag}`, title: `Vườn ${tag}`, ownerUserId: owner.id, isPublished: true, commissionPct: 0.1, shippingFee: 30_000 },
    });
  }

  /** `consignment`: sản phẩm của gian hàng, Tubu giao hộ (có mã Pancake, đã liên kết); `selfShip`: gian hàng tự giao. */
  async function variation(price: number, owner: { consignment?: string; selfShip?: string } = {}) {
    const tag = randCode(8);
    const storefrontId = owner.consignment ?? owner.selfShip ?? null;
    const pancake = !owner.selfShip;
    const product = await prisma.product.create({
      data: {
        pancakeId: pancake ? `itcap-p-${tag}` : null,
        storefrontId,
        fulfilment: owner.selfShip ? 'MERCHANT' : 'TUBU',
        brand: 'IT',
        slug: `itcap-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
      },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: pancake ? `itcap-v-${tag}` : null, productId: product.id, sku: `ITCAP-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock: 50 },
    });
    if (owner.consignment) {
      await prisma.merchantPancakeLink.create({ data: { storefrontId: owner.consignment, productId: product.id, variationId: v.id, linkedAt: ago(60) } });
    }
    return v;
  }

  async function buyer(convertedPoints: number, tierDiscountPct: number) {
    const tierId = `IT_${randCode(8)}`;
    await prisma.membershipTier.create({ data: { id: tierId, name: `Hạng ${tierId}`, minPoints: 0, discountPct: tierDiscountPct, pointMultiplier: 1, perks: {} } });
    const u = await createUser(prisma, { phone: phone(), pointsConvertedBalance: convertedPoints, tierId });
    const addr = await prisma.address.create({
      data: { userId: u.id, recipient: 'Khach IT', phone: phone(), province: 'Ha Noi', district: '', ward: 'Phuong IT', street: '1 Duong IT', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });
    return { userId: u.id, addressId: addr.id };
  }

  /** Mọi đơn con: không giảm quá tiền hàng, dòng không âm, tiền từng dòng cộng lại đúng tiền hàng khách trả (không rơi về cách chia cũ). */
  function expectSane(orders: { subtotal: number; discount: number; shippingFee: number; total: number; items: { paidTotal: number | null; pointsDiscount: number | null }[] }[]) {
    for (const o of orders) {
      expect(o.discount).toBeLessThanOrEqual(o.subtotal);
      expect(o.total).toBe(o.subtotal - o.discount + o.shippingFee);
      for (const it of o.items) {
        expect(it.paidTotal).not.toBeNull();
        expect(it.paidTotal!).toBeGreaterThanOrEqual(0);
        expect(it.pointsDiscount!).toBeGreaterThanOrEqual(0);
      }
      expect(storedLinePaid(o.total - o.shippingFee, o.items)).not.toBeNull();
    }
  }

  it('T 26.315 (Tubu) + C 60.000 (Tubu giao hộ) + M 35.000 (tự giao), hạng 5%, dùng đủ trần 25 điểm: T trả hết bằng điểm (0đ), C giữ 57.000; đối soát và hoàn tiền C đúng 57.000', async () => {
    const store = await shop();
    const t = await variation(26_315);
    const c = await variation(60_000, { consignment: store.id });
    const m = await variation(35_000, { selfShip: store.id });
    const u = await buyer(100, 0.05);
    for (const v of [t, c, m]) await cart.addItem(u.userId, { variationId: v.id, quantity: 1 });

    const q = await checkout.quote(u.userId, { addressId: u.addressId, pointsToUse: 100 } as never);
    expect(q).toMatchObject({ pointsUsed: 25, pointsMax: 25, pointsDiscount: 25_000, total: 139_250 });
    await checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', pointsToUse: 100, expectedTotal: q.total } as never, key());

    const orders = await prisma.order.findMany({ where: { userId: u.userId }, include: { items: true }, orderBy: { total: 'asc' } });
    expectSane(orders);
    const tubu = orders.find((o) => o.fulfiller === 'TUBU')!;
    const shopOrder = orders.find((o) => o.fulfiller === 'MERCHANT')!;
    const item = (vid: string) => [...tubu.items, ...shopOrder.items].find((i) => i.variationId === vid)!;
    expect(tubu).toMatchObject({ subtotal: 86_315, tierDiscount: 4_315, pointsDiscount: 25_000, pointsUsed: 25, shippingFee: 19_000, total: 76_000 });
    expect(shopOrder).toMatchObject({ subtotal: 35_000, tierDiscount: 1_750, pointsDiscount: 0, pointsUsed: 0, shippingFee: 30_000, total: 63_250 });
    expect([item(t.id).paidTotal, item(t.id).pointsDiscount]).toEqual([0, 25_000]);
    expect([item(c.id).paidTotal, item(c.id).pointsDiscount]).toEqual([57_000, 0]);
    expect([item(m.id).paidTotal, item(m.id).pointsDiscount]).toEqual([33_250, 0]);

    await prisma.order.update({ where: { id: tubu.id }, data: { status: 'DELIVERED', deliveredAt: ago(10) } });
    const st = await settlement.statementFor(store.id);
    expect(st.lines.map((l) => [l.refKey, l.goodsAmount, l.commissionAmount, l.netAmount])).toEqual([[`ITEM:${item(c.id).id}`, 57_000, 5_700, 51_300]]);

    await prisma.order.update({ where: { id: tubu.id }, data: { deliveredAt: ago(2) } });
    const rc = await returns.request(u.userId, tubu.code, { reasonCode: 'OTHER', reason: 'Không cần nữa', items: [{ orderItemId: item(c.id).id, quantity: 1 }] });
    expect(await returns.preview(rc.id)).toMatchObject({ goods: 57_000, pointsUsedBack: 0 });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    await returns.review(admin.id, rc.id, { approve: false, note: 'Xem tiếp ca trả T' });
    const rt = await returns.request(u.userId, tubu.code, { reasonCode: 'OTHER', reason: 'Không cần nữa', items: [{ orderItemId: item(t.id).id, quantity: 1 }] });
    expect(await returns.preview(rt.id)).toMatchObject({ goods: 0, pointsUsedBack: 25 });
  });

  it('M 33.333 (tự giao, vào giỏ trước) + T 3 × 33.333 (Tubu), hạng 5%, 95 điểm: trần 94 điểm, đơn Tubu không giảm quá tiền hàng, khách trả đúng từng đồng', async () => {
    const store = await shop();
    const m = await variation(33_333, { selfShip: store.id });
    const t = await variation(33_333);
    const u = await buyer(95, 0.05);
    await cart.addItem(u.userId, { variationId: m.id, quantity: 1 });
    await cart.addItem(u.userId, { variationId: t.id, quantity: 3 });

    const q = await checkout.quote(u.userId, { addressId: u.addressId, pointsToUse: 95 } as never);
    // Hàng 133.332, hạng 6.666 (T 5.000, M 1.666); T còn 94.999đ nên tối đa 94 điểm. Khách trả 133.332 − 6.666 − 94.000 + 49.000.
    expect(q).toMatchObject({ pointsUsed: 94, pointsMax: 94, pointsDiscount: 94_000, total: 81_666 });
    await checkout.placeOrder(u.userId, { addressId: u.addressId, paymentMethod: 'COD', pointsToUse: 95, expectedTotal: q.total } as never, key());

    const orders = await prisma.order.findMany({ where: { userId: u.userId }, include: { items: true } });
    expectSane(orders);
    const tubu = orders.find((o) => o.fulfiller === 'TUBU')!;
    const shopOrder = orders.find((o) => o.fulfiller === 'MERCHANT')!;
    expect(tubu).toMatchObject({ subtotal: 99_999, tierDiscount: 5_000, pointsDiscount: 94_000, discount: 99_000, shippingFee: 19_000, total: 19_999 });
    expect(shopOrder).toMatchObject({ subtotal: 33_333, tierDiscount: 1_666, discount: 1_666, shippingFee: 30_000, total: 61_667 });
    expect(tubu.items.map((i) => [i.paidTotal, i.pointsDiscount])).toEqual([[999, 94_000]]);
    expect(orders.reduce((s, o) => s + o.total, 0)).toBe(q.total);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).pointsConvertedBalance).toBe(1);
  });
});
