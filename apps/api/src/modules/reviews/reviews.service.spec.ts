import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';

/**
 * Mock analytics dùng chung cho các test không assert riêng — wiring THẬT (không @Optional()
 * no-op câm lặng) ở mọi construction để lộ lỗi ngay nếu sau này thêm event mà quên/gọi sai chữ
 * ký (Task 9). Test riêng cho create() dựng mock + tx RIÊNG bên dưới để assert đúng
 * eventName/props VÀ tx-identity (khác instance prisma top-level).
 */
const analytics = {
  record: jest.fn().mockResolvedValue(undefined),
  recordBestEffort: jest.fn().mockResolvedValue(undefined),
} as unknown as AnalyticsEventsService;

/** Hạn cố định do stub `pointsExpiresAt` trả; test kiểm đúng giá trị này được ghi vào dòng sổ (PE-3). */
const REVIEW_POINTS_EXPIRES_AT = new Date('2027-10-11T00:00:00.000Z');
const pointsExpiresAt = jest.fn(async (_from: Date) => REVIEW_POINTS_EXPIRES_AT);
const loyalty = { pointsExpiresAt } as unknown as LoyaltyService;

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    product: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', slug: 'tinh-dau' }),
      update: jest.fn().mockResolvedValue({}),
    },
    variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]) },
    order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1' }), count: jest.fn().mockResolvedValue(1) }, // có đơn DELIVERED
    review: {
      findFirst: jest.fn().mockResolvedValue(null), // chưa review
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({ id: 'old', rating: 3 }),
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.5 }, _count: 2 }),
    },
    pointsTransaction: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    user: { update: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  const prisma = { ...base, ...over } as unknown as PrismaService;
  // $transaction chạy callback với chính prisma (tx = prisma)
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

const dto = { rating: 5, comment: 'tốt', images: [] };

describe('ReviewsService.create', () => {
  it('sản phẩm không tồn tại → NotFound', async () => {
    const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ReviewsService(prisma, analytics, loyalty).create('u1', 'x', dto as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('chưa có đơn DELIVERED → BadRequest', async () => {
    const prisma = makePrisma({ order: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // Q-30 / C-110: một đánh giá cho mỗi (người, sản phẩm); gọi tạo lại (mua lại) thì SỬA đánh giá cũ,
  // thưởng Điểm Xanh chỉ ở lần tạo đầu.
  describe('đã có đánh giá (Q-30: mua lại thì sửa, không thưởng lại)', () => {
    const existing = { id: 'old', userId: 'u1', productId: 'p1', orderId: 'o0', rating: 5, pointsEarned: 15, isVisible: false };
    const withExisting = () =>
      makePrisma({
        review: {
          findFirst: jest.fn().mockResolvedValue(existing),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({ ...existing, rating: 2, comment: 'đổi ý' }),
          aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 2 }, _count: 1 }),
        },
      });
    type P = {
      review: { create: jest.Mock; update: jest.Mock };
      pointsTransaction: { create: jest.Mock };
      user: { update: jest.Mock };
      product: { update: jest.Mock };
    };

    it('sửa sao, nội dung, ảnh, video của đánh giá cũ; không tạo mới', async () => {
      const prisma = withExisting();
      const out = await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
        rating: 2,
        comment: 'đổi ý',
        images: ['x.jpg'],
        videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/rv2.mp4',
      } as never);
      const p = prisma as unknown as P;
      expect(p.review.create).not.toHaveBeenCalled();
      expect(p.review.update).toHaveBeenCalledTimes(1);
      expect(p.review.update.mock.calls[0][0]).toEqual({
        where: { userId_productId: { userId: 'u1', productId: 'p1' } },
        data: {
          rating: 2,
          comment: 'đổi ý',
          images: ['x.jpg'],
          videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/rv2.mp4',
        },
      });
      expect(out).toMatchObject({ id: 'old', updated: true });
    });

    it('sửa không đổi điểm: không ghi pointsTransaction, không cộng pointsBalance, không đụng pointsEarned', async () => {
      const prisma = withExisting();
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { rating: 4, images: ['a.jpg', 'b.jpg'] } as never);
      const p = prisma as unknown as P;
      expect(p.pointsTransaction.create).not.toHaveBeenCalled();
      expect(p.user.update).not.toHaveBeenCalled();
      expect(Object.keys(p.review.update.mock.calls[0][0].data)).not.toContain('pointsEarned');
    });

    it('sửa không bỏ ẩn đánh giá mà admin đã ẩn (không có isVisible trong data) và tính lại sao trung bình', async () => {
      const prisma = withExisting();
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { rating: 4 } as never);
      const p = prisma as unknown as P;
      expect(Object.keys(p.review.update.mock.calls[0][0].data)).not.toContain('isVisible');
      expect(p.product.update.mock.calls[0][0].data).toEqual({ ratingAvg: 2, reviewCount: 1 });
    });

    it('bỏ trống nội dung/ảnh/video khi sửa → xoá các trường đó (thay thế toàn bộ như lúc tạo)', async () => {
      const prisma = withExisting();
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { rating: 4 } as never);
      const p = prisma as unknown as P;
      expect(p.review.update.mock.calls[0][0].data).toEqual({ rating: 4, comment: null, images: [], videoUrl: null });
    });

    it('ghi engagement_action review_updated CÙNG tx, pointsEarned = 0', async () => {
      const prisma = withExisting();
      const spy = { record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn() };
      await new ReviewsService(prisma, spy as unknown as AnalyticsEventsService, loyalty).create('u1', 'tinh-dau', { rating: 4 } as never);
      expect(spy.record).toHaveBeenCalledTimes(1);
      expect(spy.record).toHaveBeenCalledWith(prisma, {
        eventName: 'engagement_action',
        userId: 'u1',
        platform: 'miniapp',
        props: { action: 'review_updated', productSlug: 'tinh-dau', pointsEarned: 0 },
      });
    });

    it('luật điều kiện giữ nguyên: đã có đánh giá nhưng không còn đơn DELIVERED → BadRequest, không sửa', async () => {
      const prisma = makePrisma({
        order: { findFirst: jest.fn().mockResolvedValue(null) },
        review: { findFirst: jest.fn().mockResolvedValue(existing), update: jest.fn(), create: jest.fn() },
      });
      await expect(new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect((prisma as unknown as P).review.update).not.toHaveBeenCalled();
    });

    it('đánh giá bị xoá đúng lúc đang sửa (P2025) → đọc lại, chưa còn thì tạo mới như lần đầu (thưởng lại vì lần xoá đã hoàn điểm)', async () => {
      const gone = Object.assign(new Error('not found'), { code: 'P2025' });
      const prisma = makePrisma({
        review: {
          findFirst: jest.fn().mockResolvedValueOnce(existing).mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'r-new' }),
          update: jest.fn().mockRejectedValue(gone),
          aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 }),
        },
      });
      const out = await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
      const p = prisma as unknown as P;
      expect(out).toMatchObject({ id: 'r-new', updated: false });
      expect(p.pointsTransaction.create).toHaveBeenCalledTimes(1);
    });

    it('thua đồng thời liên tục (3 lần) → ConflictException, không treo vô hạn', async () => {
      const gone = Object.assign(new Error('not found'), { code: 'P2025' });
      const prisma = makePrisma({
        review: {
          findFirst: jest.fn().mockResolvedValue(existing),
          create: jest.fn(),
          update: jest.fn().mockRejectedValue(gone),
          aggregate: jest.fn(),
        },
      });
      await expect(new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect((prisma as unknown as P).review.update).toHaveBeenCalledTimes(3);
    });

    it('chỉ chủ đánh giá sửa được: tìm và ghi luôn theo userId của người gọi', async () => {
      const prisma = withExisting();
      await new ReviewsService(prisma, analytics, loyalty).create('u2', 'tinh-dau', dto as never);
      const p = prisma as unknown as P & { review: { findFirst: jest.Mock } };
      expect(p.review.findFirst).toHaveBeenCalledWith({ where: { userId: 'u2', productId: 'p1' } });
      expect(p.review.update.mock.calls[0][0].where).toEqual({ userId_productId: { userId: 'u2', productId: 'p1' } });
    });
  });

  it('hợp lệ không ảnh → +5 điểm, recompute rating denormalized, đánh dấu updated=false', async () => {
    const prisma = makePrisma();
    const out = await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
    expect(out).toMatchObject({ id: 'r1', updated: false });
    const p = prisma as unknown as {
      pointsTransaction: { create: jest.Mock };
      product: { update: jest.Mock };
    };
    expect(p.pointsTransaction.create.mock.calls[0][0].data.delta).toBe(5);
    // recomputeRating cập nhật ratingAvg (làm tròn 1 chữ số) + reviewCount
    expect(p.product.update.mock.calls[0][0].data).toEqual({ ratingAvg: 4.5, reviewCount: 2 });
  });

  it('có ảnh → +10 điểm', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
      ...dto,
      images: ['https://res.cloudinary.com/x/image/upload/v1/a.jpg'],
    } as never);
    const ptx = (prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create;
    expect(ptx.mock.calls[0][0].data.delta).toBe(10);
  });

  it('ảnh raster base64 nén (miniapp chưa có Cloudinary, ENGAGE-6) → +10 điểm như ảnh Cloudinary', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
      ...dto,
      images: [`data:image/jpeg;base64,${'A'.repeat(1000)}`],
    } as never);
    const ptx = (prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create;
    expect(ptx.mock.calls[0][0].data.delta).toBe(10);
  });

  it('MONEY-10: ảnh/video không phải media đã tải lên (lọt qua DTO) → chỉ thưởng như đánh giá chữ (+5)', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
      ...dto,
      images: ['x', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      videoUrl: 'https://example.com/not-a-video',
    } as never);
    const ptx = (prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create;
    expect(ptx.mock.calls[0][0].data.delta).toBe(5);
  });

  it('có video (UGC) → +15 điểm + lưu videoUrl', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
      ...dto,
      videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/rv.mp4',
    } as never);
    const p = prisma as unknown as {
      pointsTransaction: { create: jest.Mock };
      review: { create: jest.Mock };
    };
    expect(p.pointsTransaction.create.mock.calls[0][0].data.delta).toBe(15); // video > ảnh > text
    expect(p.review.create.mock.calls[0][0].data.videoUrl).toBe('https://res.cloudinary.com/x/video/upload/v1/rv.mp4');
  });

  // Q-30: thưởng chỉ lần đầu. Xoá rồi tạo lại chỉ được thưởng lại khi lần xoá đã thu hồi đủ điểm đã thưởng.
  describe('thưởng đánh giá chỉ một lần dù xoá rồi tạo lại (Q-30)', () => {
    const row = (delta: number) => ({ delta });
    const withLedger = (rows: { delta: number }[]) => {
      const prisma = makePrisma();
      (prisma as unknown as { pointsTransaction: { findMany: jest.Mock } }).pointsTransaction.findMany.mockResolvedValue(rows);
      return prisma as unknown as {
        pointsTransaction: { create: jest.Mock; findMany: jest.Mock };
        user: { update: jest.Mock };
        review: { create: jest.Mock };
      } & PrismaService;
    };
    const create = (prisma: PrismaService) => new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);

    it('sổ chưa có dòng REVIEW nào của cặp → thưởng bình thường', async () => {
      const prisma = withLedger([]);
      await create(prisma);
      expect(prisma.pointsTransaction.create.mock.calls[0]![0].data.delta).toBe(5);
    });

    it('thưởng 5 đã thu hồi đủ (+5, -5) → thưởng lại được', async () => {
      const prisma = withLedger([row(5), row(-5)]);
      await create(prisma);
      expect(prisma.pointsTransaction.create.mock.calls[0]![0].data.delta).toBe(5);
    });

    it('thưởng 5 chỉ thu hồi được 3 (+5, -3) → còn giữ 2: tạo lại không thưởng, không ghi sổ, không cộng số dư, pointsEarned 0', async () => {
      const prisma = withLedger([row(5), row(-3)]);
      const out = await create(prisma);
      expect(out).toMatchObject({ id: 'r1', updated: false });
      expect(prisma.review.create.mock.calls[0]![0].data.pointsEarned).toBe(0);
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('thưởng đã tiêu hết nên không thu hồi được (chỉ có +15) hay đã hết hạn → không thưởng lần hai', async () => {
      const prisma = withLedger([row(15)]);
      await create(prisma);
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('chỉ đọc đúng sổ REVIEW của đúng khách và đúng sản phẩm (thưởng theo slug, thu hồi theo id sản phẩm), trong tx', async () => {
      const prisma = withLedger([]);
      await create(prisma);
      expect(prisma.pointsTransaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', refType: 'REVIEW', reason: { in: ['REVIEW:tinh-dau', 'REVIEW_DELETE:p1'] } },
        select: { delta: true },
      });
    });

    it('đọc sổ TRƯỚC khi tạo đánh giá (pointsEarned nằm trên dòng đánh giá)', async () => {
      const prisma = withLedger([]);
      await create(prisma);
      expect(prisma.pointsTransaction.findMany.mock.invocationCallOrder[0]).toBeLessThan(prisma.review.create.mock.invocationCallOrder[0]!);
    });

    it('analytics review_created ghi pointsEarned thật (0 khi không thưởng)', async () => {
      const prisma = withLedger([row(5)]);
      const spy = { record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn() };
      await new ReviewsService(prisma, spy as unknown as AnalyticsEventsService, loyalty).create('u1', 'tinh-dau', dto as never);
      expect(spy.record.mock.calls[0]![1].props).toMatchObject({ action: 'review_created', pointsEarned: 0 });
    });
  });

  // PE-3 (OQ-1): điểm thưởng đánh giá là Điểm Xanh thường, hết hạn theo loyalty.point_expire_months.
  describe('điểm thưởng có hạn (PE-3)', () => {
    beforeEach(() => pointsExpiresAt.mockClear());

    it.each([
      ['chỉ chữ', {}, 5],
      ['có ảnh', { images: ['https://res.cloudinary.com/x/image/upload/v1/a.jpg'] }, 10],
      ['có video', { videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/rv.mp4' }, 15],
    ])('%s → dòng REVIEW:<slug> mang expiresAt do pointsExpiresAt trả; số điểm, reason, refType, refId không đổi', async (_n, extra, points) => {
      const prisma = makePrisma();
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, ...extra } as never);
      const p = prisma as unknown as { pointsTransaction: { create: jest.Mock }; user: { update: jest.Mock } };
      expect(p.pointsTransaction.create).toHaveBeenCalledTimes(1);
      expect(p.pointsTransaction.create).toHaveBeenCalledWith({
        data: { userId: 'u1', delta: points, reason: 'REVIEW:tinh-dau', refType: 'REVIEW', refId: 'r1', expiresAt: REVIEW_POINTS_EXPIRES_AT },
      });
      expect(p.user.update.mock.calls[0][0].data).toEqual({ pointsBalance: { increment: points } });
      expect(pointsExpiresAt).toHaveBeenCalledTimes(1);
      expect(pointsExpiresAt.mock.calls[0]![0]).toBeInstanceOf(Date);
    });

    it('hạn được tính NGOÀI transaction (trước khi mở tx)', async () => {
      const prisma = makePrisma();
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
      const $tx = (prisma as unknown as { $transaction: jest.Mock }).$transaction;
      expect(pointsExpiresAt.mock.invocationCallOrder[0]!).toBeLessThan($tx.mock.invocationCallOrder[0]!);
    });

    it('sửa đánh giá đã có (không thưởng) → không đọc cấu hình hạn, không ghi dòng điểm', async () => {
      const existing = { id: 'old', userId: 'u1', productId: 'p1', orderId: 'o0', rating: 5, pointsEarned: 15, isVisible: true };
      const prisma = makePrisma({
        review: {
          findFirst: jest.fn().mockResolvedValue(existing),
          update: jest.fn().mockResolvedValue(existing),
          aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 }),
        },
      });
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
      expect(pointsExpiresAt).not.toHaveBeenCalled();
      expect((prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('thua race P2002 ở lần tạo rồi chuyển sang sửa: không ghi dòng điểm nào', async () => {
      const created = { id: 'r-first', userId: 'u1', productId: 'p1', pointsEarned: 5 };
      const prisma = makePrisma({
        review: {
          findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(created),
          create: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
          update: jest.fn().mockResolvedValue(created),
          aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 }),
        },
      });
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
      expect((prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create).not.toHaveBeenCalled();
    });
  });

  it('race P2002 khi tạo (request kia tạo trước) → không lỗi, chuyển sang sửa đánh giá vừa có, không thưởng lần hai', async () => {
    const created = { id: 'r-first', userId: 'u1', productId: 'p1', pointsEarned: 5 };
    const prisma = makePrisma({
      review: {
        // lần đọc đầu: chưa có; sau khi tạo đồng thời thua cuộc: đã có
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(created),
        create: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
        update: jest.fn().mockResolvedValue({ ...created, rating: 5 }),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 }),
      },
    });
    const out = await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
    const p = prisma as unknown as {
      review: { update: jest.Mock };
      pointsTransaction: { create: jest.Mock };
      user: { update: jest.Mock };
    };
    expect(out).toMatchObject({ id: 'r-first', updated: true });
    expect(p.review.update).toHaveBeenCalledTimes(1);
    expect(p.pointsTransaction.create).not.toHaveBeenCalled();
    expect(p.user.update).not.toHaveBeenCalled();
  });

  it('lỗi khác P2002 khi tạo → ném nguyên lỗi (không nuốt)', async () => {
    const prisma = makePrisma();
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never)).rejects.toThrow('db down');
  });

  /**
   * Task 9: tạo review xong → engagement_action ghi qua record(tx,...), NGAY SAU
   * recomputeRating(product.id, tx), TRONG CÙNG transaction. Dựng tx RIÊNG (khác instance với
   * prisma top-level, không như makePrisma() mặc định trả tx=prisma) để chứng minh code truyền
   * đúng tx thật vào record() — lesson (b), điểm yếu nhất được review flag ở task trước.
   */
  it('tạo xong → ghi engagement_action qua record(tx,...) với ĐÚNG tx (khác instance prisma top-level)', async () => {
    const prisma = makePrisma();
    const tx = {
      review: { create: jest.fn().mockResolvedValue({ id: 'r1' }) },
      pointsTransaction: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      user: { update: jest.fn().mockResolvedValue({}) },
      product: { update: jest.fn().mockResolvedValue({}) },
    };
    // recomputeRating(product.id, tx) gọi tx.review.aggregate + tx.product.update.
    (tx as unknown as { review: { aggregate: jest.Mock } }).review.aggregate = jest
      .fn()
      .mockResolvedValue({ _avg: { rating: 4.5 }, _count: 2 });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));
    const spy = { record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn().mockResolvedValue(undefined) };
    await new ReviewsService(prisma, spy as unknown as AnalyticsEventsService, loyalty).create('u1', 'tinh-dau', dto as never);

    expect(tx).not.toBe(prisma); // tx RIÊNG, không phải cùng instance với prisma top-level
    expect(spy.record).toHaveBeenCalledTimes(1);
    expect(spy.record).toHaveBeenCalledWith(tx, {
      eventName: 'engagement_action',
      userId: 'u1',
      platform: 'miniapp',
      props: { action: 'review_created', productSlug: 'tinh-dau', pointsEarned: 5 },
    });
    expect(spy.recordBestEffort).not.toHaveBeenCalled();
  });
});

