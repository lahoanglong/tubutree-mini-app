import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunityFeedService, levelFromReputation, levelName } from './community-feed.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    feedPost: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'post1', userId: 'author', kind: 'SHOWCASE' }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    feedReaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    feedComment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    postProductTag: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    tag: { upsert: jest.fn().mockImplementation(async ({ where }: { where: { slug: string } }) => ({ id: `tag-${where.slug}`, slug: where.slug })) },
    postTag: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    communityCategory: { findMany: jest.fn().mockResolvedValue([]) },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    communityProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    communityReport: {
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ fullName: 'Người dùng' }),
    },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

// Mock SystemConfigService — mặc định trả về fallback truyền vào (giống hành vi thật khi
// key chưa cấu hình); truyền `overrides` để giả lập giá trị đã cấu hình cho key cụ thể.
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn(async (key: string, fallback?: unknown) => (key in overrides ? overrides[key] : fallback)),
  };
}

function makeSvc(
  prisma: PrismaService,
  reward: any = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() },
  notify?: { notify: jest.Mock },
  config: any = makeConfig(),
) {
  return new CommunityFeedService(prisma, reward, config, notify as any);
}

// Dùng chung cho cả getFeed + getPost (row hình dạng Prisma trả về, đã include đủ quan hệ).
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', kind: 'SHOWCASE', status: 'PUBLISHED', title: null, body: 'Khoe cây', images: ['i1'],
  meta: null, bestCommentId: null, createdAt: new Date('2026-07-03'), userId: 'author', isPinned: false,
  user: { fullName: 'Lã Hoàng Long', avatarUrl: 'https://a/1.png', role: 'CUSTOMER', communityProfile: { level: 1 } },
  category: { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿' },
  productTags: [{ product: { slug: 'cay-a', name: 'Cây A', thumbnail: 't', salePrice: null, basePrice: 100 } }],
  tags: [],
  _count: { reactions: 3, comments: 2 }, reactions: [{ id: 'r1' }],
  ...over,
});

describe('CommunityFeedService.getFeed (cộng đồng)', () => {
  it('hiện tên thật + avatar + badge + chip SP + đã-thả-tim', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    const r = await makeSvc(prisma).getFeed('u1', { category: 'khoe-vuon' });
    expect(r.posts[0]).toMatchObject({
      id: 'p1', author: 'Lã Hoàng Long', avatar: 'https://a/1.png', badge: null,
      likeCount: 3, commentCount: 2, liked: true, isOwner: false,
      category: { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿' },
      productTags: [{ slug: 'cay-a', name: 'Cây A', thumbnail: 't', salePrice: null, basePrice: 100 }],
    });
    // Lọc theo danh mục + chỉ PUBLISHED được truyền vào where
    const where = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'PUBLISHED', category: { slug: 'khoe-vuon' } });
  });

  it('tác giả STAFF → badge EXPERT; tên null → "Bạn Tubu"', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      row({ user: { fullName: null, avatarUrl: null, role: 'STAFF' } }),
    ]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]).toMatchObject({ author: 'Bạn Tubu', avatar: null, badge: 'EXPERT' });
  });

  it('userId trùng chủ bài → isOwner true', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row({ userId: 'u1' })]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]).toMatchObject({ isOwner: true });
  });

  it('lọc theo kind → where.kind truyền vào findMany', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { kind: 'QUESTION' });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({ status: 'PUBLISHED', kind: 'QUESTION' });
  });

  it('sort=popular → orderBy pinned trước, rồi số tim, rồi createdAt', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { sort: 'popular' });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual([{ isPinned: 'desc' }, { reactions: { _count: 'desc' } }, { createdAt: 'desc' }]);
  });

  it('mặc định (new) → orderBy pinned trước, rồi createdAt', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1');
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual([{ isPinned: 'desc' }, { createdAt: 'desc' }]);
  });

  it('phân trang cursor → lấy take+1, trả nextCursor + cắt đúng, truyền cursor/skip', async () => {
    const prisma = makePrisma();
    // take=2 → service xin 3 (take+1); trả 3 hàng để có hasMore
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' }),
    ]);
    const r = await makeSvc(prisma).getFeed('u1', { take: 2, cursor: 'z' });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.take).toBe(3);
    expect(args.cursor).toEqual({ id: 'z' });
    expect(args.skip).toBe(1);
    expect(r.posts).toHaveLength(2);
    expect(r.posts.map((p: any) => p.id)).toEqual(['a', 'b']);
    expect(r.nextCursor).toBe('b');
  });

  it('tìm kiếm q → where.OR title/body contains (insensitive) + vẫn PUBLISHED', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { q: 'vàng lá' });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({
      status: 'PUBLISHED',
      OR: [
        { title: { contains: 'vàng lá', mode: 'insensitive' } },
        { body: { contains: 'vàng lá', mode: 'insensitive' } },
      ],
    });
  });

  it('unanswered → where.kind=QUESTION, bestCommentId=null', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { unanswered: true });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({ status: 'PUBLISHED', kind: 'QUESTION', bestCommentId: null });
  });

  it('unanswered thắng khi truyền cả kind khác', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { kind: 'TIP', unanswered: true });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({ kind: 'QUESTION', bestCommentId: null });
  });

  it('lọc theo tag → where.tags.some.tag.slug', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { tag: 'sen-da' });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({ status: 'PUBLISHED', tags: { some: { tag: { slug: 'sen-da' } } } });
  });

  it('toItem trả tags [{slug,name}] từ include + isPinned', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      row({ isPinned: true, tags: [{ tag: { slug: 'sen-da', name: 'Sen đá' } }, { tag: { slug: 'tuoi-nuoc', name: 'Tưới nước' } }] }),
    ]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]).toMatchObject({
      isPinned: true,
      tags: [{ slug: 'sen-da', name: 'Sen đá' }, { slug: 'tuoi-nuoc', name: 'Tưới nước' }],
    });
  });

  it('toItem không có tags include → trả tags rỗng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row({ tags: undefined })]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]).toMatchObject({ tags: [] });
  });
});

