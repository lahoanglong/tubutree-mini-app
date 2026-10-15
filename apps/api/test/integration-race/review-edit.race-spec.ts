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
 * C-110: mỗi lần mua (đơn) một đánh giá; gửi lại cho đơn đã có đánh giá thì SỬA đánh giá đó; thưởng Điểm Xanh chỉ ở đánh
 * giá đầu tiên của sản phẩm, kể cả khi nhiều request tạo chạy song song. Đánh giá theo nhiều đơn: r8-multi-reviews.race-spec.
 */
describe('Review: một đánh giá/lần mua, gửi lại thì sửa, thưởng đúng một lần (real Postgres)', () => {
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
      data: { pancakeId: `it-rv-p-${tag}`, brand: 'IT', slug: `it-rv-${tag.toLowerCase()}`, name: `SP đánh giá ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-rv-v-${tag}`, productId: p.id, sku: `RV-${tag}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 100_000, stock: 9 },
    });
    return { p, v };
  }

  async function buyer(variationId: string, status: 'DELIVERED' | 'CONFIRMED' = 'DELIVERED') {
    const u = await createUser(prisma);
    const o = await createOrder(prisma, {
      userId: u.id,
      status,
      items: {
        create: [{ variationId, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }],
      },
    });
    return { u, o };
  }

  const ledger = async (userId: string) => {
    const [user, txs, rows] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } }),
      prisma.pointsTransaction.findMany({ where: { userId, refType: 'REVIEW' }, orderBy: { createdAt: 'asc' } }),
      prisma.review.findMany({ where: { userId } }),
    ]);
    return { balance: user.pointsBalance, txs, rows };
  };

  it('2 request tạo đồng thời cùng người + sản phẩm → đúng 1 đánh giá, đúng 1 lần thưởng', async () => {
    const { p, v } = await product();
    const { u } = await buyer(v.id);
    const gate = barrierOnFirstCalls(prisma.review, 'findUnique', 2);

    const res = summarize(
      await Promise.allSettled([
        reviews.create(u.id, p.slug, { rating: 5, comment: 'Tuyệt' }),
        reviews.create(u.id, p.slug, { rating: 4, comment: 'Ổn', images: ['https://res.cloudinary.com/x/image/upload/v1/a.jpg'] }),
      ]),
    );
    gate.mockRestore();

    expect(res.errors).toEqual([]);
    const flags = res.fulfilled.map((r) => (r.value as { updated: boolean }).updated).sort();
    expect(flags).toEqual([false, true]);

    const { balance, txs, rows } = await ledger(u.id);
    expect(rows).toHaveLength(1);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.delta).toBe(rows[0]!.pointsEarned);
    expect(txs[0]!.refId).toBe(rows[0]!.id);
    expect(balance).toBe(rows[0]!.pointsEarned);
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, select: { ratingAvg: true, reviewCount: true } });
    expect(prod.reviewCount).toBe(1);
    expect(prod.ratingAvg).toBe(rows[0]!.rating);
  });

  it('8 request tạo đồng thời → vẫn đúng 1 đánh giá, 1 lần thưởng, 7 request còn lại thành sửa', async () => {
    const { p, v } = await product();
    const { u } = await buyer(v.id);
    const gate = barrierOnFirstCalls(prisma.review, 'findUnique', 8);

    const res = summarize(
      await Promise.allSettled(Array.from({ length: 8 }, (_, i) => reviews.create(u.id, p.slug, { rating: (i % 5) + 1, comment: `lần ${i}` }))),
    );
    gate.mockRestore();

    expect(res.errors).toEqual([]);
    const created = res.fulfilled.filter((r) => (r.value as { updated: boolean }).updated === false);
    expect(created).toHaveLength(1);
    const { balance, txs, rows } = await ledger(u.id);
    expect(rows).toHaveLength(1);
    expect(txs).toHaveLength(1);
    expect(balance).toBe(5);
    expect(rows[0]!.pointsEarned).toBe(5);
  });

  it('gửi lại cho đơn đã đánh giá: sửa sao/nội dung/ảnh/video, không đổi số điểm, không thêm giao dịch điểm', async () => {
    const { p, v } = await product();
    const { u, o } = await buyer(v.id);
    const first = await reviews.create(u.id, p.slug, { rating: 5, comment: 'Lần đầu' });
    expect(first).toMatchObject({ updated: false, pointsEarned: 5 });

    // mua lại: thêm một đơn DELIVERED nữa, nhưng lần gửi này chọn lại đơn cũ nên là sửa
    await createOrder(prisma, {
      userId: u.id,
      status: 'DELIVERED',
      items: { create: [{ variationId: v.id, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
    });
    const video = 'https://res.cloudinary.com/x/video/upload/v1/rv.mp4';
    const second = await reviews.create(u.id, p.slug, { orderId: o.id, rating: 2, comment: 'Dùng lâu thấy khác', images: ['https://res.cloudinary.com/x/image/upload/v1/1.jpg', 'https://res.cloudinary.com/x/image/upload/v1/2.jpg'], videoUrl: video });
    expect(second).toMatchObject({ id: first.id, updated: true });

    const { balance, txs, rows } = await ledger(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.id,
      rating: 2,
      comment: 'Dùng lâu thấy khác',
      images: ['https://res.cloudinary.com/x/image/upload/v1/1.jpg', 'https://res.cloudinary.com/x/image/upload/v1/2.jpg'],
      videoUrl: video,
      pointsEarned: 5,
      orderId: o.id,
    });
    expect(txs).toHaveLength(1);
    expect(balance).toBe(5);

    const prod = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, select: { ratingAvg: true, reviewCount: true } });
    expect(prod).toEqual({ ratingAvg: 2, reviewCount: 1 });

    // xoá sau khi sửa vẫn hoàn đúng số điểm đã thưởng (không farm được bằng sửa ảnh/video rồi xoá)
    await reviews.remove(u.id, 'USER', first.id);
    expect((await ledger(u.id)).balance).toBe(0);
  });

  it('xoá rồi viết lại: lần xoá hoàn điểm nên sổ điểm sau cùng đúng bằng MỘT lần thưởng, không farm được', async () => {
    const { p, v } = await product();
    const { u } = await buyer(v.id);
    const first = await reviews.create(u.id, p.slug, { rating: 5, comment: 'Lần 1', images: ['https://res.cloudinary.com/x/image/upload/v1/1.jpg'] });
    await reviews.remove(u.id, 'USER', first.id);
    const again = await reviews.create(u.id, p.slug, { rating: 4, comment: 'Lần 2', images: ['https://res.cloudinary.com/x/image/upload/v1/2.jpg'] });
    expect(again).toMatchObject({ updated: false });

    const { balance, txs, rows } = await ledger(u.id);
    expect(rows).toHaveLength(1);
    expect(txs.map((t) => t.delta)).toEqual([10, -10, 10]);
    expect(balance).toBe(10);
  });

  it('sửa không bỏ ẩn đánh giá admin đã ẩn, sao trung bình vẫn loại đánh giá ẩn', async () => {
    const { p, v } = await product();
    const { u } = await buyer(v.id);
    const first = await reviews.create(u.id, p.slug, { rating: 1, comment: 'Vi phạm' });
    await reviews.setVisibility(first.id, false);

    const edited = await reviews.create(u.id, p.slug, { rating: 5, comment: 'Đã sửa' });
    expect(edited).toMatchObject({ id: first.id, updated: true, isVisible: false });
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, select: { ratingAvg: true, reviewCount: true } });
    expect(prod).toEqual({ ratingAvg: 0, reviewCount: 0 });
  });

  it('chỉ chủ đánh giá sửa được: người khác tạo cho cùng sản phẩm ra đánh giá riêng, không đụng đánh giá của chủ', async () => {
    const { p, v } = await product();
    const a = await buyer(v.id);
    const b = await buyer(v.id);
    const ra = await reviews.create(a.u.id, p.slug, { rating: 5, comment: 'A' });
    const rb = await reviews.create(b.u.id, p.slug, { rating: 1, comment: 'B' });
    expect(rb.id).not.toBe(ra.id);
    expect(rb.updated).toBe(false);
    const rowA = await prisma.review.findUniqueOrThrow({ where: { id: ra.id } });
    expect(rowA).toMatchObject({ rating: 5, comment: 'A', userId: a.u.id });
    expect((await ledger(b.u.id)).balance).toBe(5);
  });

  it('luật điều kiện giữ nguyên: chưa có đơn DELIVERED thì không tạo, và đã có đánh giá mà không còn đơn DELIVERED thì không sửa được', async () => {
    const { p, v } = await product();
    const { u: nobody } = await buyer(v.id, 'CONFIRMED');
    await expect(reviews.create(nobody.id, p.slug, { rating: 5 })).rejects.toBeInstanceOf(BadRequestException);
    expect((await ledger(nobody.id)).rows).toHaveLength(0);

    const { u, o } = await buyer(v.id);
    const first = await reviews.create(u.id, p.slug, { rating: 5, comment: 'Giữ' });
    await prisma.order.update({ where: { id: o.id }, data: { status: 'RETURNED' } });
    await expect(reviews.create(u.id, p.slug, { rating: 1, comment: 'Không được sửa' })).rejects.toBeInstanceOf(BadRequestException);
    const row = await prisma.review.findUniqueOrThrow({ where: { id: first.id } });
    expect(row).toMatchObject({ rating: 5, comment: 'Giữ' });
  });

  it('can-review: đánh giá xong đơn duy nhất thì hết đơn để viết mới (ALL_REVIEWED) và trả đánh giá để sửa; chưa mua thì NOT_PURCHASED', async () => {
    const { p, v } = await product();
    const { u, o } = await buyer(v.id);
    expect(await reviews.canReview(u.id, p.slug)).toEqual({
      canReview: true,
      reason: null,
      rewardAvailable: true,
      purchaseCount: 1,
      reviewableOrders: [{ orderId: o.id, code: o.code, deliveredAt: null }],
      myReviews: [],
    });
    const first = await reviews.create(u.id, p.slug, { rating: 4, comment: 'Ổn', images: ['https://res.cloudinary.com/x/image/upload/v1/1.jpg'] });
    expect(await reviews.canReview(u.id, p.slug)).toEqual({
      canReview: false,
      reason: 'ALL_REVIEWED',
      rewardAvailable: false,
      purchaseCount: 1,
      reviewableOrders: [],
      myReviews: [{ id: first.id, orderId: o.id, orderCode: o.code, rating: 4, createdAt: first.createdAt, isVisible: true }],
    });
    expect(await reviews.findOwn(u.id, first.id)).toMatchObject({
      id: first.id,
      orderId: o.id,
      rating: 4,
      comment: 'Ổn',
      images: ['https://res.cloudinary.com/x/image/upload/v1/1.jpg'],
      videoUrl: null,
    });
    const stranger = await createUser(prisma);
    expect(await reviews.canReview(stranger.id, p.slug)).toEqual({ canReview: false, reason: 'NOT_PURCHASED' });
  });

  it('purchaseCount (ENGAGE-23): chỉ đếm đơn DELIVERED của đúng khách và đúng sản phẩm; mua lại thì viết thêm đánh giá, thưởng một lần', async () => {
    const a = await product();
    const b = await product();
    const { u } = await buyer(a.v.id);
    const item = (variationId: string) => ({
      create: [{ variationId, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }],
    });
    await createOrder(prisma, { userId: u.id, status: 'DELIVERED', items: item(a.v.id) });
    await createOrder(prisma, { userId: u.id, status: 'DELIVERED', items: item(b.v.id) });
    await createOrder(prisma, { userId: u.id, status: 'CONFIRMED', items: item(a.v.id) });
    await createOrder(prisma, { userId: u.id, status: 'RETURNED', items: item(a.v.id) });
    await buyer(a.v.id);

    expect((await reviews.canReview(u.id, a.p.slug)).purchaseCount).toBe(2);
    expect((await reviews.canReview(u.id, b.p.slug)).purchaseCount).toBe(1);

    const first = await reviews.create(u.id, a.p.slug, { rating: 5, comment: 'Lần 1' });
    const again = await reviews.create(u.id, a.p.slug, { rating: 3, comment: 'Mua lần 2' });
    expect(again).toMatchObject({ updated: false, pointsEarned: 0 });
    expect(again.id).not.toBe(first.id);
    expect(again.orderId).not.toBe(first.orderId);
    expect((await ledger(u.id)).balance).toBe(5);
    expect((await reviews.canReview(u.id, a.p.slug)).purchaseCount).toBe(2);
    // Hai lần mua đều đã có đánh giá: không gửi đơn thì là sửa đánh giá mới nhất, không tạo thứ ba.
    const third = await reviews.create(u.id, a.p.slug, { rating: 4, comment: 'Sửa lần 2' });
    expect(third).toMatchObject({ id: again.id, updated: true });
    expect((await ledger(u.id)).rows).toHaveLength(2);
  });

  // PG-4: cờ rewardAvailable phải khớp với điều createFirst làm thật trên sổ điểm.
  it('rewardAvailable khớp thưởng thật: xoá thu hồi đủ thì còn thưởng, xoá khi điểm đã tiêu hết thì hết thưởng', async () => {
    const { p, v } = await product();
    const { u } = await buyer(v.id);
    expect((await reviews.canReview(u.id, p.slug)).rewardAvailable).toBe(true);

    const first = await reviews.create(u.id, p.slug, { rating: 5, comment: 'Một' });
    expect(first.pointsEarned).toBe(5);
    expect((await reviews.canReview(u.id, p.slug)).rewardAvailable).toBe(false);

    await reviews.remove(u.id, 'USER', first.id);
    expect((await reviews.canReview(u.id, p.slug)).rewardAvailable).toBe(true);
    const again = await reviews.create(u.id, p.slug, { rating: 5, comment: 'Hai' });
    expect(again.pointsEarned).toBe(5);

    // Tiêu hết Điểm Xanh rồi xoá: không thu hồi được nên thưởng coi như đã dùng, tạo lại không thưởng.
    await prisma.user.update({ where: { id: u.id }, data: { pointsBalance: 0 } });
    await reviews.remove(u.id, 'USER', again.id);
    expect((await reviews.canReview(u.id, p.slug)).rewardAvailable).toBe(false);
    const third = await reviews.create(u.id, p.slug, { rating: 5, comment: 'Ba' });
    expect(third.pointsEarned).toBe(0);
  });

  it('rewardAvailable chỉ tính theo đúng sản phẩm: đã nhận thưởng sản phẩm A không ảnh hưởng sản phẩm B', async () => {
    const a = await product();
    const b = await product();
    const { u } = await buyer(a.v.id);
    await createOrder(prisma, {
      userId: u.id,
      status: 'DELIVERED',
      items: { create: [{ variationId: b.v.id, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
    });
    await reviews.create(u.id, a.p.slug, { rating: 5 });
    expect((await reviews.canReview(u.id, a.p.slug)).rewardAvailable).toBe(false);
    expect((await reviews.canReview(u.id, b.p.slug)).rewardAvailable).toBe(true);
  });
});