describe('ReviewsService.listByProduct (video UGC §6.14.9)', () => {
  it('trả videoUrl trong items + videoCount đếm review có video', async () => {
    const prisma = makePrisma({
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', slug: 'tinh-dau' }) },
      review: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', rating: 5, comment: 'tốt', images: [], videoUrl: 'https://x/v.mp4', createdAt: new Date(), user: { fullName: 'An', avatarUrl: null } },
          { id: 'r2', rating: 4, comment: 'ổn', images: ['a.jpg'], videoUrl: null, createdAt: new Date(), user: { fullName: 'Bình', avatarUrl: null } },
        ]),
      },
    });
    const r = await new ReviewsService(prisma, analytics, loyalty).listByProduct('tinh-dau');
    expect(r.count).toBe(2);
    expect(r.videoCount).toBe(1);
    expect(r.items[0]!.videoUrl).toBe('https://x/v.mp4');
    expect(r.items[1]!.videoUrl).toBeNull();
  });
});

// R2-ENGAGE-3: ảnh base64 (chưa cấu hình Cloudinary) không nhét vào JSON danh sách mà tải riêng, lazy, cache được.
describe('ReviewsService.listByProduct — ảnh base64 không nhúng trong JSON (R2-ENGAGE-3)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const row = (over: Record<string, unknown>) => ({
    id: 'r1', rating: 5, comment: null, images: [], videoUrl: null, createdAt: new Date(), user: { fullName: 'An', avatarUrl: null }, ...over,
  });

  it('ảnh data URL → đường dẫn tải ảnh riêng kèm mã phiên bản; ảnh https giữ nguyên', async () => {
    const prisma = makePrisma({
      review: { findMany: jest.fn().mockResolvedValue([row({ images: [PNG, 'https://res.cloudinary.com/x/a.jpg'] })]) },
    });
    const r = await new ReviewsService(prisma, analytics, loyalty).listByProduct('tinh-dau');
    expect(r.items[0]!.images[0]).toMatch(/^\/reviews\/r1\/images\/0\?v=[0-9a-f]{10}$/);
    expect(r.items[0]!.images[1]).toBe('https://res.cloudinary.com/x/a.jpg');
    expect(JSON.stringify(r)).not.toContain('base64');
  });

  it('mã phiên bản đổi khi ảnh đổi (sửa đánh giá không bị cache ảnh cũ)', async () => {
    const list = async (img: string) =>
      (await new ReviewsService(makePrisma({ review: { findMany: jest.fn().mockResolvedValue([row({ images: [img] })]) } }), analytics, loyalty).listByProduct('tinh-dau')).items[0]!.images[0];
    expect(await list(PNG)).not.toBe(await list('data:image/png;base64,AAAA'));
  });
});