describe('CommunityFeedService.getPost', () => {
  it('tăng viewCount và trả bài', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.update as jest.Mock) = jest.fn().mockResolvedValue({});
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({
      ...row(), reactions: [], _count: { reactions: 0, comments: 0 },
    });
    const svc = makeSvc(prisma);
    const r = await svc.getPost('u1', 'p1');
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { viewCount: { increment: 1 } } });
    expect(r).toMatchObject({ id: 'p1', isOwner: false });
  });

  it('userId trùng chủ bài → isOwner true', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({
      ...row(), userId: 'author', reactions: [], _count: { reactions: 0, comments: 0 },
    });
    const r = await makeSvc(prisma).getPost('author', 'p1');
    expect(r).toMatchObject({ isOwner: true });
  });

  it('bài không tồn tại → NotFound, KHÔNG tăng viewCount', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(makeSvc(prisma).getPost('u1', 'pX')).rejects.toBeInstanceOf(NotFoundException);
    // check-then-act: findUnique null → không được gọi update (Prisma update thật ném P2025 nếu thiếu row)
    expect(prisma.feedPost.update).not.toHaveBeenCalled();
  });

  it('bài đã bị xoá mềm (REMOVED) → NotFound, KHÔNG tăng viewCount', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row(), status: 'REMOVED' });
    await expect(makeSvc(prisma).getPost('u1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.feedPost.update).not.toHaveBeenCalled();
  });

  it('bài PENDING của người khác → NotFound + KHÔNG tăng viewCount', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row(), status: 'PENDING', userId: 'author', reactions: [], _count: { reactions: 0, comments: 0 } });
    await expect(makeSvc(prisma).getPost('intruder', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.feedPost.update).not.toHaveBeenCalled();
  });

  it('chủ bài xem bài PENDING của mình → OK + tăng viewCount', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row(), status: 'PENDING', userId: 'owner', reactions: [], _count: { reactions: 0, comments: 0 } });
    const r = await makeSvc(prisma).getPost('owner', 'p1');
    expect(r.id).toBe('p1');
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { viewCount: { increment: 1 } } });
  });
});

