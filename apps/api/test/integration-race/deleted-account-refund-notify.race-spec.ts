import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Chủ đơn đã xoá (ẩn danh) tài khoản trước khi đơn bị trả: đi qua đường thật (OrderStatusService.setStatus và duyệt trả một phần) thì
 * khoản hoàn phải thành dòng PENDING chờ chuyển tay và admin phải được báo (OPS_REFUND_ALERT) đúng một lần mỗi admin.
 */
describe('Hoàn tiền cho tài khoản đã xoá: khoản chờ chuyển tay + báo admin (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let orderStatus: OrderStatusService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrdersService,
        OrderReturnsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify } },
        { provide: CartService, useValue: {} },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    orderStatus = moduleRef.get(OrderStatusService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  async function walletOrder() {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-del-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 89_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: 89_000, stock: 40 },
    });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      subtotal: 267_000,
      shippingFee: 15_000,
      total: 282_000,
      deliveredAt: new Date(),
      items: { create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: 89_000, quantity: 3, total: 267_000 }] },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { user, order, item };
  }

  /** Cùng dấu vết với AccountDeletionService.anonymize: cờ metadata, khoá tài khoản, xoá SĐT, đổi tên. */
  const anonymize = (userId: string) =>
    prisma.user.update({
      where: { id: userId },
      data: { fullName: 'Người dùng đã xoá', phone: null, isBlocked: true, metadata: { anonymizedAt: new Date().toISOString(), deletionRequestId: 'it' } },
    });

  async function expectAdminsToldOnce(orderCode: string) {
    const calls = notify.mock.calls.filter((c) => c[1] === 'OPS_REFUND_ALERT' && (c[2] as { order_code?: string }).order_code === orderCode);
    const recipients = calls.map((c) => c[0] as string);
    expect(recipients.length).toBeGreaterThan(0);
    expect(new Set(recipients).size).toBe(recipients.length);
    const admins = await prisma.user.count({ where: { role: 'ADMIN', isBlocked: false } });
    expect(recipients.length).toBe(Math.min(20, admins));
    expect((calls[0]![2] as { message: string }).message).toContain('Tài khoản đã xoá, không còn thông tin liên hệ');
  }

  it.each(['ADMIN', 'PANCAKE'] as const)('%s chuyển đơn đã giao sang RETURNED sau khi khách xoá tài khoản → khoản PENDING chờ chuyển tay, Ví 0, admin được báo đúng một lần', async (actorType) => {
    await createUser(prisma, { role: 'ADMIN' });
    const { user, order } = await walletOrder();
    await anonymize(user.id);

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType });

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'MANUAL_TRANSFER', status: 'PENDING', amount: 282_000, customerUserId: null, reason: 'RETURNED' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).walletBalance).toBe(0);
    await expectAdminsToldOnce(order.code);
  });

  it('duyệt trả một phần sau khi khách xoá tài khoản → khoản PENDING chờ chuyển tay, Ví 0, admin được báo đúng một lần', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { user, order, item } = await walletOrder();
    const req = await returns.request(user.id, order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng chai này',
      items: [{ orderItemId: item.id, quantity: 1 }],
    });
    await anonymize(user.id);

    await returns.review(adminUser.id, req.id, { approve: true, expectedRefund: 89_000 });

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'MANUAL_TRANSFER', status: 'PENDING', amount: 89_000, customerUserId: null, kind: 'RETURN', refKey: req.id });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).walletBalance).toBe(0);
    await expectAdminsToldOnce(order.code);
  });
});
