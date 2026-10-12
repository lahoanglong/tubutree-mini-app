import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 864e5;
const REVIEW_POINTS = 5;

/**
 * PF-3 mục 2: xoá đánh giá đã thưởng mà khách đã tiêu hết điểm không được đẩy pointsBalance xuống dưới 0. ReviewsService.remove
 * thu hồi tối đa phần còn lại của lô REVIEW theo sổ lô và không quá số dư; phần không thu hồi được ghi rõ ở dòng
 * REVIEW_DELETE (delta 0 hoặc nhỏ hơn điểm đã thưởng). Các bất biến của PE-3 (REVIEW_DELETE ăn đúng lô REVIEW, không trừ hai
 * lần khi lô đã hết hạn) nằm ở pe3-reward-expiry.race-spec.ts và được chạy lại cùng gói này.
 *
 * "Thời gian trôi" dựng bằng lùi createdAt/expiresAt trong sổ như pe3-reward-expiry.
 */
describe('xoá đánh giá đã thưởng không đẩy số dư xuống âm (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewsService;
  let loyalty: LoyaltyService;
  let expiry: LoyaltyExpiryService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        LoyaltyService,
        LoyaltyExpiryService,
        ReviewsService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    reviews = moduleRef.get(ReviewsService);
    loyalty = moduleRef.get(LoyaltyService);
    expiry = moduleRef.get(LoyaltyExpiryService);
    await warmPool(prisma);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** User đã có đơn DELIVERED chứa một sản phẩm (đủ điều kiện đánh giá). */
  async function player() {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `it-pf3-p-${tag}`, brand: 'IT', slug: `it-pf3-${tag.toLowerCase()}`, name: `SP PF3 ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-pf3-v-${tag}`, productId: p.id, sku: `PF3-${tag}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 100_000, stock: 9 },
    });
    const user = await createUser(prisma);
    touched.push(user.id);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      items: { create: [{ variationId: v.id, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
    });
    return { user, product: p, order };
  }

  /** Lô thưởng cũ không hạn: dòng sổ cộng số dư, khớp sổ. */
  async function legacyUnlimited(userId: string, points: number) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: points, lot: 'STANDARD', reason: 'IT_LEGACY_UNLIMITED', refType: 'GAME', createdAt: new Date(Date.now() - 400 * DAY), expiresAt: null },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: points } } }),
    ]);
  }

  /** Tiêu điểm thẳng trên sổ (dòng âm lô STANDARD + trừ số dư), như đổi quà hay góp quỹ. */
  async function spend(userId: string, points: number) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({ data: { userId, delta: -points, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' } }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { decrement: points } } }),
    ]);
  }

  /** Lô thưởng game không hạn với createdAt do test đặt (để thứ tự lô trong sổ cố định). */
  async function gameLot(userId: string, points: number, createdAt: Date) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: points, lot: 'STANDARD', reason: 'GAME_SPIN_WIN', refType: 'GAME', createdAt, expiresAt: null },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: points } } }),
    ]);
  }

  /** Lùi createdAt của dòng thưởng đánh giá `days` ngày: đẩy lô đánh giá về trước trong thứ tự FIFO. */
  async function backdateReviewReward(userId: string, days: number) {
    await prisma.$executeRaw`
      UPDATE "points_transactions"
         SET "createdAt" = "createdAt" - (${days}::int * interval '1 day')
       WHERE "userId" = ${userId} AND "reason" LIKE 'REVIEW:%'`;
  }

  const VIDEO = 'https://res.cloudinary.com/x/video/upload/v1/rv.mp4';
  const VIDEO_POINTS = 15;

  /** Đơn COD đang xử lý dùng `points` Điểm Xanh, ghi sổ như CheckoutService (dòng ORDER_REDEEM + trừ số dư). */
  async function codOrderSpending(userId: string, points: number) {
    const order = await createOrder(prisma, { userId, status: 'CONFIRMED', pointsUsed: points });
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: -points, lot: 'STANDARD', reason: `ORDER_REDEEM:${order.code}`, refType: 'ORDER', refId: order.id },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { decrement: points } } }),
    ]);
    return order;
  }
  const rewardRows = (userId: string) => rowsOf(userId, 'REVIEW:');

  async function ageLedger(userId: string, months: number) {
    await prisma.$executeRaw`
      UPDATE "points_transactions"
         SET "createdAt" = "createdAt" - (${months}::int * interval '1 month'),
             "expiresAt" = "expiresAt" - (${months}::int * interval '1 month')
       WHERE "userId" = ${userId}`;
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const standardSum = async (userId: string) =>
    (await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } }))._sum.delta ?? 0;
  const rowsOf = (userId: string, prefix: string) =>
    prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: prefix } }, orderBy: { createdAt: 'asc' } });
  const reviewDeleteRows = (userId: string) => rowsOf(userId, 'REVIEW_DELETE:');
  const expiredRows = (userId: string) => rowsOf(userId, 'POINTS_EXPIRED');

  it('khách đã tiêu hết điểm đánh giá (không còn điểm nào khác) → xoá đánh giá, số dư ở 0 chứ không -5; sổ ghi rõ không thu hồi gì', async () => {
    const { user, product } = await player();
    const review = await reviews.create(user.id, product.slug, { rating: 5 });
    await spend(user.id, REVIEW_POINTS);
    expect(await balance(user.id)).toBe(0);

    await reviews.remove(user.id, 'USER', review.id);

    expect(await balance(user.id)).toBe(0);
    expect((await reviewDeleteRows(user.id)).map((r) => [r.delta, r.refType, r.refId])).toEqual([[0, 'REVIEW', review.id]]);
    expect(await standardSum(user.id)).toBe(0);
  });

  it('đã tiêu một phần điểm đánh giá (còn 3/5) → chỉ thu hồi 3, số dư về 0 chứ không -2', async () => {
    const { user, product } = await player();
    const review = await reviews.create(user.id, product.slug, { rating: 5 });
    await spend(user.id, 2);
    expect(await balance(user.id)).toBe(3);

    await reviews.remove(user.id, 'USER', review.id);

    expect(await balance(user.id)).toBe(0);
    expect((await reviewDeleteRows(user.id)).map((r) => r.delta)).toEqual([-3]);
  });

  it('có lô cũ 30: tiêu 33 ăn lô cũ rồi 3 của lô đánh giá → thu hồi 2 (phần còn lại), số dư 0 chứ không -3', async () => {
    const { user, product } = await player();
    await legacyUnlimited(user.id, 30);
    const review = await reviews.create(user.id, product.slug, { rating: 5 });
    await spend(user.id, 33);
    expect(await balance(user.id)).toBe(2);

    await reviews.remove(user.id, 'USER', review.id);

    expect(await balance(user.id)).toBe(0);
    expect((await reviewDeleteRows(user.id)).map((r) => r.delta)).toEqual([-2]);
  });

  describe('thưởng đánh giá chỉ nhận một lần cho mỗi (khách, sản phẩm) dù xoá rồi tạo lại (Q-30)', () => {
    it('vòng lặp farm: tạo (+15) → tiêu hết bằng đơn COD → xoá → huỷ đơn (hoàn điểm đã dùng) → tạo lại: 3 vòng chỉ nhận thưởng đúng một lần', async () => {
      const { user, product } = await player();
      const earned: number[] = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const review = await reviews.create(user.id, product.slug, { rating: 5, videoUrl: VIDEO });
        earned.push(review.pointsEarned);
        const order = await codOrderSpending(user.id, await balance(user.id));
        expect(await balance(user.id)).toBe(0);
        await reviews.remove(user.id, 'USER', review.id);
        await loyalty.reverseOrderPoints(order.id);
        expect(await balance(user.id)).toBe(VIDEO_POINTS);
      }
      expect(earned).toEqual([VIDEO_POINTS, 0, 0]);
      expect(await rewardRows(user.id)).toHaveLength(1);
      expect(await balance(user.id)).toBe(VIDEO_POINTS);
    });

    it('tiêu hết điểm đánh giá rồi xoá (thu hồi 0) → tạo lại không được thưởng lần hai', async () => {
      const { user, product } = await player();
      const first = await reviews.create(user.id, product.slug, { rating: 5 });
      await codOrderSpending(user.id, REVIEW_POINTS);
      await reviews.remove(user.id, 'USER', first.id);

      const again = await reviews.create(user.id, product.slug, { rating: 4 });

      expect(again).toMatchObject({ updated: false, pointsEarned: 0 });
      expect(await balance(user.id)).toBe(0);
      expect(await rewardRows(user.id)).toHaveLength(1);
      expect(await standardSum(user.id)).toBe(await balance(user.id));
    });

    it('chỉ thu hồi được một phần (đã tiêu 2/5, thu hồi 3) → phần giữ lại là thưởng đã nhận, tạo lại không thưởng thêm', async () => {
      const { user, product } = await player();
      const first = await reviews.create(user.id, product.slug, { rating: 5 });
      await spend(user.id, 2);
      await reviews.remove(user.id, 'USER', first.id);
      expect((await reviewDeleteRows(user.id)).map((r) => r.delta)).toEqual([-3]);

      const again = await reviews.create(user.id, product.slug, { rating: 4 });

      expect(again.pointsEarned).toBe(0);
      expect(await balance(user.id)).toBe(0);
    });

    it('điểm thưởng đã hết hạn và cron đã trừ rồi mới xoá → tạo lại cũng không thưởng lại (thưởng lần đầu đã nhận)', async () => {
      const { user, product } = await player();
      await legacyUnlimited(user.id, 30);
      const first = await reviews.create(user.id, product.slug, { rating: 5 });
      await ageLedger(user.id, 13);
      await expiry.expirePoints();
      await reviews.remove(user.id, 'USER', first.id);

      const again = await reviews.create(user.id, product.slug, { rating: 4 });

      expect(again.pointsEarned).toBe(0);
      expect(await balance(user.id)).toBe(30);
    });

    it('thu hồi đủ rồi tạo lại vẫn được thưởng (đúng một lần thưởng đang giữ): tạo → xoá → tạo lại → xoá về 0', async () => {
      const { user, product } = await player();
      const first = await reviews.create(user.id, product.slug, { rating: 5 });
      await reviews.remove(user.id, 'USER', first.id);
      expect(await balance(user.id)).toBe(0);

      const again = await reviews.create(user.id, product.slug, { rating: 4 });

      expect(again.pointsEarned).toBe(REVIEW_POINTS);
      expect(await balance(user.id)).toBe(REVIEW_POINTS);
      await reviews.remove(user.id, 'USER', again.id);
      expect(await balance(user.id)).toBe(0);
    });

    it('sản phẩm khác không bị ảnh hưởng: đã tiêu thưởng của sản phẩm A, đánh giá sản phẩm B vẫn được thưởng', async () => {
      const a = await player();
      const second = await prisma.product.create({
        data: { pancakeId: `it-pf3-p2-${randCode(8)}`, brand: 'IT', slug: `it-pf3-b-${randCode(8).toLowerCase()}`, name: 'SP B', description: 'IT', basePrice: 100_000 },
      });
      const variation = await prisma.variation.create({
        data: { pancakeId: `it-pf3-v2-${randCode(8)}`, productId: second.id, sku: `PF3B-${randCode(8)}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 100_000, stock: 9 },
      });
      await createOrder(prisma, {
        userId: a.user.id,
        status: 'DELIVERED',
        items: { create: [{ variationId: variation.id, productName: 'SP B', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
      });
      const first = await reviews.create(a.user.id, a.product.slug, { rating: 5 });
      await codOrderSpending(a.user.id, REVIEW_POINTS);
      await reviews.remove(a.user.id, 'USER', first.id);

      const other = await reviews.create(a.user.id, second.slug, { rating: 5 });

      expect(other.pointsEarned).toBe(REVIEW_POINTS);
      expect(await balance(a.user.id)).toBe(REVIEW_POINTS);
    });
  });

  it('lô đánh giá là lô CŨ NHẤT, khách tiêu điểm từ lô thưởng game ăn vào nó theo FIFO → vẫn thu hồi đủ phần số dư còn có', async () => {
    const { user, product } = await player();
    const review = await reviews.create(user.id, product.slug, { rating: 5 });
    await backdateReviewReward(user.id, 2);
    await gameLot(user.id, 40, new Date(Date.now() - 1 * DAY));
    await spend(user.id, 40); // FIFO ăn lô đánh giá 5 rồi 35 của lô game: số dư 5 nằm ở lô game
    expect(await balance(user.id)).toBe(5);

    await reviews.remove(user.id, 'USER', review.id);

    expect((await reviewDeleteRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);
    expect(await balance(user.id)).toBe(0);
    expect(await standardSum(user.id)).toBe(0);
  });

  it('thu hồi một phần rồi qua hạn: cron không trừ gì thêm, số dư không âm', async () => {
    const { user, product } = await player();
    await legacyUnlimited(user.id, 30);
    const review = await reviews.create(user.id, product.slug, { rating: 5 });
    await spend(user.id, 33);
    await reviews.remove(user.id, 'USER', review.id);

    await ageLedger(user.id, 13);
    await expiry.expirePoints();
    await expiry.expirePoints();

    expect(await expiredRows(user.id)).toHaveLength(0);
    expect(await balance(user.id)).toBe(0);
  });

  it('điểm đánh giá còn nguyên: thu hồi đủ 5, chống tạo → xoá → tạo lại để farm điểm vẫn giữ', async () => {
    const { user, product } = await player();
    await legacyUnlimited(user.id, 30);
    const review = await reviews.create(user.id, product.slug, { rating: 5 });
    expect(await balance(user.id)).toBe(35);

    await reviews.remove(user.id, 'USER', review.id);

    expect(await balance(user.id)).toBe(30);
    expect((await reviewDeleteRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);
    const again = await reviews.create(user.id, product.slug, { rating: 4 });
    await reviews.remove(user.id, 'USER', again.id);
    expect(await balance(user.id)).toBe(30);
  });

  it('điểm đã quá hạn và cron đã trừ, khách còn điểm khác: không thu hồi lần hai (bất biến PE-3), dòng REVIEW_DELETE không có', async () => {
    const { user, product } = await player();
    await legacyUnlimited(user.id, 30);
    const review = await reviews.create(user.id, product.slug, { rating: 5 });
    await ageLedger(user.id, 13);
    await expiry.expirePoints();
    expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);

    await reviews.remove(user.id, 'ADMIN', review.id);

    expect(await reviewDeleteRows(user.id)).toHaveLength(0);
    expect(await balance(user.id)).toBe(30);
  });
});