describe('ReviewsService.getImage', () => {
  const svc = (review: unknown) =>
    new ReviewsService(makePrisma({ review: { findUnique: jest.fn().mockResolvedValue(review) } }), analytics, loyalty);
  const PNG_B64 = 'iVBORw0KGgo=';

  it('trả đúng loại ảnh + byte của ảnh base64 thứ i trong đánh giá đang hiện', async () => {
    const img = await svc({ isVisible: true, images: ['https://x/a.jpg', `data:image/png;base64,${PNG_B64}`] }).getImage('r1', 1);
    expect(img.mime).toBe('image/png');
    expect(img.data.equals(Buffer.from(PNG_B64, 'base64'))).toBe(true);
  });

  it.each([
    ['đánh giá không tồn tại', null, 0],
    ['đánh giá bị ẩn', { isVisible: false, images: [`data:image/png;base64,${PNG_B64}`] }, 0],
    ['chỉ số ngoài phạm vi', { isVisible: true, images: [`data:image/png;base64,${PNG_B64}`] }, 3],
    ['ảnh https (không phải base64)', { isVisible: true, images: ['https://res.cloudinary.com/x/a.jpg'] }, 0],
    ['SVG/HTML không phải ảnh raster', { isVisible: true, images: ['data:image/svg+xml;base64,PHN2Zy8+'] }, 0],
  ])('%s → NotFound', async (_name, review, index) => {
    await expect(svc(review).getImage('r1', index as number)).rejects.toBeInstanceOf(NotFoundException);
  });
});

