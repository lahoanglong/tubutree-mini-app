import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { applyPointsDelta } from '../../src/modules/loyalty/points-ledger';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const UNIT = 50_000;
const EARNED = 30;

/**
 * R6-CHECKOUT-3: chi tiết đơn (GET /orders/:code) trả số Điểm Xanh tích THỰC SỰ đã thu lại do trả một phần
 * (`pointsReturnReversed` = tổng dòng sổ RETURN_REVERSED:<mã>), không phải phần chia chưa kẹp của yêu cầu trả.
 */
describe('Chi tiết đơn: Điểm Xanh thực thu lại do trả hàng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let orders: OrdersService;
  let admin: { id: string };
  let savedWindow: { key: string; value: unknown } | null = null;

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
        OrdersService,
        OrderReturnsService,
        CustomerRefundsService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: CartService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
        { provide: RbacService, useValue: {} },
        { provide: GomdonOrderService, useValue: {} },
        { provide: GomdonClient, useValue: {} },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    orders = moduleRef.get(OrdersService);
    savedWindow = await prisma.systemConfig.findUnique({ where: { key: 'returns.window_days' } });
    await setConfig(prisma, 'returns.window_days', 7);
    admin = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    if (prisma) {
      if (savedWindow) await setConfig(prisma, savedWindow.key, savedWindow.value as never);
      else await prisma.systemConfig.deleteMany({ where: { key: 'returns.window_days' } });
    }
    await moduleRef?.close();
  });

  /** Đơn COD đã giao 3 × 50.000, đã cộng 30 Điểm Xanh tích lúc giao (dòng ORDER_DELIVERED, lô của đơn còn hạn). */
  async function deliveredWithPoints() {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-c3-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 100 },
    });
    const total = 3 * UNIT;
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: total,
      shippingFee: 0,
      total,
      pointsEarned: EARNED,
      deliveredAt: new Date(),
      items: { create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: 3, total, paidTotal: total }] },
    });
    await prisma.$transaction((tx) =>
      applyPointsDelta(tx, {
        userId: user.id,
        delta: EARNED,
        lot: 'STANDARD',
        reason: `ORDER_DELIVERED:${order.code}`,
        refType: 'ORDER',
        refId: order.id,
        expiresAt: new Date(Date.now() + 365 * 864e5),
      }),
    );
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { user, order, item };
  }

  async function returnOne(userId: string, code: string, itemId: string) {
    const req = await returns.request(userId, code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: itemId, quantity: 1 }],
    });
    await returns.review(admin.id, req.id, { approve: true });
    return prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id }, select: { pointsReversed: true } });
  }

  async function ledgerMatches(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
    return u.pointsBalance;
  }

  it('chưa trả gì → 0', async () => {
    const { user, order } = await deliveredWithPoints();
    expect((await orders.detailView(user.id, order.code)).pointsReturnReversed).toBe(0);
    expect(await ledgerMatches(user.id)).toBe(EARNED);
  });

  it('trả 1/3 khi còn đủ điểm → thu đúng phần chia (10), bằng pointsReversed của yêu cầu', async () => {
    const { user, order, item } = await deliveredWithPoints();
    const req = await returnOne(user.id, order.code, item.id);
    expect(req.pointsReversed).toBe(10);
    expect((await orders.detailView(user.id, order.code)).pointsReturnReversed).toBe(10);
    expect(await ledgerMatches(user.id)).toBe(EARNED - 10);
  });

  it('khách đã tiêu gần hết điểm → số thực thu bị kẹp theo số dư (4), nhỏ hơn pointsReversed (10)', async () => {
    const { user, order, item } = await deliveredWithPoints();
    await prisma.$transaction((tx) =>
      applyPointsDelta(tx, { userId: user.id, delta: -26, lot: 'STANDARD', reason: `IT_SPEND:${randCode(6)}`, refType: 'IT' }),
    );
    const req = await returnOne(user.id, order.code, item.id);
    expect(req.pointsReversed).toBe(10);
    expect((await orders.detailView(user.id, order.code)).pointsReturnReversed).toBe(4);
    expect(await ledgerMatches(user.id)).toBe(0);
  });

  it('hai lần trả một phần cộng dồn; đơn chưa giao không trả trường này', async () => {
    const { user, order, item } = await deliveredWithPoints();
    await returnOne(user.id, order.code, item.id);
    await returnOne(user.id, order.code, item.id);
    expect((await orders.detailView(user.id, order.code)).pointsReturnReversed).toBe(20);
    const pending = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED' });
    expect((await orders.detailView(user.id, pending.code)).pointsReturnReversed).toBeUndefined();
  });
});
