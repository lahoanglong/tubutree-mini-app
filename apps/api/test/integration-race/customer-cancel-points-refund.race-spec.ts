import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, warmPool } from './helpers';

/**
 * D12-02 (review): khách tự huỷ và admin duyệt trả cả đơn là hai đường đông nhất; điểm thường đã tiêu phải hoàn trong tx
 * lật CANCELLED/RETURNED. Hoàn sau commit mà lỗi (P2024, SIGTERM) thì bấm huỷ lại bị chặn bởi "đã huỷ" và khách mất điểm vĩnh viễn.
 */
describe('Hoàn Điểm Xanh thường khi khách tự huỷ / duyệt trả cả đơn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let orders: OrdersService;
  let returns: OrderReturnsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
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
    loyalty = moduleRef.get(LoyaltyService);
    returns = moduleRef.get(OrderReturnsService);
    // Chỉ cần đường huỷ của khách: giỏ hàng không dùng tới.
    orders = new OrdersService(
      prisma,
      loyalty,
      {} as never,
      moduleRef.get(NotificationsService),
      moduleRef.get(SystemConfigService),
      moduleRef.get(AffiliateService),
      moduleRef.get(OrderReversalService),
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  const dbDown = () => new Error('P2024: hết kết nối trong pool');
  const balanceOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } })).pointsBalance;
  const refundRows = (orderId: string) => prisma.pointsTransaction.findMany({ where: { refId: orderId, reason: { startsWith: 'ORDER_REFUND_POINTS:' } } });

  it('khách tự huỷ đơn WALLET dùng 20.000 điểm thường, reverseOrderPoints ném lỗi: điểm đã hoàn trong tx; bấm huỷ lại không hoàn lần hai', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, pointsBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      total: 100_000,
      subtotal: 120_000,
      pointsUsed: 20_000,
      pointsUsedConverted: 0,
    });
    jest.spyOn(loyalty, 'reverseOrderPoints').mockRejectedValueOnce(dbDown());

    await expect(orders.cancel(user.id, order.code)).rejects.toThrow('P2024');

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect(await balanceOf(user.id)).toBe(20_000);
    const rows = await refundRows(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 20_000, lot: 'STANDARD' });
    expect(rows[0]!.expiresAt).not.toBeNull();

    await expect(orders.cancel(user.id, order.code)).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(await balanceOf(user.id)).toBe(20_000);
    expect(await refundRows(order.id)).toHaveLength(1);
  });

  it('khách tự huỷ không gặp lỗi: điểm thường hoàn đúng một lần (reverseOrderPoints thấy dòng hoàn có sẵn, không hoàn lần hai)', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, pointsBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      total: 100_000,
      subtotal: 120_000,
      pointsUsed: 20_000,
      pointsUsedConverted: 0,
    });

    await orders.cancel(user.id, order.code);

    expect(await balanceOf(user.id)).toBe(20_000);
    expect(await refundRows(order.id)).toHaveLength(1);
  });

  it('admin duyệt trả cả đơn đã giao (dùng 10.000 điểm thường, tích 50), reverseOrderPoints ném lỗi một lần: điểm thường đã hoàn trong tx; duyệt lại bị chặn nhưng khách không mất điểm đã dùng', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, pointsBalance: 50 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      total: 100_000,
      subtotal: 110_000,
      pointsUsed: 10_000,
      pointsUsedConverted: 0,
      pointsEarned: 50,
    });
    await prisma.pointsTransaction.create({
      data: { userId: user.id, delta: 50, reason: `ORDER_DELIVERED:${order.code}`, refType: 'ORDER', refId: order.id, expiresAt: new Date(Date.now() + 86_400_000 * 300) },
    });
    const req = await prisma.returnRequest.create({ data: { orderId: order.id, userId: user.id, reason: 'Hàng lỗi', status: 'REQUESTED' } });
    jest.spyOn(loyalty, 'reverseOrderPoints').mockRejectedValueOnce(dbDown());

    await expect(returns.review(admin.id, req.id, { approve: true })).rejects.toThrow('P2024');

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RETURNED');
    expect(await balanceOf(user.id)).toBe(50 + 10_000);
    const rows = await refundRows(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 10_000, lot: 'STANDARD' });
    await expect(returns.review(admin.id, req.id, { approve: true })).rejects.toThrow();
    expect(await balanceOf(user.id)).toBe(50 + 10_000);
  });
});
