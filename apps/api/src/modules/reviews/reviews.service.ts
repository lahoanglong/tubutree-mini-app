import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/review.dto';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { LoyaltyService } from '../loyalty/loyalty.service';

type Db = PrismaService | Prisma.TransactionClient;

const errCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;

/** Số lần thử lại khi tạo/sửa thua một request đồng thời của chính người đó (tạo cùng lúc, hoặc xoá đúng lúc sửa). */
const SAVE_ATTEMPTS = 3;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsEventsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  /**
   * Người dùng có được đánh giá sản phẩm này không — để FE hỏi TRƯỚC khi mở ô soạn.
   * Không có endpoint này, trang sản phẩm mở ô đánh giá cho mọi user đăng nhập; khách chưa mua
   * chọn sao, upload ảnh/video (đã tải lên server) rồi bấm Gửi mới nhận lỗi và mất trắng công
   * sức (P1-2, audit mạch lạc B2C). Trả kèm `reason` để FE nói đúng lý do thay vì báo chung.
   */
  async canReview(
    userId: string,
    slug: string,
  ): Promise<{
    canReview: boolean;
    reason: 'NOT_PURCHASED' | null;
    myReview?: { id: string; rating: number; comment: string | null; images: string[]; videoUrl: string | null } | null;
  }> {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');

    const variations = await this.prisma.variation.findMany({
      where: { productId: product.id },
      select: { id: true },
    });
    const delivered = await this.prisma.order.findFirst({
      where: {
        userId,
        status: 'DELIVERED',
        items: { some: { variationId: { in: variations.map((v) => v.id) } } },
      },
      select: { id: true },
    });
    if (!delivered) return { canReview: false, reason: 'NOT_PURCHASED' };

    // Q-30: đã có đánh giá thì vẫn được (mua lại → sửa đánh giá cũ); trả đánh giá hiện có để FE điền sẵn form.
    const existing = await this.prisma.review.findFirst({ where: { userId, productId: product.id } });
    return {
      canReview: true,
      reason: null,
      myReview: existing
        ? {
            id: existing.id,
            rating: existing.rating,
            comment: existing.comment,
            images: existing.images,
            videoUrl: existing.videoUrl,
          }
        : null,
    };
  }

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

    // Q-30: mỗi người một đánh giá cho mỗi sản phẩm (unique userId+productId). Đã có thì gọi tạo
    // lại = SỬA đánh giá cũ và KHÔNG thưởng điểm; chỉ lần tạo đầu được thưởng (chống farm điểm).
    // Khoá unique là chốt chặn cuối: hai request tạo đồng thời thì request thua nhận P2002 ở bước
    // tạo (trước cả bước ghi điểm, cùng transaction) rồi đọc lại và chuyển sang sửa.
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const existing = await this.prisma.review.findFirst({ where: { userId, productId: product.id } });
      try {
        const review = existing
          ? await this.updateOwn(userId, product, dto)
          : await this.createFirst(userId, product, delivered.id, dto);
        return { ...review, updated: !!existing };
      } catch (err) {
        const lostRace = errCode(err) === (existing ? 'P2025' : 'P2002');
        if (!lostRace) throw err;
      }
    }
    throw new ConflictException('Không lưu được đánh giá do thao tác đồng thời, vui lòng thử lại.');
  }

  private async createFirst(
    userId: string,
    product: { id: string; slug: string },
    orderId: string,
    dto: CreateReviewDto,
  ) {
    // Thưởng điểm theo độ phong phú UGC: video (§6.14.9) > ảnh > chỉ chữ.
    const hasVideo = !!dto.videoUrl;
    const hasImages = (dto.images?.length ?? 0) > 0;
    const pointsEarned = hasVideo ? 15 : hasImages ? 10 : 5;
    // Điểm đánh giá là Điểm Xanh thường nên có hạn như mọi điểm thưởng khác. Đọc cấu hình NGOÀI tx để không giữ
    // kết nối tx; lượt thua race P2002 ở bước tạo chỉ tốn một lần đọc cấu hình.
    const expiresAt = await this.loyalty.pointsExpiresAt(new Date());

    return this.prisma.$transaction(async (tx) => {
      const r = await tx.review.create({
        data: {
          userId,
          productId: product.id,
          orderId,
          rating: dto.rating,
          comment: dto.comment,
          images: dto.images ?? [],
          videoUrl: dto.videoUrl ?? null,
          pointsEarned,
        },
      });
      await tx.pointsTransaction.create({
        data: { userId, delta: pointsEarned, reason: `REVIEW:${product.slug}`, refType: 'REVIEW', refId: r.id, expiresAt },
      });
      await tx.user.update({ where: { id: userId }, data: { pointsBalance: { increment: pointsEarned } } });
      // Cập nhật rating denormalized cho Product (hiển thị sao trên card/PDP) — trong
      // cùng transaction để tránh lệch dữ liệu nếu bước này lỗi sau khi review đã tạo.
      await this.recomputeRating(product.id, tx);
      await this.analytics.record(tx, {
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'review_created', productSlug: product.slug, pointsEarned },
      });
      return r;
    });
  }

  /**
   * Sửa đánh giá của chính người gọi (khoá theo userId+productId nên không thể sửa của người khác).
   * Thay toàn bộ sao/nội dung/ảnh/video như lúc tạo; giữ nguyên điểm đã thưởng (pointsEarned còn
   * được `remove` dùng để hoàn điểm), orderId và isVisible — sửa không gỡ được lệnh ẩn của admin.
   */
  private async updateOwn(userId: string, product: { id: string; slug: string }, dto: CreateReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.review.update({
        where: { userId_productId: { userId, productId: product.id } },
        data: {
          rating: dto.rating,
          comment: dto.comment ?? null,
          images: dto.images ?? [],
          videoUrl: dto.videoUrl ?? null,
        },
      });
      await this.recomputeRating(product.id, tx);
      await this.analytics.record(tx, {
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'review_updated', productSlug: product.slug, pointsEarned: 0 },
      });
      return r;
    });
  }

  /** Tính lại ratingAvg + reviewCount cho 1 sản phẩm từ review hiển thị. */
  private async recomputeRating(productId: string, db: Db = this.prisma): Promise<void> {
    const agg = await db.review.aggregate({
      where: { productId, isVisible: true },
      _avg: { rating: true },
      _count: true,
    });
    await db.product.update({
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
      videoCount: reviews.filter((r) => !!r.videoUrl).length,
      distribution,
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        images: r.images,
        videoUrl: r.videoUrl,
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
    await this.prisma.$transaction(async (tx) => {
      // Khoá dòng user TRƯỚC khi đọc hạn của dòng thưởng: cron hết hạn cũng khoá dòng này rồi mới trừ lô đã quá hạn.
      // Đọc hạn khi chưa có khoá thì lô chạm hạn đúng lúc cron đang trừ nó vẫn bị coi là còn hạn, và thu hồi ghi sau
      // đó trừ thêm lần hai.
      if (review.pointsEarned > 0) {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${review.userId} FOR UPDATE`;
      }
      await tx.review.delete({ where: { id } });
      // Hoàn tác điểm đã thưởng lúc tạo review — nếu không, user có thể farm điểm vô hạn
      // bằng cách tạo review (+điểm) rồi xóa (unique(userId,productId) mở lại) rồi tạo lại.
      // Điểm thưởng đã quá hạn thì cron đã (hoặc sẽ) trừ chính các điểm đó; thu hồi thêm là trừ hai lần và có thể kéo
      // số dư âm. Dòng gốc cũ không hạn (trước PE-3) hoặc không tìm thấy thì thu hồi như cũ.
      if (review.pointsEarned > 0 && !(await this.rewardExpired(tx, review.userId, id))) {
        await tx.pointsTransaction.create({
          data: {
            userId: review.userId,
            delta: -review.pointsEarned,
            reason: `REVIEW_DELETE:${review.productId}`,
            refType: 'REVIEW',
            refId: id,
          },
        });
        await tx.user.update({
          where: { id: review.userId },
          data: { pointsBalance: { increment: -review.pointsEarned } },
        });
      }
      await this.recomputeRating(review.productId, tx);
    });
    return { ok: true };
  }

  /** Dòng thưởng của đánh giá đã tới hạn chưa; cùng quy tắc `expiresAt <= now` với cron hết hạn. */
  private async rewardExpired(tx: Prisma.TransactionClient, userId: string, reviewId: string): Promise<boolean> {
    const credit = await tx.pointsTransaction.findFirst({
      where: { userId, refType: 'REVIEW', refId: reviewId, delta: { gt: 0 } },
      select: { expiresAt: true },
    });
    return credit?.expiresAt != null && credit.expiresAt.getTime() <= Date.now();
  }

  /** Admin ẩn/hiện review vi phạm (§6.13: ẩn KHÔNG xóa) — rating tính lại loại review ẩn. */
  async setVisibility(id: string, isVisible: boolean) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Không tìm thấy đánh giá.');
    await this.prisma.review.update({ where: { id }, data: { isVisible } });
    await this.recomputeRating(review.productId);
    return { ok: true, isVisible };
  }
}