describe('CommunityFeedService.createPost', () => {
  it('nội dung trống → throw, không tạo', async () => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).createPost('u1', 'STAFF', { body: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });

  it('nội dung quá dài → throw', async () => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).createPost('u1', 'STAFF', { body: 'a'.repeat(5001) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('hợp lệ → tạo bài MANUAL (trim nội dung)', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).createPost('u1', 'STAFF', { body: '  Vườn mình xanh quá  ' });
    const data = (prisma.feedPost.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', kind: 'MANUAL', body: 'Vườn mình xanh quá' });
  });
});

describe('CommunityFeedService.toggleReaction', () => {
  it('bài không tồn tại → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(makeSvc(prisma).toggleReaction('u1', 'pX')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chưa thả tim → thả tim (create), liked true', async () => {
    const prisma = makePrisma();
    (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue(null);
    const r = await makeSvc(prisma).toggleReaction('u1', 'p1');
    expect(r.liked).toBe(true);
    expect(prisma.feedReaction.create).toHaveBeenCalled();
    expect(prisma.feedReaction.delete).not.toHaveBeenCalled();
  });

  it('đã thả tim → bỏ tim (delete), liked false', async () => {
    const prisma = makePrisma();
    (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r1' });
    const r = await makeSvc(prisma).toggleReaction('u1', 'p1');
    expect(r.liked).toBe(false);
    expect(prisma.feedReaction.delete).toHaveBeenCalled();
    expect(prisma.feedReaction.create).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.addComment', () => {
  it('nội dung trống → throw', async () => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).addComment('u1', 'CUSTOMER', 'p1', '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('bài không tồn tại → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(makeSvc(prisma).addComment('u1', 'CUSTOMER', 'pX', 'hay quá')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('bài đã bị xoá mềm (REMOVED) → NotFound, KHÔNG tạo comment', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'REMOVED' });
    await expect(makeSvc(prisma).addComment('u1', 'CUSTOMER', 'p1', 'hay quá')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.feedComment.create).not.toHaveBeenCalled();
  });

  it('hợp lệ → tạo comment (trim)', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).addComment('u1', 'CUSTOMER', 'p1', '  tuyệt vời  ');
    const data = (prisma.feedComment.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', postId: 'p1', body: 'tuyệt vời' });
  });
});

describe('CommunityFeedService.addComment (thưởng answer)', () => {
  it('trả lời bài QUESTION của người khác → tạo comment + thưởng answer', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).addComment('answerer', 'CUSTOMER', 'p1', 'Bạn tưới ít lại nhé');
    expect(reward.rewardAnswer).toHaveBeenCalledWith('answerer', 'author', 'c1');
  });

  it('bình luận bài không phải QUESTION → KHÔNG thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).addComment('u2', 'CUSTOMER', 'p1', 'đẹp quá');
    expect(reward.rewardAnswer).not.toHaveBeenCalled();
  });

  it('rewardAnswer lỗi → bình luận vẫn tạo (thưởng không chặn)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn().mockRejectedValue(new Error('boom')), rewardBestAnswer: jest.fn() };
    const r = await makeSvc(prisma, reward).addComment('answerer', 'CUSTOMER', 'p1', 'trả lời');
    expect(r).toEqual({ id: 'c1' });
  });
});

describe('CommunityFeedService.addComment (thông báo — non-fatal)', () => {
  it('trả lời QUESTION của người khác (role CUSTOMER) → notify COMMUNITY_NEW_ANSWER cho chủ bài', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: 'Lá vàng phải làm sao?' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ fullName: 'Long' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).addComment('answerer', 'CUSTOMER', 'p1', 'Bạn tưới ít lại nhé');
    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_NEW_ANSWER', { author: 'Long', title: 'Lá vàng phải làm sao?' });
  });

  it('answerer role STAFF → notify COMMUNITY_EXPERT_REPLIED thay vì NEW_ANSWER', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: 'Lá vàng phải làm sao?' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).addComment('answerer', 'STAFF', 'p1', 'Tưới 2 lần/tuần nhé');
    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_EXPERT_REPLIED', expect.any(Object));
  });

  it('answerer role ADMIN → cũng notify COMMUNITY_EXPERT_REPLIED', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: 't' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).addComment('answerer', 'ADMIN', 'p1', 'Trả lời admin');
    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_EXPERT_REPLIED', expect.any(Object));
  });

  it('tự trả lời câu hỏi của chính mình → KHÔNG notify', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: 't' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).addComment('author', 'CUSTOMER', 'p1', 'tự trả lời mình');
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('bình luận bài không phải QUESTION → KHÔNG notify', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE', status: 'PUBLISHED', title: null });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).addComment('u2', 'CUSTOMER', 'p1', 'đẹp quá');
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('không có title → dùng fallback "câu hỏi của bạn"', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: null });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ fullName: null });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).addComment('answerer', 'CUSTOMER', 'p1', 'trả lời');
    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_NEW_ANSWER', { author: 'Thành viên', title: 'câu hỏi của bạn' });
  });

  it('notify ném lỗi → bình luận vẫn tạo thành công (non-fatal)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: 't' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const notify = { notify: jest.fn().mockRejectedValue(new Error('boom')) };
    const r = await makeSvc(prisma, undefined, notify).addComment('answerer', 'CUSTOMER', 'p1', 'trả lời');
    expect(r).toEqual({ id: 'c1' });
  });
});

describe('CommunityFeedService.setBestAnswer', () => {
  it('không phải chủ bài & không admin → Forbidden', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    await expect(makeSvc(prisma).setBestAnswer('intruder', 'CUSTOMER', 'p1', 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('chủ bài chọn best-answer → set bestCommentId, đánh isAccepted, bỏ cờ cũ, thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(prisma.feedComment.updateMany).toHaveBeenCalledWith({ where: { postId: 'p1' }, data: { isAccepted: false } });
    expect(prisma.feedComment.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isAccepted: true } });
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { bestCommentId: 'c1' } });
    expect(reward.rewardBestAnswer).toHaveBeenCalledWith('answerer', 'author', 'c1');
  });
});

describe('CommunityFeedService.setBestAnswer (thông báo — non-fatal)', () => {
  it('chọn câu trả lời của người khác → notify COMMUNITY_BEST_ANSWER cho answerer', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(notify.notify).toHaveBeenCalledWith('answerer', 'COMMUNITY_BEST_ANSWER', {});
  });

  it('chủ bài chọn câu trả lời của chính mình (edge-case) → KHÔNG notify', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'author' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('notify ném lỗi → setBestAnswer vẫn thành công (non-fatal)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    const notify = { notify: jest.fn().mockRejectedValue(new Error('boom')) };
    const r = await makeSvc(prisma, undefined, notify).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(r).toEqual({ ok: true });
  });
});

