import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunityRewardService } from './community-reward.service';
import { authorBadge } from './author-badge';

type FeedPostKind = 'MANUAL' | 'HARVEST' | 'MILESTONE' | 'SPECIES' | 'QUESTION' | 'SHOWCASE' | 'TIP';

const MAX_TITLE = 160;
const MAX_BODY = 5000;
const MAX_IMAGES = 6;
const MAX_PRODUCT_TAGS = 5;
const MAX_COMMENT = 500;

export interface CreatePostInput {
  kind?: FeedPostKind;
  categoryId?: string;
  title?: string;
  body: string;
  images?: string[];
  productSlugs?: string[];
}

const FEED_INCLUDE = {
  user: { select: { fullName: true, avatarUrl: true, role: true } },
  category: { select: { slug: true, name: true, icon: true } },
  productTags: { include: { product: { select: { slug: true, name: true, thumbnail: true, salePrice: true, basePrice: true } } } },
  _count: { select: { reactions: true, comments: true } },
} as const;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly reward: CommunityRewardService,
  ) {}

  async getFeed(
    userId: string,
    opts: { category?: string; kind?: string; sort?: 'new' | 'popular'; cursor?: string; take?: number } = {},
  ) {
    const take = Math.min(opts.take ?? 20, 50);
    const where: Record<string, unknown> = { status: 'PUBLISHED' };
    if (opts.category) where.category = { slug: opts.category };
    if (opts.kind) where.kind = opts.kind;
    const orderBy =
      opts.sort === 'popular'
        ? [{ reactions: { _count: 'desc' as const } }, { createdAt: 'desc' as const }]
        : [{ createdAt: 'desc' as const }];
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
      posts: page.map((p) => this.toItem(p)),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async getPost(userId: string, postId: string) {
    await this.prisma.feedPost.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } });
    const p = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      include: { ...FEED_INCLUDE, reactions: { where: { userId }, select: { id: true } } },
    });
    if (!p) throw new NotFoundException('Bài viết không tồn tại.');
    return this.toItem(p);
  }

  private toItem(p: any) {
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
      category: p.category ? { slug: p.category.slug, name: p.category.name, icon: p.category.icon } : null,
      productTags: (p.productTags ?? []).map((t: any) => ({
        slug: t.product.slug, name: t.product.name, thumbnail: t.product.thumbnail,
        salePrice: t.product.salePrice, basePrice: t.product.basePrice,
      })),
      likeCount: p._count.reactions,
      commentCount: p._count.comments,
      liked: p.reactions.length > 0,
      bestCommentId: p.bestCommentId ?? null,
    };
  }

  async createPost(userId: string, input: CreatePostInput): Promise<{ id: string }> {
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

    const post = await this.prisma.feedPost.create({
      data: { userId, kind, status: 'PUBLISHED', body, title, images, categoryId: input.categoryId ?? null },
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

    try {
      await this.reward.rewardPost(userId, post.id);
    } catch (err) {
      this.logger.warn(`rewardPost failed for post ${post.id}: ${(err as Error).message}`);
    }
    return { id: post.id };
  }

  /** Tạo bài thành tích (auto-post). Không validate độ dài người-dùng-nhập. */
  async createAchievementPost(userId: string, kind: FeedPostKind, body: string, meta?: object) {
    return this.prisma.feedPost.create({ data: { userId, kind, body, meta: meta as object } });
  }

  /** Thả/bỏ tim — toggle. Trả trạng thái sau toggle. */
  async toggleReaction(userId: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    const existing = await this.prisma.feedReaction.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) {
      await this.prisma.feedReaction.delete({ where: { postId_userId: { postId, userId } } });
      return { liked: false };
    }
    await this.prisma.feedReaction.create({ data: { postId, userId } });
    return { liked: true };
  }

  async addComment(userId: string, postId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung bình luận trống.');
    if (text.length > MAX_COMMENT) throw new BadRequestException('Bình luận quá dài.');
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    return this.prisma.feedComment.create({ data: { userId, postId, body: text } });
  }

  async getComments(postId: string, take = 50) {
    const comments = await this.prisma.feedComment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      take,
      include: { user: { select: { fullName: true } } },
    });
    return comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.user.fullName ?? 'Bạn Tubu',
      createdAt: c.createdAt,
    }));
  }
}
