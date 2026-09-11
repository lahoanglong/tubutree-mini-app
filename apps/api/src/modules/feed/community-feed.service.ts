import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunityRewardService } from './community-reward.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { authorBadge } from './author-badge';

const DEFAULT_REP_THRESHOLDS = [0, 50, 200, 500];
const LEVEL_NAMES: Record<number, string> = {
  1: 'Mầm',
  2: 'Cây non',
  3: 'Cây trưởng thành',
  4: 'Cổ thụ',
};

/** Level 1-based từ điểm reputation + ngưỡng (mặc định [0,50,200,500]) — pure fn, dễ test. */
export function levelFromReputation(rep: number, thresholds: number[] = DEFAULT_REP_THRESHOLDS): number {
  let level = 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (rep >= thresholds[i]!) level = i + 1;
  }
  return level;
}

/** Tên hạng hiển thị FE — fallback 'Mầm' nếu level không hợp lệ. */
export function levelName(level: number): string {
  return LEVEL_NAMES[level] ?? 'Mầm';
}

/**
 * Chuẩn hoá slug tag về ASCII thuần (bỏ dấu tiếng Việt) — pure fn, dễ test.
 * "Sen Đá" → "sen-da". Tên gốc (name) KHÔNG bị đổi, chỉ slug.
 */
export function slugifyTag(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}

type FeedPostKind = 'MANUAL' | 'HARVEST' | 'MILESTONE' | 'SPECIES' | 'QUESTION' | 'SHOWCASE' | 'TIP';

const MAX_TITLE = 160;
const MAX_BODY = 5000;
const MAX_IMAGES = 6;
const MAX_PRODUCT_TAGS = 5;
const MAX_TAGS = 5;
const MAX_COMMENT = 500;

export interface CreatePostInput {
  kind?: FeedPostKind;
  categoryId?: string;
  title?: string;
  body: string;
  images?: string[];
  productSlugs?: string[];
  tagSlugs?: string[];
  eventId?: string;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  coverUrl?: string;
  startAt: Date;
  endAt: Date;
  rewardXu?: number;
}

const FEED_INCLUDE = {
  user: { select: { fullName: true, avatarUrl: true, role: true, communityProfile: { select: { level: true } } } },
  category: { select: { slug: true, name: true, icon: true } },
  productTags: { include: { product: { select: { slug: true, name: true, thumbnail: true, salePrice: true, basePrice: true } } } },
  tags: { include: { tag: { select: { slug: true, name: true } } } },
  // comments đếm CÓ LỌC isRemoved: thẻ bài và màn chi tiết cùng hiện con số này, trong khi
      // danh sách bình luận lại lọc bỏ bài đã gỡ — người đọc thấy "💬 5" cạnh "Trả lời (3)" và
      // tưởng bị giấu nội dung.
      _count: { select: { reactions: true, comments: { where: { isRemoved: false } } } },
} as const;

/** Hình dạng FeedPost sau khi include FEED_INCLUDE + reactions (dùng chung getFeed/getPost/eventPosts). */
type FeedPostRow = Prisma.FeedPostGetPayload<{
  include: typeof FEED_INCLUDE & { reactions: { select: { id: true } } };
}>;

/**
 * Community Feed (§6.14.12) — bảng tin cộng đồng Vườn Xanh.
 * User khoe thành tích xanh (thu hoạch cây, mốc cộng đồng, sưu tập loài) hoặc đăng
 * bài tự do; người khác thả tim 💚 + bình luận. Hiện tên thật + avatar + badge tác giả
 * (khác BXH — leaderboard vẫn ẩn danh riêng ở GameService).
 * Auto-post thành tích qua createAchievementPost (gọi @Optional từ GameService).
 */