describe('CommunityFeedService.deletePost', () => {
  it('người khác (không admin) → Forbidden', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'TIP' });
    await expect(makeSvc(prisma).deletePost('intruder', 'CUSTOMER', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('chủ bài → set status REMOVED', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'TIP' });
    await makeSvc(prisma).deletePost('author', 'CUSTOMER', 'p1');
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'REMOVED' } });
  });
});

describe('CommunityFeedService.editPost', () => {
  it('người khác → Forbidden', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author' });
    await expect(makeSvc(prisma).editPost('intruder', 'p1', { body: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('chủ bài → cập nhật body + set editedAt', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author' });
    await makeSvc(prisma).editPost('author', 'p1', { body: '  nội dung mới  ' });
    const arg = (prisma.feedPost.update as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'p1' });
    expect(arg.data.body).toBe('nội dung mới');
    expect(arg.data.editedAt).toBeInstanceOf(Date);
  });
});

describe('CommunityFeedService.getComments', () => {
  it('trả comment kèm tên tác giả thật theo thời gian tăng dần', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', body: 'hay', createdAt: new Date(), user: { fullName: 'Nguyễn Văn A' } },
    ]);
    const r = await makeSvc(prisma).getComments('p1');
    expect(r[0]).toMatchObject({ id: 'c1', body: 'hay', author: 'Nguyễn Văn A' });
  });

  it('tên null → "Bạn Tubu"', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', body: 'hay', createdAt: new Date(), user: { fullName: null } },
    ]);
    const r = await makeSvc(prisma).getComments('p1');
    expect(r[0]).toMatchObject({ author: 'Bạn Tubu' });
  });

  it('viewerId trùng userId của comment → isOwner true', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', userId: 'u1', body: 'hay', createdAt: new Date(), user: { fullName: 'A' } },
    ]);
    const r = await makeSvc(prisma).getComments('p1', 'u1');
    expect(r[0]).toMatchObject({ isOwner: true });
  });

  it('viewerId khác userId của comment → isOwner false', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', userId: 'u1', body: 'hay', createdAt: new Date(), user: { fullName: 'A' } },
    ]);
    const r = await makeSvc(prisma).getComments('p1', 'u2');
    expect(r[0]).toMatchObject({ isOwner: false });
  });

  it('không truyền viewerId → isOwner false', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', userId: 'u1', body: 'hay', createdAt: new Date(), user: { fullName: 'A' } },
    ]);
    const r = await makeSvc(prisma).getComments('p1');
    expect(r[0]).toMatchObject({ isOwner: false });
  });
});

describe('CommunityFeedService.getCategories', () => {
  it('trả danh mục active, sắp theo order, map id/slug/name/icon', async () => {
    const prisma = makePrisma();
    (prisma.communityCategory.findMany as jest.Mock).mockResolvedValue([
      { id: 'cat1', slug: 'cham-soc', name: 'Chăm sóc cây', icon: '🌱' },
    ]);
    const r = await makeSvc(prisma).getCategories();
    expect(prisma.communityCategory.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      select: { id: true, slug: true, name: true, icon: true },
    });
    expect(r).toEqual([{ id: 'cat1', slug: 'cham-soc', name: 'Chăm sóc cây', icon: '🌱' }]);
  });
});

describe('CommunityFeedService.createAchievementPost', () => {
  it('tạo bài thành tích với kind + meta', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).createAchievementPost('u1', 'SPECIES', 'Sưu tập loài Lim 🌳', { species: 'Lim' });
    const data = (prisma.feedPost.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', kind: 'SPECIES', body: 'Sưu tập loài Lim 🌳', meta: { species: 'Lim' } });
  });
});

