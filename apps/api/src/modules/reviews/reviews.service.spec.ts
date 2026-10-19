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

const PURCHASE_O1 = { id: 'o1', code: 'TB-1', deliveredAt: new Date('2026-09-01T00:00:00.000Z') };
const PURCHASE_O2 = { id: 'o2', code: 'TB-2', deliveredAt: new Date('2026-10-01T00:00:00.000Z') };

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    product: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', slug: 'tinh-dau' }),
      update: jest.fn().mockResolvedValue({}),
    },
    variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]) },
    order: { findMany: jest.fn().mockResolvedValue([PURCHASE_O1]) }, // một lần mua đã nhận
    review: {
      findUnique: jest.fn().mockResolvedValue(null), // đơn này chưa có đánh giá
      findMany: jest.fn().mockResolvedValue([]), // chưa đánh giá đơn nào
      create: jest.fn().mockResolvedValue({ id: 'r1', images: [] }),
      update: jest.fn().mockResolvedValue({ id: 'old', rating: 3, images: [] }),
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.5 }, _count: 2 }),
    },
    pointsTransaction: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    user: { update: jest.fn() },
    returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) }, // chưa có lần trả nào được duyệt
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([{ status: 'DELIVERED' }]), // khoá dòng đơn trong tx: đơn vẫn đã giao
    $executeRaw: jest.fn().mockResolvedValue(1),
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
    const prisma = makePrisma({ order: { findMany: jest.fn().mockResolvedValue([]) } });
    await expect(new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // Một lần mua (đơn) một đánh giá: gửi lại cho đơn đã có đánh giá thì SỬA đánh giá đó, không thưởng lại.
  describe('đơn này đã có đánh giá (gửi lại = sửa, không thưởng lại)', () => {
    const existing = { id: 'old', userId: 'u1', productId: 'p1', orderId: 'o1', rating: 5, pointsEarned: 15, isVisible: false };
    const withExisting = () =>
      makePrisma({
        review: {
          findUnique: jest.fn().mockResolvedValue(existing),
          findMany: jest.fn().mockResolvedValue([{ orderId: 'o1' }]),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({ ...existing, rating: 2, comment: 'đổi ý', images: [] }),
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
        where: { userId_productId_orderId: { userId: 'u1', productId: 'p1', orderId: 'o1' } },
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
        order: { findMany: jest.fn().mockResolvedValue([]) },
        review: { findUnique: jest.fn().mockResolvedValue(existing), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
      });
      await expect(
        new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, orderId: 'o1' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((prisma as unknown as P).review.update).not.toHaveBeenCalled();
    });

    it('đánh giá bị xoá đúng lúc đang sửa (P2025) → đọc lại, chưa còn thì tạo mới như lần đầu (thưởng lại vì lần xoá đã hoàn điểm)', async () => {
      const gone = Object.assign(new Error('not found'), { code: 'P2025' });
      const prisma = makePrisma({
        review: {
          findUnique: jest.fn().mockResolvedValueOnce(existing).mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([{ orderId: 'o1' }]),
          create: jest.fn().mockResolvedValue({ id: 'r-new', images: [] }),
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
          findUnique: jest.fn().mockResolvedValue(existing),
          findMany: jest.fn().mockResolvedValue([{ orderId: 'o1' }]),
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
      await new ReviewsService(prisma, analytics, loyalty).create('u2', 'tinh-dau', { ...dto, orderId: 'o1' } as never);
      const p = prisma as unknown as P & { review: { findUnique: jest.Mock } };
      expect(p.review.findUnique).toHaveBeenCalledWith({
        where: { userId_productId_orderId: { userId: 'u2', productId: 'p1', orderId: 'o1' } },
      });
      expect(p.review.update.mock.calls[0][0].where).toEqual({
        userId_productId_orderId: { userId: 'u2', productId: 'p1', orderId: 'o1' },
      });
    });

    it('sửa không lấy khoá thưởng (không đụng sổ điểm)', async () => {
      const prisma = withExisting();
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, orderId: 'o1' } as never);
      expect((prisma as unknown as { $executeRaw: jest.Mock }).$executeRaw).not.toHaveBeenCalled();
    });
  });

  // Một lần mua một đánh giá: khách mua lại thì đơn sau viết được đánh giá riêng, chỉ đánh giá đầu tiên của sản phẩm có điểm.
  describe('đánh giá theo từng lần mua', () => {
    type Db = PrismaService & {
      order: { findMany: jest.Mock };
      review: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
      pointsTransaction: { create: jest.Mock; findMany: jest.Mock };
      user: { update: jest.Mock };
      $executeRaw: jest.Mock;
      $transaction: jest.Mock;
    };
    const twoPurchases = (reviewedOrders: string[] = [], ledger: { delta: number }[] = []) => {
      const prisma = makePrisma() as Db;
      prisma.order.findMany.mockResolvedValue([PURCHASE_O1, PURCHASE_O2]);
      prisma.review.findMany.mockResolvedValue(reviewedOrders.map((orderId) => ({ orderId })));
      prisma.pointsTransaction.findMany.mockResolvedValue(ledger);
      return prisma;
    };
    const create = (prisma: PrismaService, body: Record<string, unknown> = {}) =>
      new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, ...body } as never);

    it('chỉ tính đơn đã nhận, mua lẻ cho chính mình (không tính đơn CTV lên hộ, đơn đại lý), đơn nhận sớm nhất trước', async () => {
      const prisma = twoPurchases();
      await create(prisma);
      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          status: 'DELIVERED',
          type: 'RETAIL',
          placedForCustomer: false,
          items: { some: { variationId: { in: ['v1'] } } },
        },
        orderBy: [{ deliveredAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, code: true, deliveredAt: true },
      });
    });

    it('khách chọn đơn → đánh giá gắn đúng đơn đó', async () => {
      const prisma = twoPurchases(['o1']);
      await create(prisma, { orderId: 'o2' });
      expect(prisma.review.findUnique).toHaveBeenCalledWith({
        where: { userId_productId_orderId: { userId: 'u1', productId: 'p1', orderId: 'o2' } },
      });
      expect(prisma.review.create.mock.calls[0]![0].data).toMatchObject({ userId: 'u1', productId: 'p1', orderId: 'o2' });
    });

    it('đơn không phải lần mua tính được của khách (đơn người khác, chưa giao, không có SP) → BadRequest, không ghi gì', async () => {
      const prisma = twoPurchases();
      await expect(create(prisma, { orderId: 'o-khac' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.review.create).not.toHaveBeenCalled();
      expect(prisma.review.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('không gửi đơn (app cũ) → đơn nhận sớm nhất chưa có đánh giá', async () => {
      const prisma = twoPurchases(['o1']);
      await create(prisma);
      expect(prisma.review.create.mock.calls[0]![0].data.orderId).toBe('o2');
      expect(prisma.review.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', productId: 'p1', orderId: { in: ['o1', 'o2'] } },
        orderBy: { createdAt: 'desc' },
        select: { orderId: true },
      });
    });

    it('không gửi đơn và mọi đơn đã có đánh giá → sửa đánh giá mới nhất như app cũ, không tạo thêm', async () => {
      const prisma = twoPurchases(['o2', 'o1']);
      prisma.review.findUnique.mockResolvedValue({ id: 'r-o2', userId: 'u1', productId: 'p1', orderId: 'o2', pointsEarned: 0 });
      prisma.review.update.mockResolvedValue({ id: 'r-o2', rating: 5, images: [] });
      const out = await create(prisma);
      expect(out).toMatchObject({ id: 'r-o2', updated: true });
      expect(prisma.review.create).not.toHaveBeenCalled();
      expect(prisma.review.update.mock.calls[0]![0].where).toEqual({
        userId_productId_orderId: { userId: 'u1', productId: 'p1', orderId: 'o2' },
      });
    });

    it('mua lại, đánh giá cho đơn sau khi còn giữ thưởng của đánh giá đầu → tạo đánh giá mới, 0 điểm, không ghi sổ, không cộng số dư', async () => {
      const prisma = twoPurchases(['o1'], [{ delta: 10 }]);
      const out = await create(prisma, { orderId: 'o2', images: ['https://res.cloudinary.com/x/image/upload/v1/a.jpg'] });
      expect(out).toMatchObject({ id: 'r1', updated: false });
      expect(prisma.review.create.mock.calls[0]![0].data).toMatchObject({ orderId: 'o2', pointsEarned: 0 });
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('khoá cặp (khách, sản phẩm) trong transaction TRƯỚC khi đọc sổ thưởng và trước khi tạo đánh giá', async () => {
      const prisma = twoPurchases();
      await create(prisma, { orderId: 'o2' });
      const lock = prisma.$executeRaw;
      expect(lock).toHaveBeenCalledTimes(1);
      expect((lock.mock.calls[0]![0] as TemplateStringsArray).join('?')).toMatch(/pg_advisory_xact_lock\(hashtext\(\?\)\)/);
      expect(lock.mock.calls[0]!.slice(1)).toEqual(['review-reward:u1:p1']);
      const order = (m: jest.Mock) => m.mock.invocationCallOrder[0]!;
      expect(order(prisma.$transaction)).toBeLessThan(order(lock));
      expect(order(lock)).toBeLessThan(order(prisma.pointsTransaction.findMany));
      expect(order(prisma.pointsTransaction.findMany)).toBeLessThan(order(prisma.review.create));
    });

    describe('đơn đổi trạng thái hoặc sản phẩm đã bị trả (D1-01)', () => {
      type Db = PrismaService & {
        review: { create: jest.Mock };
        pointsTransaction: { create: jest.Mock };
        user: { update: jest.Mock };
        returnRequestItem: { findMany: jest.Mock };
        orderItem: { findMany: jest.Mock };
        $queryRaw: jest.Mock;
        $executeRaw: jest.Mock;
      };
      const photo = { images: ['https://res.cloudinary.com/x/image/upload/v1/a.jpg'] };
      const returnedLine = (prisma: Db, variationId: string) => {
        prisma.returnRequestItem.findMany.mockResolvedValue([{ orderItemId: 'it1' }]);
        prisma.orderItem.findMany.mockResolvedValue([{ orderId: 'o1', variationId }]);
      };

      it('sản phẩm đã có dòng trả được duyệt trên đơn này (đơn vẫn giao vì còn hàng khác) → đánh giá 0 điểm, không ghi sổ, không cộng số dư', async () => {
        const prisma = makePrisma({ variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }]) } }) as Db;
        returnedLine(prisma, 'v1');
        await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, ...photo } as never);
        expect(prisma.review.create.mock.calls[0]![0].data).toMatchObject({ orderId: 'o1', pointsEarned: 0 });
        expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('dòng trả được duyệt là của sản phẩm khác → đánh giá vẫn được thưởng', async () => {
        const prisma = makePrisma({
          variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }, { id: 'v2', productId: 'p2' }]) },
        }) as Db;
        returnedLine(prisma, 'v2');
        await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, ...photo } as never);
        expect(prisma.review.create.mock.calls[0]![0].data).toMatchObject({ pointsEarned: 10_000 });
      });

      it('đọc dòng trả đã duyệt SAU khi lấy khoá cặp (lần duyệt giữ khoá tới commit) và trước khi tạo đánh giá', async () => {
        const prisma = makePrisma() as Db;
        await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
        const at = (m: jest.Mock) => m.mock.invocationCallOrder[0]!;
        expect(at(prisma.$executeRaw)).toBeLessThan(at(prisma.returnRequestItem.findMany));
        expect(at(prisma.returnRequestItem.findMany)).toBeLessThan(at(prisma.review.create));
      });

      it('khoá dòng đơn (FOR SHARE) TRƯỚC khoá cặp, cùng thứ tự với lần duyệt trả (dòng đơn rồi khoá cặp) để không deadlock', async () => {
        const prisma = makePrisma() as Db;
        await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
        const sql = (prisma.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
        expect(sql).toMatch(/FROM "orders" WHERE "id" = \? FOR SHARE/);
        expect(prisma.$queryRaw.mock.calls[0]!.slice(1)).toEqual(['o1']);
        expect(prisma.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(prisma.$executeRaw.mock.invocationCallOrder[0]!);
      });

      it('đơn vừa chuyển sang đã trả giữa lúc đọc và lúc lưu → BadRequest, không tạo đánh giá, không ghi điểm', async () => {
        const prisma = makePrisma() as Db;
        prisma.$queryRaw.mockResolvedValue([{ status: 'RETURNED' }]);
        await expect(new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, ...photo } as never)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.review.create).not.toHaveBeenCalled();
        expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
      });
    });
  });

  it('hợp lệ không ảnh → +5.000 điểm, recompute rating denormalized, đánh dấu updated=false', async () => {
    const prisma = makePrisma();
    const out = await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
    expect(out).toMatchObject({ id: 'r1', updated: false });
    const p = prisma as unknown as {
      pointsTransaction: { create: jest.Mock };
      product: { update: jest.Mock };
    };
    expect(p.pointsTransaction.create.mock.calls[0][0].data.delta).toBe(5_000);
    // recomputeRating cập nhật ratingAvg (làm tròn 1 chữ số) + reviewCount
    expect(p.product.update.mock.calls[0][0].data).toEqual({ ratingAvg: 4.5, reviewCount: 2 });
  });

  it('có ảnh → +10.000 điểm', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
      ...dto,
      images: ['https://res.cloudinary.com/x/image/upload/v1/a.jpg'],
    } as never);
    const ptx = (prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create;
    expect(ptx.mock.calls[0][0].data.delta).toBe(10_000);
  });

  it('ảnh raster base64 nén (miniapp chưa có Cloudinary, ENGAGE-6) → +10.000 điểm như ảnh Cloudinary', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
      ...dto,
      images: [`data:image/jpeg;base64,${'A'.repeat(1000)}`],
    } as never);
    const ptx = (prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create;
    expect(ptx.mock.calls[0][0].data.delta).toBe(10_000);
  });

  it('MONEY-10: ảnh/video không phải media đã tải lên (lọt qua DTO) → chỉ thưởng như đánh giá chữ (+5.000)', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
      ...dto,
      images: ['x', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      videoUrl: 'https://example.com/not-a-video',
    } as never);
    const ptx = (prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create;
    expect(ptx.mock.calls[0][0].data.delta).toBe(5_000);
  });

  it('có video (UGC) → +15.000 điểm + lưu videoUrl', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', {
      ...dto,
      videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/rv.mp4',
    } as never);
    const p = prisma as unknown as {
      pointsTransaction: { create: jest.Mock };
      review: { create: jest.Mock };
    };
    expect(p.pointsTransaction.create.mock.calls[0][0].data.delta).toBe(15_000); // video > ảnh > text
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
      expect(prisma.pointsTransaction.create.mock.calls[0]![0].data.delta).toBe(5_000);
    });

    it('thưởng 5.000 đã thu hồi đủ (+5.000, -5.000) → thưởng lại được', async () => {
      const prisma = withLedger([row(5_000), row(-5_000)]);
      await create(prisma);
      expect(prisma.pointsTransaction.create.mock.calls[0]![0].data.delta).toBe(5_000);
    });

    it('thưởng 5.000 chỉ thu hồi được 3.000 (+5.000, -3.000) → còn giữ 2.000: tạo lại không thưởng, không ghi sổ, không cộng số dư, pointsEarned 0', async () => {
      const prisma = withLedger([row(5_000), row(-3_000)]);
      const out = await create(prisma);
      expect(out).toMatchObject({ id: 'r1', updated: false });
      expect(prisma.review.create.mock.calls[0]![0].data.pointsEarned).toBe(0);
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('thưởng đã tiêu hết nên không thu hồi được (chỉ có +15.000) hay đã hết hạn → không thưởng lần hai', async () => {
      const prisma = withLedger([row(15_000)]);
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
      const prisma = withLedger([row(5_000)]);
      const spy = { record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn() };
      await new ReviewsService(prisma, spy as unknown as AnalyticsEventsService, loyalty).create('u1', 'tinh-dau', dto as never);
      expect(spy.record.mock.calls[0]![1].props).toMatchObject({ action: 'review_created', pointsEarned: 0 });
    });
  });

  // PE-3 (OQ-1): điểm thưởng đánh giá là Điểm Xanh thường, hết hạn theo loyalty.point_expire_months.
  describe('điểm thưởng có hạn (PE-3)', () => {
    beforeEach(() => pointsExpiresAt.mockClear());

    it.each([
      ['chỉ chữ', {}, 5_000],
      ['có ảnh', { images: ['https://res.cloudinary.com/x/image/upload/v1/a.jpg'] }, 10_000],
      ['có video', { videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/rv.mp4' }, 15_000],
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
      const existing = { id: 'old', userId: 'u1', productId: 'p1', orderId: 'o0', rating: 5, pointsEarned: 15, isVisible: true, images: [] };
      const prisma = makePrisma({
        review: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(existing),
          update: jest.fn().mockResolvedValue(existing),
          aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 }),
        },
      });
      await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', dto as never);
      expect(pointsExpiresAt).not.toHaveBeenCalled();
      expect((prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('thua race P2002 ở lần tạo rồi chuyển sang sửa: không ghi dòng điểm nào', async () => {
      const created = { id: 'r-first', userId: 'u1', productId: 'p1', pointsEarned: 5, images: [] };
      const prisma = makePrisma({
        review: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(created),
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
    const created = { id: 'r-first', userId: 'u1', productId: 'p1', pointsEarned: 5, images: [] };
    const prisma = makePrisma({
      review: {
        // lần đọc đầu: chưa có; sau khi tạo đồng thời thua cuộc: đã có
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(created),
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
      review: { create: jest.fn().mockResolvedValue({ id: 'r1', images: [] }) },
      pointsTransaction: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      user: { update: jest.fn().mockResolvedValue({}) },
      product: { update: jest.fn().mockResolvedValue({}) },
      returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'DELIVERED' }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
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
      props: { action: 'review_created', productSlug: 'tinh-dau', pointsEarned: 5_000 },
    });
    expect(spy.recordBestEffort).not.toHaveBeenCalled();
  });
});

/** Prisma cho danh sách công khai: `rows` là các dòng trả về, `byRating`/`videos` là thống kê trên mọi đánh giá đang hiện. */
function listPrisma(rows: unknown[], byRating: { rating: number; n: number }[] = [], videos = 0) {
  return makePrisma({
    review: {
      findMany: jest.fn().mockResolvedValue(rows),
      groupBy: jest.fn().mockResolvedValue(byRating.map((g) => ({ rating: g.rating, _count: { _all: g.n } }))),
      count: jest.fn().mockResolvedValue(videos),
    },
  }) as PrismaService & { review: { findMany: jest.Mock; groupBy: jest.Mock; count: jest.Mock } };
}

describe('ReviewsService.listByProduct (video UGC §6.14.9)', () => {
  it('trả videoUrl trong items + videoCount đếm review có video', async () => {
    const prisma = listPrisma(
      [
        { id: 'r1', rating: 5, comment: 'tốt', images: [], videoUrl: 'https://x/v.mp4', createdAt: new Date(), user: { fullName: 'An', avatarUrl: null } },
        { id: 'r2', rating: 4, comment: 'ổn', images: ['a.jpg'], videoUrl: null, createdAt: new Date(), user: { fullName: 'Bình', avatarUrl: null } },
      ],
      [{ rating: 5, n: 1 }, { rating: 4, n: 1 }],
      1,
    );
    const r = await new ReviewsService(prisma, analytics, loyalty).listByProduct('tinh-dau');
    expect(r.count).toBe(2);
    expect(r.videoCount).toBe(1);
    expect(r.items[0]!.videoUrl).toBe('https://x/v.mp4');
    expect(r.items[1]!.videoUrl).toBeNull();
    expect(prisma.review.count).toHaveBeenCalledWith({ where: { productId: 'p1', isVisible: true, videoUrl: { not: null } } });
  });
});

// Khách mua lại viết được nhiều đánh giá, sản phẩm dễ vượt số dòng trả về: số đánh giá, điểm trung bình, phân bổ sao phải
// tính trên mọi đánh giá đang hiện (khớp reviewCount/ratingAvg của sản phẩm), không trên 100 dòng mới nhất.
describe('ReviewsService.listByProduct — thống kê trên mọi đánh giá đang hiện', () => {
  const row = (id: string, rating: number) => ({
    id, rating, comment: null, images: [], videoUrl: null, createdAt: new Date(), user: { fullName: 'An', avatarUrl: null },
  });

  it('150 đánh giá đang hiện mà chỉ trả 100 dòng → count/average/distribution vẫn theo 150', async () => {
    const prisma = listPrisma(
      Array.from({ length: 100 }, (_, i) => row(`r${i}`, 5)),
      [{ rating: 5, n: 100 }, { rating: 1, n: 50 }],
      7,
    );
    const r = await new ReviewsService(prisma, analytics, loyalty).listByProduct('tinh-dau');
    expect(r.items).toHaveLength(100);
    expect(r.count).toBe(150);
    expect(r.average).toBe(3.7);
    expect(r.distribution).toEqual({ 5: 100, 4: 0, 3: 0, 2: 0, 1: 50 });
    expect(r.videoCount).toBe(7);
  });

  it('dòng trả về: chỉ đánh giá đang hiện, mới nhất trước, tối đa 100; thống kê cùng điều kiện đang hiện', async () => {
    const prisma = listPrisma([]);
    await new ReviewsService(prisma, analytics, loyalty).listByProduct('tinh-dau');
    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productId: 'p1', isVisible: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    );
    expect(prisma.review.groupBy).toHaveBeenCalledWith({ by: ['rating'], where: { productId: 'p1', isVisible: true }, _count: { _all: true } });
  });

  it('chưa có đánh giá → 0 hết, không chia cho 0', async () => {
    const r = await new ReviewsService(listPrisma([]), analytics, loyalty).listByProduct('tinh-dau');
    expect(r).toMatchObject({ average: 0, count: 0, videoCount: 0, items: [] });
  });
});

describe('ReviewsService.findOwn (nội dung đầy đủ để sửa đánh giá)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const row = { id: 'r1', userId: 'u1', orderId: 'o1', rating: 4, comment: 'ổn', images: [PNG], videoUrl: null, isVisible: true, createdAt: new Date('2026-10-01T00:00:00.000Z') };
  const svc = (review: unknown) =>
    new ReviewsService(makePrisma({ review: { findUnique: jest.fn().mockResolvedValue(review) } }), analytics, loyalty);

  it('chủ đánh giá → nguyên nội dung kèm đơn, ảnh base64 giữ nguyên để gửi lại khi lưu, không lộ userId', async () => {
    const out = await svc(row).findOwn('u1', 'r1');
    expect(out).toEqual({ id: 'r1', orderId: 'o1', rating: 4, comment: 'ổn', images: [PNG], videoUrl: null, isVisible: true, createdAt: row.createdAt });
  });

  it.each([
    ['đánh giá của người khác', row],
    ['không tồn tại', null],
  ])('%s → NotFound (không phân biệt để không lộ đánh giá người khác)', async (_n, review) => {
    await expect(svc(review).findOwn('u2', 'r1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// R2-ENGAGE-3: ảnh base64 (chưa cấu hình Cloudinary) không nhét vào JSON danh sách mà tải riêng, lazy, cache được.
describe('ReviewsService.listByProduct — ảnh base64 không nhúng trong JSON (R2-ENGAGE-3)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const row = (over: Record<string, unknown>) => ({
    id: 'r1', rating: 5, comment: null, images: [], videoUrl: null, createdAt: new Date(), user: { fullName: 'An', avatarUrl: null }, ...over,
  });

  it('ảnh data URL → đường dẫn tải ảnh riêng kèm mã phiên bản; ảnh https giữ nguyên', async () => {
    const prisma = listPrisma([row({ images: [PNG, 'https://res.cloudinary.com/x/a.jpg'] })], [{ rating: 5, n: 1 }]);
    const r = await new ReviewsService(prisma, analytics, loyalty).listByProduct('tinh-dau');
    expect(r.items[0]!.images[0]).toMatch(/^\/reviews\/r1\/images\/0\?v=[0-9a-f]{10}$/);
    expect(r.items[0]!.images[1]).toBe('https://res.cloudinary.com/x/a.jpg');
    expect(JSON.stringify(r)).not.toContain('base64');
  });

  it('mã phiên bản đổi khi ảnh đổi (sửa đánh giá không bị cache ảnh cũ)', async () => {
    const list = async (img: string) =>
      (await new ReviewsService(listPrisma([row({ images: [img] })]), analytics, loyalty).listByProduct('tinh-dau')).items[0]!.images[0];
    expect(await list(PNG)).not.toBe(await list('data:image/png;base64,AAAA'));
  });
});

// R3-UI-10: phản hồi tạo/sửa đánh giá không trả lại nguyên ảnh base64 vừa gửi, cùng cách trả của danh sách.
describe('ReviewsService.create — phản hồi không nhúng ảnh base64 (R3-UI-10)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const HTTPS = 'https://res.cloudinary.com/x/a.jpg';

  it('tạo lần đầu: ảnh data URL thành đường dẫn tải ảnh, ảnh https giữ nguyên, phản hồi không chứa base64', async () => {
    const prisma = makePrisma({
      review: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r9', rating: 5, images: [PNG, HTTPS] }),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 }),
      },
    });
    const out = await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, images: [PNG, HTTPS] } as never);
    expect(out.images[0]).toMatch(/^\/reviews\/r9\/images\/0\?v=[0-9a-f]{10}$/);
    expect(out.images[1]).toBe(HTTPS);
    expect(JSON.stringify(out)).not.toContain('base64');
  });

  it('sửa đánh giá cũ: cũng trả đường dẫn thay cho base64', async () => {
    const prisma = makePrisma({
      review: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'old', userId: 'u1', productId: 'p1', pointsEarned: 5 }),
        update: jest.fn().mockResolvedValue({ id: 'old', rating: 4, images: [PNG] }),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4 }, _count: 1 }),
      },
    });
    const out = await new ReviewsService(prisma, analytics, loyalty).create('u1', 'tinh-dau', { ...dto, images: [PNG] } as never);
    expect(out).toMatchObject({ id: 'old', updated: true });
    expect(out.images[0]).toMatch(/^\/reviews\/old\/images\/0\?v=[0-9a-f]{10}$/);
    expect(JSON.stringify(out)).not.toContain('base64');
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
  $executeRaw: jest.Mock;
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
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    // Đánh giá cho đơn khác của cùng sản phẩm có thể đang được viết song song: nó phải đọc sổ REVIEW sau khi thu hồi xong.
    it('đánh giá đã nhận thưởng → lấy khoá cặp (khách, sản phẩm) của chủ đánh giá trong tx, trước khoá dòng user', async () => {
      const { prisma } = await removeWith({ expiresAt: new Date(now.getTime() + 1) });
      const pairLock = prisma.$executeRaw;
      expect((pairLock.mock.calls[0]![0] as TemplateStringsArray).join('?')).toMatch(/pg_advisory_xact_lock\(hashtext\(\?\)\)/);
      expect(pairLock.mock.calls[0]!.slice(1)).toEqual(['review-reward:u1:p1']);
      const order = (m: jest.Mock) => m.mock.invocationCallOrder[0]!;
      expect(order(prisma.$transaction)).toBeLessThan(order(pairLock));
      expect(order(pairLock)).toBeLessThan(order(prisma.$queryRaw));
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
    expect(p.$executeRaw.mock.calls[0]!.slice(1)).toEqual(['review-reward:u2:p1']);
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
// FE cần biết TRƯỚC khi mở ô soạn — và nay cả viết cho đơn nào (mỗi lần mua một đánh giá).
describe('ReviewsService.canReview', () => {
  type Db = PrismaService & {
    order: { findMany: jest.Mock };
    review: { findMany: jest.Mock };
    pointsTransaction: { findMany: jest.Mock };
  };
  const withPurchases = (purchases: unknown[], mine: unknown[] = [], ledger: { delta: number }[] = []) => {
    const prisma = makePrisma() as Db;
    prisma.order.findMany.mockResolvedValue(purchases);
    prisma.review.findMany.mockResolvedValue(mine);
    prisma.pointsTransaction.findMany.mockResolvedValue(ledger);
    return prisma;
  };
  const mineOn = (orderId: string, over: Record<string, unknown> = {}) => ({
    id: `r-${orderId}`,
    orderId,
    rating: 4,
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    isVisible: true,
    ...over,
  });
  const check = (prisma: PrismaService, userId = 'u1') => new ReviewsService(prisma, analytics, loyalty).canReview(userId, 'tinh-dau');

  it('đã có đơn DELIVERED chứa sản phẩm, chưa đánh giá → được đánh giá, cho đúng đơn đó, có thưởng', async () => {
    const r = await check(makePrisma());
    expect(r).toEqual({
      canReview: true,
      reason: null,
      rewardAvailable: true,
      purchaseCount: 1,
      reviewableOrders: [{ orderId: 'o1', code: 'TB-1', deliveredAt: PURCHASE_O1.deliveredAt }],
      myReviews: [],
    });
  });

  it('chỉ đếm đơn đã nhận mua lẻ cho chính khách, có biến thể của sản phẩm, đơn nhận sớm nhất trước', async () => {
    const prisma = withPurchases([PURCHASE_O1]);
    await check(prisma);
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false, items: { some: { variationId: { in: ['v1'] } } } },
      orderBy: [{ deliveredAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, code: true, deliveredAt: true },
    });
  });

  it('chưa từng mua → không được, kèm lý do để FE hiện đúng thông điệp; không có trường nào khác', async () => {
    const r = await check(withPurchases([]));
    expect(r).toEqual({ canReview: false, reason: 'NOT_PURCHASED' });
  });

  it('mua 2 lần, đã đánh giá lần 1 → vẫn viết được cho lần 2; đánh giá lần 1 nằm trong myReviews kèm mã đơn; hết thưởng', async () => {
    const r = await check(withPurchases([PURCHASE_O1, PURCHASE_O2], [mineOn('o1')], [{ delta: 5 }]));
    expect(r).toEqual({
      canReview: true,
      reason: null,
      rewardAvailable: false,
      purchaseCount: 2,
      reviewableOrders: [{ orderId: 'o2', code: 'TB-2', deliveredAt: PURCHASE_O2.deliveredAt }],
      myReviews: [{ id: 'r-o1', orderId: 'o1', orderCode: 'TB-1', rating: 4, createdAt: new Date('2026-10-02T00:00:00.000Z'), isVisible: true }],
    });
  });

  it('mọi lần mua đã có đánh giá → không viết mới được (ALL_REVIEWED), vẫn trả các đánh giá để sửa, mới nhất trước', async () => {
    const prisma = withPurchases([PURCHASE_O1, PURCHASE_O2], [mineOn('o2'), mineOn('o1', { isVisible: false })], [{ delta: 5 }]);
    const r = await check(prisma);
    expect(r).toMatchObject({ canReview: false, reason: 'ALL_REVIEWED', rewardAvailable: false, purchaseCount: 2, reviewableOrders: [] });
    expect(r.canReview === false && r.reason === 'NOT_PURCHASED' ? [] : r.myReviews.map((m) => [m.orderCode, m.isVisible])).toEqual([
      ['TB-2', true],
      ['TB-1', false],
    ]);
    expect(prisma.review.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', productId: 'p1', orderId: { in: ['o1', 'o2'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, orderId: true, rating: true, createdAt: true, isVisible: true },
    });
  });

  it('hết đơn để viết mới → không đọc sổ điểm (không có đánh giá mới nào để thưởng)', async () => {
    const prisma = withPurchases([PURCHASE_O1], [mineOn('o1')]);
    const r = await check(prisma);
    expect(r).toMatchObject({ rewardAvailable: false });
    expect(prisma.pointsTransaction.findMany).not.toHaveBeenCalled();
  });

  // PG-4: cờ chỉ để FE nói đúng về điểm; dùng đúng luật rewardAlreadyKept của createFirst.
  describe('rewardAvailable', () => {
    const reward = async (ledger: { delta: number }[], mine: unknown[] = []) => {
      const r = await check(withPurchases([PURCHASE_O1, PURCHASE_O2], mine, ledger));
      return r.canReview === false && r.reason === 'NOT_PURCHASED' ? undefined : r.rewardAvailable;
    };

    it('chưa từng đánh giá, sổ điểm trống → true', async () => {
      expect(await reward([])).toBe(true);
    });

    it('đã đánh giá lần mua trước và còn giữ thưởng → false cho đánh giá lần mua sau', async () => {
      expect(await reward([{ delta: 10 }], [mineOn('o1')])).toBe(false);
    });

    it('đã nhận thưởng và đã xoá đánh giá nhưng điểm không thu hồi được (sổ còn dương) → false', async () => {
      expect(await reward([{ delta: 5 }])).toBe(false);
    });

    it('đã nhận thưởng, xoá đánh giá và thu hồi đủ (sổ về 0) → true, giống createFirst', async () => {
      expect(await reward([{ delta: 10 }, { delta: -10 }])).toBe(true);
    });

    it('đọc sổ đúng cặp khách-sản phẩm như luật thưởng (REVIEW:slug, REVIEW_DELETE:id)', async () => {
      const prisma = withPurchases([PURCHASE_O1]);
      await check(prisma);
      expect(prisma.pointsTransaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', refType: 'REVIEW', reason: { in: ['REVIEW:tinh-dau', 'REVIEW_DELETE:p1'] } },
        select: { delta: true },
      });
    });
  });

  it('đã đánh giá nhưng không còn đơn DELIVERED → không được sửa (NOT_PURCHASED như hiện hành)', async () => {
    const r = await check(withPurchases([], [mineOn('o1')]));
    expect(r).toEqual({ canReview: false, reason: 'NOT_PURCHASED' });
  });

  it('sản phẩm không tồn tại → NotFound (không lộ thành "chưa mua")', async () => {
    const prisma = makePrisma({ product: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ReviewsService(prisma, analytics, loyalty).canReview('u1', 'khong-co')).rejects.toBeInstanceOf(NotFoundException);
  });
});
