import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/review.dto';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { isUploadedImage, isUploadedMediaUrl, PUBLIC_CONTENT_IMAGE } from '../../common/uploaded-image';
import { decodeServedImage } from '../../common/served-image';
import { returnedProductsByOrder, REVIEWABLE_ORDER, reviewRewardLockKey } from './review-eligibility';
import { reviewReturnReason, takeBackReviewReward } from './review-reward-reversal';
import { publicDisplayName } from '../../common/mask-name';

type Db = PrismaService | Prisma.TransactionClient;

const errCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;

/**
 * Ảnh đánh giá trong danh sách công khai. Ảnh base64 (khi chưa cấu hình Cloudinary) nặng tới ~700 nghìn ký tự/ảnh nên
 * không nhúng trong JSON: trả đường dẫn tương đối tới API (`/reviews/:id/images/:i`) để trình duyệt tải lười và cache;
 * `v` là mã băm nội dung để sửa đánh giá không dính ảnh cũ trong cache. Ảnh https (Cloudinary) giữ nguyên.
 */
export function reviewImageRef(reviewId: string, index: number, image: string): string {
  if (!image.startsWith('data:')) return image;
  const version = createHash('sha1').update(image).digest('hex').slice(0, 10);
  return `/reviews/${reviewId}/images/${index}?v=${version}`;
}

/** Số lần thử lại khi tạo/sửa thua một request đồng thời của chính người đó (tạo cùng lúc, hoặc xoá đúng lúc sửa). */
const SAVE_ATTEMPTS = 3;

/** Số dòng tối đa của danh sách đánh giá công khai (FE hiện dần 5 dòng một). */
const LIST_LIMIT = 100;

export interface MyReviewRef {
  id: string;
  orderId: string;
  orderCode: string | null;
  rating: number;
  createdAt: Date;
  isVisible: boolean;
}