describe('CommunityFeedService.createPost (mở rộng)', () => {
  it('QUESTION thiếu title → BadRequest, không tạo', async () => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'QUESTION', body: 'lá vàng?' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });

  it('tạo SHOWCASE PUBLISHED kèm ảnh + gắn SP theo slug → thưởng post', async () => {
    const prisma = makePrisma();
    (prisma.product.findMany as jest.Mock).mockResolvedValue([{ id: 'prod1' }, { id: 'prod2' }]);
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    const r = await makeSvc(prisma, reward).createPost('u1', 'STAFF', {
      kind: 'SHOWCASE', body: 'Khoe cây', images: ['https://img/1.jpg'], productSlugs: ['cay-a', 'cay-b'],
    });
    expect(r).toEqual({ id: 'newpost', status: 'PUBLISHED' });
    const data = (prisma.feedPost.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', kind: 'SHOWCASE', status: 'PUBLISHED', body: 'Khoe cây', images: ['https://img/1.jpg'] });
    expect(prisma.postProductTag.createMany).toHaveBeenCalledWith({
      data: [{ postId: 'newpost', productId: 'prod1' }, { postId: 'newpost', productId: 'prod2' }],
      skipDuplicates: true,
    });
    expect(reward.rewardPost).toHaveBeenCalledWith('u1', 'newpost');
  });

  it('quá 5 SP → BadRequest', async () => {
    const prisma = makePrisma();
    await expect(
      makeSvc(prisma).createPost('u1', 'STAFF', { body: 'x', productSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rewardPost lỗi → bài vẫn tạo (thưởng không chặn đăng bài)', async () => {
    const prisma = makePrisma();
    (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const reward = { rewardPost: jest.fn().mockRejectedValue(new Error('boom')), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    const r = await makeSvc(prisma, reward).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay' });
    expect(r).toEqual({ id: 'newpost', status: 'PUBLISHED' });
    expect(prisma.feedPost.create).toHaveBeenCalled();
  });

  it('tagSlugs hợp lệ → upsert Tag mỗi slug + postTag.createMany', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const r = await makeSvc(prisma).createPost('u1', 'STAFF', {
      kind: 'TIP', body: 'mẹo hay', tagSlugs: ['Sen Đá', '#tuoi nuoc'],
    });
    expect(r).toEqual({ id: 'newpost', status: 'PUBLISHED' });
    expect(prisma.tag.upsert).toHaveBeenCalledWith({
      where: { slug: 'sen-đá' },
      create: { slug: 'sen-đá', name: 'Sen Đá' },
      update: {},
    });
    expect(prisma.tag.upsert).toHaveBeenCalledWith({
      where: { slug: 'tuoi-nuoc' },
      create: { slug: 'tuoi-nuoc', name: 'tuoi nuoc' },
      update: {},
    });
    expect(prisma.postTag.createMany).toHaveBeenCalledWith({
      data: [{ postId: 'newpost', tagId: 'tag-sen-đá' }, { postId: 'newpost', tagId: 'tag-tuoi-nuoc' }],
      skipDuplicates: true,
    });
  });

  it('tagSlugs rỗng/không truyền → không gọi tag.upsert/postTag.createMany', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay' });
    expect(prisma.tag.upsert).not.toHaveBeenCalled();
    expect(prisma.postTag.createMany).not.toHaveBeenCalled();
  });

  it('tagSlugs quá 5 → chỉ lấy tối đa 5 slug đầu', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    await makeSvc(prisma).createPost('u1', 'STAFF', {
      kind: 'TIP', body: 'mẹo hay', tagSlugs: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(prisma.tag.upsert).toHaveBeenCalledTimes(5);
    expect(prisma.postTag.createMany).toHaveBeenCalledWith({
      data: [
        { postId: 'newpost', tagId: 'tag-a' }, { postId: 'newpost', tagId: 'tag-b' },
        { postId: 'newpost', tagId: 'tag-c' }, { postId: 'newpost', tagId: 'tag-d' },
        { postId: 'newpost', tagId: 'tag-e' },
      ],
      skipDuplicates: true,
    });
  });

  it('tag.upsert lỗi → bài vẫn tạo (gắn tag không chặn đăng bài)', async () => {
    const prisma = makePrisma({ tag: { upsert: jest.fn().mockRejectedValue(new Error('boom')) } });
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const r = await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay', tagSlugs: ['sen-da'] });
    expect(r).toEqual({ id: 'newpost', status: 'PUBLISHED' });
    expect(prisma.postTag.createMany).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.isTrusted', () => {
  it('role STAFF → trusted (không cần query đơn)', async () => {
    const prisma = makePrisma();
    expect(await makeSvc(prisma).isTrusted('u1', 'STAFF')).toBe(true);
  });
  it('CUSTOMER không đơn, không profile → không trusted', async () => {
    const prisma = makePrisma();
    expect(await makeSvc(prisma).isTrusted('u1', 'CUSTOMER')).toBe(false);
  });
  it('CUSTOMER có đơn DELIVERED → trusted', async () => {
    const prisma = makePrisma();
    (prisma.order.findFirst as jest.Mock).mockResolvedValue({ id: 'o1' });
    expect(await makeSvc(prisma).isTrusted('u1', 'CUSTOMER')).toBe(true);
  });
  it('CommunityProfile.isTrusted=true → trusted', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ isTrusted: true });
    expect(await makeSvc(prisma).isTrusted('u1', 'CUSTOMER')).toBe(true);
  });
});

describe('CommunityFeedService.createPost (kiểm duyệt lai)', () => {
  it('khách KHÔNG trusted → PENDING, KHÔNG thưởng', async () => {
    const prisma = makePrisma(); // CUSTOMER, no order, no profile → not trusted
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'p1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).createPost('u1', 'CUSTOMER', { kind: 'TIP', body: 'mẹo' });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
    expect(reward.rewardPost).not.toHaveBeenCalled();
  });
  it('khách trusted (STAFF) → PUBLISHED + thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'p1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo' });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PUBLISHED');
    expect(reward.rewardPost).toHaveBeenCalledWith('u1', 'p1');
  });
});

describe('CommunityFeedService.approvePost', () => {
  it('PENDING → PUBLISHED + set author trusted + thưởng (idempotent)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).approvePost('p1');
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'PUBLISHED' } });
    expect(prisma.communityProfile.upsert).toHaveBeenCalled();
    expect(reward.rewardPost).toHaveBeenCalledWith('author', 'p1');
  });
  it('bài đã PUBLISHED → không thưởng lại (idempotent guard)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PUBLISHED' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).approvePost('p1');
    expect(reward.rewardPost).not.toHaveBeenCalled();
  });
  it('bài REMOVED → không hồi sinh (không update, không thưởng)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'REMOVED' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    const r = await makeSvc(prisma, reward).approvePost('p1');
    expect(r).toEqual({ ok: true });
    expect(prisma.feedPost.update).not.toHaveBeenCalled();
    expect(reward.rewardPost).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.approvePost (thông báo — non-fatal)', () => {
  it('duyệt bài PENDING → notify COMMUNITY_POST_APPROVED cho tác giả', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).approvePost('p1');
    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_POST_APPROVED', {});
  });

  it('bài đã PUBLISHED (idempotent) → KHÔNG notify lại', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PUBLISHED' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).approvePost('p1');
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('notify ném lỗi → approvePost vẫn trả ok (non-fatal)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });
    const notify = { notify: jest.fn().mockRejectedValue(new Error('boom')) };
    const r = await makeSvc(prisma, undefined, notify).approvePost('p1');
    expect(r).toEqual({ ok: true });
  });
});

