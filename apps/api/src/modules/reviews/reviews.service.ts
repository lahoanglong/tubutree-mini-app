import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, slug: string, dto: CreateReviewDto) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');

    // Ràng buộc: phải có đơn DELIVERED chứa sản phẩm này.
    const variations = await this.prisma.variation.findMany({
      where: { productId: product.id },
      select: { id: true },
    });
    const variationIds = variations.map((v) => v.id);
    const delivered = await this.prisma.order.findFirst({
      where: {
        userId,
        status: 'DELIVERED',
        items: { some: { variationId: { in: variationIds } } },
      },
    });
    if (!delivered) {
      throw new BadRequestException('Chỉ đánh giá sản phẩm đã mua và nhận hàng.');
    }

    // Mỗi user chỉ đánh giá 1 lần / sản phẩm — tránh farm điểm review.
    const existing = await this.prisma.review.findFirst({ where: { userId, productId: product.id } });
    if (existing) throw new BadRequestException('Bạn đã đánh giá sản phẩm này rồi.');

    const hasImages = (dto.images?.length ?? 0) > 0;
    const pointsEarned = hasImages ? 10 : 5;

    let review;
    try {
      review = await this.prisma.$transaction(async (tx) => {
        const r = await tx.review.create({
          data: {
            userId,
            productId: product.id,
            orderId: delivered.id,
            rating: dto.rating,
            comment: dto.comment,
            images: dto.images ?? [],
            pointsEarned,
          },
        });
        await tx.pointsTransaction.create({
          data: { userId, delta: pointsEarned, reason: `REVIEW:${product.slug}`, refType: 'REVIEW', refId: r.id },
        });
        await tx.user.update({ where: { id: userId }, data: { pointsBalance: { increment: pointsEarned } } });
        return r;
      });
    } catch (err) {
      // Race: 2 request đánh giá đồng thời — unique(userId,productId) chặn cái thứ hai.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Bạn đã đánh giá sản phẩm này rồi.');
      }
      throw err;
    }

    // Cập nhật rating denormalized cho Product (hiển thị sao trên card/PDP).
    await this.recomputeRating(product.id);
    return review;
  }

  /** Tính lại ratingAvg + reviewCount cho 1 sản phẩm từ review hiển thị. */
  private async recomputeRating(productId: string): Promise<void> {
    const agg = await this.prisma.review.aggregate({
      where: { productId, isVisible: true },
      _avg: { rating: true },
      _count: true,
    });
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10,
        reviewCount: agg._count,
      },
    });
  }

  async listByProduct(slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const reviews = await this.prisma.review.findMany({
      where: { productId: product.id, isVisible: true },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true, avatarUrl: true } } },
      take: 100,
    });
    const avg =
      reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
    // Phân bổ sao 5→1 (breakdown) cho UI biểu đồ.
    const distribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviews) distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
    return {
      average: Math.round(avg * 10) / 10,
      count: reviews.length,
      distribution,
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        images: r.images,
        createdAt: r.createdAt,
        author: r.user.fullName ?? 'Khách Tubu',
        avatar: r.user.avatarUrl,
        // Mọi review đều ràng buộc đơn DELIVERED (§6.13) → luôn là khách đã mua.
        verifiedPurchase: true,
      })),
    };
  }

  async remove(userId: string, role: string, id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Không tìm thấy đánh giá.');
    if (review.userId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException('Không có quyền xóa đánh giá này.');
    }
    await this.prisma.review.delete({ where: { id } });
    await this.recomputeRating(review.productId);
    return { ok: true };
  }
}