@Injectable()
export class CommunityFeedService {
  private readonly logger = new Logger(CommunityFeedService.name);
  private readonly TRUSTED_ROLES = new Set(['STAFF', 'ADMIN', 'DEALER', 'AFFILIATE']);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reward: CommunityRewardService,
    private readonly config: SystemConfigService,
    // Optional: thông báo trả lời/best-answer/duyệt bài — không chặn hành động chính nếu thiếu/lỗi.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Cộng điểm reputation (§6.14 Pha 4) + cập nhật hạng — NON-FATAL: tự try/catch,
   * không bao giờ throw ra caller (reputation chỉ mang tính trang trí, không ảnh hưởng
   * tiền/nghiệp vụ chính).
   *
   * Mọi lần cộng đều ghi 1 dòng `ReputationEvent` TRƯỚC, vì 3 lý do (P1-1,
   * docs/2026-09-08-review-progress.md):
   *  1. TRẦN NGÀY: trước đây không có gì đếm được số điểm đã cộng trong ngày → bình luận
   *     liên tục (+rep_answer mỗi lần) là lên top bảng xếp hạng trong vài phút.
   *  2. IDEMPOTENT: unique (userId, reason, refId) → retry/gọi lại cùng nguồn không cộng 2 lần.
   *  3. ĐẢO ĐƯỢC: xoá bài phải trừ lại đúng số đã cộng (xem reverseReputationForPost).
   * Đếm-rồi-quyết nằm TRONG transaction Serializable — cùng pattern với trần thưởng xu ở
   * `CommunityRewardService.rewardWithDailyCap` — để 2 request dồn dập không cùng lọt trần.
   */
  async bumpReputation(userId: string, amount: number, reason: string, refId: string): Promise<void> {
    if (amount <= 0) return;
    try {
      const thresholds = await this.config.get<number[]>('community.rep_thresholds', DEFAULT_REP_THRESHOLDS);
      const dailyCap = await this.config.get<number>('community.daily_rep_cap', 30);
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      await this.prisma.$transaction(
        async (tx) => {
          const earnedToday = await tx.reputationEvent.aggregate({
            where: { userId, amount: { gt: 0 }, createdAt: { gte: since } },
            _sum: { amount: true },
          });
          if ((earnedToday._sum.amount ?? 0) + amount > dailyCap) return; // chạm trần → bỏ qua êm
          await tx.reputationEvent.create({ data: { userId, amount, reason, refId } });
          await tx.communityProfile.upsert({
            where: { userId },
            create: { userId, reputation: amount, level: levelFromReputation(amount, thresholds) },
            update: { reputation: { increment: amount } },
          });
          const profile = await tx.communityProfile.findUnique({ where: { userId }, select: { reputation: true } });
          if (profile) {
            await tx.communityProfile.update({
              where: { userId },
              data: { level: levelFromReputation(profile.reputation, thresholds) },
            });
          }
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      // P2002 = đã cộng cho đúng nguồn này rồi; P2034 = thua race Serializable. Cả hai đều là
      // "không cộng lần này" đúng ý đồ, không phải lỗi cần báo.
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2002' || code === 'P2034') return;
      this.logger.warn(`bumpReputation failed for ${userId}: ${(err as Error).message}`);
    }
  }

  /**
   * Đảo toàn bộ điểm reputation đã cộng từ 1 bài khi bài bị gỡ/xoá. Không có bước này thì
   * farmer đăng bài ăn điểm rồi xoá sạch vẫn giữ nguyên hạng mà chẳng còn nội dung nào để
   * kiểm chứng. Ghi 1 dòng âm `REVERSE_POST` — unique (userId, reason, refId) khiến gỡ 2 lần
   * cũng chỉ trừ đúng 1 lần. NON-FATAL: lỗi đảo điểm không được chặn việc gỡ bài.
   */
  private async reverseReputationForPost(userId: string, postId: string): Promise<void> {
    return this.reverseReputationForRef(userId, postId, 'REVERSE_POST');
  }

  /**
   * Đảo điểm đã cộng từ MỘT nguồn (bài hoặc bình luận). Tách ra từ reverseReputationForPost vì
   * điểm của người TRẢ LỜI ghi theo refId = commentId: gỡ bình luận mà chỉ đảo theo postId thì
   * người trả lời giữ nguyên điểm cho nội dung đã bị kiểm duyệt gỡ đi.
   */
  private async reverseReputationForRef(userId: string, refId: string, reason: string): Promise<void> {
    try {
      const thresholds = await this.config.get<number[]>('community.rep_thresholds', DEFAULT_REP_THRESHOLDS);
      await this.prisma.$transaction(async (tx) => {
        const events = await tx.reputationEvent.findMany({
          where: { userId, refId, amount: { gt: 0 } },
          select: { amount: true },
        });
        const total = events.reduce((sum, e) => sum + e.amount, 0);
        if (total <= 0) return;
        await tx.reputationEvent.create({
          data: { userId, amount: -total, reason, refId },
        });
        await tx.communityProfile.update({
          where: { userId },
          data: { reputation: { decrement: total } },
        });
        const profile = await tx.communityProfile.findUnique({ where: { userId }, select: { reputation: true } });
        if (profile) {
          await tx.communityProfile.update({
            where: { userId },
            data: { level: levelFromReputation(Math.max(0, profile.reputation), thresholds) },
          });
        }
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2002') return; // đã đảo rồi (gỡ lần 2)
      this.logger.warn(`reverseReputation failed for ${refId}: ${(err as Error).message}`);
    }
  }

  /** Bảng xếp hạng cộng đồng theo reputation — tên thật + avatar (khác BXH ẩn danh của GameService). */
  async getLeaderboard(take = 20) {
    const rows = await this.prisma.communityProfile.findMany({
      orderBy: { reputation: 'desc' },
      take,
      where: { reputation: { gt: 0 } },
      include: { user: { select: { fullName: true, avatarUrl: true } } },
    });
    return rows.map((p) => ({
      author: p.user.fullName ?? 'Bạn Tubu',
      avatar: p.user.avatarUrl ?? null,
      reputation: p.reputation,
      level: p.level,
      levelName: levelName(p.level),
    }));
  }

  /**
   * Kiểm duyệt lai (§6.14 moderation): STAFF/ADMIN/DEALER/AFFILIATE, hoặc user đã
   * được đánh dấu isTrusted (qua approvePost trước đó), hoặc đã có đơn DELIVERED
   * (khách hàng thật) → được đăng bài PUBLISHED ngay; còn lại vào hàng chờ duyệt.
   */
  async isTrusted(userId: string, role: string): Promise<boolean> {
    if (this.TRUSTED_ROLES.has(role)) return true;
    const profile = await this.prisma.communityProfile.findUnique({
      where: { userId },
      select: { isTrusted: true },
    });
    if (profile?.isTrusted) return true;
    const delivered = await this.prisma.order.findFirst({
      where: { userId, status: 'DELIVERED' },
      select: { id: true },
    });
    return !!delivered;
  }

  async getFeed(
    userId: string,
    opts: {
      category?: string;
      kind?: string;
      sort?: 'new' | 'popular';
      cursor?: string;
      take?: number;
      q?: string;
      unanswered?: boolean;
      tag?: string;
    } = {},
  ) {
    const take = Math.max(1, Math.min(opts.take ?? 20, 50));
    const where: Record<string, unknown> = { status: 'PUBLISHED' };
    if (opts.category) where.category = { slug: opts.category };
    if (opts.kind) where.kind = opts.kind;
    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { body: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.unanswered) {
      where.kind = 'QUESTION';
      where.bestCommentId = null;
    }
    if (opts.tag) where.tags = { some: { tag: { slug: opts.tag } } };
    const orderBy =
      opts.sort === 'popular'
        ? [
            { isPinned: 'desc' as const },
            { reactions: { _count: 'desc' as const } },
            { createdAt: 'desc' as const },
            { id: 'desc' as const },
          ]
        : [{ isPinned: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'desc' as const }];
    const posts = await this.prisma.feedPost.findMany({
      where,
      orderBy,
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { ...FEED_INCLUDE, reactions: { where: { userId }, select: { id: true } } },
    });
    const hasMore = posts.length > take;
    const page = hasMore ? posts.slice(0, take) : posts;
    return {
      posts: page.map((p) => this.toItem(p, userId)),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async getPost(userId: string, postId: string) {
    const p = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      include: { ...FEED_INCLUDE, reactions: { where: { userId }, select: { id: true } } },
    });
    if (!p) throw new NotFoundException('Bài viết không tồn tại.');
    if (p.status === 'REMOVED') throw new NotFoundException('Bài viết không tồn tại.');
    if (p.status === 'PENDING' && p.userId !== userId) throw new NotFoundException('Bài viết không tồn tại.');
    // KHÔNG tăng viewCount ở đây nữa: đây là đường đọc nóng nhất, mỗi lượt mở/refresh là một
    // UPDATE khoá đúng một dòng (ghi tuần tự trên bài viral), trong khi toItem() và FeedItem
    // KHÔNG hề trả `viewCount` ra — không màn nào hiển thị con số đó. Cột vẫn còn trong schema
    // cho báo cáo sau này; khi cần hãy đếm theo phiên/ngày hoặc gom batch thay vì ghi mỗi request.
    return this.toItem(p, userId);
  }

  /** Danh mục cộng đồng đang hiển thị, sắp theo order — dùng cho tabs FE. */
  async getCategories() {
    return this.prisma.communityCategory.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      select: { id: true, slug: true, name: true, icon: true },
    });
  }

  private toItem(p: FeedPostRow, userId: string) {
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      title: p.title ?? null,
      body: p.body,
      images: p.images ?? [],
      meta: p.meta,
      createdAt: p.createdAt,
      author: p.user.fullName ?? 'Bạn Tubu',
      avatar: p.user.avatarUrl ?? null,
      badge: authorBadge(p.user.role),
      authorLevel: p.user.communityProfile?.level ?? 1,
      category: p.category ? { slug: p.category.slug, name: p.category.name, icon: p.category.icon } : null,
      productTags: (p.productTags ?? []).map((t) => ({
        slug: t.product.slug, name: t.product.name, thumbnail: t.product.thumbnail,
        salePrice: t.product.salePrice, basePrice: t.product.basePrice,
      })),
      tags: (p.tags ?? []).map((t) => ({ slug: t.tag.slug, name: t.tag.name })),
      likeCount: p._count.reactions,
      commentCount: p._count.comments,
      liked: p.reactions.length > 0,
      bestCommentId: p.bestCommentId ?? null,
      isOwner: p.userId === userId,
      isPinned: p.isPinned,
    };
  }

  async createPost(userId: string, role: string, input: CreatePostInput): Promise<{ id: string; status: string }> {
    const kind = input.kind ?? 'MANUAL';
    const body = (input.body ?? '').trim();
    if (!body) throw new BadRequestException('Nội dung bài viết trống.');
    if (body.length > MAX_BODY) throw new BadRequestException('Nội dung quá dài.');
    const title = input.title?.trim() || null;
    if (kind === 'QUESTION' && !title) throw new BadRequestException('Câu hỏi cần có tiêu đề.');
    if (title && title.length > MAX_TITLE) throw new BadRequestException('Tiêu đề quá dài.');
    const images = (input.images ?? []).filter((u) => typeof u === 'string' && u.trim()).slice(0, MAX_IMAGES);
    const slugs = input.productSlugs ?? [];
    if (slugs.length > MAX_PRODUCT_TAGS) throw new BadRequestException('Chỉ gắn tối đa 5 sản phẩm.');

    if (input.eventId) {
      const event = await this.prisma.communityEvent.findUnique({
        where: { id: input.eventId },
        select: { id: true, status: true, startAt: true, endAt: true },
      });
      if (!event || event.status !== 'OPEN') {
        throw new BadRequestException('Sự kiện không hợp lệ hoặc đã đóng.');
      }
      // App đã khoá nút nộp bài sau hạn, nhưng BE thì không: chỉ cần admin chưa bấm đóng sự
      // kiện là gọi thẳng API (hoặc dùng bản app cũ) vẫn nộp được bài muộn, và bài đó đủ tư
      // cách được chọn trúng giải kèm rewardXu.
      const now = new Date();
      if (event.startAt > now || event.endAt < now) {
        throw new BadRequestException('Sự kiện chưa mở hoặc đã hết hạn nộp bài.');
      }
    }
    if (input.categoryId) {
      const category = await this.prisma.communityCategory.findUnique({
        where: { id: input.categoryId },
        select: { id: true, isActive: true },
      });
      if (!category || !category.isActive) {
        throw new BadRequestException('Danh mục không hợp lệ.');
      }
    }

    const trusted = await this.isTrusted(userId, role);
    const status = trusted ? 'PUBLISHED' : 'PENDING';

    const post = await this.prisma.feedPost.create({
      data: {
        userId, kind, status, body, title, images, categoryId: input.categoryId ?? null,
        ...(input.eventId ? { meta: { eventId: input.eventId } } : {}),
      },
    });

    if (slugs.length) {
      const products = await this.prisma.product.findMany({
        where: { slug: { in: slugs }, isActive: true }, select: { id: true },
      });
      if (products.length) {
        await this.prisma.postProductTag.createMany({
          data: products.map((p) => ({ postId: post.id, productId: p.id })),
          skipDuplicates: true,
        });
      }
    }

    const tagLabels = (input.tagSlugs ?? [])
      .map((raw) => (raw ?? '').trim().replace(/^#+/, '').trim())
      .filter((s) => s.length > 0)
      .slice(0, MAX_TAGS);
    if (tagLabels.length) {
      try {
        const tags = await Promise.all(
          tagLabels.map((label) => {
            const slug = slugifyTag(label);
            return this.prisma.tag.upsert({ where: { slug }, create: { slug, name: label }, update: {} });
          }),
        );
        await this.prisma.postTag.createMany({
          data: tags.map((t) => ({ postId: post.id, tagId: t.id })),
          skipDuplicates: true,
        });
      } catch (err) {
        this.logger.warn(`gắn tag thất bại cho bài ${post.id}: ${(err as Error).message}`);
      }
    }

    if (status === 'PUBLISHED') {
      try {
        await this.reward.rewardPost(userId, post.id);
      } catch (err) {
        this.logger.warn(`rewardPost failed for post ${post.id}: ${(err as Error).message}`);
      }
      try {
        const amount = await this.config.get<number>('community.rep_post', 5);
        await this.bumpReputation(userId, amount, 'POST', post.id);
      } catch (err) {
        this.logger.warn(`bumpReputation(post) failed for ${userId}: ${(err as Error).message}`);
      }
    }
    return { id: post.id, status };
  }

  /** Duyệt bài PENDING → PUBLISHED; đánh dấu tác giả isTrusted; thưởng (idempotent — không thưởng lại nếu đã PUBLISHED). */
  async approvePost(postId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, userId: true, status: true },
    });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.status !== 'PENDING') return { ok: true }; // idempotent, không hồi sinh bài REMOVED/đã duyệt
    await this.prisma.feedPost.update({ where: { id: postId }, data: { status: 'PUBLISHED' } });
    try {
      await this.prisma.communityProfile.upsert({
        where: { userId: post.userId },
        create: { userId: post.userId, isTrusted: true },
        update: { isTrusted: true },
      });
    } catch (err) {
      this.logger.warn(`approve upsert profile failed ${post.userId}: ${(err as Error).message}`);
    }
    try {
      await this.reward.rewardPost(post.userId, post.id);
    } catch (err) {
      this.logger.warn(`rewardPost(approve) failed ${post.id}: ${(err as Error).message}`);
    }
    try {
      const amount = await this.config.get<number>('community.rep_post', 5);
      await this.bumpReputation(post.userId, amount, 'POST', post.id);
    } catch (err) {
      this.logger.warn(`bumpReputation(approve) failed for ${post.userId}: ${(err as Error).message}`);
    }
    try {
      await this.notifications?.notify(post.userId, 'COMMUNITY_POST_APPROVED', {});
    } catch (err) {
      this.logger.warn(`notify(approve) failed ${post.id}: ${(err as Error).message}`);
    }
    return { ok: true };
  }

  /** Từ chối bài PENDING (hoặc bất kỳ) → xoá mềm REMOVED. */
  async rejectPost(postId: string) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true, userId: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    // Endpoint này nhận cả bài ĐÃ PUBLISHED (đã cộng điểm + xu), nên phải đảo điểm y như
    // deletePost — nếu không, kiểm duyệt gỡ bài vi phạm mà tác giả vẫn giữ nguyên hạng.
    await this.reverseReputationForPost(post.userId, postId);
    await this.revokeTrust(post.userId);
    await this.prisma.feedPost.update({ where: { id: postId }, data: { status: 'REMOVED' } });
    return { ok: true };
  }

  /**
   * Rút cờ tin cậy của tác giả khi kiểm duyệt gỡ bài của họ.
   *
   * approvePost gắn `isTrusted: true` VĨNH VIỄN sau đúng một lần duyệt, và trước đây không có
   * đường nào set lại false: một tài khoản chỉ cần được duyệt một bài hiền là từ đó mọi bài sau
   * lên thẳng PUBLISHED, không bao giờ qua hàng chờ nữa. Đây là tín hiệu ngược còn thiếu.
   * Không đụng tới quyền theo ROLE (nhân viên/CTV/đại lý vẫn tin cậy theo vai trò).
   */
  private async revokeTrust(userId: string): Promise<void> {
    try {
      await this.prisma.communityProfile.updateMany({ where: { userId }, data: { isTrusted: false } });
    } catch (err) {
      this.logger.warn(`revokeTrust failed for ${userId}: ${(err as Error).message}`);
    }
  }

  /** Tạo bài thành tích (auto-post). Không validate độ dài người-dùng-nhập. */
  async createAchievementPost(userId: string, kind: FeedPostKind, body: string, meta?: object) {
    return this.prisma.feedPost.create({ data: { userId, kind, body, meta: meta as object } });
  }

  /** Thả/bỏ tim — toggle. Trả trạng thái sau toggle. */
  async toggleReaction(userId: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, status: true },
    });
    // Chỉ bài ĐÃ DUYỆT: trước đây thả tim được cho cả bài PENDING/REMOVED của người khác nếu
    // biết id — đẩy lượt tim để bài leo hạng "Phổ biến" ngay khi được duyệt.
    if (!post || post.status !== 'PUBLISHED') throw new NotFoundException('Bài viết không tồn tại.');
    const existing = await this.prisma.feedReaction.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) {
      // deleteMany thay vì delete: hai thiết bị bấm cùng lúc thì kẻ thua gặp "record not found"
      // → 500 cho một thao tác thực ra đã thành công.
      await this.prisma.feedReaction.deleteMany({ where: { postId, userId } });
      return { liked: false };
    }
    try {
      await this.prisma.feedReaction.create({ data: { postId, userId } });
    } catch (err) {
      // P2002 = thiết bị kia vừa tạo xong. Kết quả cuối cùng vẫn là "đã thích".
      if ((err as { code?: string } | null)?.code !== 'P2002') throw err;
    }
    return { liked: true };
  }

  async addComment(userId: string, role: string, postId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung bình luận trống.');
    if (text.length > MAX_COMMENT) throw new BadRequestException('Bình luận quá dài.');
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true, userId: true, kind: true, status: true, title: true } });
    // Chỉ bài ĐÃ DUYỆT mới bình luận được. Bài PENDING không hiện trên bảng tin nhưng trước
    // đây vẫn nhận bình luận nếu biết id — hai tài khoản của cùng một người hỏi–đáp trên bài
    // vô hình đó để rút xu (100 xu/bình luận, 500 xu/câu trả lời hay nhất) mà không ai kiểm
    // duyệt được. Xu tiêu thẳng được ở thanh toán nên đây là mất hàng thật.
    if (!post || post.status !== 'PUBLISHED') throw new NotFoundException('Bài viết không tồn tại.');
    const comment = await this.prisma.feedComment.create({ data: { userId, postId, body: text } });
    if (post.kind === 'QUESTION') {
      try {
        await this.reward.rewardAnswer(userId, post.userId, comment.id);
      } catch (err) {
        this.logger.warn(`rewardAnswer failed for comment ${comment.id}: ${(err as Error).message}`);
      }
      if (userId !== post.userId) {
        try {
          const answerer = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
          const template = role === 'STAFF' || role === 'ADMIN' ? 'COMMUNITY_EXPERT_REPLIED' : 'COMMUNITY_NEW_ANSWER';
          await this.notifications?.notify(post.userId, template, {
            author: answerer?.fullName ?? 'Thành viên',
            title: post.title ?? 'câu hỏi của bạn',
          });
        } catch (err) {
          this.logger.warn(`notify(answer) failed for comment ${comment.id}: ${(err as Error).message}`);
        }
        try {
          const amount = await this.config.get<number>('community.rep_answer', 2);
          await this.bumpReputation(userId, amount, 'ANSWER', comment.id);
        } catch (err) {
          this.logger.warn(`bumpReputation(answer) failed for ${userId}: ${(err as Error).message}`);
        }
      }
    }
    return { id: comment.id };
  }

  async getComments(postId: string, viewerId?: string, take = 50, cursor?: string) {
    // Cùng quy tắc hiển thị với getPost — thiếu check này cho phép đọc bình luận của bài
    // REMOVED (đã gỡ vì vi phạm) hoặc PENDING (chưa duyệt, không phải bài của mình) dù
    // chính bài viết đã bị chặn xem qua getPost (IDOR: rò rỉ nội dung qua đường vòng).
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { status: true, userId: true } });
    if (!post || post.status === 'REMOVED') throw new NotFoundException('Bài viết không tồn tại.');
    if (post.status === 'PENDING' && post.userId !== viewerId) throw new NotFoundException('Bài viết không tồn tại.');
    // Phân trang: trước đây cắt cứng ở 50 bình luận và không có đường xem tiếp — câu hỏi hot 80
    // câu trả lời thì 30 người đã được cộng xu/uy tín nhưng không ai đọc được nội dung của họ,
    // trong khi con số đếm vẫn nói 80. `id` là cuid (tăng dần theo thời gian tạo) nên đủ ổn định
    // làm khoá cursor cho thứ tự thời gian.
    const limit = Math.min(Math.max(take, 1), 100);
    const rows = await this.prisma.feedComment.findMany({
      where: { postId, isRemoved: false },
      orderBy: [{ isAccepted: 'desc' }, { createdAt: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { user: { select: { fullName: true, avatarUrl: true, role: true, communityProfile: { select: { level: true } } } } },
    });
    const hasMore = rows.length > limit;
    const comments = hasMore ? rows.slice(0, limit) : rows;
    const items = comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.user.fullName ?? 'Bạn Tubu',
      avatar: c.user.avatarUrl ?? null,
      badge: authorBadge(c.user.role),
      authorLevel: c.user.communityProfile?.level ?? 1,
      isAccepted: c.isAccepted,
      createdAt: c.createdAt,
      isOwner: c.userId === viewerId,
    }));
    return { items, nextCursor: hasMore ? comments[comments.length - 1]!.id : null };
  }

  /** Chọn câu trả lời hay nhất — chủ bài QUESTION hoặc ADMIN. */
  async setBestAnswer(userId: string, role: string, postId: string, commentId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, userId: true, kind: true, bestCommentId: true, status: true },
    });
    // Cùng lý do với addComment: thưởng 500 xu chỉ được chi cho nội dung đã qua kiểm duyệt.
    if (!post || post.status !== 'PUBLISHED') throw new NotFoundException('Bài viết không tồn tại.');
    if (post.kind !== 'QUESTION') throw new BadRequestException('Chỉ câu hỏi mới có câu trả lời hay nhất.');
    if (post.userId !== userId && role !== 'ADMIN') throw new ForbiddenException('Chỉ chủ bài mới chọn được.');
    const comment = await this.prisma.feedComment.findUnique({ where: { id: commentId }, select: { id: true, postId: true, userId: true, isRemoved: true } });
    // Bình luận đã gỡ không được nhận thưởng, và bestCommentId không được trỏ vào nội dung ẩn:
    // danh sách bình luận lọc isRemoved nên thẻ bài sẽ khoe "đã có câu trả lời hay nhất" trong
    // khi mở ra chẳng thấy câu nào.
    if (!comment || comment.postId !== postId || comment.isRemoved) {
      throw new NotFoundException('Câu trả lời không tồn tại.');
    }
    // Lần chọn ĐẦU TIÊN cho bài này (bestCommentId hiện đang null) — chỉ lần này mới được
    // cộng rep/notify (xem chống-farm bên dưới). Đọc trước transaction: nhất quán với
    // rewardBestAnswer (idempotent theo postId, không theo commentId).
    const isFirstSelection = post.bestCommentId == null;
    // 3 ghi cùng lúc phải atomic — tránh trạng thái nửa vời nếu 1 write giữa chừng lỗi
    // (vd đã bỏ cờ isAccepted cũ nhưng chưa set cờ mới/bestCommentId).
    await this.prisma.$transaction([
      this.prisma.feedComment.updateMany({ where: { postId }, data: { isAccepted: false } }),
      this.prisma.feedComment.update({ where: { id: commentId }, data: { isAccepted: true } }),
      this.prisma.feedPost.update({ where: { id: postId }, data: { bestCommentId: commentId } }),
    ]);
    try {
      await this.reward.rewardBestAnswer(comment.userId, post.userId, postId);
    } catch (err) {
      this.logger.warn(`rewardBestAnswer failed for comment ${commentId}: ${(err as Error).message}`);
    }
    // Chỉ cộng rep + notify khi (a) câu trả lời KHÔNG phải của chính chủ bài — chống farm hạng
    // (chủ bài tự trả lời rồi tự chọn best sẽ không được +rep_best) — VÀ (b) đây là lần chọn
    // best-answer ĐẦU TIÊN cho bài này. Thiếu điều kiện (b) trước đây cho phép chủ bài đổi
    // qua đổi lại best-answer giữa 2 comment (kể cả tự tạo bằng tài khoản phụ) để +rep_best
    // KHÔNG GIỚI HẠN mỗi lần đổi — cùng lớp lỗi farm-thưởng mà rewardBestAnswer (idempotent
    // theo postId) đã chặn ở phía coin, nhưng phía reputation lại bỏ sót.
    if (comment.userId !== post.userId && isFirstSelection) {
      try {
        const amount = await this.config.get<number>('community.rep_best', 10);
        await this.bumpReputation(comment.userId, amount, 'BEST_ANSWER', postId);
      } catch (err) {
        this.logger.warn(`bumpReputation(best-answer) failed for ${comment.userId}: ${(err as Error).message}`);
      }
      try {
        await this.notifications?.notify(comment.userId, 'COMMUNITY_BEST_ANSWER', {});
      } catch (err) {
        this.logger.warn(`notify(best-answer) failed for comment ${commentId}: ${(err as Error).message}`);
      }
    }
    return { ok: true };
  }

  /** Sửa bài — chỉ chủ bài; set editedAt. */
  /**
   * Sửa bài của chính mình. `role` dùng để quyết định có phải duyệt lại hay không — xem
   * khối re-moderation bên dưới (P1-4, docs/2026-09-08-review-progress.md).
   */
  async editPost(
    userId: string,
    postId: string,
    patch: { title?: string; body?: string; images?: string[] },
    role = '',
  ) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { userId: true, status: true },
    });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.userId !== userId) throw new ForbiddenException('Chỉ chủ bài mới sửa được.');
    const data: Record<string, unknown> = { editedAt: new Date() };
    if (patch.body !== undefined) {
      const b = patch.body.trim();
      if (!b || b.length > MAX_BODY) throw new BadRequestException('Nội dung không hợp lệ.');
      data.body = b;
    }
    if (patch.title !== undefined) data.title = patch.title.trim().slice(0, MAX_TITLE) || null;
    if (patch.images !== undefined) data.images = patch.images.filter((u) => u?.trim()).slice(0, MAX_IMAGES);

    // Đổi NỘI DUNG (body/title/ảnh) của bài ĐÃ ĐƯỢC DUYỆT, bởi tác giả chưa thuộc nhóm tin cậy
    // → trả về PENDING để kiểm duyệt lại. Không có bước này thì: bài hiền lành được duyệt (đồng
    // thời tác giả được gắn isTrusted vĩnh viễn), sau đó tác giả thay ruột thành spam/lừa đảo mà
    // bài vẫn PUBLISHED và không bao giờ xuất hiện lại trong hàng chờ duyệt (adminPending chỉ lọc
    // PENDING). Chỉ reset khi thực sự đổi nội dung — sửa rỗng (chỉ chạm editedAt) không đáng
    // đẩy bài ra khỏi bảng tin.
    const contentChanged = patch.body !== undefined || patch.title !== undefined || patch.images !== undefined;
    if (contentChanged && post.status === 'PUBLISHED' && !(await this.isTrusted(userId, role))) {
      data.status = 'PENDING';
    }

    await this.prisma.feedPost.update({ where: { id: postId }, data });
    return { ok: true };
  }

  /** Xoá mềm — chủ bài hoặc ADMIN. */
  /**
   * Gỡ (ẩn mềm) 1 bình luận — tác giả bình luận hoặc ADMIN. Đây là đường DUY NHẤT để xử lý
   * bình luận bị báo cáo: trước đây bảng feed_comments chỉ có create/findMany/isAccepted nên
   * bình luận chửi bới/lộ thông tin hiển thị vĩnh viễn, chính tác giả cũng không xoá được
   * (P1-3, docs/2026-09-08-review-progress.md). Ẩn mềm (isRemoved) chứ không xoá cứng để còn
   * dấu vết kiểm duyệt.
   */
  async removeComment(userId: string, role: string, commentId: string) {
    const comment = await this.prisma.feedComment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true, postId: true, isAccepted: true },
    });
    if (!comment) throw new NotFoundException('Bình luận không tồn tại.');
    if (comment.userId !== userId && role !== 'ADMIN') throw new ForbiddenException('Không có quyền gỡ bình luận này.');

    // Trả lại điểm đã cộng cho NGƯỜI TRẢ LỜI từ chính bình luận này (ANSWER + BEST_ANSWER ghi
    // theo refId = commentId). Trước đây chỉ xoá BÀI mới đảo điểm, nên gỡ một câu trả lời vi
    // phạm vẫn để người viết giữ nguyên hạng đã lên nhờ nó.
    await this.reverseReputationForRef(comment.userId, commentId, 'REVERSE_COMMENT');

    // Bình luận đang được chọn là câu trả lời hay nhất: bỏ cờ + gỡ con trỏ ở bài, nếu không
    // bài sẽ trỏ tới một comment đã ẩn (getComments lọc mất) → hiện "đã có best answer" mà
    // người đọc không thấy nội dung nào.
    await this.prisma.feedComment.update({
      where: { id: commentId },
      data: comment.isAccepted ? { isRemoved: true, isAccepted: false } : { isRemoved: true },
    });
    if (comment.isAccepted) {
      await this.prisma.feedPost.update({ where: { id: comment.postId }, data: { bestCommentId: null } });
    }
    return { ok: true };
  }

  async deletePost(userId: string, role: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.userId !== userId && role !== 'ADMIN') throw new ForbiddenException('Không có quyền xoá.');
    // Trả lại điểm reputation đã cộng từ bài này TRƯỚC khi gỡ — nếu không, đăng-ăn-điểm-rồi-xoá
    // là cách farm hạng sạch dấu vết (P1-1). Trừ theo CHỦ BÀI, kể cả khi ADMIN là người gỡ.
    await this.reverseReputationForPost(post.userId, postId);
    // ADMIN gỡ bài của người khác = hành vi kiểm duyệt → rút cờ tin cậy. Tác giả tự xoá bài
    // của mình thì không (không có vi phạm nào được xác nhận).
    if (post.userId !== userId && role === 'ADMIN') await this.revokeTrust(post.userId);
    await this.prisma.feedPost.update({ where: { id: postId }, data: { status: 'REMOVED' } });
    return { ok: true };
  }

  /** Báo cáo bài/bình luận vi phạm — tạo CommunityReport OPEN. */
  async report(reporterId: string, dto: { targetType: string; targetId: string; reason: string }) {
    const type = dto.targetType === 'COMMENT' ? 'COMMENT' : 'POST';
    const reason = (dto.reason ?? '').trim().slice(0, 500) || 'Không phù hợp';
    // targetId trước đây là chuỗi tuỳ ý, không kiểm tra gì: gửi 60 báo cáo/phút trỏ vào id bịa
    // hoặc vào bình luận của người khác ở bài khác là hàng chờ kiểm duyệt ngập id rác, mà hub
    // admin chỉ hiện đúng cái cuid đó — bấm "Ẩn nội dung" là gỡ nhầm nội dung lành.
    const exists =
      type === 'COMMENT'
        ? await this.prisma.feedComment.findUnique({ where: { id: dto.targetId }, select: { id: true } })
        : await this.prisma.feedPost.findUnique({ where: { id: dto.targetId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Nội dung bị báo cáo không tồn tại.');

    // Cùng người báo cáo cùng một nội dung nhiều lần chỉ tính một — tránh một tài khoản tự đẩy
    // hàng chờ lên hàng trăm dòng.
    const already = await this.prisma.communityReport.findFirst({
      where: { reporterId, targetType: type, targetId: dto.targetId, status: 'OPEN' },
      select: { id: true },
    });
    if (already) return { ok: true };

    await this.prisma.communityReport.create({
      data: { reporterId, targetType: type, targetId: dto.targetId, reason, status: 'OPEN' },
    });
    return { ok: true };
  }

  /** Hàng chờ duyệt — bài PENDING, cũ nhất trước, kèm tên tác giả + danh mục. */
  async adminPending(take = 50) {
    const posts = await this.prisma.feedPost.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take,
      include: { user: { select: { fullName: true } }, category: { select: { name: true } } },
    });
    return posts.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      images: p.images,
      author: p.user.fullName ?? 'Bạn Tubu',
      category: p.category?.name ?? null,
      createdAt: p.createdAt,
    }));
  }

  /** Danh sách report đang mở (OPEN), cũ nhất trước. */
  /**
   * Hàng chờ báo cáo, KÈM trích nội dung bị báo cáo.
   *
   * Trước đây chỉ trả bản ghi report, nên hub kiểm duyệt hiện đúng một dãy cuid cạnh lý do do
   * người báo cáo tự gõ — admin bấm "Ẩn nội dung" mà không nhìn thấy nội dung đó là gì. Nạp theo
   * lô (2 truy vấn cho cả trang) vì CommunityReport không khai quan hệ tới bài/bình luận.
   */
  async adminReports(take = 50) {
    const reports = await this.prisma.communityReport.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take,
    });
    if (reports.length === 0) return [];
    const postIds = reports.filter((r) => r.targetType === 'POST').map((r) => r.targetId);
    const commentIds = reports.filter((r) => r.targetType === 'COMMENT').map((r) => r.targetId);
    const [posts, comments] = await Promise.all([
      postIds.length
        ? this.prisma.feedPost.findMany({
            where: { id: { in: [...new Set(postIds)] } },
            select: { id: true, title: true, body: true, status: true, user: { select: { fullName: true } } },
          })
        : Promise.resolve([]),
      commentIds.length
        ? this.prisma.feedComment.findMany({
            where: { id: { in: [...new Set(commentIds)] } },
            select: { id: true, body: true, postId: true, isRemoved: true, user: { select: { fullName: true } } },
          })
        : Promise.resolve([]),
    ]);
    const postMap = new Map(posts.map((p) => [p.id, p]));
    const commentMap = new Map(comments.map((c) => [c.id, c]));
    return reports.map((r) => {
      const post = r.targetType === 'POST' ? postMap.get(r.targetId) : undefined;
      const comment = r.targetType === 'COMMENT' ? commentMap.get(r.targetId) : undefined;
      return {
        ...r,
        target: post
          ? {
              kind: 'POST' as const,
              author: post.user.fullName ?? 'Thành viên',
              title: post.title,
              excerpt: post.body.slice(0, 300),
              alreadyHandled: post.status === 'REMOVED',
              postId: post.id,
            }
          : comment
            ? {
                kind: 'COMMENT' as const,
                author: comment.user.fullName ?? 'Thành viên',
                title: null,
                excerpt: comment.body.slice(0, 300),
                alreadyHandled: comment.isRemoved,
                postId: comment.postId,
              }
            : null, // nội dung đã bị xoá cứng ở đâu đó — vẫn hiện để admin đóng báo cáo
      };
    });
  }

  /** Đánh dấu report đã xử lý. */
  async resolveReport(reportId: string) {
    await this.prisma.communityReport.update({ where: { id: reportId }, data: { status: 'RESOLVED' } });
    return { ok: true };
  }

  /** Ghim/bỏ ghim bài lên đầu bảng tin. */
  async pinPost(postId: string, pinned: boolean) {
    await this.prisma.feedPost.update({ where: { id: postId }, data: { isPinned: pinned } });
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // Pha 4 Task 2 — Sự kiện cộng đồng (CommunityEvent). Bài tham gia dùng
  // FeedPost.meta.eventId (không bảng join riêng — MVP, xem createPost).
  // -------------------------------------------------------------------

  /** Sự kiện đang mở, sắp theo hạn chót gần nhất trước — dùng cho danh sách FE. */
  async listEvents(take = 20) {
    return this.prisma.communityEvent.findMany({
      where: { status: 'OPEN' },
      orderBy: { endAt: 'asc' },
      take,
    });
  }

  /** Chi tiết 1 sự kiện. */
  async getEvent(id: string) {
    const event = await this.prisma.communityEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại.');
    return event;
  }

  /** Bài tham gia sự kiện — lọc FeedPost PUBLISHED có meta.eventId khớp. */
  async eventPosts(eventId: string, viewerId: string, take = 20) {
    const posts = await this.prisma.feedPost.findMany({
      where: { status: 'PUBLISHED', meta: { path: ['eventId'], equals: eventId } },
      orderBy: { createdAt: 'desc' },
      take,
      include: { ...FEED_INCLUDE, reactions: { where: { userId: viewerId }, select: { id: true } } },
    });
    return posts.map((p) => this.toItem(p, viewerId));
  }

  /** Tạo sự kiện mới (admin). */
  async createEvent(dto: CreateEventInput) {
    if (new Date(dto.startAt) >= new Date(dto.endAt)) {
      throw new BadRequestException('Thời gian kết thúc phải sau thời gian bắt đầu.');
    }
    return this.prisma.communityEvent.create({ data: dto });
  }

  /** Đóng sự kiện thủ công (admin) — không chọn người thắng. */
  async closeEvent(id: string) {
    await this.prisma.communityEvent.update({ where: { id }, data: { status: 'CLOSED' } });
    return { ok: true };
  }

  /**
   * Chọn người thắng sự kiện (admin) — đóng sự kiện + thưởng TubuXu. Thưởng NON-FATAL:
   * lỗi thưởng (vd trùng idempotency) không chặn việc chốt người thắng.
   *
   * Money-critical: CHỈ chốt được khi sự kiện còn OPEN. Vì reason thưởng nhúng userId
   * (COMMUNITY_EVENT_WIN:<eventId>:<userId>), gọi pickWinner 2 lần với 2 userId KHÁC nhau
   * trên cùng sự kiện sẽ trả thưởng CẢ HAI (unique index chỉ dedup theo từng user) → trả
   * đôi. Đóng sự kiện bằng updateMany có điều kiện status='OPEN' + gate count===1: chỉ MỘT
   * request đua chốt được (kẻ thua nhận count 0 → BadRequest, KHÔNG thưởng). Giữ cả check
   * status!=='OPEN' sớm để fail nhanh cho trường hợp phổ biến (double-submit tuần tự).
   */
  async pickWinner(eventId: string, userId: string) {
    const event = await this.prisma.communityEvent.findUnique({
      where: { id: eventId },
      select: { id: true, status: true, rewardXu: true },
    });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại.');
    if (event.status !== 'OPEN') throw new BadRequestException('Sự kiện đã đóng hoặc đã chọn người thắng.');
    const winner = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!winner) throw new NotFoundException('Người dùng không tồn tại.');
    const { count } = await this.prisma.communityEvent.updateMany({
      where: { id: eventId, status: 'OPEN' },
      data: { winnerUserId: userId, status: 'CLOSED' },
    });
    if (count !== 1) throw new BadRequestException('Sự kiện đã đóng hoặc đã chọn người thắng.');
    try {
      await this.reward.rewardEventWinner(userId, eventId, event.rewardXu);
    } catch (err) {
      this.logger.warn(`rewardEventWinner failed for event ${eventId}/user ${userId}: ${(err as Error).message}`);
    }
    return { ok: true };
  }
}