type RemoveDb = {
  review: { delete: jest.Mock };
  pointsTransaction: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
  user: { update: jest.Mock; updateMany: jest.Mock };
  product: { update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
type LedgerRow = { id: string; delta: number; expiresAt: Date | null; createdAt: Date; reason?: string; refType?: string | null; refId?: string | null };

/** Dòng thưởng REVIEW:<slug> của đánh giá r1 trong sổ lô STANDARD (còn nguyên nếu không có dòng nào khác). */
const reviewCredit = (points: number, expiresAt: Date | null = new Date('2027-10-11T00:00:00.000Z')): LedgerRow => ({
  id: 'c1',
  delta: points,
  expiresAt,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  reason: 'REVIEW:tinh-dau',
  refType: 'REVIEW',
  refId: 'r1',
});

/**
 * `credit` là dòng thưởng gốc mà ReviewsService tra theo hạn (null = không tìm thấy); `ledger` là sổ lô STANDARD mà lần đọc
 * thứ hai thấy (mặc định chỉ có đúng lô đánh giá còn nguyên); `balance` là số dư câu khoá dòng user trả về.
 */
async function removeWith(
  credit: { expiresAt: Date | null } | null,
  pointsEarned = 10,
  opts: { ledger?: LedgerRow[]; balance?: number; decCount?: number } = {},
) {
  const prisma = makePrisma({
    review: {
      findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u1', productId: 'p1', pointsEarned }),
      delete: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 0 }, _count: 0 }),
    },
    pointsTransaction: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(credit),
      findMany: jest.fn().mockResolvedValue(opts.ledger ?? [reviewCredit(pointsEarned)]),
    },
    user: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: opts.decCount ?? 1 }) },
    $queryRaw: jest.fn().mockResolvedValue([{ pointsBalance: opts.balance ?? 1_000 }]),
  });
  const run = new ReviewsService(prisma, analytics, loyalty).remove('u1', 'USER', 'r1');
  const out = await run;
  return { prisma: prisma as unknown as RemoveDb, out };
}

