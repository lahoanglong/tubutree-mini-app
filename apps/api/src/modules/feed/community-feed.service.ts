import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunityRewardService } from './community-reward.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { authorBadge } from './author-badge';
import { PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';
import { startOfVnDay } from '../../common/vn-time';
import { formatPoints } from '../../common/format-points';
import { decodeServedImage } from '../../common/served-image';
import { COMMUNITY_MODERATORS } from '../../common/staff-permissions';
import { EVENT_REWARD_MAX_POINTS, EVENT_REWARD_MIN_POINTS } from './community-limits';
import { loadFeedImages, matchesFeedImageVersion, MAX_FEED_IMAGES, type FeedPostImages } from './feed-images';
import { leaderboardAuthorName, PUBLIC_PREVIEW_DEFAULT, PUBLIC_PREVIEW_KEY, PUBLIC_PREVIEW_KINDS, PUBLIC_PREVIEW_POSTS, toPublicPreviewItem } from './community-public-preview';
import { containsBannedContent, DEFAULT_BANNED_KEYWORDS, parseBannedKeywords } from './content-filter';
import { DEFAULT_UNANSWERED_ALERT_HOURS, listUnansweredQuestions, UNANSWERED_ALERT_HOURS_KEY, unansweredCutoff } from './community-unanswered';

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

export { containsBannedContent } from './content-filter';

const DEFAULT_REJECT_REASON = 'nội dung chưa phù hợp với nội quy cộng đồng';
const REJECT_TITLE_PREVIEW = 40;

/** Tin "bài của bạn có người thích/bình luận" gộp theo bài trong chừng này phút (0 = tắt). Khoá chỉnh được ở SystemConfig. */
const AUTHOR_NOTIFY_INTERVAL_KEY = 'community.author_notify_interval_minutes';
const DEFAULT_AUTHOR_NOTIFY_INTERVAL_MIN = 60;
const MAX_AUTHOR_NOTIFY_INTERVAL_MIN = 1440;

/** Tên bài trong thông báo: tiêu đề, bài không tiêu đề thì lấy đầu nội dung. */
function previewTitle(title: string | null, body: string): string {
  const raw = (title?.trim() || body.trim()).replace(/\s+/g, ' ');
  return raw.length > REJECT_TITLE_PREVIEW ? `${raw.slice(0, REJECT_TITLE_PREVIEW)}…` : raw;
}

type FeedPostKind = 'MANUAL' | 'HARVEST' | 'MILESTONE' | 'SPECIES' | 'QUESTION' | 'SHOWCASE' | 'TIP';

const MAX_TITLE = 160;
const MAX_BODY = 5000;
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
  /** Điểm Xanh thưởng người thắng (PD-3; cột rewardXu cũ chỉ còn cho sự kiện tạo trước gộp). */
  rewardPoints?: number;
}

const FEED_INCLUDE = {
  user: { select: { fullName: true, avatarUrl: true, role: true, communityProfile: { select: { level: true } } } },
  category: { select: { slug: true, name: true, icon: true } },
  // Chip trên bài cũ mở trang sản phẩm: hàng đã ngừng bán thì ẩn chip (trang đó 404).
  productTags: {
    where: { product: PUBLIC_PRODUCT_WHERE },
    include: { product: { select: { slug: true, name: true, thumbnail: true, salePrice: true, basePrice: true } } },
  },
  tags: { include: { tag: { select: { slug: true, name: true } } } },
} as const;

/**
 * Cột của một bài trong danh sách/chi tiết. KHÔNG có `images`: cột này có thể chứa tới 6 ảnh base64 nên đọc nguyên mảng
 * cho cả trang là hàng chục MB; ảnh đi đường riêng (loadFeedImages) và trả đường dẫn tới endpoint ảnh.
 */
const FEED_SELECT = {
  id: true,
  kind: true,
  status: true,
  title: true,
  body: true,
  meta: true,
  isPinned: true,
  bestCommentId: true,
  userId: true,
  createdAt: true,
  ...FEED_INCLUDE,
} as const;

interface FeedCounts {
  likes: Map<string, number>;
  comments: Map<string, number>;
}

