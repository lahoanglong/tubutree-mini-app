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
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * Q8 review vòng 3 S1 trên Postgres thật: đơn dùng 50 Điểm Xanh (46 điểm lô quy đổi), 5 dòng, trả lần lượt 4 dòng rồi trả nốt.
 * Mỗi lần trả một phần kẹp phần quy đổi theo số điểm trả lần đó, nên có lần trả nhiều điểm thường hơn phần thường của đơn;
 * lần đảo cả đơn trước đây vẫn trả đủ phần quy đổi còn lại và khách nhận 51 điểm. Nay lần cuối chỉ trả phần còn lại của 50.
 */
describe('Trả hàng nhiều lần không trả quá số Điểm Xanh đã dùng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;

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
        CustomerRefundsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: CartService, useValue: {} },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'returns.window_days', 7);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('50 điểm (46 quy đổi), 5 dòng, trả L3, L4, L2, L5 rồi trả nốt L1 → khách nhận lại đúng 50 điểm, lô quy đổi không quá 46', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, pointsBalance: 0, pointsConvertedBalance: 0 });
    const prices = [40_000, 20_000, 90_000, 300_000, 230_000];
    const variations = await Promise.all(
      prices.map(async (price) => {
        const tag = randCode(8);
        const product = await prisma.product.create({
          data: { pancakeId: `itrp-p-${tag}`, brand: 'IT', slug: `itrp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
        });
        return prisma.variation.create({
          data: { pancakeId: `itrp-v-${tag}`, productId: product.id, sku: `ITRP-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock: 10 },
        });
      }),
    );
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 680_000,
      discount: 50_000,
      pointsDiscount: 50_000,
      pointsUsed: 50,
      pointsUsedConverted: 46,
      shippingFee: 0,
      total: 630_000,
      items: {
        create: variations.map((v, k) => ({ variationId: v.id, productName: `L${k + 1}`, variationName: 'Mặc định', unitPrice: prices[k]!, quantity: 1, total: prices[k]! })),
      },
    });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    const itemOf = (name: string) => items.find((i) => i.productName === name)!;

    for (const name of ['L3', 'L4', 'L2', 'L5', 'L1']) {
      const req = await returns.request(user.id, order.code, { reasonCode: 'OTHER', reason: `Trả ${name}`, items: [{ orderItemId: itemOf(name).id, quantity: 1 }] });
      const preview = await returns.preview(req.id);
      await returns.review(admin.id, req.id, { approve: true, expectedRefund: preview.refund });
    }

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RETURNED');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsBalance + after.pointsConvertedBalance).toBe(50);
    expect(after.pointsConvertedBalance).toBeLessThanOrEqual(46);
    expect(after.walletBalance).toBe(630_000);
  });
});
