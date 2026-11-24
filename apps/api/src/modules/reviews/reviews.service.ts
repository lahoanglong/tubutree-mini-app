import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto, type PublicReviewsQuery } from './dto/review.dto';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { isUploadedImage, isUploadedMediaUrl, PUBLIC_CONTENT_IMAGE } from '../../common/uploaded-image';
import { decodeServedImage } from '../../common/served-image';
import { returnedProductsByOrder, REVIEWABLE_ORDER, reviewRewardLockKey } from './review-eligibility';
import { reviewReturnReason, takeBackReviewReward } from './review-reward-reversal';
import { publicDisplayName } from '../../common/mask-name';
import { decodeKeysetCursor, encodeKeysetCursor, KEYSET_ORDER, keysetAfter } from '../../common/keyset-cursor';
import { endOfVnDay, startOfVnDay } from '../../common/vn-time';
import { PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';
import { GREEN_CORNER_MAX_ITEMS, GREEN_CORNER_MAX_PHOTOS, normalizeEcoTags, type GreenCornerResponse } from '@tubutree/shared-types';
// Import giá trị (không `import type`): Nest đọc kiểu tham số constructor lúc chạy để tiêm SystemConfigService.
import { SystemConfigService } from '../system-config/system-config.service';
import {
  clipComment,
  photoRewardCapLockKey,
  photoRewardReason,
  readGreenCornerConfig,
  reviewMediaKey,
  type ApproveResult,
  type GreenCornerConfig,
  type PhotoRewardSkip,
} from './review-green-corner';

type Db = PrismaService | Prisma.TransactionClient;

/** Không có SystemConfigService (spec dựng tay): Góc Sống Xanh tắt, mọi luật như trước. */
const PROGRAM_OFF: GreenCornerConfig = { enabled: false, rewardPoints: 0, dailyCap: 0 };

/** Ảnh/video thật theo cùng luật thưởng (MONEY-10): chuỗi lạ lọt qua đường khác không tính là media. */
const hasRealMedia = (images: readonly string[] | undefined, videoUrl: string | null | undefined): boolean =>
  isUploadedMediaUrl(videoUrl ?? undefined) || (images ?? []).some((img) => isUploadedImage(img, PUBLIC_CONTENT_IMAGE));

/**
 * Trạng thái duyệt sau khi khách sửa đánh giá. Hàng chờ chỉ áp khi Góc Sống Xanh bật hoặc đánh giá đang chờ duyệt; còn lại như cũ.
 * - Đổi ảnh/video thì luôn bỏ mốc duyệt cũ, kể cả khi cờ tắt: mốc duyệt chỉ đúng cho ảnh admin đã xem (bật lại cờ, dải Trang chủ không
 *   hiện ảnh chưa ai duyệt).
 * - Admin đã ẩn (không hiện, không chờ): giữ ẩn, sửa không gỡ được lệnh ẩn.
 * - Có ảnh/video và đổi media (hoặc vẫn đang chờ): về hàng chờ, chưa công khai, ghi lại lúc vào hàng chờ.
 * - Đang chờ mà bỏ hết ảnh/video: thành đánh giá chỉ chữ, hiện ngay như đánh giá chỉ chữ mới.
 * `existing.imageVersions` là cột trigger DB giữ theo `images` (cùng công thức `reviewImageVersions`).
 */
export function moderationAfterEdit(
  program: GreenCornerConfig,
  existing: { imageVersions: readonly string[]; videoUrl: string | null; isVisible: boolean; awaitingApproval?: boolean; approvedAt?: Date | null },
  dto: { images?: string[]; videoUrl?: string },
  now: Date = new Date(),
): { awaitingApproval?: boolean; isVisible?: boolean; approvedAt?: null; photoQueuedAt?: Date } {
  const awaiting = existing.awaitingApproval === true;
  const images = dto.images ?? [];
  const videoUrl = dto.videoUrl ?? null;
  const mediaChanged = videoUrl !== existing.videoUrl || JSON.stringify(reviewImageVersions(images)) !== JSON.stringify(existing.imageVersions);
  const unapprove = mediaChanged && existing.approvedAt ? { approvedAt: null } : {};
  if (!awaiting && (!program.enabled || !existing.isVisible)) return unapprove;
  if (hasRealMedia(images, videoUrl)) {
    return mediaChanged || awaiting ? { awaitingApproval: true, isVisible: false, approvedAt: null, photoQueuedAt: now } : {};
  }
  return awaiting ? { awaitingApproval: false, isVisible: true } : unapprove;
}

const MEDIA_CHANGED = 'Khách vừa đổi ảnh hoặc video của đánh giá này. Bạn tải lại danh sách để xem nội dung mới rồi duyệt.';

const errCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;

/**
 * Ảnh đánh giá trong danh sách công khai. Ảnh base64 (khi chưa cấu hình Cloudinary) nặng tới ~700 nghìn ký tự/ảnh nên
 * không nhúng trong JSON: trả đường dẫn tương đối tới API (`/reviews/:id/images/:i`) để trình duyệt tải lười và cache;
 * `v` là mã băm nội dung để sửa đánh giá không dính ảnh cũ trong cache. Ảnh https (Cloudinary) giữ nguyên.
 *
 * Cột `imageVersions` lưu sẵn phần tử tương ứng của `images`: ảnh base64 là mã băm md5 10 ký tự hex, ảnh https là chính URL.
 * Nhờ vậy danh sách công khai dựng được đường dẫn mà không phải đọc (và băm) cột `images` của cả trăm đánh giá. Trigger DB
 * `reviews_image_versions_sync` giữ cột này theo `images` (cùng công thức `reviewImageVersions`), mã ứng dụng không ghi nó.
 */
export function reviewImageVersions(images: readonly string[]): string[] {
  return images.map((img) => (img.startsWith('data:') ? createHash('md5').update(img).digest('hex').slice(0, 10) : img));
}

const IMAGE_VERSION_RE = /^[0-9a-f]{10}$/;

export function reviewImageRefFromVersion(reviewId: string, index: number, entry: string): string {
  return IMAGE_VERSION_RE.test(entry) ? `/reviews/${reviewId}/images/${index}?v=${entry}` : entry;
}

/** Ảnh của đánh giá đã ẩn: đường dẫn công khai không phát ảnh đó, admin lấy qua route riêng (cần đăng nhập). */
export function reviewAdminImageRefFromVersion(reviewId: string, index: number, entry: string): string {
  return IMAGE_VERSION_RE.test(entry) ? `/admin/reviews/${reviewId}/images/${index}?v=${entry}` : entry;
}

export function reviewImageRef(reviewId: string, index: number, image: string): string {
  return reviewImageRefFromVersion(reviewId, index, reviewImageVersions([image])[0]!);
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
  /** Đánh giá có ảnh/video đang chờ admin duyệt (Góc Sống Xanh); isVisible false nhưng chưa bị ẩn. */
  awaitingApproval: boolean;
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
      /**
       * `returned`: sản phẩm đã có dòng trả được duyệt trên đơn đó (vd trả một trong hai biến thể), nên đánh giá viết cho đơn đó không được
       * thưởng dù `rewardAvailable` là true nhờ đơn khác. FE mở ô soạn cho đúng đơn (từ chi tiết đơn) phải xét cờ này trước khi hứa điểm.
       */
      reviewableOrders: { orderId: string; code: string; deliveredAt: Date | null; returned: boolean }[];
      myReviews: MyReviewRef[];
    };

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsEventsService,
    private readonly loyalty: LoyaltyService,
    // Nest luôn tiêm (SystemConfigModule là @Global, thiếu provider thì app không khởi động). Chỉ spec dựng tay mới bỏ trống: chương trình tắt.
    private readonly config?: SystemConfigService,
  ) {}

  private program(): Promise<GreenCornerConfig> {
    return this.config ? readGreenCornerConfig(this.config) : Promise.resolve(PROGRAM_OFF);
  }

  /** Dòng đơn đầu tiên (theo id) của sản phẩm trong đơn: khoá thưởng Góc Sống Xanh "một lần mỗi dòng đơn". */
  private async orderLineOf(db: Db, orderId: string, productId: string): Promise<string | null> {
    const variations = await db.variation.findMany({ where: { productId }, select: { id: true } });
    const line = await db.orderItem.findFirst({
      where: { orderId, isGift: false, variationId: { in: variations.map((v) => v.id) } },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return line?.id ?? null;
  }

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
      select: { id: true, orderId: true, rating: true, createdAt: true, isVisible: true, awaitingApproval: true },
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
      returned: returned(o.id),
    }));
    // Chỉ để FE nói đúng về điểm: máy chủ vẫn quyết định thưởng lúc tạo (createFirst, cùng rewardAlreadyKept). Hết đơn để
    // viết mới, hay mọi đơn còn lại đều đã bị trả sản phẩm này, thì không có đánh giá mới nào để thưởng.
    const hasFreshOrder = reviewableOrders.some((o) => !returned(o.orderId));
    // Góc Sống Xanh bật: thưởng là một lần cho mỗi dòng đơn (lúc admin duyệt), không còn "đánh giá đầu tiên của sản phẩm". Dòng đơn đầu
    // chưa bị trả đã nhận thưởng (xoá đánh giá rồi viết lại) thì báo đã nhận. Trần theo ngày chỉ biết lúc duyệt nên không xét ở đây.
    const program = await this.program();
    const firstFresh = reviewableOrders.find((o) => !returned(o.orderId));
    const lineRewarded = async (orderId: string): Promise<boolean> => {
      const line = await this.orderLineOf(this.prisma, orderId, product.id);
      if (!line) return false;
      return !!(await this.prisma.pointsTransaction.findFirst({ where: { reason: photoRewardReason(line), refType: 'REVIEW' }, select: { id: true } }));
    };
    // Đã giữ thưởng thì câu "đã nhận" luôn đúng, nên xét trước lý do "đã trả".
    const kept =
      reviewableOrders.length > 0 &&
      (program.enabled ? !!firstFresh && (await lineRewarded(firstFresh.orderId)) : await this.rewardAlreadyKept(this.prisma, userId, product));
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
      // Quà tặng dùng thử 0đ không tính là lần mua: không đánh giá "Đã mua", không nhận thưởng Góc Sống Xanh.
      where: { userId, ...REVIEWABLE_ORDER, items: { some: { isGift: false, variationId: { in: variations.map((v) => v.id) } } } },
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
    const program = await this.program();

    // Mỗi lần mua một đánh giá (unique userId+productId+orderId). Đơn đã có đánh giá thì gửi lại = SỬA đánh giá đó và KHÔNG
    // thưởng điểm. Khoá unique là chốt chặn cuối cho cùng một đơn: hai request tạo đồng thời thì request thua nhận P2002 ở
    // bước tạo (trước cả bước ghi điểm, cùng transaction) rồi đọc lại và chuyển sang sửa. Thưởng giữa các đơn khác nhau
    // của cùng sản phẩm do khoá advisory trong createFirst giữ.
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const existing = await this.prisma.review.findUnique({
        where: { userId_productId_orderId: { userId, productId: product.id, orderId } },
      });
      // Góc Sống Xanh: đánh giá mới tối đa 3 ảnh; đánh giá cũ đã có nhiều ảnh hơn vẫn sửa được nhưng không thêm.
      const photoCap = Math.max(GREEN_CORNER_MAX_PHOTOS, existing?.images?.length ?? 0);
      if (program.enabled && (dto.images?.length ?? 0) > photoCap) {
        throw new BadRequestException(`Mỗi đánh giá tối đa ${GREEN_CORNER_MAX_PHOTOS} ảnh.`);
      }
      try {
        const review = existing
          ? await this.updateOwn(userId, product, orderId, dto, program)
          : await this.createFirst(userId, product, orderId, dto, program);
        const { imageVersions: _versions, ...publicReview } = review;
        return { ...publicReview, images: review.images.map((img, i) => reviewImageRef(review.id, i, img)), updated: !!existing };
      } catch (err) {
        const lostRace = errCode(err) === (existing ? 'P2025' : 'P2002');
        if (!lostRace) throw err;
      }
    }
    throw new ConflictException('Không lưu được đánh giá do thao tác đồng thời, bạn thử lại nhé.');
  }

  private async createFirst(
    userId: string,
    product: { id: string; slug: string },
    orderId: string,
    dto: CreateReviewDto,
    program: GreenCornerConfig = PROGRAM_OFF,
  ) {
    // Thưởng điểm theo độ phong phú UGC: video (§6.14.9) > ảnh > chỉ chữ.
    // Cùng luật với CreateReviewDto (MONEY-10): media lọt qua DTO bằng đường khác vẫn không được thưởng thêm.
    const hasVideo = isUploadedMediaUrl(dto.videoUrl);
    const hasImages = (dto.images ?? []).some((img) => isUploadedImage(img, PUBLIC_CONTENT_IMAGE));
    // Góc Sống Xanh bật: đánh giá có ảnh/video chờ admin duyệt (chưa công khai) và chỉ được thưởng lúc duyệt; bảng thưởng lúc gửi ngừng hẳn,
    // kể cả đánh giá chỉ chữ (nếu không, chỉ chữ 5.000 lại hơn ảnh thật được duyệt).
    const awaiting = program.enabled && (hasVideo || hasImages);
    const rewardPoints = program.enabled ? 0 : hasVideo ? 15_000 : hasImages ? 10_000 : 5_000;
    const ecoTags = normalizeEcoTags(dto.ecoTags);
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
      const returned = rewardPoints > 0 && ((await returnedProductsByOrder(tx, [orderId])).get(orderId)?.has(product.id) ?? false);
      const pointsEarned = rewardPoints === 0 || returned || (await this.rewardAlreadyKept(tx, userId, product)) ? 0 : rewardPoints;
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
          ...(ecoTags.length > 0 ? { ecoTags } : {}),
          ...(awaiting ? { awaitingApproval: true, isVisible: false, photoQueuedAt: new Date() } : {}),
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
    // Thu hồi thưởng Góc Sống Xanh lúc xoá cũng mang lý do REVIEW_DELETE:<id sản phẩm>; thưởng đó không thuộc bảng cũ (một đánh giá chỉ
    // nhận một trong hai), nên dòng thu hồi của đánh giá có dòng REVIEW_PHOTO bị bỏ khỏi tổng, không thì nó kéo tổng xuống và bảng cũ trả lần hai.
    const deletedIds = [...new Set(rows.filter((r) => r.delta < 0 && r.refId).map((r) => r.refId as string))];
    const photoRewarded = deletedIds.length
      ? new Set(
          (
            await tx.pointsTransaction.findMany({
              where: { userId, refType: 'REVIEW', refId: { in: deletedIds }, reason: { startsWith: 'REVIEW_PHOTO:' }, delta: { gt: 0 } },
              select: { refId: true },
            })
          ).map((r) => r.refId),
        )
      : new Set<string | null>();
    const kept = rows.filter((r) => !(r.delta < 0 && r.refId && photoRewarded.has(r.refId)));
    const rewardedReviewIds = kept.filter((r) => r.delta > 0 && r.refId).map((r) => r.refId as string);
    const returnRows = rewardedReviewIds.length
      ? await tx.pointsTransaction.findMany({
          where: { userId, refType: 'REVIEW', reason: { in: rewardedReviewIds.map(reviewReturnReason) } },
          select: { delta: true },
        })
      : [];
    return [...kept, ...returnRows].reduce((sum, r) => sum + r.delta, 0) > 0;
  }

  /**
   * Sửa đánh giá của chính người gọi cho một lần mua (khoá theo userId+productId+orderId nên không thể sửa của người
   * khác). Thay toàn bộ sao/nội dung/ảnh/video như lúc tạo; giữ nguyên điểm đã thưởng (pointsEarned còn được `remove` dùng
   * để hoàn điểm), orderId và isVisible — sửa không gỡ được lệnh ẩn của admin.
   */
  private async updateOwn(
    userId: string,
    product: { id: string; slug: string },
    orderId: string,
    dto: CreateReviewDto,
    program: GreenCornerConfig = PROGRAM_OFF,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Trạng thái duyệt đọc dưới khoá dòng: admin ẩn hay duyệt đúng lúc khách bấm lưu thì lần sửa tính trên trạng thái mới, không gỡ lệnh
      // ẩn. Dòng vừa bị xoá thì update dưới đây ném P2025 và vòng lưu ở `create` thử lại.
      const [current] = await tx.$queryRaw<
        { imageVersions: string[]; videoUrl: string | null; isVisible: boolean; awaitingApproval: boolean; approvedAt: Date | null }[]
      >`
        SELECT "imageVersions", "videoUrl", "isVisible", "awaitingApproval", "approvedAt" FROM "reviews"
        WHERE "userId" = ${userId} AND "productId" = ${product.id} AND "orderId" = ${orderId} FOR UPDATE`;
      const moderation = current ? moderationAfterEdit(program, current, dto) : {};
      const r = await tx.review.update({
        where: { userId_productId_orderId: { userId, productId: product.id, orderId } },
        data: {
          rating: dto.rating,
          comment: dto.comment ?? null,
          images: dto.images ?? [],
          videoUrl: dto.videoUrl ?? null,
          ...(dto.ecoTags !== undefined ? { ecoTags: normalizeEcoTags(dto.ecoTags) } : {}),
          ...moderation,
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
   * Danh sách công khai: đánh giá đang hiện khớp bộ lọc (số sao, có ảnh, có video qua `media=video` hoặc `hasVideo`), mới nhất
   * trước, mỗi trang tối đa LIST_LIMIT dòng.
   * Còn dòng phía sau thì `nextCursor` là con trỏ keyset (createdAt, id) của dòng cuối, gửi lại kèm cùng bộ lọc để lấy trang tiếp;
   * hết thì null. Không gửi `cursor` là trang đầu như trước (client cũ bỏ qua `nextCursor`).
   * Bộ lọc nằm trong truy vấn: lọc ở client chỉ thấy LIST_LIMIT dòng mới nhất nên sản phẩm nhiều đánh giá báo không có dòng
   * khớp dù có. Điểm trung bình, số đánh giá, phân bổ sao và số đánh giá có video luôn tính trên TẤT CẢ đánh giá đang hiện
   * (khớp ratingAvg/reviewCount của sản phẩm), không theo bộ lọc và không chỉ trên các dòng trả về. Response lọc vẫn mang thống
   * kê để mọi chip nhận cùng một dạng: tiêu đề, biểu đồ sao và chip "Có video" không đổi khi khách đổi chip.
   */
  async listByProduct(slug: string, filter: PublicReviewsQuery = {}) {
    const cursor = filter.cursor ? decodeKeysetCursor(filter.cursor) : null;
    const product = await this.prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const where = { productId: product.id, isVisible: true };
    const hasVideo = { videoUrl: { not: null } };
    const listWhere: Prisma.ReviewWhereInput = {
      ...where,
      ...(filter.rating ? { rating: filter.rating } : {}),
      ...(filter.media === 'photo' ? { imageVersions: { isEmpty: false } } : {}),
      ...(filter.media === 'video' || filter.hasVideo ? hasVideo : {}),
    };
    const [reviews, byRating, videoCount, photoCount] = await Promise.all([
      this.prisma.review.findMany({
        where: cursor ? { AND: [listWhere, keysetAfter(cursor)] } : listWhere,
        // id phá hoà khi nhiều đánh giá cùng mili giây: trang sau không lặp, không sót dòng.
        orderBy: KEYSET_ORDER,
        // Không chọn `images`: base64 tới ~700 nghìn ký tự/ảnh, phải giải nén TOAST cả trăm dòng cho mỗi lượt xem trang.
        select: {
          id: true,
          rating: true,
          comment: true,
          imageVersions: true,
          videoUrl: true,
          createdAt: true,
          ecoTags: true,
          user: { select: { fullName: true } },
        },
        take: LIST_LIMIT + 1,
      }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
      this.prisma.review.count({ where: { ...where, ...hasVideo } }),
      // Số trên chip "Có ảnh", trên mọi đánh giá đang hiện như các chip khác (không đếm trên 100 dòng đã trả).
      this.prisma.review.count({ where: { ...where, imageVersions: { isEmpty: false } } }),
    ]);
    const hasMore = reviews.length > LIST_LIMIT;
    const page = hasMore ? reviews.slice(0, LIST_LIMIT) : reviews;
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
      photoCount,
      distribution,
      items: page.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        images: r.imageVersions.map((entry, i) => reviewImageRefFromVersion(r.id, i, entry)),
        videoUrl: r.videoUrl,
        createdAt: r.createdAt,
        ecoTags: normalizeEcoTags(r.ecoTags),
        author: publicDisplayName(r.user.fullName, 'Khách Tubu'),
        // Mọi review đều ràng buộc đơn DELIVERED (§6.13) → luôn là khách đã mua.
        verifiedPurchase: true,
      })),
      nextCursor: hasMore ? encodeKeysetCursor(page[page.length - 1]!) : null,
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
        ecoTags: true,
        awaitingApproval: true,
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
      ecoTags: normalizeEcoTags(review.ecoTags),
      awaitingApproval: review.awaitingApproval === true,
    };
  }

  /** Byte của ảnh base64 thứ `index` trong một đánh giá đang hiện (đích của `reviewImageRef`). */
  async getImage(reviewId: string, index: number): Promise<{ mime: string; data: Buffer }> {
    // Chỉ đọc đúng phần tử cần (mảng Postgres đánh số từ 1) thay vì đưa cả mảng ảnh về Node.
    const safeIndex = Number.isInteger(index) && index >= 0 && index < 1000 ? index : -1;
    const rows =
      safeIndex < 0
        ? []
        : await this.prisma.$queryRaw<{ isVisible: boolean; image: string | null }[]>`
            SELECT "isVisible", "images"[${safeIndex + 1}::int] AS "image" FROM "reviews" WHERE "id" = ${reviewId}`;
    const image = rows[0]?.isVisible ? rows[0].image : undefined;
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
    // Đánh giá đã qua hàng chờ Góc Sống Xanh mà chưa có thưởng có thể vừa được duyệt (cộng thưởng) sau lần đọc trên: đọc lại điểm dưới khoá
    // dòng để thu hồi cả phần đó. Đánh giá đã có thưởng thì lần duyệt không cộng thêm (ALREADY_REWARDED), số đọc ngoài tx vẫn đúng.
    const mayGainReward = review.pointsEarned === 0 && review.photoQueuedAt != null;
    await this.prisma.$transaction(async (tx) => {
      // Cùng khoá cặp (khách, sản phẩm) với createFirst và approve, lấy trước khoá dòng đánh giá và dòng user như hai đường đó: đánh giá
      // mới viết song song với lần xoá này đọc sổ REVIEW sau khi thu hồi đã ghi xong.
      if (review.pointsEarned > 0 || mayGainReward) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reviewRewardLockKey(review.userId, review.productId)}))`;
      }
      let pointsEarned = review.pointsEarned;
      if (mayGainReward) {
        const [fresh] = await tx.$queryRaw<{ pointsEarned: number }[]>`SELECT "pointsEarned" FROM "reviews" WHERE "id" = ${id} FOR UPDATE`;
        if (!fresh) throw new NotFoundException('Không tìm thấy đánh giá.');
        pointsEarned = fresh.pointsEarned;
      }
      // Khoá dòng user TRƯỚC khi đọc hạn của dòng thưởng: cron hết hạn cũng khoá dòng này rồi mới trừ lô đã quá hạn.
      // Đọc hạn khi chưa có khoá thì lô chạm hạn đúng lúc cron đang trừ nó vẫn bị coi là còn hạn, và thu hồi ghi sau
      // đó trừ thêm lần hai. Số dư đọc cùng câu khoá để chặn thu hồi quá số dư.
      const locked =
        pointsEarned > 0
          ? await tx.$queryRaw<{ pointsBalance: number }[]>`SELECT "pointsBalance" FROM "users" WHERE "id" = ${review.userId} FOR UPDATE`
          : [];
      await tx.review.delete({ where: { id } });
      // Hoàn tác điểm đã thưởng lúc tạo review — nếu không, user có thể farm điểm vô hạn bằng cách tạo review (+điểm)
      // rồi xóa (đơn đó mở lại để viết) rồi tạo lại. Đánh giá không nhận thưởng (pointsEarned 0) không thu hồi gì. Không
      // thu hồi được gì thì không ghi dòng nào (khác đơn hàng, xoá đánh giá không cần dấu "đã xử lý": dòng đánh giá đã mất
      // nên không có lượt xoá thứ hai).
      if (pointsEarned > 0) {
        await takeBackReviewReward(tx, { ...review, pointsEarned }, locked[0]?.pointsBalance ?? 0, `REVIEW_DELETE:${review.productId}`);
      }
      await this.recomputeRating(review.productId, tx);
    });
    return { ok: true };
  }

  /**
   * Admin ẩn/hiện review vi phạm (§6.13: ẩn KHÔNG xóa) — rating tính lại loại review ẩn. Ẩn cũng rút đánh giá khỏi hàng chờ duyệt.
   * "Hiện lại" một đánh giá đang chờ duyệt là duyệt nó (đi qua `approve` để thưởng đúng một lần), không bỏ qua bước thưởng, và cần
   * `mediaKey` của dòng admin đang xem. Hiện lại đánh giá đã ẩn kèm `mediaKey` thì khách vừa đổi ảnh trong lúc bị ẩn sẽ ra 409.
   */
  async setVisibility(id: string, isVisible: boolean, mediaKey?: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Không tìm thấy đánh giá.');
    if (isVisible && review.awaitingApproval) {
      if (mediaKey === undefined) throw new ConflictException('Đánh giá này đang chờ duyệt. Bạn tải lại danh sách rồi bấm Duyệt.');
      await this.approve(id, mediaKey);
      return { ok: true, isVisible };
    }
    if (isVisible && mediaKey !== undefined) {
      await this.prisma.$transaction(async (tx) => {
        const [cur] = await tx.$queryRaw<{ imageVersions: string[]; videoUrl: string | null }[]>`
          SELECT "imageVersions", "videoUrl" FROM "reviews" WHERE "id" = ${id} FOR UPDATE`;
        if (!cur) throw new NotFoundException('Không tìm thấy đánh giá.');
        if (reviewMediaKey(cur.imageVersions, cur.videoUrl) !== mediaKey) throw new ConflictException(MEDIA_CHANGED);
        await tx.review.update({ where: { id }, data: { isVisible } });
        await this.recomputeRating(review.productId, tx);
      });
      return { ok: true, isVisible };
    }
    await this.prisma.review.update({ where: { id }, data: isVisible ? { isVisible } : { isVisible, awaitingApproval: false } });
    await this.recomputeRating(review.productId);
    return { ok: true, isVisible };
  }

  /**
   * Admin duyệt một đánh giá: hiện công khai, ghi mốc duyệt (đưa lên dải Góc Sống Xanh nếu có ảnh) và, với đánh giá có ảnh/video đi qua
   * hàng chờ, cộng `reviews.photo_reward_points` Điểm Xanh. Thưởng một lần cho mỗi dòng đơn (dòng sổ REVIEW_PHOTO:<id dòng đơn>, unique),
   * không cho dòng hàng đã trả, không cho đánh giá đã nhận thưởng lúc gửi (bảng cũ), và mỗi khách tối đa `reviews.photo_reward_daily_cap`
   * đánh giá được thưởng trong số các đánh giá viết cùng một ngày giờ VN (đếm theo ngày viết, nên admin duyệt dồn một lúc không làm khách
   * mất suất). Vượt trần vẫn duyệt và hiện. Bấm lại đánh giá đã duyệt không đổi gì.
   *
   * Thứ tự khoá như createFirst và lần đảo trả hàng: dòng đơn (chia sẻ), khoá cặp (khách, sản phẩm), dòng đánh giá, khoá trần theo khách,
   * rồi dòng user. Xoá đánh giá lấy khoá cặp trước dòng đánh giá nên không chéo; đánh giá được thưởng ở đây mang pointsEarned nên xoá và
   * trả hàng sau đó thu hồi như thưởng cũ (cùng lô REVIEW:<id đánh giá>).
   *
   * `mediaKey` là dấu ảnh/video của dòng admin đang xem (`reviewMediaKey`, đọc dưới khoá dòng): khách đổi ảnh sau khi admin mở danh sách
   * thì 409, ảnh chưa ai xem không lên công khai. "Đã qua hàng chờ" là `photoQueuedAt` (không xoá khi ẩn), nên lỡ tay ẩn rồi duyệt lại vẫn thưởng.
   */
  async approve(id: string, mediaKey: string): Promise<ApproveResult> {
    const head = await this.prisma.review.findUnique({ where: { id }, select: { userId: true, productId: true, orderId: true } });
    if (!head) throw new NotFoundException('Không tìm thấy đánh giá.');
    const [program, expiresAt, line] = await Promise.all([
      this.program(),
      this.loyalty.pointsExpiresAt(new Date()),
      // Dòng đơn không đổi sau khi đặt, đọc ngoài tx được.
      this.orderLineOf(this.prisma, head.orderId, head.productId),
    ]);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [order] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text AS "status" FROM "orders" WHERE "id" = ${head.orderId} FOR SHARE`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reviewRewardLockKey(head.userId, head.productId)}))`;
        const [r] = await tx.$queryRaw<
          {
            userId: string;
            productId: string;
            isVisible: boolean;
            awaitingApproval: boolean;
            approvedAt: Date | null;
            photoQueuedAt: Date | null;
            pointsEarned: number;
            imageVersions: string[];
            videoUrl: string | null;
            createdAt: Date;
          }[]
        >`
          SELECT "userId", "productId", "isVisible", "awaitingApproval", "approvedAt", "photoQueuedAt", "pointsEarned",
                 "imageVersions", "videoUrl", "createdAt"
          FROM "reviews" WHERE "id" = ${id} FOR UPDATE`;
        if (!r) throw new NotFoundException('Không tìm thấy đánh giá.');
        // Gộp phiên khách vừa chuyển đánh giá sang tài khoản khác giữa lúc đọc và lúc khoá: khoá cặp đang giữ là của chủ cũ.
        if (r.userId !== head.userId) throw new ConflictException('Đánh giá vừa đổi chủ tài khoản, bạn bấm duyệt lại nhé.');
        if (r.isVisible && !r.awaitingApproval && r.approvedAt) {
          return { ok: true, isVisible: true, alreadyApproved: true, rewardPoints: 0, rewardSkipped: null } as const;
        }
        if (reviewMediaKey(r.imageVersions, r.videoUrl) !== mediaKey) throw new ConflictException(MEDIA_CHANGED);

        let skip: PhotoRewardSkip | null = null;
        if (!r.photoQueuedAt) skip = 'NOT_ENROLLED';
        else if (r.imageVersions.length === 0 && r.videoUrl === null) skip = 'NO_MEDIA';
        else if (r.pointsEarned > 0) skip = 'ALREADY_REWARDED';
        else if (
          order?.status !== REVIEWABLE_ORDER.status ||
          ((await returnedProductsByOrder(tx, [head.orderId])).get(head.orderId)?.has(r.productId) ?? false)
        ) {
          skip = 'RETURNED';
        } else if (!line) skip = 'NOT_ENROLLED';
        else if (await tx.pointsTransaction.findFirst({ where: { reason: photoRewardReason(line), refType: 'REVIEW' }, select: { id: true } })) {
          skip = 'ALREADY_REWARDED';
        } else if (program.rewardPoints <= 0) skip = 'ZERO';
        else {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${photoRewardCapLockKey(r.userId)}))`;
          const rewardedSameDay = await tx.review.count({
            where: { userId: r.userId, photoRewardPoints: { gt: 0 }, createdAt: { gte: startOfVnDay(r.createdAt), lte: endOfVnDay(r.createdAt) } },
          });
          if (rewardedSameDay >= program.dailyCap) skip = 'DAILY_CAP';
        }
        const points = skip === null ? program.rewardPoints : 0;

        await tx.review.update({
          where: { id },
          data: {
            isVisible: true,
            awaitingApproval: false,
            approvedAt: new Date(),
            ...(points > 0 ? { pointsEarned: { increment: points }, photoRewardPoints: points } : {}),
          },
        });
        if (points > 0 && line) {
          await tx.pointsTransaction.create({
            data: { userId: r.userId, delta: points, reason: photoRewardReason(line), refType: 'REVIEW', refId: id, expiresAt },
          });
          await tx.user.update({ where: { id: r.userId }, data: { pointsBalance: { increment: points } } });
        }
        await this.recomputeRating(r.productId, tx);
        return { ok: true, isVisible: true, alreadyApproved: false, rewardPoints: points, rewardSkipped: skip } as const;
      });
    } catch (err) {
      // Lớp hai (unique theo dòng đơn): một lần duyệt khác của cùng dòng đơn vừa ghi thưởng. Không cộng lần hai; admin tải lại sẽ thấy đã duyệt.
      if (errCode(err) === 'P2002') throw new ConflictException('Đánh giá này vừa được duyệt ở nơi khác, bạn tải lại danh sách nhé.');
      throw err;
    }
  }

  /**
   * Dải "Khách hàng sống xanh cùng TubuTree" (Trang chủ Mini App và web): đánh giá đã duyệt, đang hiện, có ảnh, mới duyệt trước, mỗi sản
   * phẩm một đánh giá, tối đa GREEN_CORNER_MAX_ITEMS. Cờ tắt thì `enabled: false` và không truy vấn gì. Chỉ đọc cột nhẹ (`imageVersions`,
   * không `images`): ảnh base64 đi qua đường dẫn `/reviews/:id/images/0` như danh sách ở trang sản phẩm.
   */
  async greenCorner(): Promise<GreenCornerResponse> {
    const program = await this.program();
    if (!program.enabled) return { enabled: false, items: [] };
    const rows = await this.prisma.review.findMany({
      where: { isVisible: true, approvedAt: { not: null }, imageVersions: { isEmpty: false }, product: PUBLIC_PRODUCT_WHERE },
      orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
      // Lấy dư để còn đủ sau khi bỏ trùng sản phẩm; bảng nhỏ và có chỉ mục approvedAt.
      take: GREEN_CORNER_MAX_ITEMS * 4,
      select: {
        id: true,
        rating: true,
        comment: true,
        imageVersions: true,
        ecoTags: true,
        user: { select: { fullName: true } },
        product: { select: { id: true, slug: true, name: true } },
      },
    });
    const seen = new Set<string>();
    const items: GreenCornerResponse['items'] = [];
    for (const r of rows) {
      if (seen.has(r.product.id)) continue;
      seen.add(r.product.id);
      items.push({
        id: r.id,
        rating: r.rating,
        comment: clipComment(r.comment),
        image: reviewImageRefFromVersion(r.id, 0, r.imageVersions[0]!),
        author: publicDisplayName(r.user.fullName, 'Khách Tubu'),
        ecoTags: normalizeEcoTags(r.ecoTags),
        product: { slug: r.product.slug, name: r.product.name },
      });
      if (items.length >= GREEN_CORNER_MAX_ITEMS) break;
    }
    return { enabled: true, items };
  }
}
