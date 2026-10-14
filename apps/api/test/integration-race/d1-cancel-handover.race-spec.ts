import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { CancelAfterHandoverError } from '../../src/modules/orders/order-transition';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * D1 trên Postgres THẬT: người vận hành (admin/CSKH/kho) không huỷ + hoàn Ví được đơn đã bàn giao vận chuyển, kể cả khi
 * Pancake gán mã vận đơn / chuyển SHIPPING chen giữa lúc setStatus đọc đơn và lúc lật CANCELLED. Lỗi cũ (R2-ADMINOPS-1):
 * đơn SHIPPING có mã BEX vẫn huỷ được và Ví khách được cộng lại tổng tiền trong khi hàng đang ở hãng vận chuyển.
 */
describe('D1 — không huỷ/hoàn tiền sau bàn giao vận chuyển (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let status: OrderStatusService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        {
          provide: AffiliateService,
          useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined), lockCommissionsForOrder: jest.fn() },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    status = moduleRef.get(OrderStatusService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function paidWalletOrder(overrides: Record<string, unknown> = {}, total = 300_000) {
    const user = await createUser(prisma, { walletBalance: 1_000_000 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PACKED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      total,
      subtotal: total,
      ...overrides,
    });
    return { user, order };
  }

  const walletOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;

  it('(a) đơn đang giao có mã vận đơn → admin huỷ bị từ chối, Ví không đổi, đơn vẫn PAID', async () => {
    const { user, order } = await paidWalletOrder({ status: 'SHIPPING', shippingCode: 'BEX100600777', shippingPartner: 'BestExpress' });
    const admin = await createUser(prisma, { role: 'ADMIN' });

    await expect(status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN', actorId: admin.id })).rejects.toBeInstanceOf(
      CancelAfterHandoverError,
    );

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('SHIPPING');
    expect(after.paymentStatus).toBe('PAID');
    expect(await walletOf(user.id)).toBe(1_000_000);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('(b) Pancake gán mã vận đơn chen giữa lúc đọc và lúc lật → lần huỷ trượt + báo lỗi bàn giao, không hoàn tiền', async () => {
    const { user, order } = await paidWalletOrder();
    const original = prisma.order.findFirst.bind(prisma.order);
    const spy = jest.spyOn(prisma.order, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const snap = await original(args);
      await prisma.order.update({ where: { id: order.id }, data: { shippingCode: 'GHN777888', shippingPartner: 'GHN' } });
      return snap;
    }) as never);
    try {
      await expect(status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' })).rejects.toBeInstanceOf(CancelAfterHandoverError);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PACKED');
    expect(after.paymentStatus).toBe('PAID');
    expect(await walletOf(user.id)).toBe(1_000_000);
  });

  it('(c) 10 đơn: admin huỷ và Pancake báo "Đã gửi hàng" kèm mã vận đơn ĐỒNG THỜI → không đơn nào vừa có mã vận đơn vừa được hoàn tiền', async () => {
    const N = 10;
    const fixtures = await Promise.all(Array.from({ length: N }, (_, i) => paidWalletOrder({}, 100_000 + i * 1_000)));
    const results = await Promise.allSettled(
      fixtures.flatMap(({ order }, i) => [
        status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' }),
        status.setStatus(order.id, 'SHIPPING', {
          actorType: 'PANCAKE',
          patch: { shippingCode: `BEX${i}`, shippingPartner: 'BestExpress' },
        }),
      ]),
    );
    const { errors } = summarize(results);
    for (const e of errors) expect(e).toMatch(/CancelAfterHandoverError|Không thể chuyển đơn/);

    for (const { user, order } of fixtures) {
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const wallet = await walletOf(user.id);
      if (after.status === 'CANCELLED') {
        expect(after.shippingCode).toBeNull();
        expect(after.paymentStatus).toBe('REFUNDED');
        expect(wallet).toBe(1_000_000 + order.total);
      } else {
        expect(after.status).toBe('SHIPPING');
        expect(after.paymentStatus).toBe('PAID');
        expect(wallet).toBe(1_000_000);
      }
    }
  });

  it('(d) đơn thu gom: Gomdon báo bưu tá đã lấy hàng chen giữa → admin huỷ trượt, không hoàn tiền', async () => {
    const { user, order } = await paidWalletOrder({
      status: 'CONFIRMED',
      hasRecyclingPickup: true,
      gomdonOrderId: '9005',
      gomdonPartnerCode: 'BEX9005',
      gomdonStatus: '1',
      shippingCode: 'BEX9005',
      shippingPartner: 'BestExpress',
    });
    const original = prisma.order.findFirst.bind(prisma.order);
    const spy = jest.spyOn(prisma.order, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const snap = await original(args);
      await prisma.order.update({ where: { id: order.id }, data: { gomdonStatus: '3' } });
      return snap;
    }) as never);
    try {
      await expect(status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' })).rejects.toThrow(/bưu tá Gomdon\/BestExpress đã lấy hàng/);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CONFIRMED');
    expect(await walletOf(user.id)).toBe(1_000_000);
  });
});
