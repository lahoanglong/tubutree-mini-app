import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type FeedPostKind = 'MANUAL' | 'HARVEST' | 'MILESTONE' | 'SPECIES';

const MAX_BODY = 1000;
const MAX_COMMENT = 500;

/**
 * Community Feed (§6.14.12) — bảng tin cộng đồng Vườn Xanh.
 * User khoe thành tích xanh (thu hoạch cây, mốc cộng đồng, sưu tập loài) hoặc đăng
 * bài tự do; người khác thả tim 💚 + bình luận. Tên hiển thị ẩn (mask) như BXH.
 * Auto-post thành tích qua createAchievementPost (gọi @Optional từ GameService).
 */
@Injectable()
export class CommunityFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(userId: string, take = 20) {
    const posts = await this.prisma.feedPost.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        user: { select: { fullName: true } },
        _count: { select: { reactions: true, comments: true } },
        reactions: { where: { userId }, select: { id: true } },
      },
    });
    return {
      posts: posts.map((p) => ({
        id: p.id,
        kind: p.kind as FeedPostKind,
        body: p.body,
        meta: p.meta,
        createdAt: p.createdAt,
        author: this.maskName(p.user.fullName),
        likeCount: p._count.reactions,
        commentCount: p._count.comments,
        liked: p.reactions.length > 0,
      })),
    };
  }

  async createPost(userId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung bài viết trống.');
    if (text.length > MAX_BODY) throw new BadRequestException('Nội dung quá dài.');
    return this.prisma.feedPost.create({ data: { userId, kind: 'MANUAL', body: text } });
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
      author: this.maskName(c.user.fullName),
      createdAt: c.createdAt,
    }));
  }

  private maskName(name: string | null): string {
    if (!name) return 'Bạn Tubu';
    const parts = name.trim().split(' ');
    const last = parts[parts.length - 1] ?? 'Tubu';
    return `${last}***`;
  }
}
