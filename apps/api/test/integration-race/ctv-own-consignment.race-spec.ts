import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * Đại lý không hưởng hoa hồng CTV trên hàng ký gửi "Tubu giao hộ" của chính mình khi khách mua qua slug của đại lý (chủ dự án
 * chốt 2026-10-16). Loại theo từng dòng: đơn con Tubu có thể trộn hàng Tubu và hàng của đại lý.
 */
describe('Hoa hồng CTV: loại hàng ký gửi của chính người giới thiệu (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let returns: OrderReturnsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'returns.window_days', 7);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function variation(price: number, storefrontId: string | null, rate = 10) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-oc-p-${tag}`,
        brand: 'IT',
        slug: `it-oc-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
        storefrontId,
      },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-oc-v-${tag}`, productId: product.id, sku: `ITOC-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, affiliateRate: rate, stock: 50 },
    });
  }

  async function dealerWithStore() {
    const dealer = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'CTV', isPartner: true, slug: `it-oc-${tag}`, ownerUserId: dealer.id, title: `Shop ${tag}` },
    });
    return { dealer, store };
  }

  /** Đơn con Tubu giao hộ: dòng ký gửi của đại lý (2 x 100.000) + dòng hàng Tubu (2 x 100.000), tiền thực trả bằng giá. */
  async function mixedOrder(referrerId: string, storeId: string) {
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const [own, tubu] = await Promise.all([variation(100_000, storeId), variation(100_000, null)]);
    const order = await createOrder(prisma, {
      userId: buyer.id,
      referrerUserId: referrerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      subtotal: 400_000,
      total: 400_000,
      items: {
        create: [
          { variationId: own.id, productName: 'Own', variationName: 'Mặc định', unitPrice: 100_000, quantity: 2, total: 200_000, paidTotal: 200_000 },
          { variationId: tubu.id, productName: 'Tubu', variationName: 'Mặc định', unitPrice: 100_000, quantity: 2, total: 200_000, paidTotal: 200_000 },
        ],
      },
    });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    return {
      buyer,
      order,
      own: items.find((i) => i.variationId === own.id)!,
      tubu: items.find((i) => i.variationId === tubu.id)!,
    };
  }

  const commissionsOf = (orderId: string) => prisma.commission.findMany({ where: { orderId } });

  it('đại lý mua qua slug riêng: chỉ dòng Tubu có hoa hồng, nền doanh số chỉ gồm dòng Tubu', async () => {
    const { dealer, store } = await dealerWithStore();
    const o = await mixedOrder(dealer.id, store.id);
    await affiliate.createCommissionForOrder(o.order.id);
    const rows = await commissionsOf(o.order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ affiliateUserId: dealer.id, amount: 20_000, commissionableTotal: 200_000 });
    expect(Number(rows[0]!.rate)).toBe(5);
    expect(rows[0]!.lineAmounts).toEqual({ [o.tubu.id]: 20_000 });
  });

  it('CTV khác giới thiệu đúng hàng ký gửi đó vẫn hưởng hoa hồng cả hai dòng', async () => {
    const { store } = await dealerWithStore();
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const o = await mixedOrder(ctv.id, store.id);
    await affiliate.createCommissionForOrder(o.order.id);
    const rows = await commissionsOf(o.order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ affiliateUserId: ctv.id, amount: 40_000, commissionableTotal: 400_000 });
    expect(Number(rows[0]!.rate)).toBe(10);
    expect(rows[0]!.lineAmounts).toEqual({ [o.own.id]: 20_000, [o.tubu.id]: 20_000 });
  });

  it('đại lý khác giới thiệu hàng ký gửi của đại lý này vẫn hưởng hoa hồng', async () => {
    const { store } = await dealerWithStore();
    const other = await dealerWithStore();
    const o = await mixedOrder(other.dealer.id, store.id);
    await affiliate.createCommissionForOrder(o.order.id);
    const rows = await commissionsOf(o.order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ affiliateUserId: other.dealer.id, amount: 40_000, commissionableTotal: 400_000 });
  });

  it('đơn chỉ có hàng ký gửi của chính đại lý: không tạo dòng hoa hồng nào', async () => {
    const { dealer, store } = await dealerWithStore();
    const buyer = await createUser(prisma, { role: 'CUSTOMER' });
    const own = await variation(100_000, store.id);
    const order = await createOrder(prisma, {
      userId: buyer.id,
      referrerUserId: dealer.id,
      status: 'DELIVERED',
      subtotal: 100_000,
      total: 100_000,
      items: {
        create: [{ variationId: own.id, productName: 'Own', variationName: 'Mặc định', unitPrice: 100_000, quantity: 1, total: 100_000, paidTotal: 100_000 }],
      },
    });
    await affiliate.createCommissionForOrder(order.id);
    expect(await commissionsOf(order.id)).toHaveLength(0);
    expect(await prisma.commission.count({ where: { affiliateUserId: dealer.id } })).toBe(0);
  });

  it('trả một phần đơn trộn: trả dòng ký gửi của đại lý không cắt gì, trả dòng Tubu cắt đúng phần dòng đó; tổng khớp', async () => {
    const { dealer, store } = await dealerWithStore();
    const o = await mixedOrder(dealer.id, store.id);
    await affiliate.createCommissionForOrder(o.order.id);
    await affiliate.lockCommissionsForOrder(o.order.id);
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const partial = async (orderItemId: string, quantity: number) => {
      const req = await returns.request(o.buyer.id, o.order.code, {
        reasonCode: 'DEFECTIVE',
        items: [{ orderItemId, quantity }],
        refundMethod: 'WALLET',
      });
      await returns.review(admin.id, req.id, { approve: true });
    };

    await partial(o.own.id, 1);
    expect((await commissionsOf(o.order.id))[0]).toMatchObject({ amount: 20_000, commissionableTotal: 200_000 });

    await partial(o.tubu.id, 1);
    expect((await commissionsOf(o.order.id))[0]).toMatchObject({ amount: 10_000, commissionableTotal: 100_000 });

    await partial(o.tubu.id, 1);
    expect((await commissionsOf(o.order.id))[0]).toMatchObject({ amount: 0, commissionableTotal: 0 });
  });

  it('CTV khác trên cùng hàng ký gửi: trả dòng ký gửi vẫn cắt hoa hồng của dòng đó', async () => {
    const { store } = await dealerWithStore();
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const o = await mixedOrder(ctv.id, store.id);
    await affiliate.createCommissionForOrder(o.order.id);
    await affiliate.lockCommissionsForOrder(o.order.id);
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const req = await returns.request(o.buyer.id, o.order.code, {
      reasonCode: 'DEFECTIVE',
      items: [{ orderItemId: o.own.id, quantity: 1 }],
      refundMethod: 'WALLET',
    });
    await returns.review(admin.id, req.id, { approve: true });
    expect((await commissionsOf(o.order.id))[0]).toMatchObject({ amount: 30_000, commissionableTotal: 300_000 });
  });
});
