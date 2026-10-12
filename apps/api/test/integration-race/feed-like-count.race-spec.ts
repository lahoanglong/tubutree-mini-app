import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { createUser, summarize, warmPool } from './helpers';

/**
 * C-042 (A3-005): feed không còn `_count` join cả bảng; số tim/bình luận đếm theo trang, còn
 * `likeCount` phi chuẩn hoá dùng sắp xếp "Phổ biến" phải đúng khi nhiều người thả/bỏ tim đồng thời.
 */
describe('Feed: đếm theo trang + likeCount (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let feed: CommunityFeedService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        { provide: CommunityRewardService, useValue: {} },
        CommunityFeedService,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    feed = moduleRef.get(CommunityFeedService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function post(userId: string, over: Record<string, unknown> = {}) {
    return prisma.feedPost.create({ data: { userId, body: 'Bài IT', status: 'PUBLISHED', ...over } });
  }

  it('20 người thả tim đồng thời → likeCount = 20 và bằng số dòng feed_reactions', async () => {
    const author = await createUser(prisma);
    const p = await post(author.id);
    const users = await Promise.all(Array.from({ length: 20 }, () => createUser(prisma)));
    const res = summarize(await Promise.allSettled(users.map((u) => feed.toggleReaction(u.id, p.id))));
    expect(res.errors).toEqual([]);
    const [row, rows] = await Promise.all([
      prisma.feedPost.findUniqueOrThrow({ where: { id: p.id }, select: { likeCount: true } }),
      prisma.feedReaction.count({ where: { postId: p.id } }),
    ]);
    expect(rows).toBe(20);
    expect(row.likeCount).toBe(20);
  });

  it('cùng một người bấm đúp (2 thiết bị) → chỉ 1 tim, likeCount khớp', async () => {
    const author = await createUser(prisma);
    const p = await post(author.id);
    const u = await createUser(prisma);
    const res = summarize(
      await Promise.allSettled([feed.toggleReaction(u.id, p.id), feed.toggleReaction(u.id, p.id)]),
    );
    expect(res.errors).toEqual([]);
    const [row, rows] = await Promise.all([
      prisma.feedPost.findUniqueOrThrow({ where: { id: p.id }, select: { likeCount: true } }),
      prisma.feedReaction.count({ where: { postId: p.id } }),
    ]);
    expect(row.likeCount).toBe(rows);
  });

  it('thả rồi bỏ tim → likeCount về 0, không âm', async () => {
    const author = await createUser(prisma);
    const p = await post(author.id);
    const u = await createUser(prisma);
    await feed.toggleReaction(u.id, p.id);
    await feed.toggleReaction(u.id, p.id);
    const row = await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id }, select: { likeCount: true } });
    expect(row.likeCount).toBe(0);
  });

  it('getFeed: số tim/bình luận đúng theo trang (bỏ bình luận đã gỡ), popular xếp theo tim', async () => {
    const author = await createUser(prisma);
    const marker = `it-${Date.now()}`;
    const low = await post(author.id, { title: marker, isPinned: true });
    const high = await post(author.id, { title: marker, isPinned: true });
    const likers = await Promise.all(Array.from({ length: 3 }, () => createUser(prisma)));
    for (const u of likers) await feed.toggleReaction(u.id, high.id);
    await feed.toggleReaction(likers[0]!.id, low.id);
    await prisma.feedComment.createMany({
      data: [
        { postId: high.id, userId: likers[0]!.id, body: 'a' },
        { postId: high.id, userId: likers[1]!.id, body: 'b', isRemoved: true },
        { postId: low.id, userId: likers[2]!.id, body: 'c' },
      ],
    });

    const popular = await feed.getFeed(author.id, { sort: 'popular', q: marker, take: 10 });
    expect(popular.posts.map((x: { id: string }) => x.id)).toEqual([high.id, low.id]);
    const byId = new Map(popular.posts.map((x: { id: string; likeCount: number; commentCount: number }) => [x.id, x]));
    expect(byId.get(high.id)).toMatchObject({ likeCount: 3, commentCount: 1 });
    expect(byId.get(low.id)).toMatchObject({ likeCount: 1, commentCount: 1 });

    const detail = await feed.getPost(author.id, high.id);
    expect(detail).toMatchObject({ likeCount: 3, commentCount: 1 });
  });
});