describe('CommunityFeedService.report', () => {
  it('tạo report OPEN cho POST', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).report('u1', { targetType: 'POST', targetId: 'p1', reason: 'spam' });
    expect((prisma.communityReport.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      reporterId: 'u1', targetType: 'POST', targetId: 'p1', reason: 'spam', status: 'OPEN',
    });
  });

  it('targetType không hợp lệ → chuẩn hoá về POST', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).report('u1', { targetType: 'WHATEVER', targetId: 'p1', reason: 'spam' });
    expect((prisma.communityReport.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ targetType: 'POST' });
  });

  it('targetType COMMENT → giữ nguyên COMMENT', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).report('u1', { targetType: 'COMMENT', targetId: 'c1', reason: 'spam' });
    expect((prisma.communityReport.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ targetType: 'COMMENT', targetId: 'c1' });
  });

  it('reason rỗng → fallback "Không phù hợp"', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).report('u1', { targetType: 'POST', targetId: 'p1', reason: '   ' });
    expect((prisma.communityReport.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ reason: 'Không phù hợp' });
  });

  it('reason quá dài → cắt còn 500 ký tự', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).report('u1', { targetType: 'POST', targetId: 'p1', reason: 'a'.repeat(600) });
    expect((prisma.communityReport.create as jest.Mock).mock.calls[0][0].data.reason).toHaveLength(500);
  });
});

describe('CommunityFeedService.adminPending', () => {
  it('lấy bài PENDING, sắp asc, kèm tên tác giả + tên danh mục', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', kind: 'TIP', title: 't', body: 'b', images: [], createdAt: new Date('2026-07-01'), user: { fullName: 'Long' }, category: { name: 'Chăm sóc' } },
    ]);
    const r = await makeSvc(prisma).adminPending();
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ status: 'PENDING' });
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
    expect(r[0]).toMatchObject({ id: 'p1', author: 'Long', category: 'Chăm sóc' });
  });

  it('tác giả không tên, không danh mục → "Bạn Tubu" / null', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', kind: 'TIP', title: null, body: 'b', images: [], createdAt: new Date(), user: { fullName: null }, category: null },
    ]);
    const r = await makeSvc(prisma).adminPending();
    expect(r[0]).toMatchObject({ author: 'Bạn Tubu', category: null });
  });
});

describe('CommunityFeedService.adminReports', () => {
  it('lấy report OPEN, sắp asc', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).adminReports();
    expect(prisma.communityReport.findMany).toHaveBeenCalledWith({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 50 });
  });
});

describe('CommunityFeedService.resolveReport', () => {
  it('set RESOLVED', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).resolveReport('r1');
    expect(prisma.communityReport.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'RESOLVED' } });
  });
});

describe('CommunityFeedService.pinPost', () => {
  it('set isPinned true', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).pinPost('p1', true);
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isPinned: true } });
  });

  it('set isPinned false', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).pinPost('p1', false);
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isPinned: false } });
  });
});