/** Hình dạng FeedPost sau khi select FEED_SELECT + reactions (dùng chung getFeed/getPost/eventPosts). */
type FeedPostRow = Prisma.FeedPostGetPayload<{
  select: typeof FEED_SELECT & { reactions: { select: { id: true } } };
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
    private readonly analytics: AnalyticsEventsService,
    // Optional: thông báo trả lời/best-answer/duyệt bài — không chặn hành động chính nếu thiếu/lỗi.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Từ cấm do admin chỉnh ở SystemConfig `community.banned_keywords`; chưa đặt hoặc sai kiểu thì dùng danh sách mặc định. */
  private async bannedKeywords(): Promise<readonly string[]> {
    return parseBannedKeywords(await this.config.get<unknown>('community.banned_keywords', DEFAULT_BANNED_KEYWORDS));
  }

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
   * Đếm-rồi-quyết nằm TRONG transaction Serializable — cùng pattern với trần thưởng Điểm Xanh ở
   * `CommunityRewardService.rewardWithDailyCap` — để 2 request dồn dập không cùng lọt trần.
   */
  async bumpReputation(userId: string, amount: number, reason: string, refId: string): Promise<void> {
    if (amount <= 0) return;
    try {
      const thresholds = await this.config.get<number[]>('community.rep_thresholds', DEFAULT_REP_THRESHOLDS);
      const dailyCap = await this.config.get<number>('community.daily_rep_cap', 30);
      const since = startOfVnDay();
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
      const thresholds = await this.repThresholds();
      await this.prisma.$transaction((tx) => this.reverseReputationInTx(tx, userId, refId, reason, thresholds));
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2002') return; // đã đảo rồi (gỡ lần 2)
      // Bài đã REMOVED thì các lần gọi sau thoát sớm, nên lỗi ở đây là điểm kẹt vĩnh viễn: phải có dấu vết để dò.
      this.logger.error(`reverseReputation failed refId=${refId} user=${userId} reason=${reason}: ${(err as Error).message}`);
    }
  }

  private repThresholds(): Promise<number[]> {
    return this.config.get<number[]>('community.rep_thresholds', DEFAULT_REP_THRESHOLDS);
  }

  /**
   * Thân của việc đảo điểm. KHÔNG nuốt lỗi: gọi bên trong transaction của hidePost/deletePost thì lỗi hoàn tác luôn việc đổi
   * trạng thái (bài vẫn đăng, CSKH thử lại được) thay vì để bài REMOVED mà điểm kẹt vĩnh viễn. Kiểm dòng đảo đã có bằng
   * findFirst vì P2002 trong transaction làm hỏng cả giao dịch. `thresholds` đọc trước (đọc config trong tx xin thêm kết nối pool).
   */
  private async reverseReputationInTx(tx: Prisma.TransactionClient, userId: string, refId: string, reason: string, thresholds: number[]): Promise<void> {
    if (await tx.reputationEvent.findFirst({ where: { userId, reason, refId }, select: { id: true } })) return;
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
      author: leaderboardAuthorName(p.user.fullName),
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
    // 'popular' sắp theo cột likeCount (bảo trì trong toggleReaction) nên không phải đếm cả bảng
    // feed_reactions. HẠN CHẾ ĐÃ BIẾT: khoá sắp xếp là số tim — một con số THAY ĐỔI ĐƯỢC. Ai đó
    // thả tim cho một bài ở trang 2 trong lúc người dùng đang xem trang 1 thì bài đó có thể nhảy
    // lên và hiện lần thứ hai (hoặc một bài khác bị bỏ qua); keyset theo (likeCount, createdAt,
    // id) mới triệt để, chưa làm. Cột chỉ để xếp hạng: số hiển thị vẫn đếm thật theo trang.
    const orderBy =
      opts.sort === 'popular'
        ? [
            { isPinned: 'desc' as const },
            { likeCount: 'desc' as const },
            { createdAt: 'desc' as const },
            { id: 'desc' as const },
          ]
        : [{ isPinned: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'desc' as const }];
    const posts = await this.prisma.feedPost.findMany({
      where,
      orderBy,
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: { ...FEED_SELECT, reactions: { where: { userId }, select: { id: true } } },
    });
    const hasMore = posts.length > take;
    const page = hasMore ? posts.slice(0, take) : posts;
    const ids = page.map((p) => p.id);
    const [counts, images] = await Promise.all([this.countsForPage(ids), loadFeedImages(this.prisma, ids, true)]);
    return {
      posts: page.map((p) => this.toItem(p, userId, counts, images, { list: true })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  /**
   * Xem trước công khai cho khách chưa đăng nhập (D5-07): vài bài đã đăng, chỉ trường công khai (xem
   * toPublicPreviewItem). Cờ tắt thì 404 như route không tồn tại. Đọc chi tiết, thích, bình luận, đăng bài vẫn qua các
   * route cần đăng nhập.
   */
  async publicPreview() {
    if ((await this.config.get<unknown>(PUBLIC_PREVIEW_KEY, PUBLIC_PREVIEW_DEFAULT)) !== true) throw new NotFoundException('Không tìm thấy.');
    const rows = await this.prisma.feedPost.findMany({
      where: { status: 'PUBLISHED', kind: { in: [...PUBLIC_PREVIEW_KINDS] } },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: PUBLIC_PREVIEW_POSTS,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        isPinned: true,
        createdAt: true,
        user: { select: { fullName: true, role: true } },
        category: { select: { slug: true, name: true, icon: true } },
      },
    });
    const ids = rows.map((r) => r.id);
    const [counts, images] = await Promise.all([this.countsForPage(ids), loadFeedImages(this.prisma, ids, true)]);
    return {
      posts: rows.map((r) =>
        toPublicPreviewItem(r, { likes: counts.likes.get(r.id) ?? 0, comments: counts.comments.get(r.id) ?? 0 }, images.get(r.id)?.images[0] ?? null),
      ),
    };
  }

  async getPost(userId: string, postId: string) {
    const p = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { ...FEED_SELECT, reactions: { where: { userId }, select: { id: true } } },
    });
    if (!p) throw new NotFoundException('Bài viết không tồn tại.');
    if (p.status === 'REMOVED') throw new NotFoundException('Bài viết không tồn tại.');
    if (p.status === 'PENDING' && p.userId !== userId) throw new NotFoundException('Bài viết không tồn tại.');
    // KHÔNG tăng viewCount ở đây nữa: đây là đường đọc nóng nhất, mỗi lượt mở/refresh là một
    // UPDATE khoá đúng một dòng (ghi tuần tự trên bài viral), trong khi toItem() và FeedItem
    // KHÔNG hề trả `viewCount` ra — không màn nào hiển thị con số đó. Cột vẫn còn trong schema
    // cho báo cáo sau này; khi cần hãy đếm theo phiên/ngày hoặc gom batch thay vì ghi mỗi request.
    const [counts, images] = await Promise.all([this.countsForPage([p.id]), loadFeedImages(this.prisma, [p.id], false)]);
    return this.toItem(p, userId, counts, images);
  }

  /**
   * Đếm tim/bình luận CHỈ cho các bài của trang hiện tại (theo index postId). Cách cũ dùng
   * `_count` của include khiến Prisma LEFT JOIN hai subquery GROUP BY quét cả bảng reactions và
   * comments mỗi lần tải feed (C-042). Bình luận đếm CÓ LỌC isRemoved: thẻ bài và màn chi tiết
   * cùng hiện con số này, trong khi danh sách bình luận lại lọc bỏ bài đã gỡ — người đọc thấy
   * "💬 5" cạnh "Trả lời (3)" và tưởng bị giấu nội dung.
   */
  private async countsForPage(postIds: string[]): Promise<FeedCounts> {
    if (postIds.length === 0) return { likes: new Map(), comments: new Map() };
    const [likes, comments] = await Promise.all([
      this.prisma.feedReaction.groupBy({
        by: ['postId'],
        where: { postId: { in: postIds } },
        _count: { _all: true },
      }),
      this.prisma.feedComment.groupBy({
        by: ['postId'],
        where: { postId: { in: postIds }, isRemoved: false },
        _count: { _all: true },
      }),
    ]);
    return {
      likes: new Map(likes.map((g) => [g.postId, g._count._all])),
      comments: new Map(comments.map((g) => [g.postId, g._count._all])),
    };
  }

  /**
   * Byte của ảnh base64 thứ `index` trong một bài (đích của `feedImageRef`). Quyền xem như bài viết: bài đã đăng ai cũng
   * xem (ảnh bài đã công khai trong bảng tin); bài PENDING/HIDDEN/REMOVED chỉ tác giả, ADMIN hoặc STAFF nhóm CSKH. Thẻ img
   * không gửi được token nên bài PENDING còn mở được bằng mã `v` của đúng ảnh đó (danh sách của tác giả/người duyệt mới có).
   * Mọi trường hợp không được xem đều 404 để không lộ bài có tồn tại hay không. Chỉ đọc đúng một phần tử mảng ảnh.
   * `versionOk` cho controller biết URL có gắn đúng nội dung ảnh hiện tại không (cache vĩnh viễn chỉ an toàn khi có).
   */
  async getImage(
    postId: string,
    index: number,
    viewer: { sub: string; role: string; staffPermissions?: string[] } | undefined,
    version: unknown,
  ): Promise<{ mime: string; data: Buffer; isPublic: boolean; versionOk: boolean }> {
    const notFound = () => new NotFoundException('Không tìm thấy ảnh.');
    if (!Number.isInteger(index) || index < 0 || index >= MAX_FEED_IMAGES) throw notFound();
    const rows = await this.prisma.$queryRaw<{ status: string; userId: string; img: string | null }[]>`
      SELECT "status"::text AS "status", "userId", "images"[${index + 1}::int] AS "img" FROM "feed_posts" WHERE "id" = ${postId}`;
    const row = rows[0];
    if (!row?.img) throw notFound();
    const isPublic = row.status === 'PUBLISHED';
    const versionOk = matchesFeedImageVersion(version, postId, index, row.img);
    if (!isPublic) {
      const isModerator =
        viewer?.role === 'ADMIN' || (viewer?.role === 'STAFF' && COMMUNITY_MODERATORS.some((p) => viewer.staffPermissions?.includes(p)));
      const allowed =
        isModerator ||
        (!!viewer && viewer.sub === row.userId) ||
        (row.status === 'PENDING' && versionOk);
      if (!allowed) throw notFound();
    }
    const decoded = decodeServedImage(row.img);
    if (!decoded) throw notFound();
    return { ...decoded, isPublic, versionOk };
  }

  /** Danh mục cộng đồng đang hiển thị, sắp theo order — dùng cho tabs FE. */
  async getCategories() {
    return this.prisma.communityCategory.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      select: { id: true, slug: true, name: true, icon: true },
    });
  }

  /**
   * Ảnh bài là base64 (~300KB/ảnh khi chưa có Cloudinary) nên không nhúng trong JSON: `images` là đường dẫn tới endpoint ảnh
   * (hoặc URL https nguyên văn). `imagesOf` đã cắt sẵn theo nơi gọi: danh sách chỉ ảnh bìa + `imageCount`, chi tiết trả đủ.
   */
  private toItem(
    p: FeedPostRow,
    userId: string,
    counts: FeedCounts,
    imagesOf: Map<string, FeedPostImages>,
    opts: { list?: boolean } = {},
  ) {
    const postImages = imagesOf.get(p.id);
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      title: p.title ?? null,
      body: p.body,
      images: postImages?.images ?? [],
      imageCount: postImages?.count ?? 0,
      meta: p.meta,
      createdAt: p.createdAt,
      author: p.user.fullName ?? 'Bạn Tubu',
      avatar: p.user.avatarUrl ?? null,
      badge: authorBadge(p.user.role),
      authorLevel: p.user.communityProfile?.level ?? 1,
      category: p.category ? { slug: p.category.slug, name: p.category.name, icon: p.category.icon } : null,
      // Ảnh sản phẩm đối tác có thể là base64 tới 1,5 triệu ký tự (chưa cấu hình Cloudinary): danh sách (20 đến 50 bài) không
      // nhúng chỉ để vẽ biểu tượng 28px, client đã chịu được thumbnail rỗng. Chi tiết một bài vẫn trả để vẽ ảnh 48px.
      productTags: (p.productTags ?? []).map((t) => ({
        slug: t.product.slug, name: t.product.name,
        thumbnail: opts.list && t.product.thumbnail?.startsWith('data:') ? null : t.product.thumbnail,
        salePrice: t.product.salePrice, basePrice: t.product.basePrice,
      })),
      tags: (p.tags ?? []).map((t) => ({ slug: t.tag.slug, name: t.tag.name })),
      likeCount: counts.likes.get(p.id) ?? 0,
      commentCount: counts.comments.get(p.id) ?? 0,
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
    const images = (input.images ?? []).filter((u) => typeof u === 'string' && u.trim()).slice(0, MAX_FEED_IMAGES);
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
      // cách được chọn trúng giải kèm rewardPoints.
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
    // Rào chắn nội dung (bug fix): user isTrusted trước đây được PUBLISHED thẳng, bỏ qua MỌI bộ
    // lọc — rào cản "đã mua 1 lần" đủ thấp để một tài khoản mua hàng 1 lần chèn link ngoài/nội
    // dung vi phạm vào bài đăng công khai ngay lập tức. Match từ cấm/link lạ → ép PENDING (bỏ
    // qua nhánh auto-PUBLISHED) thay vì chặn hẳn, để admin còn duyệt tay nếu là báo động giả.
    const flagged = containsBannedContent(`${title ?? ''}\n${body}`, await this.bannedKeywords());
    const status = trusted && !flagged ? 'PUBLISHED' : 'PENDING';

    const post = await this.prisma.feedPost.create({
      data: {
        userId, kind, status, body, title, images, categoryId: input.categoryId ?? null,
        ...(input.eventId ? { meta: { eventId: input.eventId } } : {}),
      },
      select: { id: true },
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
        // Hai nhãn cùng slug là một Tag: nhãn đầu giữ name, như upsert nối tiếp trước đây.
        const nameBySlug = new Map<string, string>();
        for (const label of tagLabels) {
          const slug = slugifyTag(label);
          if (!nameBySlug.has(slug)) nameBySlug.set(slug, label);
        }
        const slugs = [...nameBySlug.keys()];
        await this.prisma.tag.createMany({
          data: slugs.map((slug) => ({ slug, name: nameBySlug.get(slug)! })),
          skipDuplicates: true,
        });
        const rows = await this.prisma.tag.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
        const idBySlug = new Map(rows.map((t) => [t.slug, t.id]));
        const tags = slugs.flatMap((slug) => {
          const id = idBySlug.get(slug);
          return id ? [{ id }] : [];
        });
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
    // Có điều kiện PENDING: duyệt song song với từ chối (hoặc duyệt đôi) thì chỉ một lượt thắng, lượt thua không hồi sinh
    // bài vừa bị gỡ và không thưởng/báo lần hai.
    const { count } = await this.prisma.feedPost.updateMany({ where: { id: postId, status: 'PENDING' }, data: { status: 'PUBLISHED' } });
    if (count !== 1) return { ok: true };
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
    // Các bước trên (tin cậy, thưởng, uy tín) không nằm chung transaction với việc đổi trạng thái, nên ẩn/xoá có thể chen vào
    // giữa: lúc đó chưa có gì để đảo và tác giả giữ điểm + tin cậy của một bài đã bị gỡ. Đọc lại trạng thái SAU khi đã cộng
    // xong; FOR SHARE chờ nếu một transaction ẩn/xoá đang giữ khoá dòng chưa commit, nên không bỏ sót lượt đang dở. Hoặc ta thấy
    // REMOVED và tự đảo ở đây, hoặc lượt gỡ chạy sau lần đọc này và nó thấy điểm đã cộng (mọi bước cộng đã commit trước lần đọc).
    // Điểm Xanh của rewardPost không đảo được ở đây (ẩn/xoá thường cũng không đảo): việc đã có từ trước.
    const [now] = await this.prisma.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "feed_posts" WHERE "id" = ${postId} FOR SHARE`;
    if (now?.status !== 'PUBLISHED') {
      await this.reverseReputationForPost(post.userId, postId);
      await this.revokeTrust(post.userId);
      return { ok: true };
    }
    try {
      await this.notifications?.notify(post.userId, 'COMMUNITY_POST_APPROVED', { post_id: post.id });
    } catch (err) {
      this.logger.warn(`notify(approve) failed ${post.id}: ${(err as Error).message}`);
    }
    return { ok: true };
  }

  /**
   * Từ chối bài PENDING → xoá mềm REMOVED và báo tác giả (kèm lý do) để họ biết bài đi đâu. CHỈ nhận bài chưa đăng: bài đã
   * đăng phải dùng hidePost (đảo điểm, tin nhắn "đã được ẩn"); nhận cả hai thì CSKH bấm nhầm trên bài vừa được người khác
   * duyệt sẽ gỡ bài và báo tác giả "chưa được đăng" ngay sau tin "đã duyệt". Bài chờ duyệt chưa cộng điểm nên không có gì để đảo.
   */
  async rejectPost(postId: string, reason?: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, userId: true, status: true, title: true, body: true },
    });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.status === 'REMOVED') return { ok: true };
    if (post.status !== 'PENDING') throw this.alreadyPublished();
    const { count } = await this.prisma.feedPost.updateMany({ where: { id: postId, status: 'PENDING' }, data: { status: 'REMOVED' } });
    if (count !== 1) {
      // Thua cuộc đua: nếu người kia từ chối thì xong rồi; nếu người kia duyệt thì CSKH phải biết bài đã lên.
      const now = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { status: true } });
      if (now?.status === 'PUBLISHED') throw this.alreadyPublished();
      return { ok: true };
    }
    await this.revokeTrust(post.userId);
    await this.notifyPostRejected(postId, post, reason);
    return { ok: true };
  }

  private alreadyPublished() {
    return new ConflictException('Bài này đã được đăng nên không thể từ chối. Hãy dùng "Ẩn" để gỡ bài đã đăng.');
  }

  /**
   * Rút cờ tin cậy của tác giả khi kiểm duyệt gỡ bài của họ.
   *
   * approvePost gắn `isTrusted: true` VĨNH VIỄN sau đúng một lần duyệt, và trước đây không có
   * đường nào set lại false: một tài khoản chỉ cần được duyệt một bài hiền là từ đó mọi bài sau
   * lên thẳng PUBLISHED, không bao giờ qua hàng chờ nữa. Đây là tín hiệu ngược còn thiếu.
   * Không đụng tới quyền theo ROLE (nhân viên/CTV/đại lý vẫn tin cậy theo vai trò).
   */
  private async revokeTrust(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    // Trong transaction thì để lỗi nổi lên (hoàn tác cả giao dịch); ngoài transaction vẫn là việc phụ, không chặn việc gỡ bài.
    if (tx) {
      await tx.communityProfile.updateMany({ where: { userId }, data: { isTrusted: false } });
      return;
    }
    try {
      await this.prisma.communityProfile.updateMany({ where: { userId }, data: { isTrusted: false } });
    } catch (err) {
      this.logger.error(`revokeTrust failed user=${userId}: ${(err as Error).message}`);
    }
  }

  /** Tạo bài thành tích (auto-post). Không validate độ dài người-dùng-nhập. */
  async createAchievementPost(userId: string, kind: FeedPostKind, body: string, meta?: object, client: Pick<Prisma.TransactionClient, 'feedPost'> = this.prisma) {
    return client.feedPost.create({ data: { userId, kind, body, meta: meta as object } });
  }

  /** Thả/bỏ tim — toggle. Trả trạng thái sau toggle. */
  async toggleReaction(userId: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, userId: true, status: true, title: true, body: true },
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
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.feedReaction.deleteMany({ where: { postId, userId } });
        if (count > 0) {
          await tx.feedPost.updateMany({
            where: { id: postId, likeCount: { gt: 0 } },
            data: { likeCount: { decrement: count } },
          });
        }
      });
      return { liked: false };
    }
    let created = false;
    try {
      // Cùng transaction để likeCount không lệch khi tạo tim thất bại (P2002 → rollback cả hai).
      await this.prisma.$transaction([
        this.prisma.feedReaction.create({ data: { postId, userId } }),
        this.prisma.feedPost.update({ where: { id: postId }, data: { likeCount: { increment: 1 } }, select: { id: true } }),
      ]);
      created = true;
      // Task 9: chỉ phát khi THẬT SỰ tạo được reaction ở request này — nhánh P2002 bên dưới nghĩa
      // là thiết bị khác đã tạo trước, không phải hành động của request này.
      await this.analytics.recordBestEffort({
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'feed_reaction', postId },
      });
    } catch (err) {
      // P2002 = thiết bị kia vừa tạo xong. Kết quả cuối cùng vẫn là "đã thích".
      if ((err as { code?: string } | null)?.code !== 'P2002') throw err;
    }
    if (created) {
      await this.notifyAuthorOfActivity(post, userId, 'COMMUNITY_POST_LIKED', async () => ({
        title: previewTitle(post.title, post.body),
        post_id: post.id,
      }));
    }
    return { liked: true };
  }

  /** Cửa sổ gộp tin tương tác theo bài, mili giây; null = đã tắt. Giá trị cấu hình sai thì dùng mặc định thay vì tắt/mở toang. */
  private async authorNotifyWindowMs(): Promise<number | null> {
    const raw = await this.config.get<unknown>(AUTHOR_NOTIFY_INTERVAL_KEY, DEFAULT_AUTHOR_NOTIFY_INTERVAL_MIN);
    const minutes =
      typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_AUTHOR_NOTIFY_INTERVAL_MIN
        ? raw
        : DEFAULT_AUTHOR_NOTIFY_INTERVAL_MIN;
    return minutes === 0 ? null : minutes * 60_000;
  }

  /**
   * Báo chủ bài khi người khác thích/bình luận (mọi loại bài; câu trả lời cho QUESTION đã có tin riêng). Mỗi loại một khoá gộp
   * theo bài: một bài viral cũng chỉ làm điện thoại tác giả rung một lần mỗi cửa sổ cho mỗi loại, và một lượt thích không chặn
   * tin bình luận (bình luận mới là thứ tác giả cần trả lời). Không bao giờ làm hỏng thao tác chính.
   */
  private async notifyAuthorOfActivity(
    post: { id: string; userId: string },
    actorId: string,
    template: 'COMMUNITY_POST_LIKED' | 'COMMUNITY_POST_COMMENTED',
    buildData: () => Promise<Record<string, string>>,
  ): Promise<void> {
    if (!post.userId || post.userId === actorId) return;
    try {
      const windowMs = await this.authorNotifyWindowMs();
      if (windowMs === null) return;
      await this.notifications?.notify(post.userId, template, await buildData(), {
        dedupeKey: `${template === 'COMMUNITY_POST_LIKED' ? 'post-like' : 'post-comment'}:${post.id}`,
        dedupeWithinMs: windowMs,
      });
    } catch (err) {
      this.logger.warn(`notify(${template}) failed for post ${post.id}: ${(err as Error).message}`);
    }
  }

  async addComment(userId: string, role: string, postId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung bình luận trống.');
    if (text.length > MAX_COMMENT) throw new BadRequestException('Bình luận quá dài.');
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true, userId: true, kind: true, status: true, title: true, body: true } });
    // Chỉ bài ĐÃ DUYỆT mới bình luận được. Bài PENDING không hiện trên bảng tin nhưng trước
    // đây vẫn nhận bình luận nếu biết id — hai tài khoản của cùng một người hỏi–đáp trên bài
    // vô hình đó để rút Điểm Xanh thưởng (bình luận, câu trả lời hay nhất) mà không ai kiểm
    // duyệt được. Điểm Xanh tiêu thẳng được ở thanh toán nên đây là mất hàng thật.
    if (!post || post.status !== 'PUBLISHED') throw new NotFoundException('Bài viết không tồn tại.');
    const comment = await this.prisma.feedComment.create({ data: { userId, postId, body: text } });
    // Task 9: addComment luôn TẠO mới (không có nhánh xoá/toggle-off) — phát ngay sau khi ghi thành công.
    await this.analytics.recordBestEffort({
      eventName: 'engagement_action',
      userId,
      platform: 'miniapp',
      props: { action: 'feed_comment', postId },
    });
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
          const data = {
            author: answerer?.fullName ?? 'Thành viên',
            title: post.title ?? 'câu hỏi của bạn',
            post_id: post.id,
          };
          if (template === 'COMMUNITY_NEW_ANSWER') {
            // Khoá cấu hình 0 là "tắt tin thích/bình luận"; tin câu trả lời trước nay luôn gửi nên 0 chỉ bỏ việc gộp, không tắt tin.
            const windowMs = await this.authorNotifyWindowMs();
            if (windowMs === null) await this.notifications?.notify(post.userId, template, data);
            else await this.notifications?.notify(post.userId, template, data, { dedupeKey: `post-answer:${post.id}`, dedupeWithinMs: windowMs });
          } else {
            await this.notifications?.notify(post.userId, template, data);
          }
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
    } else {
      await this.notifyAuthorOfActivity(post, userId, 'COMMUNITY_POST_COMMENTED', async () => {
        const commenter = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
        return { author: commenter?.fullName ?? 'Thành viên', title: previewTitle(post.title, post.body), post_id: post.id };
      });
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
    // câu trả lời thì 30 người đã được cộng điểm thưởng/uy tín nhưng không ai đọc được nội dung của họ,
    // trong khi con số đếm vẫn nói 80. `id` là cuid (tăng dần theo thời gian tạo) nên đủ ổn định
    // làm khoá cursor cho thứ tự thời gian.
    const limit = Math.min(Math.max(take, 1), 100);
    const rows = await this.prisma.feedComment.findMany({
      where: { postId, isRemoved: false },
      // Keyset THUẦN theo (createdAt, id) — cố ý KHÔNG có `isAccepted` ở đây.
      //
      // `isAccepted` là khoá sắp xếp THAY ĐỔI ĐƯỢC: người đọc lấy trang 1 (cursor = bình luận
      // cuối, isAccepted=false), chủ bài chọn đúng bình luận đó làm câu trả lời hay nhất, thì
      // Prisma dựng điều kiện cursor theo giá trị HIỆN TẠI của hàng cursor → "từ cursor trở đi"
      // gần như là toàn bộ danh sách, trang 2 trả lại gần hết trang 1 (UI lặp, React trùng key).
      // `id` là khoá phá hoà bắt buộc: thiếu nó thì hai bình luận cùng createdAt có thứ tự không
      // xác định giữa hai lần truy vấn. Câu trả lời hay nhất được ghim riêng ở dưới.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
    // Cùng lý do với addComment: thưởng Điểm Xanh cho câu trả lời hay nhất chỉ được chi cho nội dung đã qua kiểm duyệt.
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
      this.prisma.feedPost.update({ where: { id: postId }, data: { bestCommentId: commentId }, select: { id: true } }),
    ]);
    let rewardedPoints = 0;
    try {
      rewardedPoints = (await this.reward.rewardBestAnswer(comment.userId, post.userId, postId)) ?? 0;
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
        await this.notifications?.notify(comment.userId, 'COMMUNITY_BEST_ANSWER', {
          post_id: postId,
          reward_note: rewardedPoints > 0 ? ` Bạn nhận thêm ${formatPoints(rewardedPoints)} Điểm Xanh thưởng.` : '',
        });
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
      select: { userId: true, status: true, title: true, body: true },
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
    if (patch.images !== undefined) data.images = patch.images.filter((u) => u?.trim()).slice(0, MAX_FEED_IMAGES);

    // Đổi NỘI DUNG (body/title/ảnh) của bài ĐÃ ĐƯỢC DUYỆT, bởi tác giả chưa thuộc nhóm tin cậy
    // → trả về PENDING để kiểm duyệt lại. Không có bước này thì: bài hiền lành được duyệt (đồng
    // thời tác giả được gắn isTrusted vĩnh viễn), sau đó tác giả thay ruột thành spam/lừa đảo mà
    // bài vẫn PUBLISHED và không bao giờ xuất hiện lại trong hàng chờ duyệt (adminPending chỉ lọc
    // PENDING). Chỉ reset khi thực sự đổi nội dung — sửa rỗng (chỉ chạm editedAt) không đáng
    // đẩy bài ra khỏi bảng tin.
    //
    // Rào chắn nội dung (bug fix, cùng logic với createPost): quét nội dung SAU khi merge patch
    // vào bản hiện có — NGAY CẢ khi tác giả isTrusted. Tin cậy chỉ nói lên lịch sử tới thời điểm
    // TẠO bài, không có nghĩa lần sửa nào sau đó cũng an toàn; nếu không, một tài khoản đã được
    // duyệt 1 bài hiền có thể sửa ruột bài cũ thành link ngoài/spam mà không bao giờ quay lại
    // hàng chờ duyệt.
    const contentChanged = patch.body !== undefined || patch.title !== undefined || patch.images !== undefined;
    if (contentChanged && post.status === 'PUBLISHED') {
      const mergedTitle = data.title !== undefined ? (data.title as string | null) : post.title;
      const mergedBody = data.body !== undefined ? (data.body as string) : post.body;
      const flagged = containsBannedContent(`${mergedTitle ?? ''}\n${mergedBody}`, await this.bannedKeywords());
      const trusted = await this.isTrusted(userId, role);
      if (flagged || !trusted) {
        data.status = 'PENDING';
      }
    }

    await this.prisma.feedPost.update({ where: { id: postId }, data, select: { id: true } });
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

    // Trả lại điểm đã cộng cho NGƯỜI TRẢ LỜI từ chính bình luận này. Trước đây chỉ xoá BÀI mới
    // đảo điểm, nên gỡ một câu trả lời vi phạm vẫn để người viết giữ nguyên hạng lên nhờ nó.
    //
    // Hai nguồn điểm, HAI refId khác nhau — phải đảo cả hai:
    //  - ANSWER      ghi theo refId = commentId (xem addComment)
    //  - BEST_ANSWER ghi theo refId = postId   (xem setBestAnswer)
    // Chỉ đảo theo commentId thì người viết giữ nguyên điểm best-answer; tệ hơn, removeComment
    // đặt bestCommentId = null nên chủ bài chọn lại người khác là cộng thêm một lượt nữa —
    // vòng chọn–gỡ–chọn lại farm được điểm.
    await this.reverseReputationForRef(comment.userId, commentId, 'REVERSE_COMMENT');
    if (comment.isAccepted) {
      await this.reverseReputationForRef(comment.userId, comment.postId, 'REVERSE_BEST_ANSWER');
    }

    // Bình luận đang được chọn là câu trả lời hay nhất: bỏ cờ + gỡ con trỏ ở bài, nếu không
    // bài sẽ trỏ tới một comment đã ẩn (getComments lọc mất) → hiện "đã có best answer" mà
    // người đọc không thấy nội dung nào.
    await this.prisma.feedComment.update({
      where: { id: commentId },
      data: comment.isAccepted ? { isRemoved: true, isAccepted: false } : { isRemoved: true },
    });
    if (comment.isAccepted) {
      await this.prisma.feedPost.update({ where: { id: comment.postId }, data: { bestCommentId: null }, select: { id: true } });
    }
    return { ok: true };
  }

  async deletePost(userId: string, role: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true, title: true, body: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.userId !== userId && role !== 'ADMIN') throw new ForbiddenException('Không có quyền xoá.');
    // Đổi trạng thái, đảo điểm và rút tin cậy trong MỘT transaction: updateMany có điều kiện là cổng (hai người cùng gỡ thì
    // chỉ lượt thắng, count 1, làm các việc phụ — kiểm-rồi-ghi tách rời sẽ báo tác giả hai lần), còn lỗi ở bước đảo điểm
    // hoàn tác luôn việc gỡ để lần thử lại không thoát sớm vì "đã REMOVED" (điểm kẹt vĩnh viễn).
    // Đảo điểm: nếu không, đăng-ăn-điểm-rồi-xoá là cách farm hạng sạch dấu vết (P1-1). Trừ theo CHỦ BÀI, kể cả khi ADMIN gỡ.
    // ADMIN gỡ bài của người khác = hành vi kiểm duyệt → rút cờ tin cậy; tác giả tự xoá bài mình thì không.
    const moderated = post.userId !== userId && role === 'ADMIN';
    const thresholds = await this.repThresholds();
    // Loại tin báo tác giả chọn theo trạng thái lúc CHUYỂN, không theo lúc đọc đầu hàm: nếu người khác vừa duyệt bài trong
    // lúc đó thì tác giả không được nhận "chưa được đăng" ngay sau "đã duyệt".
    const removedFrom = await this.prisma.$transaction(async (tx) => {
      const gone = { status: 'REMOVED' } as const;
      let from: 'PENDING' | 'PUBLISHED' | null = null;
      if ((await tx.feedPost.updateMany({ where: { id: postId, status: 'PENDING' }, data: gone })).count === 1) from = 'PENDING';
      else if ((await tx.feedPost.updateMany({ where: { id: postId, status: { not: 'REMOVED' } }, data: gone })).count === 1) from = 'PUBLISHED';
      if (!from) return null;
      await this.reverseReputationInTx(tx, post.userId, postId, 'REVERSE_POST', thresholds);
      if (moderated) await this.revokeTrust(post.userId, tx);
      return from;
    });
    if (!removedFrom) return { ok: true };
    if (moderated) {
      // Bài còn PENDING chưa từng hiện ra với ai: báo "chưa được đăng" chứ không phải "đã được ẩn khỏi cộng đồng".
      if (removedFrom === 'PENDING') await this.notifyPostRejected(postId, post);
      else await this.notifyPostHidden(postId, post);
    }
    return { ok: true };
  }

  /**
   * Kiểm duyệt ẩn một bài ĐÃ ĐĂNG kèm lý do cho tác giả (bài đang chờ duyệt thì dùng rejectPost: nó chưa từng hiện ra nên
   * "đã được ẩn khỏi cộng đồng" là sai sự thật). Gọi lại trên bài đã gỡ, hoặc hai người ẩn cùng lúc, chỉ một lượt đảo điểm và
   * báo tác giả.
   */
  async hidePost(postId: string, reason?: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, userId: true, status: true, title: true, body: true },
    });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.status === 'REMOVED') return { ok: true };
    if (post.status !== 'PUBLISHED') throw new ConflictException('Bài đang chờ duyệt nên chưa được đăng, không thể ẩn. Hãy dùng "Từ chối" cho bài này.');
    const thresholds = await this.repThresholds();
    const hidden = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.feedPost.updateMany({ where: { id: postId, status: 'PUBLISHED' }, data: { status: 'REMOVED' } });
      if (count !== 1) return false;
      await this.reverseReputationInTx(tx, post.userId, postId, 'REVERSE_POST', thresholds);
      await this.revokeTrust(post.userId, tx);
      return true;
    });
    if (!hidden) return { ok: true };
    await this.notifyPostHidden(postId, post, reason);
    return { ok: true };
  }

  private async notifyPostRejected(postId: string, post: { userId: string; title: string | null; body: string }, reason?: string) {
    try {
      await this.notifications?.notify(post.userId, 'COMMUNITY_POST_REJECTED', {
        title: previewTitle(post.title, post.body),
        reason: reason?.trim() || DEFAULT_REJECT_REASON,
      });
    } catch (err) {
      this.logger.warn(`notify(reject) failed ${postId}: ${(err as Error).message}`);
    }
  }

  private async notifyPostHidden(postId: string, post: { userId: string; title: string | null; body: string }, reason?: string) {
    try {
      await this.notifications?.notify(post.userId, 'COMMUNITY_POST_HIDDEN', {
        title: previewTitle(post.title, post.body),
        reason: reason?.trim() || DEFAULT_REJECT_REASON,
      });
    } catch (err) {
      this.logger.warn(`notify(hidden) failed ${postId}: ${(err as Error).message}`);
    }
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
      select: {
        id: true, kind: true, title: true, body: true, createdAt: true,
        user: { select: { fullName: true } }, category: { select: { name: true } },
      },
    });
    const images = await loadFeedImages(this.prisma, posts.map((p) => p.id), false);
    return posts.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      images: images.get(p.id)?.images ?? [],
      author: p.user.fullName ?? 'Bạn Tubu',
      category: p.category?.name ?? null,
      createdAt: p.createdAt,
    }));
  }

  /**
   * Bài đã đăng cho người kiểm duyệt: ghim lên đầu rồi mới nhất trước (cùng thứ tự bảng tin), phân trang cursor. Không trả
   * ảnh/thẻ: màn kiểm duyệt chỉ cần đủ chữ để quyết định ẩn hay ghim.
   */
  async adminPublished(take = 30, cursor?: string) {
    const size = Math.max(1, Math.min(take, 50));
    const posts = await this.prisma.feedPost.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, kind: true, title: true, body: true, isPinned: true, createdAt: true,
        user: { select: { fullName: true } }, category: { select: { name: true } },
      },
    });
    const hasMore = posts.length > size;
    const page = hasMore ? posts.slice(0, size) : posts;
    const counts = await this.countsForPage(page.map((p) => p.id));
    return {
      items: page.map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        excerpt: p.body.slice(0, 200),
        author: p.user.fullName ?? 'Bạn Tubu',
        category: p.category?.name ?? null,
        createdAt: p.createdAt,
        isPinned: p.isPinned,
        likeCount: counts.likes.get(p.id) ?? 0,
        commentCount: counts.comments.get(p.id) ?? 0,
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  /** Câu hỏi đã chờ quá ngưỡng (mặc định 24 giờ) mà chưa ai trả lời, cũ nhất trước — cùng điều kiện với số trên "Việc cần xử lý". */
  async adminUnanswered(take = 50) {
    const now = new Date();
    const cutoff = unansweredCutoff(await this.config.get<unknown>(UNANSWERED_ALERT_HOURS_KEY, DEFAULT_UNANSWERED_ALERT_HOURS), now);
    const rows = await listUnansweredQuestions(this.prisma, cutoff, Math.max(1, Math.min(take, 100)));
    return rows.map((r) => ({ ...r, waitingHours: Math.floor((now.getTime() - r.createdAt.getTime()) / 3_600_000) }));
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
    await this.prisma.feedPost.update({ where: { id: postId }, data: { isPinned: pinned }, select: { id: true } });
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

  /** Bài tham gia sự kiện — lọc FeedPost PUBLISHED có meta.eventId khớp. */
  /**
   * Bài dự thi của một sự kiện, có phân trang.
   *
   * Trần cứng 20 bài trước đây nghĩa là sự kiện 200 bài dự thi thì 180 bài không có đường nào
   * xem tới — kể cả admin lúc chấm giải. (Lọc theo `meta` JSON vẫn phải quét bảng vì cột này
   * không có index; nếu sự kiện trở thành tính năng thường xuyên thì nên tách cột `eventId`.)
   */
  async eventPosts(eventId: string, viewerId: string, take = 20, cursor?: string) {
    const limit = Math.min(Math.max(take, 1), 50);
    const rows = await this.prisma.feedPost.findMany({
      where: { status: 'PUBLISHED', meta: { path: ['eventId'], equals: eventId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { ...FEED_SELECT, reactions: { where: { userId: viewerId }, select: { id: true } } },
    });
    const hasMore = rows.length > limit;
    const posts = hasMore ? rows.slice(0, limit) : rows;
    const ids = posts.map((p) => p.id);
    const [counts, images] = await Promise.all([this.countsForPage(ids), loadFeedImages(this.prisma, ids, true)]);
    return {
      posts: posts.map((p) => this.toItem(p, viewerId, counts, images, { list: true })),
      nextCursor: hasMore ? posts[posts.length - 1]!.id : null,
    };
  }

  /**
   * Danh sách sự kiện cho quản trị: mặc định đang mở; "CLOSED" cho sự kiện đã đóng (kèm người thắng) để còn xem lại lịch
   * sử, vì listEvents công khai chỉ trả OPEN nên chốt người thắng xong sự kiện biến khỏi mọi màn.
   */
  async adminEvents(status: 'OPEN' | 'CLOSED' = 'OPEN', take = 50) {
    const closed = status === 'CLOSED';
    const events = await this.prisma.communityEvent.findMany({
      where: { status: closed ? 'CLOSED' : 'OPEN' },
      orderBy: { endAt: closed ? 'desc' : 'asc' },
      take,
    });
    const winnerIds = [...new Set(events.map((e) => e.winnerUserId).filter((id): id is string => !!id))];
    const winners = winnerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: winnerIds } }, select: { id: true, fullName: true, avatarUrl: true } })
      : [];
    const byId = new Map(winners.map((u) => [u.id, u]));
    return events.map((e) => {
      const w = e.winnerUserId ? byId.get(e.winnerUserId) : undefined;
      return { ...e, winner: w ? { id: w.id, name: w.fullName ?? 'Bạn Tubu', avatar: w.avatarUrl } : null };
    });
  }

  /**
   * Người dự thi của một sự kiện (quản trị chọn người thắng từ đây, không phải dán userId): mỗi người một dòng với bài
   * mới nhất và số bài đã đăng. Chỉ bài PUBLISHED vì bài chờ duyệt/bị từ chối chưa được công nhận là dự thi.
   */
  async adminEventParticipants(eventId: string) {
    const posts = await this.prisma.feedPost.findMany({
      where: { status: 'PUBLISHED', meta: { path: ['eventId'], equals: eventId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
      select: { id: true, userId: true, title: true, body: true, createdAt: true, user: { select: { fullName: true, avatarUrl: true } } },
    });
    const byUser = new Map<string, { userId: string; name: string; avatar: string | null; postId: string; postTitle: string; postedAt: Date; postCount: number }>();
    for (const p of posts) {
      const seen = byUser.get(p.userId);
      if (seen) {
        seen.postCount += 1;
        continue;
      }
      byUser.set(p.userId, {
        userId: p.userId,
        name: p.user.fullName ?? 'Bạn Tubu',
        avatar: p.user.avatarUrl,
        postId: p.id,
        postTitle: previewTitle(p.title, p.body),
        postedAt: p.createdAt,
        postCount: 1,
      });
    }
    return [...byUser.values()];
  }

  /** Tạo sự kiện mới (admin). */
  async createEvent(dto: CreateEventInput) {
    if (new Date(dto.startAt) >= new Date(dto.endAt)) {
      throw new BadRequestException('Thời gian kết thúc phải sau thời gian bắt đầu.');
    }
    const reward = dto.rewardPoints ?? 0;
    if (reward !== 0 && (reward < EVENT_REWARD_MIN_POINTS || reward > EVENT_REWARD_MAX_POINTS)) {
      throw new BadRequestException(
        `Quà sự kiện phải từ ${formatPoints(EVENT_REWARD_MIN_POINTS)} đến ${formatPoints(EVENT_REWARD_MAX_POINTS)} Điểm Xanh, hoặc để 0 nếu sự kiện không có quà.`,
      );
    }
    return this.prisma.communityEvent.create({ data: dto });
  }

  /** Đóng sự kiện thủ công (admin) — không chọn người thắng. */
  async closeEvent(id: string) {
    await this.prisma.communityEvent.update({ where: { id }, data: { status: 'CLOSED' } });
    return { ok: true };
  }

  /**
   * Chọn người thắng sự kiện (admin) — đóng sự kiện + thưởng Điểm Xanh. Thưởng NON-FATAL:
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
      select: { id: true, title: true, status: true, rewardPoints: true },
    });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại.');
    if (event.status !== 'OPEN') throw new BadRequestException('Sự kiện đã đóng hoặc đã chọn người thắng.');
    const winner = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!winner) throw new NotFoundException('Người dùng không tồn tại.');
    // Cùng điều kiện với adminEventParticipants: gọi API trực tiếp không được vòng qua danh sách người dự thi.
    const entry = await this.prisma.feedPost.findFirst({
      where: { userId, status: 'PUBLISHED', meta: { path: ['eventId'], equals: eventId } },
      select: { id: true },
    });
    if (!entry) throw new BadRequestException('Người này chưa có bài dự thi nào được đăng trong sự kiện, không thể chọn làm người thắng.');
    const { count } = await this.prisma.communityEvent.updateMany({
      where: { id: eventId, status: 'OPEN' },
      data: { winnerUserId: userId, status: 'CLOSED' },
    });
    if (count !== 1) throw new BadRequestException('Sự kiện đã đóng hoặc đã chọn người thắng.');
    let rewarded = true;
    try {
      await this.reward.rewardEventWinner(userId, eventId, event.rewardPoints);
    } catch (err) {
      rewarded = false;
      this.logger.warn(`rewardEventWinner failed for event ${eventId}/user ${userId}: ${(err as Error).message}`);
    }
    // Người thắng phải biết mình trúng (trước đây chỉ cộng điểm im lặng); lỗi thông báo không đảo việc đã chốt.
    await this.notifications
      ?.notify(userId, 'COMMUNITY_EVENT_WINNER', {
        title: event.title,
        reward: rewarded && event.rewardPoints > 0 ? ` Bạn được thưởng ${formatPoints(event.rewardPoints)} Điểm Xanh.` : '',
      })
      .catch((e: unknown) => this.logger.warn(`Không báo được người thắng sự kiện ${eventId}/${userId}: ${(e as Error).message}`));
    return { ok: true };
  }
}