describe('ReviewsService.remove (chống farm điểm qua tạo→xóa→tạo lại)', () => {
  it('chủ review tự xóa → hoàn tác điểm đã thưởng + xóa review + recompute rating', async () => {
    const { prisma, out } = await removeWith({ expiresAt: new Date('2027-10-11T00:00:00.000Z') });
    expect(out).toEqual({ ok: true });
    expect(prisma.review.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(prisma.pointsTransaction.create.mock.calls[0][0].data.delta).toBe(-10);
    expect(prisma.user.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'u1', pointsBalance: { gte: 10 } },
      data: { pointsBalance: { decrement: 10 } },
    });
    expect(prisma.product.update.mock.calls[0][0].data).toEqual({ ratingAvg: 0, reviewCount: 0 });
  });

  it('review chưa từng được thưởng điểm (pointsEarned=0) → không tạo pointsTransaction hoàn tác', async () => {
    const prisma = makePrisma({
      review: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u1', productId: 'p1', pointsEarned: 0 }),
        delete: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 0 }, _count: 0 }),
      },
    });
    await new ReviewsService(prisma, analytics, loyalty).remove('u1', 'USER', 'r1');
    const p = prisma as unknown as { pointsTransaction: { create: jest.Mock }; user: { update: jest.Mock } };
    expect(p.pointsTransaction.create).not.toHaveBeenCalled();
    expect(p.user.update).not.toHaveBeenCalled();
  });

  // PE-3: điểm đánh giá nay có hạn. Điểm đã hết hạn thì cron đã (hoặc sẽ) trừ; thu hồi thêm khi xoá là trừ hai lần
  // và có thể kéo số dư âm (xác nhận trên Postgres thật: còn 30 điểm khác → 25; không còn điểm nào → -5).
  describe('xoá đánh giá khi điểm thưởng đã hết hạn (PE-3)', () => {
    const now = new Date('2026-10-11T03:00:00.000Z');
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
      jest.setSystemTime(now);
    });
    afterEach(() => jest.useRealTimers());

    it('điểm thưởng đã quá hạn → vẫn xoá đánh giá và tính lại sao, nhưng KHÔNG thu hồi điểm lần nữa', async () => {
      const { prisma, out } = await removeWith({ expiresAt: new Date(now.getTime() - 1) });
      expect(out).toEqual({ ok: true });
      expect(prisma.review.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(prisma.product.update).toHaveBeenCalled();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('đúng lúc hết hạn (expiresAt = bây giờ) cũng coi là đã hết hạn, khớp cron (expiresAt <= now)', async () => {
      const { prisma } = await removeWith({ expiresAt: new Date(now.getTime()) });
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('điểm thưởng còn hạn → thu hồi như cũ', async () => {
      const { prisma } = await removeWith({ expiresAt: new Date(now.getTime() + 1) });
      expect(prisma.pointsTransaction.create.mock.calls[0][0].data).toMatchObject({ delta: -10, reason: 'REVIEW_DELETE:p1', refType: 'REVIEW', refId: 'r1' });
      expect(prisma.user.updateMany.mock.calls[0][0].data).toEqual({ pointsBalance: { decrement: 10 } });
    });

    it('dòng thưởng cũ không hạn (trước PE-3, expiresAt NULL) → thu hồi như cũ', async () => {
      const { prisma } = await removeWith({ expiresAt: null });
      expect(prisma.pointsTransaction.create.mock.calls[0][0].data.delta).toBe(-10);
    });

    it('không tìm thấy dòng thưởng gốc → thu hồi như cũ (không đoán là đã hết hạn)', async () => {
      const { prisma } = await removeWith(null);
      expect(prisma.pointsTransaction.create.mock.calls[0][0].data.delta).toBe(-10);
    });

    it('tra dòng thưởng gốc theo đúng người, đúng đánh giá, chỉ dòng cộng', async () => {
      const { prisma } = await removeWith({ expiresAt: new Date(now.getTime() + 1) });
      expect(prisma.pointsTransaction.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1', refType: 'REVIEW', refId: 'r1', delta: { gt: 0 } },
        select: { expiresAt: true },
      });
    });

    // Cron hết hạn khoá dòng user rồi mới trừ lô đã quá hạn. Đọc hạn trước khi có khoá thì lô chạm hạn đúng lúc cron đang
    // trừ nó vẫn bị coi là còn hạn, và REVIEW_DELETE ghi sau đó trừ thêm lần hai.
    it('khoá dòng user rồi mới đọc hạn của dòng thưởng, tất cả trong transaction, trước khi ghi thu hồi', async () => {
      const { prisma } = await removeWith({ expiresAt: new Date(now.getTime() + 1) });
      const tx = (prisma as unknown as { $transaction: jest.Mock }).$transaction;
      const lock = (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw;
      const lockSql = (lock.mock.calls[0]![0] as TemplateStringsArray).join('?');
      expect(lockSql).toMatch(/FROM "users" WHERE "id" = \? FOR UPDATE/);
      expect(lock.mock.calls[0]!.slice(1)).toEqual(['u1']);
      const order = (m: jest.Mock) => m.mock.invocationCallOrder[0]!;
      expect(order(tx)).toBeLessThan(order(lock));
      expect(order(lock)).toBeLessThan(order(prisma.pointsTransaction.findFirst));
      expect(order(prisma.pointsTransaction.findFirst)).toBeLessThan(order(prisma.pointsTransaction.findMany));
      expect(order(prisma.pointsTransaction.findMany)).toBeLessThan(order(prisma.pointsTransaction.create));
      expect(order(prisma.pointsTransaction.create)).toBeLessThan(order(prisma.user.updateMany));
    });

    it('đánh giá chưa từng được thưởng (pointsEarned=0) → không tra sổ điểm', async () => {
      const { prisma } = await removeWith({ expiresAt: new Date(now.getTime() - 1) }, 0);
      expect(prisma.pointsTransaction.findFirst).not.toHaveBeenCalled();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect((prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw).not.toHaveBeenCalled();
    });
  });

  // PF-3: khách đã tiêu điểm đánh giá thì xoá đánh giá không được đẩy số dư xuống âm. Cặp Postgres thật nằm ở
  // test/integration-race/pf3-review-delete-floor.race-spec.ts.
  describe('thu hồi tối đa phần còn lại của lô đánh giá, không quá số dư (PF-3)', () => {
    const still = { expiresAt: new Date('2027-10-11T00:00:00.000Z') };
    const spent = (delta: number): LedgerRow => ({ id: 's1', delta, expiresAt: null, createdAt: new Date('2026-10-05T00:00:00.000Z'), reason: 'ORDER_REDEEM:X', refType: 'ORDER', refId: 'ox' });

    it('đã tiêu một phần (còn 3/10 theo sổ lô) → thu hồi 3, trừ số dư có guard gte', async () => {
      const { prisma } = await removeWith(still, 10, { ledger: [reviewCredit(10), spent(-7)], balance: 3 });
      expect(prisma.pointsTransaction.create.mock.calls[0]![0].data).toMatchObject({ delta: -3, reason: 'REVIEW_DELETE:p1', refType: 'REVIEW', refId: 'r1' });
      expect(prisma.user.updateMany.mock.calls[0]![0]).toEqual({ where: { id: 'u1', pointsBalance: { gte: 3 } }, data: { pointsBalance: { decrement: 3 } } });
    });

    it('đã tiêu hết (số dư 0) → không thu hồi gì: không ghi dòng REVIEW_DELETE delta 0 vào sổ khách, không đụng số dư, vẫn xoá đánh giá', async () => {
      const { prisma, out } = await removeWith(still, 10, { ledger: [reviewCredit(10), spent(-10)], balance: 0 });
      expect(out).toEqual({ ok: true });
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.review.delete).toHaveBeenCalled();
      expect(prisma.product.update).toHaveBeenCalled();
    });

    it('lô cũ ăn phần tiêu trước (FIFO): lô đánh giá còn nguyên thì thu hồi đủ', async () => {
      const old: LedgerRow = { id: 'o0', delta: 30, expiresAt: null, createdAt: new Date('2025-01-01T00:00:00.000Z'), reason: 'IT_OLD' };
      const { prisma } = await removeWith(still, 10, { ledger: [old, reviewCredit(10), spent(-25)], balance: 15 });
      expect(prisma.pointsTransaction.create.mock.calls[0]![0].data.delta).toBe(-10);
    });

    it('không bao giờ vượt số dư đã đọc sau khoá (sổ lô còn 10 nhưng số dư 4)', async () => {
      const { prisma } = await removeWith(still, 10, { ledger: [reviewCredit(10)], balance: 4 });
      expect(prisma.pointsTransaction.create.mock.calls[0]![0].data.delta).toBe(-4);
      expect(prisma.user.updateMany.mock.calls[0]![0].where).toEqual({ id: 'u1', pointsBalance: { gte: 4 } });
    });

    it('số dư âm (dữ liệu cũ) → không thu hồi gì, không làm âm thêm, không ghi dòng delta 0', async () => {
      const { prisma } = await removeWith(still, 10, { ledger: [reviewCredit(10)], balance: -3 });
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('sổ không có lô khớp (dòng thưởng cũ thiếu refType/refId) → như trước: thu hồi pointsEarned nhưng không quá số dư', async () => {
      const legacy = { ...reviewCredit(10), refType: null, refId: null };
      const { prisma } = await removeWith(null, 10, { ledger: [legacy], balance: 6 });
      expect(prisma.pointsTransaction.create.mock.calls[0]![0].data.delta).toBe(-6);
    });

    it('chỉ đọc sổ lô STANDARD của đúng chủ đánh giá, trong tx', async () => {
      const { prisma } = await removeWith(still);
      expect(prisma.pointsTransaction.findMany.mock.calls[0]![0].where).toEqual({ userId: 'u1', lot: 'STANDARD' });
    });

    it('lô đã quá hạn thì không đọc sổ lô và không ghi gì (cron lo phần hết hạn)', async () => {
      const { prisma } = await removeWith({ expiresAt: new Date(Date.now() - 1000) }, 10, { ledger: [reviewCredit(10, new Date(Date.now() - 1000))] });
      expect(prisma.pointsTransaction.findMany).not.toHaveBeenCalled();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('số dư đổi giữa chừng (guard gte không trúng) → ném để rollback, không để sổ lệch', async () => {
      await expect(removeWith(still, 10, { decCount: 0 })).rejects.toThrow(/số dư đổi giữa chừng/);
    });
  });

  it('không phải chủ review + không phải ADMIN → Forbidden, không xóa', async () => {
    const deleteFn = jest.fn();
    const prisma = makePrisma({
      review: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u2', productId: 'p1', pointsEarned: 5 }),
        delete: deleteFn,
      },
    });
    await expect(new ReviewsService(prisma, analytics, loyalty).remove('u1', 'USER', 'r1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('ADMIN xóa review của người khác → cho phép, thu hồi điểm của CHỦ đánh giá', async () => {
    const prisma = makePrisma({
      review: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u2', productId: 'p1', pointsEarned: 5 }),
        delete: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 0 }, _count: 0 }),
      },
      pointsTransaction: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ expiresAt: new Date('2027-10-11T00:00:00.000Z') }),
        findMany: jest.fn().mockResolvedValue([{ ...reviewCredit(5), userId: 'u2' }]),
      },
      user: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue([{ pointsBalance: 50 }]),
    });
    await expect(new ReviewsService(prisma, analytics, loyalty).remove('admin1', 'ADMIN', 'r1')).resolves.toEqual({ ok: true });
    const p = prisma as unknown as RemoveDb;
    expect(p.pointsTransaction.create.mock.calls[0]![0].data).toMatchObject({ userId: 'u2', delta: -5 });
    expect(p.user.updateMany.mock.calls[0]![0].where).toEqual({ id: 'u2', pointsBalance: { gte: 5 } });
  });

  it('review không tồn tại → NotFound', async () => {
    const prisma = makePrisma({ review: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ReviewsService(prisma, analytics, loyalty).remove('u1', 'USER', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReviewsService.setVisibility (§6.13 admin ẩn review)', () => {
  it('ẩn review → update isVisible=false + recompute rating (không xóa)', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      review: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', productId: 'p1' }),
        update,
        delete: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4 }, _count: 1 }),
      },
    });
    const r = await new ReviewsService(prisma, analytics, loyalty).setVisibility('r1', false);
    expect(r).toEqual({ ok: true, isVisible: false });
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { isVisible: false } });
    expect((prisma as unknown as { review: { delete: jest.Mock } }).review.delete).not.toHaveBeenCalled();
  });

  it('review không tồn tại → NotFound', async () => {
    const prisma = makePrisma({ review: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ReviewsService(prisma, analytics, loyalty).setVisibility('x', false)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// P1-2 (audit mạch lạc B2C): nút "Viết đánh giá" ở trang sản phẩm mở cho MỌI user đăng nhập,
// nhưng BE chỉ nhận đánh giá của người đã có đơn DELIVERED. Khách chưa mua chọn sao, upload
// 3 ảnh + 1 video (đã tải lên server xong) rồi bấm Gửi mới nhận lỗi — mất trắng công sức.
// FE cần biết TRƯỚC khi mở ô soạn.
describe('ReviewsService.canReview', () => {
  it('đã có đơn DELIVERED chứa sản phẩm, chưa đánh giá → được đánh giá', async () => {
    const prisma = makePrisma();
    const r = await new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'tinh-dau');
    expect(r).toEqual({ canReview: true, reason: null, myReview: null, rewardAvailable: true, purchaseCount: 1 });
  });

  it('mua lại nhiều lần (ENGAGE-23): trả số đơn đã nhận có sản phẩm để FE nói "đã mua N lần", đếm đúng khách và đúng biến thể', async () => {
    const prisma = makePrisma({ order: { findFirst: jest.fn().mockResolvedValue({ id: 'o3' }), count: jest.fn().mockResolvedValue(3) } });
    const r = await new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'tinh-dau');
    expect(r.purchaseCount).toBe(3);
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'DELIVERED', items: { some: { variationId: { in: ['v1'] } } } },
    });
  });

  it('chưa từng mua → không được, kèm lý do để FE hiện đúng thông điệp', async () => {
    const prisma = makePrisma({ order: { findFirst: jest.fn().mockResolvedValue(null) } });
    const r = await new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'tinh-dau');
    expect(r).toEqual({ canReview: false, reason: 'NOT_PURCHASED' });
  });

  it('đã đánh giá rồi (Q-30) → vẫn được, kèm đánh giá hiện có để FE điền sẵn form "Sửa đánh giá của bạn"', async () => {
    const prisma = makePrisma({
      review: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'r0',
          userId: 'u1',
          productId: 'p1',
          orderId: 'o0',
          rating: 4,
          comment: 'ổn',
          images: ['a.jpg'],
          videoUrl: null,
          pointsEarned: 10,
          isVisible: true,
        }),
      },
    });
    const r = await new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'tinh-dau');
    expect(r).toEqual({
      canReview: true,
      reason: null,
      myReview: { id: 'r0', rating: 4, comment: 'ổn', images: ['a.jpg'], videoUrl: null },
      rewardAvailable: false,
      purchaseCount: 1,
    });
  });

  // PG-4: cờ chỉ để miniapp ẩn câu gợi ý điểm; dùng đúng luật rewardAlreadyKept của createFirst.
  describe('rewardAvailable', () => {
    const ledger = (rows: { delta: number }[]) => makePrisma({ pointsTransaction: { findMany: jest.fn().mockResolvedValue(rows) } });

    it('chưa từng đánh giá, sổ điểm trống → true', async () => {
      const r = await new ReviewsService(ledger([]), analytics, loyalty).canReview('u1', 'tinh-dau');
      expect(r.rewardAvailable).toBe(true);
    });

    it('đã nhận thưởng và đã xoá đánh giá nhưng điểm không thu hồi được (sổ còn dương) → false', async () => {
      const r = await new ReviewsService(ledger([{ delta: 5 }]), analytics, loyalty).canReview('u1', 'tinh-dau');
      expect(r.rewardAvailable).toBe(false);
    });

    it('đã nhận thưởng, xoá đánh giá và thu hồi đủ (sổ về 0) → true, giống createFirst', async () => {
      const r = await new ReviewsService(ledger([{ delta: 10 }, { delta: -10 }]), analytics, loyalty).canReview('u1', 'tinh-dau');
      expect(r.rewardAvailable).toBe(true);
    });

    it('đang có đánh giá (gọi tạo lại là sửa, không thưởng) → false, không cần đọc sổ', async () => {
      const prisma = makePrisma({ review: { findFirst: jest.fn().mockResolvedValue({ id: 'r0', rating: 4, comment: null, images: [], videoUrl: null }) } });
      const r = await new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'tinh-dau');
      expect(r.rewardAvailable).toBe(false);
      expect(prisma.pointsTransaction.findMany).not.toHaveBeenCalled();
    });

    it('đọc sổ đúng cặp khách-sản phẩm như luật thưởng (REVIEW:slug, REVIEW_DELETE:id)', async () => {
      const prisma = ledger([]);
      await new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'tinh-dau');
      expect(prisma.pointsTransaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', refType: 'REVIEW', reason: { in: ['REVIEW:tinh-dau', 'REVIEW_DELETE:p1'] } },
        select: { delta: true },
      });
    });

    it('chưa mua → không có cờ (hợp đồng cũ giữ nguyên)', async () => {
      const prisma = makePrisma({ order: { findFirst: jest.fn().mockResolvedValue(null) } });
      const r = await new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'tinh-dau');
      expect(r).not.toHaveProperty('rewardAvailable');
    });
  });

  it('đã đánh giá nhưng không còn đơn DELIVERED → không được sửa (NOT_PURCHASED như hiện hành)', async () => {
    const prisma = makePrisma({
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      review: { findFirst: jest.fn().mockResolvedValue({ id: 'r0' }) },
    });
    const r = await new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'tinh-dau');
    expect(r).toEqual({ canReview: false, reason: 'NOT_PURCHASED' });
  });

  it('sản phẩm không tồn tại → NotFound (không lộ thành "chưa mua")', async () => {
    const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'khong-co')).rejects.toBeInstanceOf(NotFoundException);
  });
});