// ---------------------------------------------------------------------------
// Pha 4 Task 1 — reputation/hạng + authorLevel trong DTO + leaderboard
// ---------------------------------------------------------------------------

describe('levelFromReputation (pure fn)', () => {
  it('rep 0 → level 1', () => {
    expect(levelFromReputation(0)).toBe(1);
  });
  it('rep 49 → level 1 (chưa đạt ngưỡng 50)', () => {
    expect(levelFromReputation(49)).toBe(1);
  });
  it('rep 50 → level 2', () => {
    expect(levelFromReputation(50)).toBe(2);
  });
  it('rep 200 → level 3', () => {
    expect(levelFromReputation(200)).toBe(3);
  });
  it('rep 500 → level 4', () => {
    expect(levelFromReputation(500)).toBe(4);
  });
  it('rep vượt xa ngưỡng cao nhất → vẫn level 4 (trần)', () => {
    expect(levelFromReputation(9999)).toBe(4);
  });
  it('ngưỡng tuỳ biến truyền vào → dùng ngưỡng đó thay vì mặc định', () => {
    expect(levelFromReputation(15, [0, 10, 20])).toBe(2);
    expect(levelFromReputation(25, [0, 10, 20])).toBe(3);
  });
});

describe('levelName (pure fn)', () => {
  it.each([
    [1, 'Mầm'],
    [2, 'Cây non'],
    [3, 'Cây trưởng thành'],
    [4, 'Cổ thụ'],
  ])('level %d → %s', (level, name) => {
    expect(levelName(level as number)).toBe(name);
  });
  it('level không hợp lệ (0 hoặc ngoài khoảng) → fallback "Mầm"', () => {
    expect(levelName(0)).toBe('Mầm');
    expect(levelName(99)).toBe('Mầm');
  });
});

describe('CommunityFeedService.bumpReputation', () => {
  it('upsert increment reputation + set create.level theo ngưỡng mặc định', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 5 });
    await makeSvc(prisma).bumpReputation('u1', 5);
    expect(prisma.communityProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', reputation: 5, level: 1 },
      update: { reputation: { increment: 5 } },
    });
  });

  it('sau upsert → đọc lại reputation rồi cập nhật level tương ứng (2 bước)', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 210 });
    await makeSvc(prisma).bumpReputation('u1', 10);
    expect(prisma.communityProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { reputation: true } });
    expect(prisma.communityProfile.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { level: 3 } });
  });

  it('đọc ngưỡng từ SystemConfig community.rep_thresholds (fallback [0,50,200,500])', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 15 });
    const config = makeConfig({ 'community.rep_thresholds': [0, 10, 20] });
    await makeSvc(prisma, undefined, undefined, config).bumpReputation('u1', 15);
    expect(config.get).toHaveBeenCalledWith('community.rep_thresholds', [0, 50, 200, 500]);
    expect(prisma.communityProfile.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { level: 2 } });
  });

  it('upsert lỗi → nuốt lỗi, KHÔNG throw (non-fatal)', async () => {
    const prisma = makePrisma({
      communityProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockRejectedValue(new Error('db down')),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    await expect(makeSvc(prisma).bumpReputation('u1', 5)).resolves.toBeUndefined();
  });

  it('findUnique/update lỗi sau upsert → vẫn nuốt lỗi, KHÔNG throw', async () => {
    const prisma = makePrisma({
      communityProfile: {
        findUnique: jest.fn().mockRejectedValue(new Error('boom')),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    await expect(makeSvc(prisma).bumpReputation('u1', 5)).resolves.toBeUndefined();
  });
});

describe('CommunityFeedService.getLeaderboard', () => {
  it('lấy top theo reputation desc, where reputation>0, map author/avatar/reputation/level/levelName', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findMany as jest.Mock).mockResolvedValue([
      { reputation: 520, level: 4, user: { fullName: 'Long', avatarUrl: 'https://a/1.png' } },
      { reputation: 3, level: 1, user: { fullName: null, avatarUrl: null } },
    ]);
    const r = await makeSvc(prisma).getLeaderboard();
    expect(prisma.communityProfile.findMany).toHaveBeenCalledWith({
      orderBy: { reputation: 'desc' },
      take: 20,
      where: { reputation: { gt: 0 } },
      include: { user: { select: { fullName: true, avatarUrl: true } } },
    });
    expect(r).toEqual([
      { author: 'Long', avatar: 'https://a/1.png', reputation: 520, level: 4, levelName: 'Cổ thụ' },
      { author: 'Bạn Tubu', avatar: null, reputation: 3, level: 1, levelName: 'Mầm' },
    ]);
  });

  it('truyền take tuỳ biến → dùng take đó', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).getLeaderboard(5);
    expect((prisma.communityProfile.findMany as jest.Mock).mock.calls[0][0].take).toBe(5);
  });
});

