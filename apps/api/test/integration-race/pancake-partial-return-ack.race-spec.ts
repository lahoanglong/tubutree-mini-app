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
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { createOrder, createUser, randCode, warmPool } from './helpers';

const ACK = 'Pancake đã nhận phiếu hoàn một phần — đã hoàn trên Tubu';

/**
 * R3-MONEY-2 trên Postgres THẬT: admin duyệt trả một phần đơn Tubu giao (tiền hoàn ngay), hệ thống nhắc tạo phiếu
 * "Hoàn một phần" trên Pancake, kho làm, Pancake báo 15. Lỗi cũ: lời nhắc bị ghi đè thành "hoàn tiền/điểm … bằng tay"
 * (hoàn hai lần) và mất nhắc "Đã nhận hàng về". Stub: thông báo, hoa hồng, flash-sale, coupon, báo động admin.
 */
describe('Pancake "Hoàn một phần" (15) cho đơn đã duyệt trả trên Tubu (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let proc: { onStatusUpdated(d: Record<string, unknown>): Promise<void> };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };

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
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    proc = new PancakeProcessor(
      prisma,
      moduleRef.get(NotificationsService),
      moduleRef.get(OrderStatusService),
      alerts as never,
    ) as unknown as typeof proc;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => alerts.alert.mockClear());

  /** Đơn Ví đã giao qua kho Tubu (Pancake): 3 chai × 38.000 = 114.000, không phí ship; khách trả 1 chai lỗi shop. */
  async function approvedPartialReturn() {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-r5-${tag.toLowerCase()}`, name: `DRIP ${tag}`, description: 'IT', basePrice: 38_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: 38_000, stock: 10 },
    });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      subtotal: 114_000,
      shippingFee: 0,
      total: 114_000,
      deliveredAt: new Date(),
      pancakeOrderId: `pk-${tag}`,
      items: { create: [{ variationId: v.id, productName: 'DRIP', variationName: 'Chai', unitPrice: 38_000, quantity: 3, total: 114_000 }] },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const req = await returns.request(user.id, order.code, {
      reasonCode: 'DEFECTIVE',
      reason: 'Chai bị rò rỉ',
      items: [{ orderItemId: item.id, quantity: 1 }],
    });
    await returns.review(admin.id, req.id, { approve: true });
    return { admin, user, v, order, req };
  }

  const orderRow = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const walletOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;
  const stockOf = async (id: string) => (await prisma.variation.findUniqueOrThrow({ where: { id } })).stock;

  it('(a) Pancake báo 15 → "đã hoàn trên Tubu", không bảo hoàn tay, giữ nhắc "Đã nhận hàng về"; bấm nhận hàng → cộng kho, gỡ việc', async () => {
    const { admin, user, v, order, req } = await approvedPartialReturn();
    const refunded = await walletOf(user.id);
    expect(refunded).toBe(38_000);
    expect((await orderRow(order.id)).pancakeAttention).toMatch(/^Khách trả một phần đơn/);

    await proc.onStatusUpdated({ id: order.pancakeOrderId, status: 15 });
    await proc.onStatusUpdated({ id: order.pancakeOrderId, status: 15 });

    const flagged = await orderRow(order.id);
    expect(flagged.status).toBe('DELIVERED');
    expect(flagged.pancakeAttention).toMatch(new RegExp(`^${ACK}`));
    expect(flagged.pancakeAttention).toContain('Đã nhận hàng về');
    expect(flagged.pancakeAttention).not.toContain('bằng tay');
    expect(alerts.alert).not.toHaveBeenCalled();
    expect(await walletOf(user.id)).toBe(refunded);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, note: { startsWith: ACK } } })).toBe(1);

    const stock0 = await stockOf(v.id);
    await returns.markReceived(admin.id, req.id);
    expect(await stockOf(v.id)).toBe(stock0 + 1);
    expect((await orderRow(order.id)).pancakeAttention).toBeNull();
  });

  it('(b) Pancake báo 15 SONG SONG với admin bấm "Đã nhận hàng về" (10 đơn) → không đơn nào kẹt lại lời nhắc nhận hàng đã nhận', async () => {
    const fixtures = await Promise.all(Array.from({ length: 10 }, () => approvedPartialReturn()));
    await Promise.all(
      fixtures.flatMap(({ admin, order, req }) => [
        proc.onStatusUpdated({ id: order.pancakeOrderId, status: 15 }),
        returns.markReceived(admin.id, req.id),
      ]),
    );
    for (const { user, order } of fixtures) {
      const after = await orderRow(order.id);
      expect(after.pancakeAttention ?? '').not.toContain('bấm "Đã nhận hàng về"');
      expect(after.pancakeAttention ?? '').not.toContain('bằng tay');
      expect(await walletOf(user.id)).toBe(38_000);
    }
  });

  it('(c) đơn không có yêu cầu trả nào trên Tubu → lời cũ: kiểm tra hàng, hoàn tay phần bị trả', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'DELIVERED', pancakeOrderId: `pk-${randCode(8)}` });
    await proc.onStatusUpdated({ id: order.pancakeOrderId, status: 15 });
    expect((await orderRow(order.id)).pancakeAttention).toContain('hoàn tiền/điểm cho phần bị trả bằng tay');
    expect(alerts.alert).toHaveBeenCalledTimes(1);
  });
});