export type CanReviewResult =
  | { canReview: false; reason: 'NOT_PURCHASED' }
  | {
      canReview: boolean;
      reason: 'ALL_REVIEWED' | null;
      /** Đánh giá MỚI lúc này có được cộng Điểm Xanh không (chỉ đánh giá đầu tiên của cặp khách-sản phẩm được thưởng). */
      rewardAvailable: boolean;
      /**
       * Vì sao `rewardAvailable` là false, để FE nói đúng: ALREADY_KEPT = khách đang giữ thưởng của sản phẩm này; RETURNED =
       * mọi đơn còn lại đã có dòng trả được duyệt cho sản phẩm này (khách chưa nhận thưởng nào); NO_ORDER = hết đơn để viết mới.
       */
      rewardUnavailableReason: 'ALREADY_KEPT' | 'RETURNED' | 'NO_ORDER' | null;
      /** Số lần mua đã nhận có sản phẩm này. */
      purchaseCount: number;
      reviewableOrders: { orderId: string; code: string; deliveredAt: Date | null }[];
      myReviews: MyReviewRef[];
    };

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsEventsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  /**
   * Người dùng viết được đánh giá MỚI cho sản phẩm này không, và cho đơn nào — để FE hỏi TRƯỚC khi mở ô soạn.
   * Không có endpoint này, trang sản phẩm mở ô đánh giá cho mọi user đăng nhập; khách chưa mua
   * chọn sao, upload ảnh/video (đã tải lên server) rồi bấm Gửi mới nhận lỗi và mất trắng công
   * sức (P1-2, audit mạch lạc B2C). Trả kèm `reason` để FE nói đúng lý do thay vì báo chung.
   *
   * Mỗi lần mua (đơn đã nhận) một đánh giá: `reviewableOrders` là các đơn chưa đánh giá, đơn nhận sớm nhất trước (FE viết
   * cho đơn đầu khi khách không chọn đơn). `myReviews` là các đánh giá khách đã viết cho sản phẩm này ở những đơn đó (mới
   * nhất trước) để FE gắn nút sửa đúng dòng; nội dung đầy đủ để sửa lấy ở GET /reviews/:id.
   */
  async canReview(userId: string, slug: string): Promise<CanReviewResult> {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');

    const purchases = await this.purchasesOf(userId, product.id);
    if (purchases.length === 0) return { canReview: false, reason: 'NOT_PURCHASED' };

    const mine = await this.prisma.review.findMany({
      where: { userId, productId: product.id, orderId: { in: purchases.map((o) => o.id) } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, orderId: true, rating: true, createdAt: true, isVisible: true },
    });
    const reviewed = new Set(mine.map((r) => r.orderId));
    const codeOf = new Map(purchases.map((o) => [o.id, o.code]));
    const unreviewed = purchases.filter((o) => !reviewed.has(o.id));
    // Đánh giá viết cho đơn mà sản phẩm đã có dòng trả được duyệt không được thưởng (createFirst), nên đơn chưa bị trả sản phẩm
    // này đứng trước: FE mặc định viết cho đơn đầu danh sách, nếu không thì gợi ý có điểm nhưng khách nhận 0.
    const returnedBy = await returnedProductsByOrder(this.prisma, unreviewed.map((o) => o.id));
    const returned = (orderId: string) => returnedBy.get(orderId)?.has(product.id) ?? false;
    const reviewableOrders = [...unreviewed.filter((o) => !returned(o.id)), ...unreviewed.filter((o) => returned(o.id))].map((o) => ({
      orderId: o.id,
      code: o.code,
      deliveredAt: o.deliveredAt,
    }));
    // Chỉ để FE nói đúng về điểm: máy chủ vẫn quyết định thưởng lúc tạo (createFirst, cùng rewardAlreadyKept). Hết đơn để
    // viết mới, hay mọi đơn còn lại đều đã bị trả sản phẩm này, thì không có đánh giá mới nào để thưởng.
    const hasFreshOrder = reviewableOrders.some((o) => !returned(o.orderId));
    // Đã giữ thưởng thì câu "đã nhận" luôn đúng, nên xét trước lý do "đã trả".
    const kept = reviewableOrders.length > 0 && (await this.rewardAlreadyKept(this.prisma, userId, product));
    const rewardUnavailableReason: 'ALREADY_KEPT' | 'RETURNED' | 'NO_ORDER' | null =
      reviewableOrders.length === 0 ? 'NO_ORDER' : kept ? 'ALREADY_KEPT' : hasFreshOrder ? null : 'RETURNED';
    const rewardAvailable = rewardUnavailableReason === null;
    return {
      canReview: reviewableOrders.length > 0,
      reason: reviewableOrders.length > 0 ? null : 'ALL_REVIEWED',
      rewardAvailable,
      rewardUnavailableReason,
      purchaseCount: purchases.length,
      reviewableOrders,
      myReviews: mine.map((r) => ({ ...r, orderCode: codeOf.get(r.orderId) ?? null })),
    };
  }

  /** Các lần mua sản phẩm của khách tính để đánh giá (REVIEWABLE_ORDER), đơn nhận sớm nhất trước. */
  private async purchasesOf(userId: string, productId: string) {
    const variations = await this.prisma.variation.findMany({ where: { productId }, select: { id: true } });
    return this.prisma.order.findMany({
      where: { userId, ...REVIEWABLE_ORDER, items: { some: { variationId: { in: variations.map((v) => v.id) } } } },
      orderBy: [{ deliveredAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, code: true, deliveredAt: true },
    });
  }

  /**
   * Đơn mà lần gửi này đánh giá. Khách chọn đơn thì đơn đó phải là một lần mua tính được của chính khách. Không gửi đơn
   * (bản app cũ chưa biết chọn đơn): đơn nhận sớm nhất chưa có đánh giá; mọi đơn đều đã có đánh giá thì gửi lại là sửa
   * đánh giá mới nhất, đúng như bản cũ sửa đánh giá duy nhất của khách.
   */
  private async targetOrder(
    userId: string,
    productId: string,
    purchases: { id: string }[],
    requested: string | undefined,
  ): Promise<string> {
    if (requested !== undefined) {
      if (!purchases.some((o) => o.id === requested)) {
        throw new BadRequestException('Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.');
      }
      return requested;
    }
    const reviewed = await this.prisma.review.findMany({
      where: { userId, productId, orderId: { in: purchases.map((o) => o.id) } },
      orderBy: { createdAt: 'desc' },
      select: { orderId: true },
    });
    const done = new Set(reviewed.map((r) => r.orderId));
    return purchases.find((o) => !done.has(o.id))?.id ?? reviewed[0]!.orderId;
  }

  async create(userId: string, slug: string, dto: CreateReviewDto) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');

    // Ràng buộc: phải có đơn đã nhận (REVIEWABLE_ORDER) chứa sản phẩm này.
    const purchases = await this.purchasesOf(userId, product.id);
    if (purchases.length === 0) {
      throw new BadRequestException('Chỉ đánh giá sản phẩm đã mua và nhận hàng.');
    }
    const orderId = await this.targetOrder(userId, product.id, purchases, dto.orderId);

    // Mỗi lần mua một đánh giá (unique userId+productId+orderId). Đơn đã có đánh giá thì gửi lại = SỬA đánh giá đó và KHÔNG
    // thưởng điểm. Khoá unique là chốt chặn cuối cho cùng một đơn: hai request tạo đồng thời thì request thua nhận P2002 ở
    // bước tạo (trước cả bước ghi điểm, cùng transaction) rồi đọc lại và chuyển sang sửa. Thưởng giữa các đơn khác nhau
    // của cùng sản phẩm do khoá advisory trong createFirst giữ.
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const existing = await this.prisma.review.findUnique({
        where: { userId_productId_orderId: { userId, productId: product.id, orderId } },
      });
      try {
        const review = existing
          ? await this.updateOwn(userId, product, orderId, dto)
          : await this.createFirst(userId, product, orderId, dto);
        return { ...review, images: review.images.map((img, i) => reviewImageRef(review.id, i, img)), updated: !!existing };
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
    // Cùng luật với CreateReviewDto (MONEY-10): media lọt qua DTO bằng đường khác vẫn không được thưởng thêm.
    const hasVideo = isUploadedMediaUrl(dto.videoUrl);
    const hasImages = (dto.images ?? []).some((img) => isUploadedImage(img, PUBLIC_CONTENT_IMAGE));
    const rewardPoints = hasVideo ? 15_000 : hasImages ? 10_000 : 5_000;
    // Điểm đánh giá là Điểm Xanh thường nên có hạn như mọi điểm thưởng khác. Đọc cấu hình NGOÀI tx để không giữ
    // kết nối tx; lượt thua race P2002 ở bước tạo chỉ tốn một lần đọc cấu hình.
    const expiresAt = await this.loyalty.pointsExpiresAt(new Date());

    return this.prisma.$transaction(async (tx) => {
      // Đọc trạng thái đơn ở ngoài tx (purchasesOf) có thể cũ: đơn đang được trả cả đơn thì lần đảo (đã ghi trạng thái, giữ
      // khoá dòng đơn) đã quét thưởng đánh giá trước khi đánh giá này tồn tại. Khoá chung dòng đơn để hoặc chờ lần đảo xong
      // rồi từ chối, hoặc ghi xong trước khi lần đảo lật trạng thái và lần đảo thấy đánh giá. Lấy khoá đơn TRƯỚC khoá cặp
      // (cùng thứ tự với lần đảo: dòng đơn, rồi khoá cặp, rồi dòng user) để không deadlock. Gộp phiên khách và ẩn danh hoá
      // cũng khoá dòng đơn của khách trước dòng users nên cùng thứ tự; bỏ một trong các khoá đơn đó là deadlock trở lại
      // (p3-review-return-merge.race-spec). Đòi đơn còn đúng của người gọi: đơn vừa gộp sang tài khoản đích thì phiên khách
      // cũ không được ghi đánh giá và điểm thưởng vào dòng khách đã gộp.
      const [order] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status"::text AS "status" FROM "orders" WHERE "id" = ${orderId} AND "userId" = ${userId} FOR SHARE`;
      if (order?.status === 'RETURNED') throw new BadRequestException('Đơn này đã trả hàng nên không đánh giá mới được.');
      if (order?.status !== REVIEWABLE_ORDER.status) {
        throw new BadRequestException('Đơn này chưa giao tới bạn hoặc không có sản phẩm này nên chưa đánh giá được.');
      }
      // pointsEarned nằm ngay trên dòng đánh giá nên phải biết trước review.create. Thưởng chỉ cho đánh giá đầu tiên của
      // cặp (khách, sản phẩm) nhưng đánh giá cho đơn khác không chạm khoá unique của đơn này: khoá theo cặp để sổ REVIEW
      // của cặp không đổi giữa lúc đọc và lúc ghi, lượt chờ khoá đọc được dòng thưởng lượt trước vừa ghi.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reviewRewardLockKey(userId, product.id)}))`;
      // Sản phẩm đã bị trả (dù một phần) trên chính đơn này: lần duyệt trả không còn đánh giá nào để thu hồi nên thưởng ở
      // đây sẽ không bao giờ bị lấy lại. Lần duyệt giữ cùng khoá cặp tới khi commit nên đọc ở đây thấy đủ.
      const returned = (await returnedProductsByOrder(tx, [orderId])).get(orderId)?.has(product.id) ?? false;
      const pointsEarned = returned || (await this.rewardAlreadyKept(tx, userId, product)) ? 0 : rewardPoints;
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
      if (pointsEarned > 0) {
        await tx.pointsTransaction.create({
          data: { userId, delta: pointsEarned, reason: `REVIEW:${product.slug}`, refType: 'REVIEW', refId: r.id, expiresAt },
        });
        await tx.user.update({ where: { id: userId }, data: { pointsBalance: { increment: pointsEarned } } });
      }
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
   * Khách đã nhận thưởng đánh giá của sản phẩm này và còn giữ nó chưa. Thưởng chỉ cho đánh giá đầu tiên của cặp (khách,
   * sản phẩm): mua lại rồi viết đánh giá cho đơn sau không được thưởng thêm. Xoá rồi tạo lại chỉ được thưởng lại khi lần
   * xoá đã thu hồi đủ điểm đã thưởng (tạo, xoá, tạo lại ra đúng một lần thưởng). Điểm đã tiêu
   * hết nên không thu hồi được, hay đã hết hạn và cron đã trừ, thì thưởng đó khách đã dùng rồi: tạo lại không thưởng
   * thêm, không thì vòng tạo, tiêu điểm, xoá, tạo lại cho điểm vô hạn.
   *
   * Cộng mọi dòng sổ REVIEW của cặp (khách, sản phẩm): thưởng dương `REVIEW:<slug>`, thu hồi âm `REVIEW_DELETE:<id sản
   * phẩm>` (xoá đánh giá) và `REVIEW_RETURN:<id đánh giá>` (trả hàng); còn dương nghĩa là còn phần thưởng chưa thu hồi. Dòng
   * trả hàng không mang id sản phẩm nên tra theo id đánh giá của các dòng thưởng của cặp. slug không đổi sau khi tạo sản
   * phẩm (đồng bộ Pancake chỉ ghi slug lúc tạo).
   */
  private async rewardAlreadyKept(tx: Db, userId: string, product: { id: string; slug: string }): Promise<boolean> {
    const rows = await tx.pointsTransaction.findMany({
      where: {
        userId,
        refType: 'REVIEW',
        reason: { in: [`REVIEW:${product.slug}`, `REVIEW_DELETE:${product.id}`] },
      },
      select: { delta: true, refId: true },
    });
    const rewardedReviewIds = rows.filter((r) => r.delta > 0 && r.refId).map((r) => r.refId as string);
    const returnRows = rewardedReviewIds.length
      ? await tx.pointsTransaction.findMany({
          where: { userId, refType: 'REVIEW', reason: { in: rewardedReviewIds.map(reviewReturnReason) } },
          select: { delta: true },
        })
      : [];
    return [...rows, ...returnRows].reduce((sum, r) => sum + r.delta, 0) > 0;
  }

  /**
   * Sửa đánh giá của chính người gọi cho một lần mua (khoá theo userId+productId+orderId nên không thể sửa của người
   * khác). Thay toàn bộ sao/nội dung/ảnh/video như lúc tạo; giữ nguyên điểm đã thưởng (pointsEarned còn được `remove` dùng
   * để hoàn điểm), orderId và isVisible — sửa không gỡ được lệnh ẩn của admin.
   */
  private async updateOwn(userId: string, product: { id: string; slug: string }, orderId: string, dto: CreateReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.review.update({
        where: { userId_productId_orderId: { userId, productId: product.id, orderId } },
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

  /**
   * Danh sách công khai: mọi đánh giá đang hiện, mới nhất trước, tối đa LIST_LIMIT dòng. Điểm trung bình, số đánh giá,
   * phân bổ sao và số đánh giá có video tính trên TẤT CẢ đánh giá đang hiện (khớp ratingAvg/reviewCount của sản phẩm),
   * không chỉ trên các dòng trả về.
   */
  async listByProduct(slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const where = { productId: product.id, isVisible: true };
    const [reviews, byRating, videoCount] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { fullName: true } } },
        take: LIST_LIMIT,
      }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
      this.prisma.review.count({ where: { ...where, videoUrl: { not: null } } }),
    ]);
    // Phân bổ sao 5→1 (breakdown) cho UI biểu đồ.
    const distribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let count = 0;
    let sum = 0;
    for (const g of byRating) {
      distribution[g.rating] = (distribution[g.rating] ?? 0) + g._count._all;
      count += g._count._all;
      sum += g.rating * g._count._all;
    }
    return {
      average: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
      count,
      videoCount,
      distribution,
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        images: r.images.map((img, i) => reviewImageRef(r.id, i, img)),
        videoUrl: r.videoUrl,
        createdAt: r.createdAt,
        author: publicDisplayName(r.user.fullName, 'Khách Tubu'),
        // Mọi review đều ràng buộc đơn DELIVERED (§6.13) → luôn là khách đã mua.
        verifiedPurchase: true,
      })),
    };
  }

  /**
   * Một đánh giá của chính người gọi, nguyên nội dung (ảnh base64 không đổi thành đường dẫn) để FE điền sẵn form sửa và
   * gửi lại đúng ảnh cũ. Đánh giá của người khác trả 404 như không tồn tại.
   */
  async findOwn(userId: string, id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        orderId: true,
        rating: true,
        comment: true,
        images: true,
        videoUrl: true,
        isVisible: true,
        createdAt: true,
      },
    });
    if (!review || review.userId !== userId) throw new NotFoundException('Không tìm thấy đánh giá.');
    return {
      id: review.id,
      orderId: review.orderId,
      rating: review.rating,
      comment: review.comment,
      images: review.images,
      videoUrl: review.videoUrl,
      isVisible: review.isVisible,
      createdAt: review.createdAt,
    };
  }

  /** Byte của ảnh base64 thứ `index` trong một đánh giá đang hiện (đích của `reviewImageRef`). */
  async getImage(reviewId: string, index: number): Promise<{ mime: string; data: Buffer }> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId }, select: { isVisible: true, images: true } });
    const image = review?.isVisible && Number.isInteger(index) && index >= 0 ? review.images[index] : undefined;
    const decoded = decodeServedImage(image);
    if (!decoded) throw new NotFoundException('Không tìm thấy ảnh.');
    return decoded;
  }

  async remove(userId: string, role: string, id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Không tìm thấy đánh giá.');
    if (review.userId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException('Không có quyền xoá đánh giá này.');
    }
    await this.prisma.$transaction(async (tx) => {
      // Cùng khoá cặp (khách, sản phẩm) với createFirst và lấy trước khoá dòng user như createFirst: đánh giá mới viết song
      // song với lần xoá này đọc sổ REVIEW sau khi thu hồi đã ghi xong.
      if (review.pointsEarned > 0) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reviewRewardLockKey(review.userId, review.productId)}))`;
      }
      // Khoá dòng user TRƯỚC khi đọc hạn của dòng thưởng: cron hết hạn cũng khoá dòng này rồi mới trừ lô đã quá hạn.
      // Đọc hạn khi chưa có khoá thì lô chạm hạn đúng lúc cron đang trừ nó vẫn bị coi là còn hạn, và thu hồi ghi sau
      // đó trừ thêm lần hai. Số dư đọc cùng câu khoá để chặn thu hồi quá số dư.
      const locked =
        review.pointsEarned > 0
          ? await tx.$queryRaw<{ pointsBalance: number }[]>`SELECT "pointsBalance" FROM "users" WHERE "id" = ${review.userId} FOR UPDATE`
          : [];
      await tx.review.delete({ where: { id } });
      // Hoàn tác điểm đã thưởng lúc tạo review — nếu không, user có thể farm điểm vô hạn bằng cách tạo review (+điểm)
      // rồi xóa (đơn đó mở lại để viết) rồi tạo lại. Đánh giá không nhận thưởng (pointsEarned 0) không thu hồi gì. Không
      // thu hồi được gì thì không ghi dòng nào (khác đơn hàng, xoá đánh giá không cần dấu "đã xử lý": dòng đánh giá đã mất
      // nên không có lượt xoá thứ hai).
      if (review.pointsEarned > 0) {
        await takeBackReviewReward(tx, review, locked[0]?.pointsBalance ?? 0, `REVIEW_DELETE:${review.productId}`);
      }
      await this.recomputeRating(review.productId, tx);
    });
    return { ok: true };
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
