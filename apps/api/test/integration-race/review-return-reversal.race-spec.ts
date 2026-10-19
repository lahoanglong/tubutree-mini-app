import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const UNIT = 100_000;
const PHOTO = ['https://res.cloudinary.com/it/review.jpg'];
const REWARD = 10_000;

/**
 * Điểm thưởng đánh giá được cấp ngay khi đơn giao, nên đơn trả (cả đơn hay đúng sản phẩm đã đánh giá) phải thu hồi đúng
 * khoản thưởng của dòng bị trả, một lần, không quá số dư. Chạy ReviewsService, OrderReturnsService và OrderReversalService thật.
 */
describe('Trả hàng thu hồi điểm thưởng đánh giá (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewsService;
  let returns: OrderReturnsService;
  let admin: { id: string };
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        LoyaltyService,
        ReviewsService,
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
    reviews = moduleRef.get(ReviewsService);
    returns = moduleRef.get(OrderReturnsService);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    admin = await createUser(prisma, { role: 'ADMIN' });
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function product(tag: string) {
    const p = await prisma.product.create({
      data: { pancakeId: `it-rr-p-${tag}`, brand: 'IT', slug: `it-rr-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-rr-v-${tag}`, productId: p.id, sku: `RR-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 20 },
    });
    return { p, v };
  }

  /** Khách đã đánh giá có ảnh sản phẩm của đơn COD đã giao: A mua 2 chai, B mua 1 chai; điểm thưởng 10.000 mỗi đánh giá (B bỏ qua nếu reviewB=false). */
  async function setup(opts: { reviewB?: boolean } = {}) {
    const user = await createUser(prisma);
    touched.push(user.id);
    const tag = randCode(8);
    const a = await product(`${tag}A`);
    const b = await product(`${tag}B`);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 3 * UNIT,
      shippingFee: 0,
      total: 3 * UNIT,
      deliveredAt: new Date(),
      items: {
        create: [
          { variationId: a.v.id, productName: 'A', variationName: 'Chai', unitPrice: UNIT, quantity: 2, total: 2 * UNIT, paidTotal: 2 * UNIT },
          { variationId: b.v.id, productName: 'B', variationName: 'Chai', unitPrice: UNIT, quantity: 1, total: UNIT, paidTotal: UNIT },
        ],
      },
    });
    const itemA = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id, variationId: a.v.id } });
    const itemB = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id, variationId: b.v.id } });
    const ra = await reviews.create(user.id, a.p.slug, { rating: 5, comment: 'tốt', images: PHOTO, orderId: order.id });
    const rb = opts.reviewB === false ? null : await reviews.create(user.id, b.p.slug, { rating: 5, comment: 'ổn', images: PHOTO, orderId: order.id });
    return { user, order, a, b, itemA, itemB, reviewA: ra.id, reviewB: rb?.id ?? '' };
  }

  async function returnLines(userId: string, code: string, lines: { orderItemId: string; quantity: number }[]) {
    const req = await returns.request(userId, code, { reasonCode: 'OTHER', reason: 'Không còn nhu cầu dùng nữa', items: lines });
    await returns.review(admin.id, req.id, { approve: true });
    return req.id;
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const returnRows = (userId: string) =>
    prisma.pointsTransaction.findMany({
      where: { userId, reason: { startsWith: 'REVIEW_RETURN:' } },
      select: { delta: true, reason: true, refType: true, refId: true },
      orderBy: { reason: 'asc' },
    });

  it('đánh giá có ảnh rồi trả cả đơn: số dư về 0 và có dòng thu hồi của từng đánh giá', async () => {
    const s = await setup();
    expect(await balance(s.user.id)).toBe(2 * REWARD);

    await returnLines(s.user.id, s.order.code, [
      { orderItemId: s.itemA.id, quantity: 2 },
      { orderItemId: s.itemB.id, quantity: 1 },
    ]);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('RETURNED');
    expect(await balance(s.user.id)).toBe(0);
    expect(await returnRows(s.user.id)).toEqual(
      [s.reviewA, s.reviewB].sort().map((id) => ({ delta: -REWARD, reason: `REVIEW_RETURN:${id}`, refType: 'REVIEW', refId: id })),
    );
  });

  it('trả một phần đúng sản phẩm đã đánh giá: chỉ thu hồi thưởng của sản phẩm đó', async () => {
    const s = await setup();
    await returnLines(s.user.id, s.order.code, [{ orderItemId: s.itemA.id, quantity: 1 }]);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('DELIVERED');
    expect(await balance(s.user.id)).toBe(REWARD);
    expect((await returnRows(s.user.id)).map((r) => r.refId)).toEqual([s.reviewA]);
  });

  it('trả sản phẩm khác sản phẩm đã đánh giá: không thu hồi thưởng của đánh giá', async () => {
    const s = await setup({ reviewB: false });
    expect(await balance(s.user.id)).toBe(REWARD);

    await returnLines(s.user.id, s.order.code, [{ orderItemId: s.itemB.id, quantity: 1 }]);

    expect(await balance(s.user.id)).toBe(REWARD);
    expect(await returnRows(s.user.id)).toEqual([]);
  });

  it('trả hai lần cùng sản phẩm rồi trả nốt cả đơn: mỗi đánh giá chỉ bị thu hồi một lần', async () => {
    const s = await setup();
    await returnLines(s.user.id, s.order.code, [{ orderItemId: s.itemA.id, quantity: 1 }]);
    await returnLines(s.user.id, s.order.code, [{ orderItemId: s.itemA.id, quantity: 1 }]);
    expect(await balance(s.user.id)).toBe(REWARD);
    expect((await returnRows(s.user.id)).map((r) => r.refId)).toEqual([s.reviewA]);

    await returnLines(s.user.id, s.order.code, [{ orderItemId: s.itemB.id, quantity: 1 }]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('RETURNED');
    expect(await balance(s.user.id)).toBe(0);
    expect(await returnRows(s.user.id)).toHaveLength(2);
  });

  it('khoá unique chặn dòng thu hồi thứ hai của cùng đánh giá', async () => {
    const s = await setup();
    await returnLines(s.user.id, s.order.code, [{ orderItemId: s.itemA.id, quantity: 1 }]);
    await expect(
      prisma.pointsTransaction.create({
        data: { userId: s.user.id, delta: -1, reason: `REVIEW_RETURN:${s.reviewA}`, refType: 'REVIEW', refId: s.reviewA },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('khách đã tiêu bớt điểm: thu hồi tối đa số dư, không âm', async () => {
    const s = await setup();
    await prisma.$transaction([
      prisma.pointsTransaction.create({ data: { userId: s.user.id, delta: -15_000, reason: 'IT_SPEND', refType: 'GAME' } }),
      prisma.user.update({ where: { id: s.user.id }, data: { pointsBalance: { decrement: 15_000 } } }),
    ]);
    expect(await balance(s.user.id)).toBe(5_000);

    await returnLines(s.user.id, s.order.code, [
      { orderItemId: s.itemA.id, quantity: 2 },
      { orderItemId: s.itemB.id, quantity: 1 },
    ]);

    expect(await balance(s.user.id)).toBe(0);
    const taken = (await returnRows(s.user.id)).reduce((sum, r) => sum + r.delta, 0);
    expect(taken).toBe(-5_000);
  });

  it('xoá đánh giá sau khi thưởng đã bị thu hồi vì trả hàng: không trừ lần hai', async () => {
    const s = await setup();
    await returnLines(s.user.id, s.order.code, [{ orderItemId: s.itemA.id, quantity: 1 }]);
    expect(await balance(s.user.id)).toBe(REWARD);

    await reviews.remove(s.user.id, 'USER', s.reviewA);

    expect(await balance(s.user.id)).toBe(REWARD);
    expect(await prisma.pointsTransaction.count({ where: { userId: s.user.id, reason: `REVIEW_DELETE:${s.a.p.id}` } })).toBe(0);
  });

  it('đảo đơn chạy song song với xoá đánh giá: tổng điểm bị trừ đúng một lần, không âm, không deadlock', async () => {
    for (let round = 0; round < 4; round++) {
      const s = await setup();
      const results = await Promise.allSettled([
        returnLines(s.user.id, s.order.code, [
          { orderItemId: s.itemA.id, quantity: 2 },
          { orderItemId: s.itemB.id, quantity: 1 },
        ]),
        reviews.remove(s.user.id, 'USER', s.reviewA),
        reviews.remove(s.user.id, 'USER', s.reviewB),
      ]);
      const sum = summarize(results);
      expect(sum.errors).toEqual([]);
      expect(await balance(s.user.id)).toBe(0);
      const reviewDeduct = await prisma.pointsTransaction.aggregate({
        where: { userId: s.user.id, reason: { startsWith: 'REVIEW_DELETE:' } },
        _sum: { delta: true },
      });
      const returnDeduct = (await returnRows(s.user.id)).reduce((acc, r) => acc + r.delta, 0);
      expect((reviewDeduct._sum.delta ?? 0) + returnDeduct).toBe(-2 * REWARD);
    }
  });
});
