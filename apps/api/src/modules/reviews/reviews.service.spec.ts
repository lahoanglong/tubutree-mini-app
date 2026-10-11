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
    order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1' }) }, // có đơn DELIVERED
    review: {
      findFirst: jest.fn().mockResolvedValue(null), // chưa review
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({ id: 'old', rating: 3 }),
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.5 }, _count: 2 }),
    },
    pointsTransaction: { create: jest.fn() },
    user: { update: jest.fn() },
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
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, images: ['a.jpg'] } as never);
    const ptx = (prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create;
    expect(ptx.mock.calls[0][0].data.delta).toBe(10);
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

  // PE-3 (OQ-1): điểm thưởng đánh giá là Điểm Xanh thường, hết hạn theo loyalty.point_expire_months.
  describe('điểm thưởng có hạn (PE-3)', () => {
    beforeEach(() => pointsExpiresAt.mockClear());

    it.each([
      ['chỉ chữ', {}, 5],
      ['có ảnh', { images: ['a.jpg'] }, 10],
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
      pointsTransaction: { create: jest.fn().mockResolvedValue({}) },
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

describe('ReviewsService.remove (chống farm điểm qua tạo→xóa→tạo lại)', () => {
  it('chủ review tự xóa → hoàn tác điểm đã thưởng + xóa review + recompute rating', async () => {
    const prisma = makePrisma({
      review: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u1', productId: 'p1', pointsEarned: 10 }),
        delete: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 0 }, _count: 0 }),
      },
    });
    const out = await new ReviewsService(prisma, analytics, loyalty).remove('u1', 'USER', 'r1');
    const p = prisma as unknown as {
      review: { delete: jest.Mock };
      pointsTransaction: { create: jest.Mock };
      user: { update: jest.Mock };
      product: { update: jest.Mock };
    };
    expect(out).toEqual({ ok: true });
    expect(p.review.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(p.pointsTransaction.create.mock.calls[0][0].data.delta).toBe(-10);
    expect(p.user.update.mock.calls[0][0].data.pointsBalance).toEqual({ increment: -10 });
    expect(p.product.update.mock.calls[0][0].data).toEqual({ ratingAvg: 0, reviewCount: 0 });
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

  it('ADMIN xóa review của người khác → cho phép', async () => {
    const prisma = makePrisma({
      review: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u2', productId: 'p1', pointsEarned: 5 }),
        delete: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 0 }, _count: 0 }),
      },
    });
    await expect(new ReviewsService(prisma, analytics, loyalty).remove('admin1', 'ADMIN', 'r1')).resolves.toEqual({ ok: true });
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
    expect(r).toEqual({ canReview: true, reason: null, myReview: null });
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
