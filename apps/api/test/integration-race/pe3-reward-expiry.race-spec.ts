import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { GameService } from '../../src/modules/game/game.service';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const DAY = 864e5;
const SPIN_COST = 10_000;
const SPIN_WIN = 25_000;
const MISSION_POINTS = 20_000;
const REVIEW_POINTS = 5_000;

/**
 * PE-3 (OQ-1): thưởng vòng quay (GAME_SPIN_WIN), nhiệm vụ Vườn Xanh (MISSION) và điểm đánh giá (REVIEW) là Điểm Xanh
 * lô STANDARD hết hạn sau loyalty.point_expire_months tháng, dùng đúng helper của điểm danh và điểm hoàn.
 * Bản thật của GameService, ReviewsService, LoyaltyService và cron hết hạn chạy trên Postgres thật.
 *
 * "Thời gian trôi" được dựng bằng cách lùi mọi mốc createdAt/expiresAt của user trong sổ điểm đi N tháng (xem
 * ageLedger), rồi chạy cron ở giờ thật. Không giả đồng hồ JS vì createdAt của dòng do cron ghi được gán bởi
 * query engine theo giờ máy thật, giả Date ở JS sẽ làm lệch đúng điều mà replay của cron dựa vào.
 */
describe('thưởng game/đánh giá có hạn, cron hết hạn nhất quán với lô không hạn cũ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  let reviews: ReviewsService;
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
        GameService,
        ReviewsService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    game = moduleRef.get(GameService);
    reviews = moduleRef.get(ReviewsService);
    expiry = moduleRef.get(LoyaltyExpiryService);
    await warmPool(prisma);

    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    await setConfig(prisma, 'game.spin_buy_cost_points', SPIN_COST);
    await setConfig(prisma, 'game.spin_buy_daily_limit', 50);
    await setConfig(prisma, 'game.spin_prizes', [{ id: 'win', name: 'Trúng điểm', weight: 1, rewardType: 'POINTS', value: SPIN_WIN }]);
    await prisma.mission.upsert({
      where: { code: 'FIRST_ORDER' },
      update: { rewardPoints: MISSION_POINTS, goal: 1, isRepeatable: false, rewardCoupon: null },
      create: { id: `it-m-${randCode(6)}`, code: 'FIRST_ORDER', title: 'Đơn đầu', description: 'IT', rewardPoints: MISSION_POINTS, goal: 1, isRepeatable: false },
    });
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** User đã có đơn CONFIRMED (đủ điều kiện nhiệm vụ FIRST_ORDER) và đơn DELIVERED chứa một sản phẩm (đủ điều kiện đánh giá). */
  async function player() {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `it-pe3-p-${tag}`, brand: 'IT', slug: `it-pe3-${tag.toLowerCase()}`, name: `SP PE3 ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-pe3-v-${tag}`, productId: p.id, sku: `PE3-${tag}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 100_000, stock: 9 },
    });
    const user = await createUser(prisma);
    touched.push(user.id);
    // Giao từ 30 ngày trước: qua hạn đổi/trả nên nhiệm vụ FIRST_ORDER tính đơn này.
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      deliveredAt: new Date(Date.now() - 30 * DAY),
      items: { create: [{ variationId: v.id, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
    });
    return { user, product: p, order };
  }

  /** Lô thưởng cũ không hạn (điểm trước PE-3): dòng sổ cộng số dư, khớp sổ. */
  async function legacyUnlimited(userId: string, points: number) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: points, lot: 'STANDARD', reason: 'IT_LEGACY_UNLIMITED', refType: 'GAME', createdAt: new Date(Date.now() - 400 * DAY), expiresAt: null },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: points } } }),
    ]);
  }

  /** Tiêu điểm thẳng trên sổ (dòng âm lô STANDARD + trừ số dư), như một đơn dùng điểm. */
  async function spend(userId: string, points: number) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({ data: { userId, delta: -points, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' } }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { decrement: points } } }),
    ]);
  }

  /** Thời gian trôi N tháng: lùi mọi mốc createdAt/expiresAt của user đi N tháng (NULL giữ NULL). */
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
  const expiredRows = (userId: string) =>
    prisma.pointsTransaction.findMany({ where: { userId, reason: 'POINTS_EXPIRED' }, orderBy: { createdAt: 'asc' } });
  const rowOf = (userId: string, reasonStart: string) =>
    prisma.pointsTransaction.findFirstOrThrow({ where: { userId, reason: { startsWith: reasonStart } } });

  /** expiresAt nằm trong [trước + N tháng, sau + N tháng] tính bằng đúng phép cộng tháng của helper. */
  function expectMonthsAhead(expiresAt: Date | null, before: Date, after: Date, months = 12) {
    expect(expiresAt).toBeInstanceOf(Date);
    const lo = new Date(before);
    lo.setMonth(lo.getMonth() + months);
    const hi = new Date(after);
    hi.setMonth(hi.getMonth() + months);
    expect(expiresAt!.getTime()).toBeGreaterThanOrEqual(lo.getTime());
    expect(expiresAt!.getTime()).toBeLessThanOrEqual(hi.getTime());
  }

  describe('từng nguồn ghi expiresAt ≈ bây giờ + 12 tháng, lô STANDARD, số dư khớp sổ', () => {
    it('vòng quay trúng điểm: GAME_SPIN_WIN có hạn, GAME_SPIN_COST không hạn, đúng số điểm', async () => {
      const { user } = await player();
      await legacyUnlimited(user.id, 100_000);
      const before = new Date();
      await game.spin(user.id);
      const after = new Date();

      const win = await rowOf(user.id, 'GAME_SPIN_WIN:win');
      expect(win).toMatchObject({ delta: SPIN_WIN, lot: 'STANDARD', refType: 'GAME' });
      expectMonthsAhead(win.expiresAt, before, after);
      const cost = await rowOf(user.id, 'GAME_SPIN_COST');
      expect(cost).toMatchObject({ delta: -SPIN_COST, lot: 'STANDARD', expiresAt: null });
      expect(await balance(user.id)).toBe(100_000 - SPIN_COST + SPIN_WIN);
    });

    it('nhận thưởng nhiệm vụ: MISSION:FIRST_ORDER:0 có hạn, đúng số điểm', async () => {
      const { user } = await player();
      const before = new Date();
      await game.claimMission(user.id, 'FIRST_ORDER');
      const after = new Date();

      const row = await rowOf(user.id, 'MISSION:FIRST_ORDER:0');
      expect(row).toMatchObject({ delta: MISSION_POINTS, lot: 'STANDARD', refType: 'GAME' });
      expectMonthsAhead(row.expiresAt, before, after);
      expect(await balance(user.id)).toBe(MISSION_POINTS);
    });

    it('tạo đánh giá: REVIEW:<slug> có hạn, gắn refId = id đánh giá, đúng số điểm', async () => {
      const { user, product } = await player();
      const before = new Date();
      const review = await reviews.create(user.id, product.slug, { rating: 5, comment: 'Tốt' });
      const after = new Date();

      const row = await rowOf(user.id, `REVIEW:${product.slug}`);
      expect(row).toMatchObject({ delta: REVIEW_POINTS, lot: 'STANDARD', refType: 'REVIEW', refId: review.id });
      expectMonthsAhead(row.expiresAt, before, after);
      expect(await balance(user.id)).toBe(REVIEW_POINTS);
    });

    it('sửa đánh giá không thưởng thêm, không thêm dòng điểm nào', async () => {
      const { user, product } = await player();
      await reviews.create(user.id, product.slug, { rating: 5 });
      await reviews.create(user.id, product.slug, { rating: 3, comment: 'đổi ý' });
      expect(await prisma.pointsTransaction.count({ where: { userId: user.id, refType: 'REVIEW' } })).toBe(1);
      expect(await balance(user.id)).toBe(REVIEW_POINTS);
    });

    it('cả ba nguồn: không dòng cộng nào của game/nhiệm vụ/đánh giá còn expiresAt NULL', async () => {
      const { user, product } = await player();
      await legacyUnlimited(user.id, 50_000);
      await game.spin(user.id);
      await game.claimMission(user.id, 'FIRST_ORDER');
      await reviews.create(user.id, product.slug, { rating: 4 });
      const rows = await prisma.pointsTransaction.findMany({
        where: { userId: user.id, delta: { gt: 0 }, OR: [{ reason: { startsWith: 'GAME_SPIN_WIN:' } }, { reason: { startsWith: 'MISSION:' } }, { reason: { startsWith: 'REVIEW:' } }] },
      });
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => r.expiresAt === null)).toEqual([]);
    });
  });

  describe('idempotency và unique giữ nguyên dưới đồng thời', () => {
    it('6 request nhận cùng nhiệm vụ song song → đúng 1 lần cộng, 5 lỗi 400, dòng duy nhất có hạn', async () => {
      const { user } = await player();
      const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => game.claimMission(user.id, 'FIRST_ORDER'))));
      expect(s.fulfilled).toHaveLength(1);
      for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
      const rows = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'MISSION:FIRST_ORDER:0' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.expiresAt).toBeInstanceOf(Date);
      expect(await balance(user.id)).toBe(MISSION_POINTS);
    });

    it('5 request tạo đánh giá song song cùng người + sản phẩm → đúng 1 đánh giá, 1 dòng thưởng có hạn', async () => {
      const { user, product } = await player();
      const s = summarize(await Promise.allSettled(Array.from({ length: 5 }, () => reviews.create(user.id, product.slug, { rating: 5 }))));
      expect(s.errors).toEqual([]);
      expect(await prisma.review.count({ where: { userId: user.id } })).toBe(1);
      const rows = await prisma.pointsTransaction.findMany({ where: { userId: user.id, refType: 'REVIEW' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.expiresAt).toBeInstanceOf(Date);
      expect(await balance(user.id)).toBe(REVIEW_POINTS);
    });

    it('5 lượt quay song song (đủ điểm, dưới trần ngày) → 5 dòng thắng đều có hạn, số dư khớp sổ', async () => {
      const { user } = await player();
      await legacyUnlimited(user.id, 100_000);
      const s = summarize(await Promise.allSettled(Array.from({ length: 5 }, () => game.spin(user.id))));
      expect(s.errors).toEqual([]);
      const wins = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'GAME_SPIN_WIN:win' } });
      expect(wins).toHaveLength(5);
      expect(wins.every((w) => w.expiresAt instanceof Date)).toBe(true);
      expect(await balance(user.id)).toBe(100_000 + 5 * (SPIN_WIN - SPIN_COST));
    });
  });

  describe('xoá đánh giá khi điểm thưởng đã hết hạn: không trừ hai lần', () => {
    const reviewDeleteRows = (userId: string) => prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: 'REVIEW_DELETE:' } } });

    it.each([[30_000], [0]])('cron đã trừ điểm đánh giá rồi mới xoá (còn %i điểm khác): xoá không trừ lần hai, số dư không âm', async (other) => {
      const { user, product } = await player();
      if (other > 0) await legacyUnlimited(user.id, other);
      const review = await reviews.create(user.id, product.slug, { rating: 5 });
      await ageLedger(user.id, 13);
      await expiry.expirePoints();
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);
      expect(await balance(user.id)).toBe(other);

      await reviews.remove(user.id, 'USER', review.id);

      expect(await prisma.review.count({ where: { id: review.id } })).toBe(0);
      expect(await reviewDeleteRows(user.id)).toHaveLength(0);
      expect(await balance(user.id)).toBe(other);
      await expiry.expirePoints();
      expect(await balance(user.id)).toBe(other);
    });

    it('quá hạn nhưng cron chưa chạy rồi xoá: không thu hồi; cron đêm đó trừ đúng 5.000 một lần', async () => {
      const { user, product } = await player();
      await legacyUnlimited(user.id, 30_000);
      const review = await reviews.create(user.id, product.slug, { rating: 5 });
      await ageLedger(user.id, 13);

      await reviews.remove(user.id, 'ADMIN', review.id);
      expect(await reviewDeleteRows(user.id)).toHaveLength(0);
      expect(await balance(user.id)).toBe(30_000 + REVIEW_POINTS);

      await expiry.expirePoints();
      await expiry.expirePoints();
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);
      expect(await balance(user.id)).toBe(30_000);
    });

    it('điểm còn hạn: xoá vẫn thu hồi đúng số điểm đã thưởng (chống tạo → xoá → tạo lại để farm điểm)', async () => {
      const { user, product } = await player();
      await legacyUnlimited(user.id, 30_000);
      const review = await reviews.create(user.id, product.slug, { rating: 5 });
      await ageLedger(user.id, 11); // còn 1 tháng

      await reviews.remove(user.id, 'USER', review.id);

      const rows = await reviewDeleteRows(user.id);
      expect(rows.map((r) => [r.delta, r.lot])).toEqual([[-REVIEW_POINTS, 'STANDARD']]);
      expect(await balance(user.id)).toBe(30_000);
    });

    it('lô đánh giá chạm hạn đúng lúc cron đang giữ khoá user và trừ nó: remove chờ khoá rồi đọc lại hạn, không thu hồi thêm', async () => {
      const { user, product } = await player();
      await legacyUnlimited(user.id, 30_000);
      const review = await reviews.create(user.id, product.slug, { rating: 5 });
      await ageLedger(user.id, 11); // còn một tháng: remove (đọc trước khi cron commit) thấy chưa hết hạn

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      // Việc của expireUser: khoá dòng user, thấy lô đánh giá đã quá hạn, trừ số dư và ghi POINTS_EXPIRED rồi mới commit.
      const cron = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id} FOR UPDATE`;
          locked();
          await gate;
          await tx.$executeRaw`
            UPDATE "points_transactions"
               SET "createdAt" = "createdAt" - interval '2 month', "expiresAt" = "expiresAt" - interval '2 month'
             WHERE "userId" = ${user.id}`;
          await tx.pointsTransaction.create({ data: { userId: user.id, delta: -REVIEW_POINTS, reason: 'POINTS_EXPIRED', refType: 'EXPIRE', lot: 'STANDARD' } });
          await tx.user.update({ where: { id: user.id }, data: { pointsBalance: { decrement: REVIEW_POINTS } } });
        },
        { timeout: 30_000 },
      );
      await lockTaken;
      const removal = reviews.remove(user.id, 'USER', review.id);
      const waiting = () =>
        prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      for (let i = 0; i < 100 && (await waiting())[0]!.n === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await waiting())[0]!.n).toBeGreaterThan(0); // remove đã tới chỗ chờ khoá user
      release();
      await Promise.all([cron, removal]);

      expect(await reviewDeleteRows(user.id)).toHaveLength(0);
      expect(await balance(user.id)).toBe(30_000);
      await expiry.expirePoints();
      expect(await balance(user.id)).toBe(30_000);
      expect(await standardSum(user.id)).toBe(30_000);
    });

    it('dòng thưởng đánh giá cũ không hạn (trước PE-3): xoá vẫn thu hồi như cũ', async () => {
      const { user, product, order } = await player();
      const review = await prisma.review.create({
        data: { userId: user.id, productId: product.id, orderId: order.id, rating: 5, comment: 'cũ', images: [], pointsEarned: REVIEW_POINTS },
      });
      await prisma.$transaction([
        prisma.pointsTransaction.create({
          data: { userId: user.id, delta: REVIEW_POINTS, lot: 'STANDARD', reason: `REVIEW:${product.slug}`, refType: 'REVIEW', refId: review.id, expiresAt: null },
        }),
        prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: REVIEW_POINTS } } }),
      ]);

      await reviews.remove(user.id, 'USER', review.id);

      expect((await reviewDeleteRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);
      expect(await balance(user.id)).toBe(0);
    });
  });

  /**
   * Dòng REVIEW_DELETE âm mà replay FIFO ăn vào lô CŨ NHẤT thì lô đánh giá (nay có hạn) vẫn còn nguyên trong sổ, tới hạn
   * cron trừ thêm chính 5 đến 15 điểm đã thu hồi: khách mất điểm hai lần. Thu hồi phải ăn đúng lô đánh giá của nó.
   */
  describe('xoá đánh giá KHI ĐIỂM CÒN HẠN rồi qua hạn: cron không trừ lại điểm đã thu hồi', () => {
    const reviewDeleteRows = (userId: string) => prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: 'REVIEW_DELETE:' } } });

    it('lô cũ không hạn 30: tạo rồi xoá đánh giá còn hạn, qua hạn, cron hai lần → còn 30, không có POINTS_EXPIRED', async () => {
      const { user, product } = await player();
      await legacyUnlimited(user.id, 30_000);
      const review = await reviews.create(user.id, product.slug, { rating: 5 });
      await reviews.remove(user.id, 'USER', review.id);
      expect((await reviewDeleteRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);
      expect(await balance(user.id)).toBe(30_000);

      await ageLedger(user.id, 13);
      await expiry.expirePoints();
      await expiry.expirePoints();

      expect(await expiredRows(user.id)).toHaveLength(0);
      expect(await balance(user.id)).toBe(30_000);
      expect(await standardSum(user.id)).toBe(30_000);
    });

    it('admin hạ loyalty.point_expire_months 12 → 3: đánh giá hạn 3 tháng nằm sau lô cũ hạn 12 tháng, xoá rồi qua 4 tháng → lô cũ còn nguyên', async () => {
      const config = moduleRef.get(SystemConfigService);
      const { user, product } = await player();
      await game.claimMission(user.id, 'FIRST_ORDER'); // +20, hạn 12 tháng
      await ageLedger(user.id, 1);
      await config.set('loyalty.point_expire_months', 3, 'it-pe3');
      let review;
      try {
        review = await reviews.create(user.id, product.slug, { rating: 5 }); // +5, hạn 3 tháng: sớm hơn lô nhiệm vụ cũ hơn
      } finally {
        await config.set('loyalty.point_expire_months', 12, 'it-pe3');
      }
      await reviews.remove(user.id, 'USER', review.id);
      expect(await balance(user.id)).toBe(MISSION_POINTS);

      await ageLedger(user.id, 4); // đánh giá quá hạn 1 tháng; nhiệm vụ còn 7 tháng
      for (let night = 0; night < 3; night++) await expiry.expirePoints();

      expect(await expiredRows(user.id)).toHaveLength(0);
      expect(await balance(user.id)).toBe(MISSION_POINTS);
    });

    it('hai đánh giá: xoá cái MỚI hơn thì thu hồi ăn lô của nó, không ăn lô đánh giá cũ hơn (hai lô hết hạn lệch nhau)', async () => {
      const first = await player();
      const second = await prisma.product.create({
        data: { pancakeId: `it-pe3-p2-${randCode(6)}`, brand: 'IT', slug: `it-pe3-b-${randCode(6).toLowerCase()}`, name: 'SP PE3 B', description: 'IT', basePrice: 100_000 },
      });
      const variation = await prisma.variation.create({
        data: { pancakeId: `it-pe3-v2-${randCode(6)}`, productId: second.id, sku: `PE3B-${randCode(6)}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 100_000, stock: 9 },
      });
      await createOrder(prisma, {
        userId: first.user.id,
        status: 'DELIVERED',
        items: { create: [{ variationId: variation.id, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
      });
      await legacyUnlimited(first.user.id, 30_000);
      await reviews.create(first.user.id, first.product.slug, { rating: 5 }); // +5, hạn T+12
      await ageLedger(first.user.id, 1);
      const newer = await reviews.create(first.user.id, second.slug, { rating: 5 }); // +5, hạn T+12 tính từ lúc sau, muộn hơn 1 tháng
      await reviews.remove(first.user.id, 'USER', newer.id);
      expect(await balance(first.user.id)).toBe(35_000);

      await ageLedger(first.user.id, 13); // cả hai lô đánh giá đã quá hạn nếu còn nằm trong sổ
      for (let night = 0; night < 3; night++) await expiry.expirePoints();

      expect((await expiredRows(first.user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]); // chỉ lô đánh giá còn lại (cũ hơn)
      expect(await balance(first.user.id)).toBe(30_000);
      expect(await standardSum(first.user.id)).toBe(30_000);
    });
  });

  describe('cron hết hạn với nhiều lô có hạn khác nhau trộn với lô không hạn cũ', () => {
    it('nhận thưởng → cron sau hạn → trừ đúng một lần; chạy lại không trừ lần hai; số dư khớp sổ', async () => {
      const { user } = await player();
      await game.claimMission(user.id, 'FIRST_ORDER');
      const before = await expiredRows(user.id);
      expect(before).toHaveLength(0);

      await expiry.expirePoints();
      expect(await expiredRows(user.id)).toHaveLength(0); // còn hạn: cron không đụng
      expect(await balance(user.id)).toBe(MISSION_POINTS);

      await ageLedger(user.id, 13); // 13 tháng sau: quá hạn 12 tháng
      await expiry.expirePoints();
      await expiry.expirePoints();
      await expiry.expirePoints();

      const expired = await expiredRows(user.id);
      expect(expired.map((r) => [r.delta, r.lot])).toEqual([[-MISSION_POINTS, 'STANDARD']]);
      expect(await balance(user.id)).toBe(0);
      expect(await standardSum(user.id)).toBe(0);
    });

    it('lô không hạn cũ + thưởng đánh giá/vòng quay/nhiệm vụ hết hạn lần lượt: mỗi lô bị trừ đúng một lần, lô không hạn còn nguyên', async () => {
      const { user, product } = await player();
      await legacyUnlimited(user.id, 30_000); // số dư 30 = lô cũ không hạn

      await reviews.create(user.id, product.slug, { rating: 5 }); // +5, hết hạn sau 12 tháng
      await ageLedger(user.id, 2);
      await game.spin(user.id); // -10 (ăn lô cũ nhất), +25 hết hạn sau 12 tháng (còn 10 tháng so với lô đánh giá: 10)
      await spend(user.id, 12_000); // -12.000, ăn lô cũ nhất
      await ageLedger(user.id, 2);
      await game.claimMission(user.id, 'FIRST_ORDER'); // +20 hết hạn sau 12 tháng
      expect(await balance(user.id)).toBe(30_000 + REVIEW_POINTS - SPIN_COST + SPIN_WIN - 12_000 + MISSION_POINTS); // 58.000
      expect(await standardSum(user.id)).toBe(58_000);

      // Hạn: đánh giá còn 8 tháng, vòng quay còn 10 tháng, nhiệm vụ còn 12 tháng tính từ bây giờ.
      const [rv, win, ms] = await Promise.all([
        rowOf(user.id, 'REVIEW:'),
        rowOf(user.id, 'GAME_SPIN_WIN:win'),
        rowOf(user.id, 'MISSION:'),
      ]);
      const monthsToExpiry = (d: Date | null) => Math.round((d!.getTime() - Date.now()) / (30.4 * DAY));
      expect([monthsToExpiry(rv.expiresAt), monthsToExpiry(win.expiresAt), monthsToExpiry(ms.expiresAt)]).toEqual([8, 10, 12]);

      await expiry.expirePoints();
      expect(await expiredRows(user.id)).toHaveLength(0); // chưa lô nào tới hạn

      // 9 tháng sau: chỉ lô đánh giá (5) quá hạn.
      await ageLedger(user.id, 9);
      await expiry.expirePoints();
      await expiry.expirePoints();
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);
      expect(await balance(user.id)).toBe(58_000 - REVIEW_POINTS);

      // 2 tháng sau nữa: lô vòng quay (25) quá hạn, lô nhiệm vụ còn hạn.
      await ageLedger(user.id, 2);
      await expiry.expirePoints();
      await expiry.expirePoints();
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS, -SPIN_WIN]);
      expect(await balance(user.id)).toBe(58_000 - REVIEW_POINTS - SPIN_WIN);

      // 2 tháng sau nữa: lô nhiệm vụ (20) quá hạn; chỉ còn phần lô không hạn cũ chưa tiêu (30.000 - 10.000 - 12.000 = 8.000).
      await ageLedger(user.id, 2);
      await expiry.expirePoints();
      await expiry.expirePoints();
      await expiry.expirePoints();
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS, -SPIN_WIN, -MISSION_POINTS]);
      expect(await balance(user.id)).toBe(8_000);
      expect(await standardSum(user.id)).toBe(8_000);
    });

    it('admin hạ loyalty.point_expire_months từ 12 xuống 3 giữa chừng: lô mới hết hạn TRƯỚC lô cũ, mỗi lô bị trừ đúng một lần qua nhiều đêm', async () => {
      // Replay FIFO thuần ăn dòng POINTS_EXPIRED vào lô cũ nhất (còn hạn), lô mới đã hết hạn trông còn nguyên và bị trừ lại mỗi đêm.
      const config = moduleRef.get(SystemConfigService);
      const { user, product } = await player();
      await game.claimMission(user.id, 'FIRST_ORDER'); // +20, hạn 12 tháng
      await ageLedger(user.id, 1);
      const before = new Date();
      await config.set('loyalty.point_expire_months', 3, 'it-pe3');
      let review;
      try {
        review = await reviews.create(user.id, product.slug, { rating: 5 }); // +5, hạn 3 tháng: sớm hơn lô nhiệm vụ cũ hơn
      } finally {
        await config.set('loyalty.point_expire_months', 12, 'it-pe3');
      }
      expectMonthsAhead((await rowOf(user.id, 'REVIEW:')).expiresAt, before, new Date(), 3);
      expect(review.id).toBeTruthy();

      await expiry.expirePoints();
      expect(await expiredRows(user.id)).toHaveLength(0);

      await ageLedger(user.id, 4); // lô đánh giá quá hạn 1 tháng; lô nhiệm vụ còn 7 tháng
      for (let night = 0; night < 3; night++) await expiry.expirePoints();
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS]);
      expect(await balance(user.id)).toBe(MISSION_POINTS);

      await ageLedger(user.id, 8); // lô nhiệm vụ quá hạn
      for (let night = 0; night < 3; night++) await expiry.expirePoints();
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-REVIEW_POINTS, -MISSION_POINTS]);
      expect(await balance(user.id)).toBe(0);
    });

    it('thưởng đã tiêu hết trước hạn: cron không trừ gì thêm (không trừ điểm đã tiêu), số dư khớp sổ', async () => {
      const { user } = await player();
      await game.claimMission(user.id, 'FIRST_ORDER'); // +20
      await spend(user.id, MISSION_POINTS); // tiêu hết lô nhiệm vụ
      await ageLedger(user.id, 13);
      await expiry.expirePoints();
      await expiry.expirePoints();
      expect(await expiredRows(user.id)).toHaveLength(0);
      expect(await balance(user.id)).toBe(0);
    });
  });
});
