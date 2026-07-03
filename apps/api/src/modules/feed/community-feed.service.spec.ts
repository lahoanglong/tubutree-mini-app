import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommunityFeedService } from './community-feed.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    feedPost: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'post1' }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data })),
    },
    feedReaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    feedComment: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data })),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    postProductTag: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

function makeSvc(prisma: PrismaService, reward: any = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() }) {
  return new CommunityFeedService(prisma, reward);
}

describe('CommunityFeedService.getFeed', () => {
  it('trả bài viết kèm số tim/bình luận + cờ "đã thả tim" + tên ẩn', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'p1',
        kind: 'HARVEST',
        body: 'Mình vừa thu hoạch 🌳',
        meta: null,
        createdAt: new Date('2026-06-24'),
        user: { fullName: 'Lã Hoàng Long' },
        _count: { reactions: 3, comments: 2 },
        reactions: [{ id: 'r1' }], // current user đã thả tim
      },
    ]);
    const svc = makeSvc(prisma);
    const r = await svc.getFeed('u1');
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({
      id: 'p1',
      kind: 'HARVEST',
      likeCount: 3,
      commentCount: 2,
      liked: true,
      author: 'Long***',
    });
  });

  it('bài chưa thả tim → liked false', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', kind: 'MANUAL', body: 'x', meta: null, createdAt: new Date(), user: { fullName: null }, _count: { reactions: 0, comments: 0 }, reactions: [] },
    ]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]!.liked).toBe(false);
    expect(r.posts[0]!.author).toBe('Bạn Tubu');
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

  it('hợp lệ → tạo comment (trim)', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).addComment('u1', 'p1', '  tuyệt vời  ');
    const data = (prisma.feedComment.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', postId: 'p1', body: 'tuyệt vời' });
  });
});

describe('CommunityFeedService.getComments', () => {
  it('trả comment kèm tên ẩn theo thời gian tăng dần', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', body: 'hay', createdAt: new Date(), user: { fullName: 'Nguyễn Văn A' } },
    ]);
    const r = await makeSvc(prisma).getComments('p1');
    expect(r[0]).toMatchObject({ id: 'c1', body: 'hay', author: 'A***' });
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
