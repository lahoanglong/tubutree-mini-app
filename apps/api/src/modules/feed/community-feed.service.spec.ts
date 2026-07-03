import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunityFeedService } from './community-feed.service';
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
  };
  return { ...base, ...over } as unknown as PrismaService;
}

function makeSvc(prisma: PrismaService, reward: any = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() }) {
  return new CommunityFeedService(prisma, reward);
}

// Dùng chung cho cả getFeed + getPost (row hình dạng Prisma trả về, đã include đủ quan hệ).
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', kind: 'SHOWCASE', status: 'PUBLISHED', title: null, body: 'Khoe cây', images: ['i1'],
  meta: null, bestCommentId: null, createdAt: new Date('2026-07-03'),
  user: { fullName: 'Lã Hoàng Long', avatarUrl: 'https://a/1.png', role: 'CUSTOMER' },
  category: { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿' },
  productTags: [{ product: { slug: 'cay-a', name: 'Cây A', thumbnail: 't', salePrice: null, basePrice: 100 } }],
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
      likeCount: 3, commentCount: 2, liked: true,
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

  it('lọc theo kind → where.kind truyền vào findMany', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { kind: 'QUESTION' });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({ status: 'PUBLISHED', kind: 'QUESTION' });
  });

  it('sort=popular → orderBy theo số tim rồi createdAt', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { sort: 'popular' });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual([{ reactions: { _count: 'desc' } }, { createdAt: 'desc' }]);
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
    expect(r).toMatchObject({ id: 'p1' });
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
});

describe('CommunityFeedService.createPost', () => {
  it('nội dung trống → throw, không tạo', async () => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).createPost('u1', { body: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });

  it('nội dung quá dài → throw', async () => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).createPost('u1', { body: 'a'.repeat(5001) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('hợp lệ → tạo bài MANUAL (trim nội dung)', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).createPost('u1', { body: '  Vườn mình xanh quá  ' });
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
    await expect(makeSvc(prisma).addComment('u1', 'p1', '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('bài không tồn tại → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(makeSvc(prisma).addComment('u1', 'pX', 'hay quá')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('bài đã bị xoá mềm (REMOVED) → NotFound, KHÔNG tạo comment', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'REMOVED' });
    await expect(makeSvc(prisma).addComment('u1', 'p1', 'hay quá')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.feedComment.create).not.toHaveBeenCalled();
  });

  it('hợp lệ → tạo comment (trim)', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).addComment('u1', 'p1', '  tuyệt vời  ');
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
    await makeSvc(prisma, reward).addComment('answerer', 'p1', 'Bạn tưới ít lại nhé');
    expect(reward.rewardAnswer).toHaveBeenCalledWith('answerer', 'author', 'c1');
  });

  it('bình luận bài không phải QUESTION → KHÔNG thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).addComment('u2', 'p1', 'đẹp quá');
    expect(reward.rewardAnswer).not.toHaveBeenCalled();
  });

  it('rewardAnswer lỗi → bình luận vẫn tạo (thưởng không chặn)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn().mockRejectedValue(new Error('boom')), rewardBestAnswer: jest.fn() };
    const r = await makeSvc(prisma, reward).addComment('answerer', 'p1', 'trả lời');
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
    await expect(makeSvc(prisma).createPost('u1', { kind: 'QUESTION', body: 'lá vàng?' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });

  it('tạo SHOWCASE PUBLISHED kèm ảnh + gắn SP theo slug → thưởng post', async () => {
    const prisma = makePrisma();
    (prisma.product.findMany as jest.Mock).mockResolvedValue([{ id: 'prod1' }, { id: 'prod2' }]);
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    const r = await makeSvc(prisma, reward).createPost('u1', {
      kind: 'SHOWCASE', body: 'Khoe cây', images: ['https://img/1.jpg'], productSlugs: ['cay-a', 'cay-b'],
    });
    expect(r).toEqual({ id: 'newpost' });
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
      makeSvc(prisma).createPost('u1', { body: 'x', productSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rewardPost lỗi → bài vẫn tạo (thưởng không chặn đăng bài)', async () => {
    const prisma = makePrisma();
    (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const reward = { rewardPost: jest.fn().mockRejectedValue(new Error('boom')), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    const r = await makeSvc(prisma, reward).createPost('u1', { kind: 'TIP', body: 'mẹo hay' });
    expect(r).toEqual({ id: 'newpost' });
    expect(prisma.feedPost.create).toHaveBeenCalled();
  });
});