describe('CommunityFeedService.createPost (cộng reputation — non-fatal)', () => {
  it('đăng bài PUBLISHED (trusted) → cộng community.rep_post (mặc định 5) cho tác giả', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 5 });
    await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay' });
    expect(prisma.communityProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', reputation: 5, level: 1 },
      update: { reputation: { increment: 5 } },
    });
  });

  it('bài PENDING (chưa duyệt) → KHÔNG cộng reputation', async () => {
    const prisma = makePrisma(); // CUSTOMER, không đơn, không profile → chưa trusted
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'p1' });
    await makeSvc(prisma).createPost('u1', 'CUSTOMER', { kind: 'TIP', body: 'mẹo' });
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled();
  });

  it('bumpReputation lỗi → bài vẫn tạo thành công (non-fatal)', async () => {
    const prisma = makePrisma({
      communityProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockRejectedValue(new Error('boom')),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const r = await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay' });
    expect(r).toEqual({ id: 'newpost', status: 'PUBLISHED' });
  });
});

describe('CommunityFeedService.addComment (cộng reputation — non-fatal)', () => {
  it('trả lời QUESTION của người khác → cộng community.rep_answer (mặc định 2) cho answerer', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: 't' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 2 });
    await makeSvc(prisma).addComment('answerer', 'CUSTOMER', 'p1', 'trả lời');
    expect(prisma.communityProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'answerer' },
      create: { userId: 'answerer', reputation: 2, level: 1 },
      update: { reputation: { increment: 2 } },
    });
  });

  it('tự trả lời câu hỏi của chính mình → KHÔNG cộng reputation', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: 't' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    await makeSvc(prisma).addComment('author', 'CUSTOMER', 'p1', 'tự trả lời');
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled();
  });

  it('bình luận bài không phải QUESTION → KHÔNG cộng reputation', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE', status: 'PUBLISHED', title: null });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    await makeSvc(prisma).addComment('u2', 'CUSTOMER', 'p1', 'đẹp quá');
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled();
  });

  it('bumpReputation lỗi → bình luận vẫn tạo thành công (non-fatal)', async () => {
    const prisma = makePrisma({
      communityProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockRejectedValue(new Error('boom')),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: 't' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const r = await makeSvc(prisma).addComment('answerer', 'CUSTOMER', 'p1', 'trả lời');
    expect(r).toEqual({ id: 'c1' });
  });
});

describe('CommunityFeedService.setBestAnswer (cộng reputation — non-fatal)', () => {
  it('chọn best-answer → cộng community.rep_best (mặc định 10) cho answerer', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 10 });
    await makeSvc(prisma).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(prisma.communityProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'answerer' },
      create: { userId: 'answerer', reputation: 10, level: 1 },
      update: { reputation: { increment: 10 } },
    });
  });

  it('bumpReputation lỗi → setBestAnswer vẫn trả ok (non-fatal)', async () => {
    const prisma = makePrisma({
      communityProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockRejectedValue(new Error('boom')),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    const r = await makeSvc(prisma).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(r).toEqual({ ok: true });
  });
});

describe('CommunityFeedService.approvePost (cộng reputation — non-fatal)', () => {
  it('duyệt bài PENDING → cộng community.rep_post (mặc định 5) cho tác giả', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 5 });
    await makeSvc(prisma).approvePost('p1');
    expect(prisma.communityProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'author' },
      create: { userId: 'author', reputation: 5, level: 1 },
      update: { reputation: { increment: 5 } },
    });
  });

  it('bumpReputation lỗi → approvePost vẫn trả ok (non-fatal)', async () => {
    const prisma = makePrisma({
      communityProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockRejectedValue(new Error('boom')),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });
    const r = await makeSvc(prisma).approvePost('p1');
    expect(r).toEqual({ ok: true });
  });
});

describe('CommunityFeedService authorLevel trong DTO (getFeed/getPost/getComments)', () => {
  it('getFeed toItem → authorLevel lấy từ user.communityProfile.level', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      row({ user: { fullName: 'Long', avatarUrl: 'a', role: 'CUSTOMER', communityProfile: { level: 3 } } }),
    ]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]).toMatchObject({ authorLevel: 3 });
  });

  it('getFeed toItem → user không có communityProfile → authorLevel mặc định 1', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      row({ user: { fullName: 'Long', avatarUrl: 'a', role: 'CUSTOMER' } }),
    ]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]).toMatchObject({ authorLevel: 1 });
  });

  it('getComments → authorLevel lấy từ user.communityProfile.level, mặc định 1 nếu thiếu', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', body: 'hay', createdAt: new Date(), user: { fullName: 'A', communityProfile: { level: 2 } } },
      { id: 'c2', body: 'tốt', createdAt: new Date(), user: { fullName: 'B' } },
    ]);
    const r = await makeSvc(prisma).getComments('p1');
    expect(r[0]).toMatchObject({ authorLevel: 2 });
    expect(r[1]).toMatchObject({ authorLevel: 1 });
  });
});
