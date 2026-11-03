import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { GameOrderWaterService } from '../../src/modules/game/game-order-water.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * VX2-01: duyệt trả CẢ ĐƠN qua yêu cầu đổi/trả phải thu lại nước thưởng đơn giao như đường huỷ/trả khác, và đơn còn chờ
 * (khách chưa mở game) không được cộng nước sau khi đã trả.
 */
describe('Duyệt trả cả đơn đảo nước thưởng đơn giao (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let water: GameOrderWaterService;
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
        GameOrderWaterService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    water = moduleRef.get(GameOrderWaterService);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'game.order_seeds', 100);
    await setConfig(prisma, 'game.order_seeds_weekly_cap', 300);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function variation(price: number) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-gwr-p-${tag}`, brand: 'IT', slug: `it-gwr-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-gwr-v-${tag}`, productId: product.id, sku: `ITGWR-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock: 50 },
    });
  }

  async function deliveredOrder(buyerId: string) {
    const v = await variation(200_000);
    const order = await createOrder(prisma, {
      userId: buyerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      subtotal: 200_000,
      total: 200_000,
      items: { create: [{ variationId: v.id, productName: 'A', variationName: 'Mặc định', unitPrice: 200_000, quantity: 1, total: 200_000, paidTotal: 200_000 }] },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { order, item };
  }

  async function returnWholeOrder(buyerId: string, order: { code: string }, itemId: string) {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const req = await returns.request(buyerId, order.code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: itemId, quantity: 1 }], refundMethod: 'WALLET' });
    await returns.review(admin.id, req.id, { approve: true });
  }

  const seedsOf = async (userId: string) => (await prisma.gameProfile.findUnique({ where: { userId } }))?.totalSeeds ?? null;

  it('khách đã có hồ sơ game: trả cả đơn thu lại 100 giọt đã cộng', async () => {
    const buyer = await createUser(prisma, { zaloId: `z_${randCode(10)}`, walletBalance: 0 });
    await prisma.gameProfile.create({ data: { userId: buyer.id, totalSeeds: 0 } });
    const { order, item } = await deliveredOrder(buyer.id);
    await expect(water.grantForOrder(order.id)).resolves.toMatchObject({ granted: 100 });
    expect(await seedsOf(buyer.id)).toBe(100);

    await returnWholeOrder(buyer.id, order, item.id);

    expect(await seedsOf(buyer.id)).toBe(0);
    const reversed = await prisma.gameWaterEvent.findMany({ where: { userId: buyer.id, reason: 'ORDER_REVERSED' } });
    expect(reversed).toHaveLength(1);
    expect(reversed[0]!.delta).toBe(-100);
  });

  it('khách chưa mở game: trả cả đơn tắt dòng chờ, mở game sau đó không được cộng nước của đơn đã trả', async () => {
    const buyer = await createUser(prisma, { zaloId: `z_${randCode(10)}`, walletBalance: 0 });
    const { order, item } = await deliveredOrder(buyer.id);
    await expect(water.grantForOrder(order.id)).resolves.toEqual({ granted: 0, pending: true });

    await returnWholeOrder(buyer.id, order, item.id);

    await prisma.gameProfile.create({ data: { userId: buyer.id, totalSeeds: 0 } });
    await expect(water.claimPending(buyer.id)).resolves.toBe(0);
    expect(await seedsOf(buyer.id)).toBe(0);
    expect(await prisma.gameWaterEvent.findMany({ where: { userId: buyer.id, pending: true } })).toHaveLength(0);
  });
});
