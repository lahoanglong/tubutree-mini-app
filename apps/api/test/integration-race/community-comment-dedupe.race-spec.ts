import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { createUser, summarize, warmPool } from './helpers';

/**
 * Bình luận gửi đúp song song: cùng người + bài + nội dung trong 10 giây chỉ tạo MỘT bình luận và chỉ thưởng MỘT lần.
 * Khoá tư vấn pg_advisory_xact_lock theo (người, bài) buộc yêu cầu sau đợi yêu cầu trước ghi xong rồi mới tìm bản trùng.
 */
describe('CommunityFeedService.addComment song song (real Postgres)', () => {
  let prisma: PrismaClient;
  let db: PrismaService;
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL as string });
    db = prisma as unknown as PrismaService;
    await warmPool(db, 20);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const build = () => {
    const reward = { rewardAnswer: jest.fn().mockResolvedValue(0) };
    const config = { get: jest.fn(async (_k: string, d: unknown) => d) };
    const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) };
    const svc = new CommunityFeedService(db, reward as never, config as never, analytics as never);
    return { svc, reward };
  };

  async function setup() {
    const author = await createUser(db);
    const commenter = await createUser(db);
    userIds.push(author.id, commenter.id);
    const post = await prisma.feedPost.create({ data: { userId: author.id, kind: 'QUESTION', body: 'Câu hỏi IT', status: 'PUBLISHED' } });
    return { commenter, post };
  }

  it('8 yêu cầu giống hệt chạy cùng lúc → 1 bình luận, 1 lần thưởng, cùng một id trả về', async () => {
    const { commenter, post } = await setup();
    const { svc, reward } = build();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => svc.addComment(commenter.id, 'CUSTOMER', post.id, 'Cảm ơn nhé')));
    expect(summarize(results).errors).toEqual([]);
    expect(await prisma.feedComment.count({ where: { postId: post.id, userId: commenter.id } })).toBe(1);
    expect(reward.rewardAnswer).toHaveBeenCalledTimes(1);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
  });

  it('nội dung khác nhau thì không bị coi là trùng; cùng chữ có dấu viết dạng tổ hợp (NFD) thì trùng', async () => {
    const { commenter, post } = await setup();
    const { svc } = build();
    await svc.addComment(commenter.id, 'CUSTOMER', post.id, 'Cây đẹp quá');
    await svc.addComment(commenter.id, 'CUSTOMER', post.id, 'Cây đẹp quá'.normalize('NFD'));
    await svc.addComment(commenter.id, 'CUSTOMER', post.id, 'Cây xấu quá');
    expect(await prisma.feedComment.count({ where: { postId: post.id, userId: commenter.id } })).toBe(2);
  });
});
