import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import type { PrismaService } from '../../prisma/prisma.service';

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
    await expect(new ReviewsService(prisma).create('u1', 'x', dto as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('chưa có đơn DELIVERED → BadRequest', async () => {
    const prisma = makePrisma({ order: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(new ReviewsService(prisma).create('u1', 'tinh-dau', dto as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('đã đánh giá sản phẩm này rồi → BadRequest (chống farm điểm)', async () => {
    const prisma = makePrisma({
      review: {
        findFirst: jest.fn().mockResolvedValue({ id: 'old' }),
        create: jest.fn(),
        aggregate: jest.fn(),
      },
    });
    await expect(new ReviewsService(prisma).create('u1', 'tinh-dau', dto as never)).rejects.toThrow(
      'đã đánh giá',
    );
    expect((prisma as unknown as { review: { create: jest.Mock } }).review.create).not.toHaveBeenCalled();
  });

  it('hợp lệ không ảnh → +5 điểm, recompute rating denormalized', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma).create('u1', 'tinh-dau', dto as never);
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
    await new ReviewsService(prisma).create('u1', 'tinh-dau', { ...dto, images: ['a.jpg'] } as never);
    const ptx = (prisma as unknown as { pointsTransaction: { create: jest.Mock } }).pointsTransaction.create;
    expect(ptx.mock.calls[0][0].data.delta).toBe(10);
  });

  it('có video (UGC) → +15 điểm + lưu videoUrl', async () => {
    const prisma = makePrisma();
    await new ReviewsService(prisma).create('u1', 'tinh-dau', {
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

  it('race P2002 khi tạo → dịch sang BadRequest', async () => {
    const prisma = makePrisma();
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(new ReviewsService(prisma).create('u1', 'tinh-dau', dto as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
    const r = await new ReviewsService(prisma).listByProduct('tinh-dau');
    expect(r.count).toBe(2);
    expect(r.videoCount).toBe(1);
    expect(r.items[0]!.videoUrl).toBe('https://x/v.mp4');
    expect(r.items[1]!.videoUrl).toBeNull();
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
    const r = await new ReviewsService(prisma).setVisibility('r1', false);
    expect(r).toEqual({ ok: true, isVisible: false });
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { isVisible: false } });
    expect((prisma as unknown as { review: { delete: jest.Mock } }).review.delete).not.toHaveBeenCalled();
  });

  it('review không tồn tại → NotFound', async () => {
    const prisma = makePrisma({ review: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(new ReviewsService(prisma).setVisibility('x', false)).rejects.toBeInstanceOf(NotFoundException);
  });
});
