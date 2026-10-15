import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 864e5;
const UNIT = 100_000;

/**
 * Trả MỘT PHẦN thu điểm tích của phần trả tối đa bằng phần lô ORDER_DELIVERED của đơn còn thu hồi được (lotRecoverable),
 * như lần đảo cả đơn: lô đơn đã hết hạn và cron đã trừ thì không trừ thêm vào điểm của lô khác. Chạy OrderReturnsService,
 * OrderReversalService, LoyaltyService và cron hết hạn thật trên Postgres.
 */
describe('trả một phần không thu điểm tích đã hết hạn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let expiry: LoyaltyExpiryService;
  let returns: OrderReturnsService;
  let admin: { id: string };
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        LoyaltyExpiryService,
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
    loyalty = moduleRef.get(LoyaltyService);
    expiry = moduleRef.get(LoyaltyExpiryService);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'returns.window_days', 30);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    admin = await createUser(prisma, { role: 'ADMIN' });
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Khách có lô cũ 100 điểm không hạn và đơn COD đã giao 2 × 100.000, tích 20 điểm (có hạn 12 tháng). */
  async function setup() {
    const user = await createUser(prisma);
    touched.push(user.id);
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId: user.id, delta: 100, lot: 'STANDARD', reason: 'IT_OLD_LOT', refType: 'GAME', createdAt: new Date(Date.now() - 400 * DAY) },
      }),
      prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: 100 } } }),
    ]);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-g3-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 10 },
    });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 2 * UNIT,
      shippingFee: 0,
      total: 2 * UNIT,
      pointsEarned: 20,
      deliveredAt: new Date(),
      items: {
        create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: 2, total: 2 * UNIT, paidTotal: 2 * UNIT }],
      },
    });
    await loyalty.creditOrderPoints(order.id);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { user, order, item };
  }

  async function returnUnits(userId: string, code: string, orderItemId: string, quantity: number) {
    const req = await returns.request(userId, code, { reasonCode: 'OTHER', reason: 'Không còn nhu cầu dùng nữa', items: [{ orderItemId, quantity }] });
    await returns.review(admin.id, req.id, { approve: true });
    return req.id;
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const rows = (userId: string, prefix: string) =>
    prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: prefix } }, select: { delta: true } });

  it('lô đơn đã hết hạn và cron đã trừ 20: trả một nửa không trừ thêm (còn 100, không phải 90); trả nốt cũng không trừ', async () => {
    const { user, order, item } = await setup();
    expect(await balance(user.id)).toBe(120);
    // Lô đơn quá hạn: lùi mốc hạn của dòng ORDER_DELIVERED rồi cho cron chạy.
    await prisma.pointsTransaction.updateMany({
      where: { userId: user.id, reason: `ORDER_DELIVERED:${order.code}` },
      data: { expiresAt: new Date(Date.now() - DAY) },
    });
    await expiry.expirePoints();
    expect((await rows(user.id, 'POINTS_EXPIRED')).map((r) => r.delta)).toEqual([-20]);
    expect(await balance(user.id)).toBe(100);

    const reqId = await returnUnits(user.id, order.code, item.id, 1);
    expect(await balance(user.id)).toBe(100);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: reqId } })).pointsReversed).toBe(10);

    await returnUnits(user.id, order.code, item.id, 1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RETURNED');
    await loyalty.reverseOrderPoints(order.id);
    expect(await balance(user.id)).toBe(100);
    await expiry.expirePoints();
    expect(await balance(user.id)).toBe(100);
  });

  it('lô đơn chưa hết hạn: trả một nửa thu 10, trả nốt thu 10 như cũ', async () => {
    const { user, order, item } = await setup();
    await returnUnits(user.id, order.code, item.id, 1);
    expect((await rows(user.id, 'RETURN_REVERSED:')).map((r) => r.delta)).toEqual([-10]);
    expect(await balance(user.id)).toBe(110);
    await returnUnits(user.id, order.code, item.id, 1);
    await loyalty.reverseOrderPoints(order.id);
    expect((await rows(user.id, 'ORDER_REVERSED:')).map((r) => r.delta)).toEqual([-10]);
    expect(await balance(user.id)).toBe(100);
  });
});
