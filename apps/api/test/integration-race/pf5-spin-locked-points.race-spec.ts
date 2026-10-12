import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const DAY = 864e5;
const COST = 10;

/**
 * PF-5a: vòng quay (GameService.spin) phải tôn trọng lockedOrderPoints như checkout, đổi voucher và góp quỹ cây.
 *
 * Lỗ hổng cũ: spin chỉ kiểm pointsBalance >= phí rồi trừ. Khách nhận +20 Điểm Xanh của đơn vừa giao (còn trong cửa sổ
 * đổi/trả nên đang khoá), quay hết 20 điểm đó, rồi trả hàng: reverseOrderPoints bị chặn bởi số dư (không âm) nên khách
 * giữ nguyên điểm của đơn đã trả.
 *
 * Giải thưởng mặc định là NONE (Math.random giả = 0.1) để số dư cuối tất định; ca thưởng điểm đổi Math.random.
 */
describe('PF-5a vòng quay không tiêu điểm đơn còn trong hạn đổi/trả (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  let loyalty: LoyaltyService;
  let reviews: ReviewsService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService, ReviewsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    loyalty = moduleRef.get(LoyaltyService);
    reviews = moduleRef.get(ReviewsService);
    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'game.spin_buy_cost_points', COST);
    await setConfig(prisma, 'game.spin_buy_daily_limit', 100);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    await setConfig(prisma, 'game.spin_prizes', [
      { id: 'none', name: 'Chúc may mắn', weight: 1, rewardType: 'NONE', value: 0 },
      { id: 'win5', name: '5 Điểm Xanh', weight: 1, rewardType: 'POINTS', value: 5 },
    ]);
  });

  beforeEach(() => {
    // r = 0.1 * 2 = 0.2: trừ weight của giải đầu (1) đã <= 0 nên luôn trúng 'none'.
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /**
   * Khách có `lockedPts` điểm từ đơn giao 2 ngày trước (còn khoá) và `freePts` điểm thường tự do (không thuộc đơn nào).
   * Số dư khớp sổ. Đơn ở trạng thái DELIVERED.
   */
  async function holder(opts: { lockedPts: number; freePts: number }) {
    const user = await createUser(prisma, { pointsBalance: opts.lockedPts + opts.freePts });
    touched.push(user.id);
    const deliveredAt = new Date(Date.now() - 2 * DAY);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      deliveredAt,
      pointsEarned: opts.lockedPts,
      paymentStatus: 'PAID',
    });
    const rows = [
      { delta: opts.lockedPts, reason: `ORDER_DELIVERED:${order.code}`, refType: 'ORDER', refId: order.id },
      { delta: opts.freePts, reason: 'IT_SEED_STANDARD', refType: 'IT', refId: null },
    ].filter((r) => r.delta !== 0);
    await prisma.pointsTransaction.createMany({
      data: rows.map((r) => ({ userId: user.id, lot: 'STANDARD' as const, createdAt: deliveredAt, ...r })),
    });
    return { user, order };
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const spinRows = (userId: string) =>
    prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: 'GAME_SPIN' } }, orderBy: [{ createdAt: 'asc' }, { delta: 'asc' }] });
  const reversedRows = (userId: string) =>
    prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: 'ORDER_REVERSED:' } } });
  const spinCount = (userId: string) => prisma.gameSpin.count({ where: { userId } });

  async function returnOrder(orderId: string) {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'RETURNED' } });
  }

  /** Số kết nối đang chờ một khoá dòng. */
  const lockWaiters = async () =>
    (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)[0]!
      .n;

  async function waitForWaiters(n: number) {
    for (let i = 0; i < 200 && (await lockWaiters()) < n; i++) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await lockWaiters()).toBeGreaterThanOrEqual(n);
  }

  /**
   * Giữ khoá dòng user trong một transaction riêng cho tới khi `release()`, để dựng đúng thứ tự xếp hàng ở khoá:
   * các tx khác tới sau đều dừng ở khoá này (đếm bằng lockWaiters).
   */
  async function holdUserLock(userId: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => (locked = resolve));
    const tx = prisma.$transaction(
      async (t) => {
        await t.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    await acquired;
    return { release, done: tx };
  }

  describe('(a) toàn bộ số dư là điểm đơn đang khoá', () => {
    it('đơn giao +20 đang khoá, số dư chỉ có 20 điểm đó → quay bị từ chối (400 có lý do), số dư không đổi, không có dòng GAME_SPIN', async () => {
      const { user } = await holder({ lockedPts: 20, freePts: 0 });

      const err = await game.spin(user.id).then(
        () => new Error('không ném lỗi'),
        (e: unknown) => e as Error,
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Cần 10 Điểm Xanh để quay/);
      expect(err.message).toMatch(/chưa dùng được/);
      expect(err.message).toMatch(/20 điểm từ đơn mới giao/);
      expect(await balance(user.id)).toBe(20);
      expect(await spinRows(user.id)).toEqual([]);
      expect(await spinCount(user.id)).toBe(0);
    });

    it('không có đơn nào đang khoá và thiếu điểm → vẫn 400 như cũ, thông báo không nhắc điểm khoá', async () => {
      const { user } = await holder({ lockedPts: 0, freePts: 5 });
      const err = await game.spin(user.id).then(
        () => new Error('không ném lỗi'),
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Cần 10 Điểm Xanh để quay.');
      expect(await balance(user.id)).toBe(5);
    });

    it('đơn đã quá cửa sổ đổi/trả (giao 10 ngày trước) thì hết khoá → quay được', async () => {
      const { user, order } = await holder({ lockedPts: 20, freePts: 0 });
      await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: new Date(Date.now() - 10 * DAY) } });
      await game.spin(user.id);
      expect(await balance(user.id)).toBe(10);
      expect((await spinRows(user.id)).map((r) => r.delta)).toEqual([-COST]);
    });
  });

  describe('(b) số dư dư phần không khoá', () => {
    it('20 khoá + 25 tự do: tuần tự quay 3 lần → 2 lần được, lần 3 bị từ chối; số dư còn 25 (20 khoá + 5 tự do)', async () => {
      const { user } = await holder({ lockedPts: 20, freePts: 25 });

      await game.spin(user.id);
      await game.spin(user.id);
      await expect(game.spin(user.id)).rejects.toBeInstanceOf(BadRequestException);

      expect(await balance(user.id)).toBe(25);
      expect((await spinRows(user.id)).map((r) => [r.reason, r.delta, r.lot])).toEqual([
        ['GAME_SPIN_COST', -COST, 'STANDARD'],
        ['GAME_SPIN_COST', -COST, 'STANDARD'],
      ]);
      expect(await spinCount(user.id)).toBe(2);
    });

    it('6 lượt quay song song với 20 khoá + 25 tự do → đúng 2 lượt, phần khoá còn nguyên, các lượt thua là 400', async () => {
      const { user } = await holder({ lockedPts: 20, freePts: 25 });

      const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => game.spin(user.id))));

      expect(s.fulfilled).toHaveLength(2);
      expect(s.rejected).toHaveLength(4);
      for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
      expect(await balance(user.id)).toBe(25);
      expect(await spinCount(user.id)).toBe(2);
    });

    it('trúng giải điểm: dòng GAME_SPIN_WIN vẫn có hạn, lô STANDARD; điểm thắng không dùng trả được phí lượt kế khi chỉ còn điểm khoá', async () => {
      const { user } = await holder({ lockedPts: 20, freePts: 10 });
      (Math.random as jest.Mock).mockReturnValue(0.9); // trúng 'win5'

      await game.spin(user.id);

      const rows = await spinRows(user.id);
      expect(rows.map((r) => [r.reason, r.delta, r.lot])).toEqual([
        ['GAME_SPIN_COST', -COST, 'STANDARD'],
        ['GAME_SPIN_WIN:win5', 5, 'STANDARD'],
      ]);
      expect(rows[0]!.expiresAt).toBeNull();
      expect(rows[1]!.expiresAt).toBeInstanceOf(Date);
      expect(rows[1]!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 300 * DAY);
      expect(await balance(user.id)).toBe(25); // 30 - 10 + 5
      // dùng được còn 25 - 20 = 5 < 10: lượt kế bị từ chối
      await expect(game.spin(user.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(await balance(user.id)).toBe(25);
    });

    it('đủ điểm dùng được nhưng đã chạm trần lượt/ngày → 400 và rollback hết, không mất phí', async () => {
      const { user } = await holder({ lockedPts: 0, freePts: 100 });
      await prisma.gameSpin.createMany({
        data: Array.from({ length: 100 }, () => ({ userId: user.id, prizeId: 'none', prizeName: 'cũ', rewardType: 'NONE' })),
      });
      const err = await game.spin(user.id).then(
        () => new Error('không ném lỗi'),
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/quay đủ 100 lượt/);
      expect(await balance(user.id)).toBe(100);
      expect(await spinRows(user.id)).toEqual([]);
    });
  });

  describe('(c) kịch bản đầy đủ: quay bị chặn, trả hàng, thu hồi đủ', () => {
    it('nhận +20 (khoá) → quay 400 → trả hàng → thu hồi đủ 20, khách không giữ điểm của đơn đã trả', async () => {
      const { user, order } = await holder({ lockedPts: 20, freePts: 0 });

      await expect(game.spin(user.id)).rejects.toBeInstanceOf(BadRequestException);
      await returnOrder(order.id);
      await loyalty.reverseOrderPoints(order.id);

      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(0);
      expect(await spinRows(user.id)).toEqual([]);
    });

    it('khách còn 15 điểm tự do: quay được 1 lần dùng phần tự do; trả hàng vẫn thu hồi đủ 20, số dư về 0 chứ không âm', async () => {
      const { user, order } = await holder({ lockedPts: 20, freePts: 15 });

      await game.spin(user.id);
      await expect(game.spin(user.id)).rejects.toBeInstanceOf(BadRequestException);
      await returnOrder(order.id);
      await loyalty.reverseOrderPoints(order.id);

      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(5);
    });
  });

  describe('(d) quay song song với trả hàng của cùng khách', () => {
    it('3 lượt quay đã xếp hàng ở khoá dòng user TRƯỚC lượt thu hồi: chỉ 1 lượt quay được (phần tự do 10), thu hồi đủ 20, số dư 0', async () => {
      const { user, order } = await holder({ lockedPts: 20, freePts: 10 });
      await returnOrder(order.id);
      const hold = await holdUserLock(user.id);

      const spins: Promise<unknown>[] = [];
      for (let i = 1; i <= 3; i++) {
        spins.push(game.spin(user.id));
        await waitForWaiters(i);
      }
      const reversal = loyalty.reverseOrderPoints(order.id);
      await waitForWaiters(4);
      hold.release();
      await hold.done;

      const s = summarize(await Promise.allSettled(spins));
      await reversal;
      expect(s.fulfilled).toHaveLength(1);
      for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(0);
      expect(await spinCount(user.id)).toBe(1);
    });

    it('lượt thu hồi xếp hàng ở khoá TRƯỚC lượt quay: quay sau thu hồi vẫn được vì phần tự do 10 (không bị từ chối nhầm), số dư 0', async () => {
      const { user, order } = await holder({ lockedPts: 20, freePts: 10 });
      await returnOrder(order.id);
      const hold = await holdUserLock(user.id);

      const reversal = loyalty.reverseOrderPoints(order.id);
      await waitForWaiters(1);
      const spin = game.spin(user.id);
      await waitForWaiters(2);
      hold.release();
      await hold.done;

      await expect(spin).resolves.toBeDefined();
      await reversal;
      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(0);
      expect(await spinCount(user.id)).toBe(1);
    });

    it('4 khách, mỗi khách 3 lượt quay + 1 lượt thu hồi bắn cùng lúc: không deadlock, số dư không âm, không mất/giữ điểm sai lý do', async () => {
      const cases = await Promise.all(Array.from({ length: 4 }, () => holder({ lockedPts: 20, freePts: 10 })));
      await Promise.all(cases.map((c) => returnOrder(c.order.id)));

      const settled = await Promise.all(
        cases.map(async ({ user, order }) => {
          const results = await Promise.allSettled([
            game.spin(user.id),
            game.spin(user.id),
            game.spin(user.id),
            loyalty.reverseOrderPoints(order.id),
          ]);
          return { user, results };
        }),
      );

      for (const { user, results } of settled) {
        // Mọi lỗi phải là 400 của vòng quay; deadlock/serialization (P2034, 40P01) làm ca này đỏ.
        const spinsRes = summarize(results.slice(0, 3));
        for (const r of spinsRes.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
        expect(results[3]!.status).toBe('fulfilled');
        expect(spinsRes.fulfilled).toHaveLength(1);
        expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-20]);
        expect(await balance(user.id)).toBe(0);
      }
    });
  });

  describe('(f) thu hồi không phải chi tiêu: chặn theo số dư, không theo phần dùng được', () => {
    const VIDEO = 'https://res.cloudinary.com/x/video/upload/v1/rv.mp4';

    /** Sản phẩm và một đơn DELIVERED cũ (không điểm, ngoài cửa sổ đổi/trả) để khách đủ điều kiện đánh giá. */
    async function reviewableProduct(userId: string) {
      const tag = randCode(8);
      const product = await prisma.product.create({
        data: { pancakeId: `it-pf5-p-${tag}`, brand: 'IT', slug: `it-pf5-${tag.toLowerCase()}`, name: `SP PF5 ${tag}`, description: 'IT', basePrice: 100_000 },
      });
      const variation = await prisma.variation.create({
        data: { pancakeId: `it-pf5-v-${tag}`, productId: product.id, sku: `PF5-${tag}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 100_000, stock: 9 },
      });
      await createOrder(prisma, {
        userId,
        status: 'DELIVERED',
        deliveredAt: new Date(Date.now() - 20 * DAY),
        items: { create: [{ variationId: variation.id, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
      });
      return product;
    }

    const reviewDeleteRows = (userId: string) =>
      prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: 'REVIEW_DELETE:' } } });

    /**
     * Ghim hành vi hiện tại để comment ở reverseOrderPoints/lotRecoverable không lệch khỏi thực tế: vòng quay không tiêu
     * được điểm đơn khoá, nhưng xoá đánh giá chặn theo SỐ DƯ nên có thể lấy lại điểm đánh giá đã bị tiêu bằng chính điểm
     * đơn khoá, và phần hụt rơi vào ORDER_REVERSED. Nếu sau này thu hồi đánh giá và thu hồi thưởng giới thiệu được chặn ở
     * max(0, số dư - lockedOrderPoints) thì hụt chuyển sang dòng của lô bị thu hồi và test này phải đổi theo.
     */
    it('đơn giao +20 (khoá) + đánh giá video +15, quay tốn 10 (dùng được 15), xoá đánh giá thu hồi đủ 15, trả đơn: ORDER_REVERSED chỉ -10, số dư 0', async () => {
      const { user, order } = await holder({ lockedPts: 20, freePts: 0 });
      const product = await reviewableProduct(user.id);
      const review = await reviews.create(user.id, product.slug, { rating: 5, videoUrl: VIDEO });
      expect(review.pointsEarned).toBe(15);
      expect(await balance(user.id)).toBe(35);

      await game.spin(user.id);
      expect(await balance(user.id)).toBe(25);

      await reviews.remove(user.id, 'USER', review.id);
      expect((await reviewDeleteRows(user.id)).map((r) => r.delta)).toEqual([-15]);
      expect(await balance(user.id)).toBe(10);

      await returnOrder(order.id);
      await loyalty.reverseOrderPoints(order.id);

      expect((await reversedRows(user.id)).map((r) => r.delta)).toEqual([-10]);
      expect(await balance(user.id)).toBe(0);
      expect((await spinRows(user.id)).map((r) => r.delta)).toEqual([-COST]);
    });
  });
});
