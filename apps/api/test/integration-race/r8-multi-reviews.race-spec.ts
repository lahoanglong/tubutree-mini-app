import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { barrierOnFirstCalls, createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * Mỗi lần mua một đánh giá: khách mua lại viết được đánh giá mới cho đơn sau, nhưng Điểm Xanh chỉ thưởng cho đánh giá đầu
 * tiên của cặp (khách, sản phẩm). Đánh giá cho hai đơn khác nhau không đụng nhau ở khoá unique, nên quyết định thưởng phải
 * được khoá theo cặp; cùng một đơn thì khoá unique (userId, productId, orderId) vẫn là chốt chặn cuối.
 */
describe('Review: mỗi lần mua một đánh giá, thưởng một lần cho mỗi sản phẩm (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, ReviewsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    reviews = moduleRef.get(ReviewsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function product() {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `it-mr-p-${tag}`, brand: 'IT', slug: `it-mr-${tag.toLowerCase()}`, name: `SP mua lại ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-mr-v-${tag}`, productId: p.id, sku: `MR-${tag}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 100_000, stock: 9 },
    });
    return { p, v };
  }

  const line = (variationId: string) => ({
    create: [{ variationId, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }],
  });

  /** Khách đã nhận `n` đơn có sản phẩm, đơn nhận sớm hơn đứng trước. */
  async function buyerWithOrders(variationId: string, n: number) {
    const u = await createUser(prisma);
    const orders = [];
    for (let i = 0; i < n; i++) {
      orders.push(
        await createOrder(prisma, {
          userId: u.id,
          status: 'DELIVERED',
          deliveredAt: new Date(Date.UTC(2026, 8, 1 + i)),
          items: line(variationId),
        }),
      );
    }
    return { u, orders };
  }

  const ledger = async (userId: string) => {
    const [user, txs, rows] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } }),
      prisma.pointsTransaction.findMany({ where: { userId, refType: 'REVIEW' }, orderBy: { createdAt: 'asc' } }),
      prisma.review.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { balance: user.pointsBalance, txs, rows };
  };

  const stats = (productId: string) =>
    prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { ratingAvg: true, reviewCount: true } });

  it('2 lần gửi đồng thời cho CÙNG một đơn (bấm đúp) → đúng 1 đánh giá, đúng 1 lần thưởng, lượt sau thành sửa', async () => {
    const { p, v } = await product();
    const { u, orders } = await buyerWithOrders(v.id, 2);
    const gate = barrierOnFirstCalls(prisma.review, 'findUnique', 2);

    const res = summarize(
      await Promise.allSettled([
        reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 5, comment: 'Lần 2' }),
        reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 4, comment: 'Lần 2 bấm đúp' }),
      ]),
    );
    gate.mockRestore();

    expect(res.errors).toEqual([]);
    expect(res.fulfilled.map((r) => (r.value as { updated: boolean }).updated).sort()).toEqual([false, true]);
    const { balance, txs, rows } = await ledger(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orderId).toBe(orders[1]!.id);
    expect(txs).toHaveLength(1);
    expect(balance).toBe(5);
    expect(rows[0]!.pointsEarned).toBe(5);
  });

  it('gửi đồng thời cho HAI đơn khác nhau của cùng sản phẩm → 2 đánh giá, điểm chỉ thưởng MỘT lần', async () => {
    // Lặp vài cặp khách để lỗi đọc-rồi-ghi không lọt nhờ may mắn về thứ tự.
    for (let round = 0; round < 4; round++) {
      const { p, v } = await product();
      const { u, orders } = await buyerWithOrders(v.id, 2);
      const gate = barrierOnFirstCalls(prisma.review, 'findUnique', 2);

      const res = summarize(
        await Promise.allSettled([
          reviews.create(u.id, p.slug, { orderId: orders[0]!.id, rating: 5, comment: 'Đơn 1', videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/a.mp4' }),
          reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 3, comment: 'Đơn 2', videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/b.mp4' }),
        ]),
      );
      gate.mockRestore();

      expect(res.errors).toEqual([]);
      const { balance, txs, rows } = await ledger(u.id);
      expect(rows.map((r) => r.orderId).sort()).toEqual([orders[0]!.id, orders[1]!.id].sort());
      expect(rows.filter((r) => r.pointsEarned > 0)).toHaveLength(1);
      expect(rows.reduce((s, r) => s + r.pointsEarned, 0)).toBe(15);
      expect(txs).toHaveLength(1);
      expect(txs[0]!.refId).toBe(rows.find((r) => r.pointsEarned > 0)!.id);
      expect(balance).toBe(15);
      expect(await stats(p.id)).toEqual({ ratingAvg: 4, reviewCount: 2 });
    }
  });

  it('8 lượt gửi đồng thời trên 4 đơn (mỗi đơn 2 lượt) → 4 đánh giá, 1 lần thưởng', async () => {
    const { p, v } = await product();
    const { u, orders } = await buyerWithOrders(v.id, 4);
    const gate = barrierOnFirstCalls(prisma.review, 'findUnique', 8);

    const res = summarize(
      await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => reviews.create(u.id, p.slug, { orderId: orders[i % 4]!.id, rating: (i % 5) + 1, comment: `lượt ${i}` })),
      ),
    );
    gate.mockRestore();

    expect(res.errors).toEqual([]);
    expect(res.fulfilled.filter((r) => (r.value as { updated: boolean }).updated === false)).toHaveLength(4);
    const { balance, txs, rows } = await ledger(u.id);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.orderId)).size).toBe(4);
    expect(txs).toHaveLength(1);
    expect(balance).toBe(5);
    expect((await stats(p.id)).reviewCount).toBe(4);
  });

  it('mua lại theo thứ tự: đánh giá đơn sau không có điểm; can-review chỉ còn đơn chưa đánh giá, hết đơn thì ALL_REVIEWED', async () => {
    const { p, v } = await product();
    const { u, orders } = await buyerWithOrders(v.id, 2);

    const before = await reviews.canReview(u.id, p.slug);
    expect(before).toMatchObject({ canReview: true, rewardAvailable: true, purchaseCount: 2 });
    expect(before.canReview && before.reason === null ? before.reviewableOrders.map((o) => o.code) : []).toEqual([orders[0]!.code, orders[1]!.code]);

    const first = await reviews.create(u.id, p.slug, { orderId: orders[0]!.id, rating: 5, comment: 'Lần 1', images: ['https://res.cloudinary.com/x/image/upload/v1/1.jpg'] });
    expect(first).toMatchObject({ updated: false, pointsEarned: 10 });

    const mid = await reviews.canReview(u.id, p.slug);
    expect(mid).toMatchObject({ canReview: true, reason: null, rewardAvailable: false, purchaseCount: 2 });
    if (mid.reason === 'NOT_PURCHASED') throw new Error('unreachable');
    expect(mid.reviewableOrders.map((o) => o.orderId)).toEqual([orders[1]!.id]);
    expect(mid.myReviews.map((r) => [r.id, r.orderCode])).toEqual([[first.id, orders[0]!.code]]);

    const second = await reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 3, comment: 'Lần 2', images: ['https://res.cloudinary.com/x/image/upload/v1/2.jpg'] });
    expect(second).toMatchObject({ updated: false, pointsEarned: 0 });

    const after = await reviews.canReview(u.id, p.slug);
    expect(after).toMatchObject({ canReview: false, reason: 'ALL_REVIEWED', rewardAvailable: false, reviewableOrders: [] });
    if (after.reason === 'NOT_PURCHASED') throw new Error('unreachable');
    expect(after.myReviews.map((r) => r.id)).toEqual([second.id, first.id]);

    const { balance, txs } = await ledger(u.id);
    expect(txs.map((t) => t.delta)).toEqual([10]);
    expect(balance).toBe(10);
  });

  it('danh sách công khai: mọi đánh giá đang hiện của khách (cả đơn cũ) đều hiện, mới nhất trước; số liệu khớp sản phẩm', async () => {
    const { p, v } = await product();
    const { u, orders } = await buyerWithOrders(v.id, 2);
    const other = await buyerWithOrders(v.id, 1);
    const r1 = await reviews.create(u.id, p.slug, { orderId: orders[0]!.id, rating: 5, comment: 'Lần 1' });
    const r2 = await reviews.create(other.u.id, p.slug, { rating: 4, comment: 'Người khác' });
    const r3 = await reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 2, comment: 'Lần 2' });

    const list = await reviews.listByProduct(p.slug);
    expect(list.items.map((i) => i.id)).toEqual([r3.id, r2.id, r1.id]);
    expect(list).toMatchObject({ count: 3, average: 3.7, distribution: { 5: 1, 4: 1, 3: 0, 2: 1, 1: 0 } });
    expect(await stats(p.id)).toEqual({ ratingAvg: 3.7, reviewCount: 3 });

    // Admin ẩn một đánh giá của khách: số liệu tính lại trên các đánh giá còn hiện, đánh giá kia của khách vẫn hiện.
    await reviews.setVisibility(r1.id, false);
    const hidden = await reviews.listByProduct(p.slug);
    expect(hidden.items.map((i) => i.id)).toEqual([r3.id, r2.id]);
    expect(hidden).toMatchObject({ count: 2, average: 3 });
    expect(await stats(p.id)).toEqual({ ratingAvg: 3, reviewCount: 2 });
  });

  it('xoá đánh giá KHÔNG có điểm → không thu hồi gì; xoá đánh giá CÓ điểm → thu hồi đúng điểm của nó, đánh giá mới sau đó được thưởng lại một lần', async () => {
    const { p, v } = await product();
    const { u, orders } = await buyerWithOrders(v.id, 3);
    const first = await reviews.create(u.id, p.slug, { orderId: orders[0]!.id, rating: 5 });
    const second = await reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 4 });
    expect([first.pointsEarned, second.pointsEarned]).toEqual([5, 0]);

    await reviews.remove(u.id, 'USER', second.id);
    let book = await ledger(u.id);
    expect(book.txs.map((t) => t.delta)).toEqual([5]);
    expect(book.balance).toBe(5);
    expect(book.rows.map((r) => r.id)).toEqual([first.id]);

    // Đơn 2 mở lại để viết; còn giữ thưởng của đánh giá đầu nên vẫn 0 điểm.
    const rewrite = await reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 3 });
    expect(rewrite).toMatchObject({ updated: false, pointsEarned: 0 });

    await reviews.remove(u.id, 'USER', first.id);
    book = await ledger(u.id);
    expect(book.txs.map((t) => t.delta)).toEqual([5, -5]);
    expect(book.balance).toBe(0);

    // Thưởng đã thu hồi đủ: đánh giá mới (đơn 3) nhận lại đúng một lần thưởng; tổng sổ của cặp vẫn chỉ một phần thưởng.
    const third = await reviews.create(u.id, p.slug, { orderId: orders[2]!.id, rating: 5 });
    expect(third.pointsEarned).toBe(5);
    book = await ledger(u.id);
    expect(book.txs.reduce((s, t) => s + t.delta, 0)).toBe(5);
    expect(book.balance).toBe(5);
    expect(await stats(p.id)).toEqual({ ratingAvg: 4, reviewCount: 2 });
  });

  it('viết đánh giá cho đơn sau song song với xoá đánh giá có điểm → sổ của cặp không bao giờ giữ quá một phần thưởng', async () => {
    for (let round = 0; round < 3; round++) {
      const { p, v } = await product();
      const { u, orders } = await buyerWithOrders(v.id, 2);
      const first = await reviews.create(u.id, p.slug, { orderId: orders[0]!.id, rating: 5 });

      const res = summarize(
        await Promise.allSettled([
          reviews.remove(u.id, 'USER', first.id),
          reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 4 }),
        ]),
      );
      expect(res.errors).toEqual([]);
      const { balance, txs, rows } = await ledger(u.id);
      const kept = txs.reduce((s, t) => s + t.delta, 0);
      expect(kept).toBeLessThanOrEqual(5);
      expect(balance).toBe(kept);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.pointsEarned).toBe(kept);
    }
  });

  it('sửa theo từng dòng: gửi cho đơn đã có đánh giá chỉ sửa đúng đánh giá của đơn đó, không đụng đánh giá đơn kia', async () => {
    const { p, v } = await product();
    const { u, orders } = await buyerWithOrders(v.id, 2);
    const first = await reviews.create(u.id, p.slug, { orderId: orders[0]!.id, rating: 5, comment: 'Một' });
    const second = await reviews.create(u.id, p.slug, { orderId: orders[1]!.id, rating: 4, comment: 'Hai' });

    const edited = await reviews.create(u.id, p.slug, { orderId: orders[0]!.id, rating: 1, comment: 'Một đã sửa' });
    expect(edited).toMatchObject({ id: first.id, updated: true, pointsEarned: 5 });
    expect(await prisma.review.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ rating: 4, comment: 'Hai' });
    expect(await stats(p.id)).toEqual({ ratingAvg: 2.5, reviewCount: 2 });
    expect((await ledger(u.id)).txs).toHaveLength(1);
  });

  it('đơn không tính là lần mua của khách (CTV lên hộ, đơn đại lý, chưa giao, đơn người khác) → không viết được, không đếm', async () => {
    const { p, v } = await product();
    const u = await createUser(prisma);
    const placed = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', placedForCustomer: true, items: line(v.id) });
    const dealer = await createOrder(prisma, { userId: u.id, type: 'DEALER', status: 'DELIVERED', items: line(v.id) });
    const shipping = await createOrder(prisma, { userId: u.id, status: 'SHIPPING', items: line(v.id) });
    const stranger = await buyerWithOrders(v.id, 1);

    expect(await reviews.canReview(u.id, p.slug)).toEqual({ canReview: false, reason: 'NOT_PURCHASED' });
    await expect(reviews.create(u.id, p.slug, { rating: 5 })).rejects.toBeInstanceOf(BadRequestException);

    const own = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', items: line(v.id) });
    for (const orderId of [placed.id, dealer.id, shipping.id, stranger.orders[0]!.id]) {
      await expect(reviews.create(u.id, p.slug, { orderId, rating: 5 })).rejects.toBeInstanceOf(BadRequestException);
    }
    const ok = await reviews.canReview(u.id, p.slug);
    expect(ok).toMatchObject({ canReview: true, purchaseCount: 1 });
    expect(ok.reason === 'NOT_PURCHASED' ? [] : ok.reviewableOrders.map((o) => o.orderId)).toEqual([own.id]);
    expect((await ledger(u.id)).rows).toHaveLength(0);
  });

  it('đánh giá của chính mình đọc được nguyên nội dung để sửa; của người khác thì 404', async () => {
    const { p, v } = await product();
    const a = await buyerWithOrders(v.id, 1);
    const b = await buyerWithOrders(v.id, 1);
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const mine = await reviews.create(a.u.id, p.slug, { rating: 4, comment: 'Có ảnh', images: [PNG] });
    expect(mine.images[0]).toMatch(/^\/reviews\//);
    expect(await reviews.findOwn(a.u.id, mine.id)).toMatchObject({ id: mine.id, orderId: a.orders[0]!.id, images: [PNG] });
    await expect(reviews.findOwn(b.u.id, mine.id)).rejects.toThrow('Không tìm thấy đánh giá.');
  });
});
