import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunityFeedService, containsBannedContent, levelFromReputation, levelName, slugifyTag } from './community-feed.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { feedImageVersion, MAX_FEED_IMAGES } from './feed-images';

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    feedPost: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'post1', userId: 'author', kind: 'SHOWCASE' }),
      // pickWinner đòi người thắng có bài dự thi: mặc định coi mọi người đều đã dự.
      findFirst: jest.fn().mockResolvedValue({ id: 'entry1' }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data })),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    feedReaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    feedComment: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    postProductTag: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    tag: {
      upsert: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockImplementation(async ({ where }: { where: { slug: { in: string[] } } }) =>
        [...where.slug.in].reverse().map((slug) => ({ id: `tag-${slug}`, slug })),
      ),
    },
    postTag: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    // approvePost đọc lại trạng thái bài (FOR SHARE) sau khi thưởng; mặc định: vẫn đang đăng.
    $queryRaw: jest.fn().mockResolvedValue([{ status: 'PUBLISHED' }]),
    communityCategory: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    communityProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    communityReport: {
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ fullName: 'Người dùng' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    communityEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ev1', ...data })),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // Sổ cái reputation (chặn farm + idempotent + đảo khi xoá bài).
    reputationEvent: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  // $transaction hỗ trợ CẢ 2 dạng: mảng op (cũ) và callback interactive (bumpReputation/
  // reverseReputationForPost chạy Serializable) — callback nhận chính mock prisma này làm tx.
  base.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(base) : Promise.all(arg as Promise<unknown>[]),
  );
  const merged = { ...base, ...over } as Record<string, unknown>;
  // Nếu test override 1 bảng nào đó, callback tx vẫn phải thấy bản override.
  merged.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(merged) : Promise.all(arg as Promise<unknown>[]),
  );
  return merged as unknown as PrismaService;
}

/**
 * `feedPost.updateMany` theo ngữ nghĩa thật: chỉ khớp (count 1) khi trạng thái HIỆN TẠI thoả `where.status`, và đổi trạng thái
 * khi khớp. Dùng cho test cần phân biệt bài đã chuyển từ PENDING hay từ PUBLISHED.
 */
function withPostStatus(prisma: PrismaService, initial: string) {
  let current = initial;
  (prisma.feedPost.updateMany as jest.Mock).mockImplementation(
    async ({ where, data }: { where: { status: string | { not: string } }; data: { status: string } }) => {
      const cond = where.status;
      const matches = typeof cond === 'string' ? current === cond : current !== cond.not;
      if (!matches) return { count: 0 };
      current = data.status;
      return { count: 1 };
    },
  );
}

// Mock SystemConfigService — mặc định trả về fallback truyền vào (giống hành vi thật khi
// key chưa cấu hình); truyền `overrides` để giả lập giá trị đã cấu hình cho key cụ thể.
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn(async (key: string, fallback?: unknown) => (key in overrides ? overrides[key] : fallback)),
  };
}

/**
 * Analytics mock — mặc định luôn FRESH mỗi lần makeSvc() được gọi (default param, không phải
 * biến module-scope dùng chung) để các test không vô tình cộng dồn call count của nhau. Wiring
 * THẬT (không @Optional() no-op câm lặng) ở mọi construction (Task 9).
 */
function makeAnalytics() {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  };
}

function makeSvc(
  prisma: PrismaService,
  reward: any = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn(), rewardEventWinner: jest.fn() },
  notify?: { notify: jest.Mock },
  config: any = makeConfig(),
  analytics: any = makeAnalytics(),
) {
  return new CommunityFeedService(prisma, reward, config, analytics, notify as any);
}

// Dùng chung cho cả getFeed + getPost (row hình dạng Prisma trả về, đã include đủ quan hệ).
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', kind: 'SHOWCASE', status: 'PUBLISHED', title: null, body: 'Khoe cây',
  meta: null, bestCommentId: null, createdAt: new Date('2026-07-03'), userId: 'author', isPinned: false,
  user: { fullName: 'Lã Hoàng Long', avatarUrl: 'https://a/1.png', role: 'CUSTOMER', communityProfile: { level: 1 } },
  category: { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿' },
  productTags: [{ product: { slug: 'cay-a', name: 'Cây A', thumbnail: 't', salePrice: null, basePrice: 100 } }],
  tags: [],
  reactions: [{ id: 'r1' }],
  ...over,
});

describe('CommunityFeedService.getFeed (cộng đồng)', () => {
  it('hiện tên rút gọn + avatar + badge + chip SP + đã-thả-tim', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    (prisma.feedReaction.groupBy as jest.Mock).mockResolvedValue([{ postId: 'p1', _count: { _all: 3 } }]);
    (prisma.feedComment.groupBy as jest.Mock).mockResolvedValue([{ postId: 'p1', _count: { _all: 2 } }]);
    const r = await makeSvc(prisma).getFeed('u1', { category: 'khoe-vuon' });
    expect(r.posts[0]).toMatchObject({
      id: 'p1', author: 'Long L.', avatar: 'https://a/1.png', badge: null,
      likeCount: 3, commentCount: 2, liked: true, isOwner: false,
      category: { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿' },
      productTags: [{ slug: 'cay-a', name: 'Cây A', thumbnail: 't', salePrice: null, basePrice: 100 }],
    });
    // Lọc theo danh mục + chỉ PUBLISHED được truyền vào where
    const where = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'PUBLISHED', category: { slug: 'khoe-vuon' } });
  });

  it('đếm tim/bình luận chỉ cho id của trang (không _count join cả bảng), bình luận bỏ isRemoved', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    (prisma.feedReaction.groupBy as jest.Mock).mockResolvedValue([{ postId: 'b', _count: { _all: 4 } }]);
    (prisma.feedComment.groupBy as jest.Mock).mockResolvedValue([{ postId: 'a', _count: { _all: 1 } }]);
    const r = await makeSvc(prisma).getFeed('u1', { take: 2 });
    const findArgs = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(findArgs.select)).not.toContain('_count');
    // c là bài thừa (take+1) nên không được đếm
    expect(prisma.feedReaction.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['postId'], where: { postId: { in: ['a', 'b'] } } }),
    );
    expect(prisma.feedComment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { postId: { in: ['a', 'b'] }, isRemoved: false } }),
    );
    expect(r.posts.map((p: any) => [p.id, p.likeCount, p.commentCount])).toEqual([['a', 0, 1], ['b', 4, 0]]);
  });

  it('trang rỗng → không gọi groupBy', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).getFeed('u1');
    expect(prisma.feedReaction.groupBy).not.toHaveBeenCalled();
    expect(prisma.feedComment.groupBy).not.toHaveBeenCalled();
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

  it('sort=popular → orderBy pinned trước, rồi số tim, rồi createdAt, rồi id (tiebreaker)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1', { sort: 'popular' });
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual([
      { isPinned: 'desc' },
      { likeCount: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('mặc định (new) → orderBy pinned trước, rồi createdAt, rồi id (tiebreaker)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    await makeSvc(prisma).getFeed('u1');
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual([{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
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

describe('CommunityFeedService — ảnh trong danh sách (ENGAGE-7, D6-05)', () => {
  const imgRow = (postId: string, idx: number, count: number, over: Record<string, unknown> = {}) => ({
    postId, count, idx, url: null, hash: `${'a'.repeat(31)}${idx}`, ...over,
  });
  const ref = (postId: string, idx: number) => `/feed/posts/${postId}/images/${idx}?v=${'a'.repeat(31)}${idx}`;
  const withImages = (prisma: PrismaService, rows: unknown[]) => (prisma.$queryRaw as jest.Mock).mockResolvedValue(rows);

  it('danh sách chỉ select các cột cần: không đọc cột images, không include thô', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).getFeed('u1');
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(args.select).toBeDefined();
    expect(args.select.images).toBeUndefined();
    expect(args.select).toMatchObject({ id: true, body: true, status: true, userId: true, reactions: { where: { userId: 'u1' }, select: { id: true } } });
  });

  it('danh sách trả ảnh bìa là đường dẫn endpoint (không phải base64) + imageCount', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    withImages(prisma, [imgRow('p1', 0, 3)]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]!.images).toEqual([ref('p1', 0)]);
    expect(r.posts[0]!.imageCount).toBe(3);
  });

  it('ảnh bìa đã là URL (Cloudinary) thì trả nguyên', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    withImages(prisma, [imgRow('p1', 0, 1, { hash: null, url: 'https://res.cloudinary.com/x/y.jpg' })]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]!.images).toEqual(['https://res.cloudinary.com/x/y.jpg']);
  });

  it('hỏi ảnh một lần cho cả trang, chỉ phần tử đầu', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row({ id: 'p1' }), row({ id: 'p2' })]);
    await makeSvc(prisma).getFeed('u1');
    const calls = (prisma.$queryRaw as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    const [, ...values] = calls[0] as unknown[];
    expect(values).toEqual([['p1', 'p2']]);
  });

  it('trang rỗng không hỏi ảnh', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).getFeed('u1');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('bài dự thi của sự kiện cũng chỉ trả ảnh bìa dạng đường dẫn và không đọc cột images', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    withImages(prisma, [imgRow('p1', 0, 3)]);
    const r = await makeSvc(prisma).eventPosts('ev1', 'u1');
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(args.select.images).toBeUndefined();
    expect(r.posts[0]!.images).toEqual([ref('p1', 0)]);
    expect(r.posts[0]!.imageCount).toBe(3);
  });

  it('chi tiết bài trả đủ ảnh (đường dẫn hoặc URL) và không đọc cột images thô', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row(), reactions: [] });
    withImages(prisma, [imgRow('p1', 0, 3), imgRow('p1', 1, 3, { hash: null, url: 'https://res.cloudinary.com/a.jpg' }), imgRow('p1', 2, 3)]);
    const r = await makeSvc(prisma).getPost('u1', 'p1');
    const args = (prisma.feedPost.findUnique as jest.Mock).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(args.select.images).toBeUndefined();
    expect(r.images).toEqual([ref('p1', 0), 'https://res.cloudinary.com/a.jpg', ref('p1', 2)]);
    expect(r.imageCount).toBe(3);
    const [, ...values] = (prisma.$queryRaw as jest.Mock).mock.calls[0] as unknown[];
    expect(values).toEqual([['p1'], 6]);
  });

  it('bài không ảnh → images rỗng, imageCount 0', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    withImages(prisma, []);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]).toMatchObject({ images: [], imageCount: 0 });
  });

  describe('ảnh nhỏ của sản phẩm gắn thẻ', () => {
    const DATA = `data:image/jpeg;base64,${'A'.repeat(2000)}`;
    const tag = (slug: string, thumbnail: string | null) => ({ product: { slug, name: slug, thumbnail, salePrice: null, basePrice: 100 } });
    const tags = () => [tag('a', 'https://cdn/a.jpg'), tag('b', DATA), tag('c', null)];

    it('danh sách feed: URL giữ nguyên, ảnh base64 (sản phẩm đối tác chưa có Cloudinary) bị bỏ khỏi JSON', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row({ productTags: tags() })]);
      const r = await makeSvc(prisma).getFeed('u1');
      expect(r.posts[0]!.productTags.map((t) => t.thumbnail)).toEqual(['https://cdn/a.jpg', null, null]);
      expect(JSON.stringify(r)).not.toContain('base64');
    });

    it('bài dự thi của sự kiện (cũng là danh sách) bỏ ảnh base64 như feed', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row({ productTags: tags() })]);
      const r = await makeSvc(prisma).eventPosts('ev1', 'u1');
      expect(r.posts[0]!.productTags.map((t) => t.thumbnail)).toEqual(['https://cdn/a.jpg', null, null]);
    });

    it('chi tiết bài (một bài, ảnh 48px): giữ nguyên ảnh sản phẩm kể cả base64', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row({ productTags: tags() }), reactions: [] });
      const r = await makeSvc(prisma).getPost('u1', 'p1');
      expect(r.productTags.map((t) => t.thumbnail)).toEqual(['https://cdn/a.jpg', DATA, null]);
    });
  });

  it('bài không được xem (REMOVED, PENDING của người khác) bị chặn trước khi đọc ảnh', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row({ status: 'REMOVED' }), reactions: [] });
    await expect(makeSvc(prisma).getPost('u1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.getImage (endpoint ảnh bài)', () => {
  const PNG = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
  const author = { sub: 'author', role: 'CUSTOMER' };
  const stranger = { sub: 'stranger', role: 'CUSTOMER' };
  const admin = { sub: 'adm', role: 'ADMIN' };
  const cskh = { sub: 'cs', role: 'STAFF', staffPermissions: ['CSKH'] };
  const kho = { sub: 'kho', role: 'STAFF', staffPermissions: ['KHO'] };
  const marketing = { sub: 'mkt', role: 'STAFF', staffPermissions: ['MARKETING'] };
  const keToan = { sub: 'kt', role: 'STAFF', staffPermissions: ['KE_TOAN'] };
  const post = (status: string, img: string | null = PNG) => [{ status, userId: 'author', img }];
  const svc = (rows: unknown[]) => {
    const prisma = makePrisma();
    (prisma.$queryRaw as jest.Mock).mockResolvedValue(rows);
    return { prisma, svc: makeSvc(prisma) };
  };
  const vOf = (idx = 0, img = PNG) => feedImageVersion('p1', idx, img);

  it('bài đã đăng: ai cũng xem được, trả đúng byte + Content-Type theo data URI, cho cache công khai', async () => {
    const r = await svc(post('PUBLISHED')).svc.getImage('p1', 0, undefined, undefined);
    expect(r.mime).toBe('image/png');
    expect(r.data.toString()).toBe('png-bytes');
    expect(r.isPublic).toBe(true);
  });

  it('bài đã đăng: báo mã v khớp ảnh đang lưu hay không (quyết định cache vĩnh viễn hay ngắn)', async () => {
    const s = svc(post('PUBLISHED')).svc;
    expect((await s.getImage('p1', 0, undefined, vOf())).versionOk).toBe(true);
    for (const v of [undefined, '', 'x'.repeat(32), vOf(1), feedImageVersion('p2', 0, PNG), vOf(0, `${PNG}A`)]) {
      expect((await s.getImage('p1', 0, undefined, v)).versionOk).toBe(false);
    }
  });

  it.each(['image/jpeg', 'image/webp', 'image/gif'])('nhận MIME ảnh %s', async (mime) => {
    const r = await svc(post('PUBLISHED', `data:${mime};base64,QUJD`)).svc.getImage('p1', 0, undefined, undefined);
    expect(r.mime).toBe(mime);
  });

  it.each([
    ['SVG (chạy được script)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['HTML', 'data:text/html;base64,PGgxPng8L2gxPg=='],
    ['base64 sai ký tự', 'data:image/png;base64,@@@@'],
    ['URL https (không phải ảnh nhúng)', 'https://res.cloudinary.com/x/y.jpg'],
  ])('không phục vụ %s', async (_name, img) => {
    await expect(svc(post('PUBLISHED', img)).svc.getImage('p1', 0, undefined, undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bài không tồn tại hoặc không có ảnh ở chỉ số đó → 404', async () => {
    await expect(svc([]).svc.getImage('px', 0, undefined, undefined)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc(post('PUBLISHED', null)).svc.getImage('p1', 3, undefined, undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([-1, MAX_FEED_IMAGES, 99, 1.5, Number.NaN])('chỉ số %s ngoài khoảng → 404 mà không hỏi DB', async (index) => {
    const { prisma, svc: s } = svc(post('PUBLISHED'));
    await expect(s.getImage('p1', index, undefined, undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('chỉ đọc đúng một phần tử của mảng ảnh (không kéo cả mảng)', async () => {
    const { prisma, svc: s } = svc(post('PUBLISHED'));
    await s.getImage('p1', 2, undefined, undefined);
    const [strings, ...values] = (prisma.$queryRaw as jest.Mock).mock.calls[0] as [string[], ...unknown[]];
    expect(strings.join('?')).toContain('"images"[');
    expect(values).toEqual([3, 'p1']);
  });

  describe.each(['PENDING', 'HIDDEN', 'REMOVED'])('bài %s', (status) => {
    it('tác giả, ADMIN, STAFF nhóm CSKH hoặc MARKETING (người kiểm duyệt) xem được, và ảnh không vào cache dùng chung', async () => {
      for (const viewer of [author, admin, cskh, marketing]) {
        const r = await svc(post(status)).svc.getImage('p1', 0, viewer, undefined);
        expect(r.data.toString()).toBe('png-bytes');
        expect(r.isPublic).toBe(false);
      }
    });

    it('khách chưa đăng nhập, người dùng khác và STAFF nhóm KHO hoặc KE_TOAN đều nhận 404', async () => {
      for (const viewer of [undefined, stranger, kho, keToan]) {
        await expect(svc(post(status)).svc.getImage('p1', 0, viewer, undefined)).rejects.toBeInstanceOf(NotFoundException);
      }
    });

    it('mã v đúng cũng không mở ảnh của người khác nếu bài không phải PENDING', async () => {
      if (status === 'PENDING') return;
      await expect(svc(post(status)).svc.getImage('p1', 0, undefined, vOf())).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc(post(status)).svc.getImage('p1', 0, stranger, vOf())).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('bài PENDING: thẻ img không có token vẫn xem được khi mang đúng mã v của ảnh đó', async () => {
    const r = await svc(post('PENDING')).svc.getImage('p1', 0, undefined, vOf());
    expect(r.isPublic).toBe(false);
    expect(r.data.toString()).toBe('png-bytes');
  });

  it('bài PENDING: mã v sai, thiếu hoặc của ảnh/bài khác → 404', async () => {
    const s = svc(post('PENDING')).svc;
    for (const v of [undefined, '', 'x'.repeat(32), vOf(1), feedImageVersion('p2', 0, PNG), vOf(0, `${PNG}A`)]) {
      await expect(s.getImage('p1', 0, stranger, v)).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});

describe('CommunityFeedService.getPost', () => {
  it('KHÔNG ghi viewCount trên đường đọc nóng (không màn nào hiển thị con số đó)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.update as jest.Mock) = jest.fn().mockResolvedValue({});
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({
      ...row(), reactions: [],
    });
    const svc = makeSvc(prisma);
    const r = await svc.getPost('u1', 'p1');
    // Đây là đường đọc nóng nhất: mỗi lượt mở/refresh từng là một UPDATE khoá đúng một dòng
    // (ghi tuần tự trên bài viral), trong khi toItem()/FeedItem không trả viewCount ra cho ai.
    expect(prisma.feedPost.update).not.toHaveBeenCalled();
    expect(r).toMatchObject({ id: 'p1', isOwner: false });
  });

  it('userId trùng chủ bài → isOwner true', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({
      ...row(), userId: 'author', reactions: [],
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
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row(), status: 'PENDING', userId: 'author', reactions: [] });
    await expect(makeSvc(prisma).getPost('intruder', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.feedPost.update).not.toHaveBeenCalled();
  });

  it('chủ bài xem bài PENDING của mình → OK', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row(), status: 'PENDING', userId: 'owner', reactions: [] });
    const r = await makeSvc(prisma).getPost('owner', 'p1');
    expect(r.id).toBe('p1');
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

  it('chỉ đọc lại id bài vừa tạo, không kéo cả mảng ảnh vừa ghi về Node', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).createPost('u1', 'STAFF', { body: 'Có ảnh', images: ['https://res.cloudinary.com/a.jpg'] });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].select).toEqual({ id: true });
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
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
    (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue(null);
    const r = await makeSvc(prisma).toggleReaction('u1', 'p1');
    expect(r.liked).toBe(true);
    expect(prisma.feedReaction.create).toHaveBeenCalled();
    expect(prisma.feedReaction.deleteMany).not.toHaveBeenCalled();
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { likeCount: { increment: 1 } }, select: { id: true } });
  });

  it('đã thả tim → bỏ tim, liked false', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
    (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r1' });
    const r = await makeSvc(prisma).toggleReaction('u1', 'p1');
    expect(r.liked).toBe(false);
    expect(prisma.feedReaction.deleteMany).toHaveBeenCalled();
    expect(prisma.feedReaction.create).not.toHaveBeenCalled();
    expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', likeCount: { gt: 0 } },
      data: { likeCount: { decrement: 1 } },
    });
  });

  it('bỏ tim nhưng deleteMany xoá 0 dòng (thiết bị kia đã bỏ) → không trừ likeCount lần hai', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
    (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r1' });
    (prisma.feedReaction.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    await makeSvc(prisma).toggleReaction('u1', 'p1');
    expect(prisma.feedPost.updateMany).not.toHaveBeenCalled();
  });

  it('bài CHƯA DUYỆT → NotFound, không đẩy lượt tim cho bài sắp được duyệt', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PENDING' });
    await expect(makeSvc(prisma).toggleReaction('u1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.feedReaction.create).not.toHaveBeenCalled();
  });

  it('hai thiết bị bấm cùng lúc (P2002) → vẫn trả liked, KHÔNG 500', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
    (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.feedReaction.create as jest.Mock).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(makeSvc(prisma).toggleReaction('u1', 'p1')).resolves.toEqual({ liked: true });
  });

  describe('Task 9 analytics (engagement_action) — chỉ phát khi TẠO, không phát khi toggle-off', () => {
    it('chưa thả tim → thả tim (create) → recordBestEffort đúng eventName/action/props', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
      (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue(null);
      const analytics = makeAnalytics();
      await makeSvc(prisma, undefined, undefined, undefined, analytics).toggleReaction('u1', 'p1');
      expect(analytics.recordBestEffort).toHaveBeenCalledTimes(1);
      expect(analytics.recordBestEffort).toHaveBeenCalledWith({
        eventName: 'engagement_action',
        userId: 'u1',
        platform: 'miniapp',
        props: { action: 'feed_reaction', postId: 'p1' },
      });
    });

    it('đã thả tim → bỏ tim (delete) → KHÔNG phát sự kiện', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
      (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r1' });
      const analytics = makeAnalytics();
      await makeSvc(prisma, undefined, undefined, undefined, analytics).toggleReaction('u1', 'p1');
      expect(analytics.recordBestEffort).not.toHaveBeenCalled();
    });

    it('hai thiết bị bấm cùng lúc (P2002 — thiết bị KIA mới là người tạo) → request này KHÔNG phát sự kiện', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
      (prisma.feedReaction.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.feedReaction.create as jest.Mock).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      const analytics = makeAnalytics();
      await makeSvc(prisma, undefined, undefined, undefined, analytics).toggleReaction('u1', 'p1');
      expect(analytics.recordBestEffort).not.toHaveBeenCalled();
    });
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

  it('bài đang CHỜ DUYỆT → NotFound, KHÔNG tạo comment và KHÔNG thưởng', async () => {
    // Bài PENDING không ai thấy trên bảng tin, nhưng trước đây vẫn bình luận được nếu biết id.
    // Hai tài khoản của cùng một người có thể hỏi–đáp–chọn-hay-nhất trên bài vô hình đó để
    // rút 100 xu/bình luận + 500 xu/câu trả lời hay nhất mà không ai kiểm duyệt được.
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PENDING' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await expect(makeSvc(prisma, reward).addComment('u1', 'CUSTOMER', 'p1', 'hay quá')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.feedComment.create).not.toHaveBeenCalled();
    expect(reward.rewardAnswer).not.toHaveBeenCalled();
  });

  it('hợp lệ → tạo comment (trim)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE', status: 'PUBLISHED' });
    await makeSvc(prisma).addComment('u1', 'CUSTOMER', 'p1', '  tuyệt vời  ');
    const data = (prisma.feedComment.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', postId: 'p1', body: 'tuyệt vời' });
  });

  it('Task 9: bình luận tạo thành công → recordBestEffort đúng eventName/action/props (addComment luôn TẠO, không có nhánh xoá)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE', status: 'PUBLISHED' });
    const analytics = makeAnalytics();
    await makeSvc(prisma, undefined, undefined, undefined, analytics).addComment('u1', 'CUSTOMER', 'p1', 'tuyệt vời');
    expect(analytics.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(analytics.recordBestEffort).toHaveBeenCalledWith({
      eventName: 'engagement_action',
      userId: 'u1',
      platform: 'miniapp',
      props: { action: 'feed_comment', postId: 'p1' },
    });
  });
});

describe('CommunityFeedService.addComment (thưởng answer)', () => {
  it('trả lời bài QUESTION của người khác → tạo comment + thưởng answer', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).addComment('answerer', 'CUSTOMER', 'p1', 'Bạn tưới ít lại nhé');
    expect(reward.rewardAnswer).toHaveBeenCalledWith('answerer', 'author', 'c1');
  });

  it('bình luận bài không phải QUESTION → KHÔNG thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE', status: 'PUBLISHED' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).addComment('u2', 'CUSTOMER', 'p1', 'đẹp quá');
    expect(reward.rewardAnswer).not.toHaveBeenCalled();
  });

  it('rewardAnswer lỗi → bình luận vẫn tạo (thưởng không chặn)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
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
    expect(notify.notify).toHaveBeenCalledWith(
      'author',
      'COMMUNITY_NEW_ANSWER',
      { author: 'Long', title: 'Lá vàng phải làm sao?', post_id: 'p1' },
      { dedupeKey: 'post-answer:p1', dedupeWithinMs: 3_600_000 },
    );
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

  it('bình luận bài không phải QUESTION → không phát tin "trả lời" (chỉ có tin bình luận mới ở khối bên dưới)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE', status: 'PUBLISHED', title: null, body: 'Khoe cây' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).addComment('u2', 'CUSTOMER', 'p1', 'đẹp quá');
    const codes = notify.notify.mock.calls.map((c) => c[1]);
    expect(codes).not.toContain('COMMUNITY_NEW_ANSWER');
    expect(codes).not.toContain('COMMUNITY_EXPERT_REPLIED');
  });

  it('không có title → dùng fallback "câu hỏi của bạn"', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', title: null });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ fullName: null });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).addComment('answerer', 'CUSTOMER', 'p1', 'trả lời');
    expect(notify.notify).toHaveBeenCalledWith(
      'author',
      'COMMUNITY_NEW_ANSWER',
      { author: 'Thành viên', title: 'câu hỏi của bạn', post_id: 'p1' },
      { dedupeKey: 'post-answer:p1', dedupeWithinMs: 3_600_000 },
    );
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
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    await expect(makeSvc(prisma).setBestAnswer('intruder', 'CUSTOMER', 'p1', 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('chủ bài chọn best-answer → set bestCommentId, đánh isAccepted, bỏ cờ cũ, thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(prisma.feedComment.updateMany).toHaveBeenCalledWith({ where: { postId: 'p1' }, data: { isAccepted: false } });
    expect(prisma.feedComment.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isAccepted: true } });
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { bestCommentId: 'c1' }, select: { id: true } });
    expect(reward.rewardBestAnswer).toHaveBeenCalledWith('answerer', 'author', 'p1');
  });

  it('bài chưa được duyệt → NotFound, KHÔNG thưởng 500 xu', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PENDING' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer', isRemoved: false });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await expect(makeSvc(prisma, reward).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reward.rewardBestAnswer).not.toHaveBeenCalled();
  });

  it('bình luận đã bị gỡ → NotFound, KHÔNG thưởng và KHÔNG trỏ bestCommentId vào nội dung ẩn', async () => {
    // Nếu cho qua: thẻ bài hiện "đã có câu trả lời hay nhất" nhưng mở ra không thấy câu nào,
    // vì danh sách bình luận lọc isRemoved.
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer', isRemoved: true });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await expect(makeSvc(prisma, reward).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reward.rewardBestAnswer).not.toHaveBeenCalled();
    expect(prisma.feedPost.update).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.setBestAnswer (thông báo — non-fatal)', () => {
  it('chọn câu trả lời của người khác → notify COMMUNITY_BEST_ANSWER cho answerer', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(notify.notify).toHaveBeenCalledWith('answerer', 'COMMUNITY_BEST_ANSWER', { post_id: 'p1', reward_note: '' });
  });

  describe('lời tin chỉ nhắc Điểm Xanh khi điểm đã thật sự vào sổ (D5-03)', () => {
    const run = async (reward: unknown) => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
      (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };
      await makeSvc(prisma, reward, notify).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
      return notify.notify.mock.calls[0][2] as Record<string, string>;
    };
    const rewardOf = (rewardBestAnswer: jest.Mock) => ({ rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer });

    it('đã cộng 1.000 điểm → reward_note nêu số điểm', async () => {
      const data = await run(rewardOf(jest.fn().mockResolvedValue(1000)));
      expect(data.reward_note).toBe(' Bạn nhận thêm 1.000 Điểm Xanh thưởng.');
    });

    it('chạm trần ngày (thưởng trả 0) → reward_note rỗng', async () => {
      const data = await run(rewardOf(jest.fn().mockResolvedValue(0)));
      expect(data.reward_note).toBe('');
    });

    it('rewardBestAnswer ném lỗi → reward_note rỗng, tin vẫn gửi', async () => {
      const data = await run(rewardOf(jest.fn().mockRejectedValue(new Error('boom'))));
      expect(data.reward_note).toBe('');
    });
  });

  it('chủ bài chọn câu trả lời của chính mình (edge-case) → KHÔNG notify', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'author' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('notify ném lỗi → setBestAnswer vẫn thành công (non-fatal)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
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
    withPostStatus(prisma, 'PUBLISHED');
    await makeSvc(prisma).deletePost('author', 'CUSTOMER', 'p1');
    expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: { not: 'REMOVED' } }, data: { status: 'REMOVED' } });
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
    expect(arg.select).toEqual({ id: true });
  });

  // P1-4 (docs/2026-09-08-review-progress.md): bài của user CHƯA tin cậy đi qua kiểm duyệt
  // (PENDING → admin duyệt → PUBLISHED, đồng thời tác giả được đánh isTrusted VĨNH VIỄN).
  // Sau đó tác giả PATCH nội dung thành spam/lừa đảo: bài vẫn PUBLISHED, giữ nguyên vị trí đã
  // ghim/best-answer, và KHÔNG bao giờ quay lại hàng chờ duyệt (adminPending chỉ lọc PENDING).
  it('sửa NỘI DUNG bài PUBLISHED của user chưa tin cậy → quay lại PENDING để duyệt lại', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author', status: 'PUBLISHED' });
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ isTrusted: false });
    (prisma.order.findFirst as jest.Mock).mockResolvedValue(null); // chưa có đơn DELIVERED
    await makeSvc(prisma).editPost('author', 'p1', { body: 'nội dung đổi hoàn toàn' }, 'CUSTOMER');
    expect((prisma.feedPost.update as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('sửa nội dung bài PUBLISHED của user TIN CẬY (vd STAFF) → giữ nguyên PUBLISHED', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author', status: 'PUBLISHED' });
    await makeSvc(prisma).editPost('author', 'p1', { body: 'sửa chính tả' }, 'STAFF');
    expect((prisma.feedPost.update as jest.Mock).mock.calls[0][0].data.status).toBeUndefined();
  });

  // Bug fix (cùng logic với createPost): isTrusted chỉ phản ánh lịch sử tới lúc TẠO bài — tác
  // giả có thể sửa lại ruột bài ĐÃ DUYỆT thành link ngoài/spam mà không bao giờ quay lại hàng
  // chờ nếu chỉ check isTrusted. Phải quét nội dung SAU khi sửa, kể cả với user tin cậy.
  it('sửa nội dung bài PUBLISHED của user TIN CẬY (STAFF) THÀNH nội dung vi phạm → quay lại PENDING', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author', status: 'PUBLISHED', title: null, body: 'nội dung cũ hiền lành' });
    await makeSvc(prisma).editPost('author', 'p1', { body: 'Group casino đổi thưởng, inbox ngay' }, 'STAFF');
    expect((prisma.feedPost.update as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('sửa nội dung bài PUBLISHED của user TIN CẬY (STAFF) chỉ đổi TITLE thành vi phạm (giữ nguyên body) → vẫn quét ra PENDING', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author', status: 'PUBLISHED', title: 'Tiêu đề cũ', body: 'nội dung hiền lành' });
    await makeSvc(prisma).editPost('author', 'p1', { title: 'Vay nong lãi thấp, inbox ngay' }, 'STAFF');
    expect((prisma.feedPost.update as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('bài đang PENDING sẵn → sửa không đụng tới status (vẫn chờ duyệt)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author', status: 'PENDING' });
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ isTrusted: false });
    (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);
    await makeSvc(prisma).editPost('author', 'p1', { body: 'bổ sung thêm' }, 'CUSTOMER');
    expect((prisma.feedPost.update as jest.Mock).mock.calls[0][0].data.status).toBeUndefined();
  });
});

describe('CommunityFeedService.getComments', () => {
  it('trả comment kèm tên tác giả rút gọn theo thời gian tăng dần', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', body: 'hay', createdAt: new Date(), user: { fullName: 'Nguyễn Văn A' } },
    ]);
    const r = (await makeSvc(prisma).getComments('p1')).items;
    expect(r[0]).toMatchObject({ id: 'c1', body: 'hay', author: 'A N.' });
  });

  it('tên null → "Bạn Tubu"', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', body: 'hay', createdAt: new Date(), user: { fullName: null } },
    ]);
    const r = (await makeSvc(prisma).getComments('p1')).items;
    expect(r[0]).toMatchObject({ author: 'Bạn Tubu' });
  });

  it('viewerId trùng userId của comment → isOwner true', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', userId: 'u1', body: 'hay', createdAt: new Date(), user: { fullName: 'A' } },
    ]);
    const r = (await makeSvc(prisma).getComments('p1', 'u1')).items;
    expect(r[0]).toMatchObject({ isOwner: true });
  });

  it('viewerId khác userId của comment → isOwner false', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', userId: 'u1', body: 'hay', createdAt: new Date(), user: { fullName: 'A' } },
    ]);
    const r = (await makeSvc(prisma).getComments('p1', 'u2')).items;
    expect(r[0]).toMatchObject({ isOwner: false });
  });

  it('không truyền viewerId → isOwner false', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', userId: 'u1', body: 'hay', createdAt: new Date(), user: { fullName: 'A' } },
    ]);
    const r = (await makeSvc(prisma).getComments('p1')).items;
    expect(r[0]).toMatchObject({ isOwner: false });
  });

  it('bài REMOVED → NotFound (chặn đọc bình luận vòng qua bài đã gỡ, IDOR)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ status: 'REMOVED', userId: 'author' });
    await expect(makeSvc(prisma).getComments('p1', 'someone')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.feedComment.findMany).not.toHaveBeenCalled();
  });

  it('bài PENDING, viewer không phải chủ bài → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ status: 'PENDING', userId: 'author' });
    await expect(makeSvc(prisma).getComments('p1', 'someone-else')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bài PENDING, viewer là chủ bài → vẫn đọc được bình luận', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ status: 'PENDING', userId: 'author' });
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([]);
    await expect(makeSvc(prisma).getComments('p1', 'author')).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('bài không tồn tại → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(makeSvc(prisma).getComments('p1', 'someone')).rejects.toBeInstanceOf(NotFoundException);
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

  it('có client (giao dịch của người gọi) thì tạo bài bằng client đó, không dùng this.prisma', async () => {
    const prisma = makePrisma();
    const client = { feedPost: { create: jest.fn().mockResolvedValue({ id: 'p1' }) } };
    await makeSvc(prisma).createAchievementPost('u1', 'HARVEST', 'x', { treesPlanted: 2 }, client as never);
    expect(client.feedPost.create).toHaveBeenCalledTimes(1);
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
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

  it('tagSlugs hợp lệ → tạo Tag theo lô (slug ASCII, name giữ dấu) rồi postTag.createMany đúng thứ tự nhập', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const r = await makeSvc(prisma).createPost('u1', 'STAFF', {
      kind: 'TIP', body: 'mẹo hay', tagSlugs: ['Sen Đá', '#tuoi nuoc'],
    });
    expect(r).toEqual({ id: 'newpost', status: 'PUBLISHED' });
    expect(prisma.tag.upsert).not.toHaveBeenCalled();
    expect(prisma.tag.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.tag.createMany).toHaveBeenCalledWith({
      data: [{ slug: 'sen-da', name: 'Sen Đá' }, { slug: 'tuoi-nuoc', name: 'tuoi nuoc' }],
      skipDuplicates: true,
    });
    expect(prisma.tag.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.postTag.createMany).toHaveBeenCalledWith({
      data: [{ postId: 'newpost', tagId: 'tag-sen-da' }, { postId: 'newpost', tagId: 'tag-tuoi-nuoc' }],
      skipDuplicates: true,
    });
  });

  it('tagSlugs rỗng/không truyền → không gọi tag.upsert/postTag.createMany', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay' });
    expect(prisma.tag.createMany).not.toHaveBeenCalled();
    expect(prisma.tag.findMany).not.toHaveBeenCalled();
    expect(prisma.postTag.createMany).not.toHaveBeenCalled();
  });

  it('tagSlugs quá 5 → chỉ lấy tối đa 5 slug đầu', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    await makeSvc(prisma).createPost('u1', 'STAFF', {
      kind: 'TIP', body: 'mẹo hay', tagSlugs: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(prisma.tag.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.tag.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.postTag.createMany).toHaveBeenCalledWith({
      data: [
        { postId: 'newpost', tagId: 'tag-a' }, { postId: 'newpost', tagId: 'tag-b' },
        { postId: 'newpost', tagId: 'tag-c' }, { postId: 'newpost', tagId: 'tag-d' },
        { postId: 'newpost', tagId: 'tag-e' },
      ],
      skipDuplicates: true,
    });
  });

  it('hai nhãn cùng slug → một Tag (nhãn đầu giữ name), postTag gắn một lần', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay', tagSlugs: ['Sen Đá', 'sen da'] });
    expect(prisma.tag.createMany).toHaveBeenCalledWith({ data: [{ slug: 'sen-da', name: 'Sen Đá' }], skipDuplicates: true });
    expect(prisma.postTag.createMany).toHaveBeenCalledWith({
      data: [{ postId: 'newpost', tagId: 'tag-sen-da' }],
      skipDuplicates: true,
    });
  });

  it('tạo Tag lỗi → bài vẫn tạo (gắn tag không chặn đăng bài)', async () => {
    const prisma = makePrisma({ tag: { createMany: jest.fn().mockRejectedValue(new Error('boom')), findMany: jest.fn() } });
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

  // Bug fix: rào cản "đã mua 1 lần" (isTrusted) quá thấp — trước đây user isTrusted được
  // PUBLISHED thẳng dù nội dung chứa từ cấm/link ngoài. Match → ép PENDING (không chặn hẳn) để
  // admin còn duyệt tay, thay vì bỏ qua mọi bộ lọc chỉ vì tác giả đã từng mua 1 đơn.
  it('khách trusted (STAFF) NHƯNG nội dung chứa từ cấm → vẫn PENDING, KHÔNG thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'p1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).createPost('u1', 'STAFF', {
      kind: 'TIP', body: 'Kiếm tiền nhanh với vay nong lãi thấp, inbox ngay!',
    });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
    expect(reward.rewardPost).not.toHaveBeenCalled();
  });

  it('khách trusted (STAFF) NHƯNG có link ngoài domain lạ → vẫn PENDING', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'p1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).createPost('u1', 'STAFF', {
      kind: 'TIP', body: 'Xem thêm tại http://trung-thuong-fake.biz/claim nhé mọi người',
    });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
    expect(reward.rewardPost).not.toHaveBeenCalled();
  });

  it('khách trusted (STAFF) + link thuộc domain whitelist (tubutree.com) → vẫn PUBLISHED', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'p1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).createPost('u1', 'STAFF', {
      kind: 'TIP', body: 'Xem thêm sản phẩm tại https://tubutree.com/san-pham/cay-a',
    });
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
    expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'PENDING' }, data: { status: 'PUBLISHED' } });
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
    expect(prisma.feedPost.updateMany).not.toHaveBeenCalled();
    expect(reward.rewardPost).not.toHaveBeenCalled();
  });
  it('lượt duyệt thua cuộc đua (updateMany count 0: bài vừa bị từ chối/duyệt bởi người khác) → không thưởng, không báo, không đổi gì', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });
    (prisma.feedPost.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await expect(makeSvc(prisma, reward, notify).approvePost('p1')).resolves.toEqual({ ok: true });
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled();
    expect(reward.rewardPost).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.approvePost — bài bị ẩn/xoá chen vào giữa lúc đang thưởng', () => {
  const pending = { id: 'p1', userId: 'author', status: 'PENDING' };
  const raced = () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(pending);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ status: 'REMOVED' }]);
    (prisma.reputationEvent.findMany as jest.Mock).mockResolvedValue([{ amount: 5 }]);
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 5 });
    return prisma;
  };

  it('sau khi thưởng đọc lại thấy REMOVED → đảo điểm vừa cộng, rút tin cậy vừa gắn, KHÔNG báo "đã duyệt"', async () => {
    const prisma = raced();
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await expect(makeSvc(prisma, undefined, notify).approvePost('p1')).resolves.toEqual({ ok: true });

    expect(prisma.reputationEvent.create).toHaveBeenCalledWith({ data: { userId: 'author', amount: -5, reason: 'REVERSE_POST', refId: 'p1' } });
    expect(prisma.communityProfile.updateMany).toHaveBeenCalledWith({ where: { userId: 'author' }, data: { isTrusted: false } });
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('lần đọc lại phải đứng SAU mọi bước cộng điểm/thưởng/gắn tin cậy (để thấy việc gỡ của lượt chen vào)', async () => {
    const prisma = raced();
    const order: string[] = [];
    (prisma.communityProfile.upsert as jest.Mock).mockImplementation(async () => void order.push('upsert'));
    (prisma.$queryRaw as jest.Mock).mockImplementation(async () => {
      order.push('recheck');
      return [{ status: 'REMOVED' }];
    });
    const reward = { rewardPost: jest.fn(async () => void order.push('reward')), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };

    await makeSvc(prisma, reward).approvePost('p1');

    expect(order.indexOf('recheck')).toBeGreaterThan(order.lastIndexOf('reward'));
    expect(order.indexOf('recheck')).toBeGreaterThan(order.lastIndexOf('upsert'));
  });

  it('đọc lại vẫn PUBLISHED → báo "đã duyệt" như thường, không đảo gì', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(pending);
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).approvePost('p1');

    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_POST_APPROVED', { post_id: 'p1' });
    expect(prisma.communityProfile.updateMany).not.toHaveBeenCalled();
  });

  it('đảo điểm bù lỗi (không phải P2002) → vẫn rút tin cậy, không báo duyệt, ghi log error có postId và userId', async () => {
    const prisma = raced();
    (prisma.reputationEvent.create as jest.Mock).mockRejectedValue(new Error('db down'));
    const svc = makeSvc(prisma);
    const error = jest.spyOn((svc as unknown as { logger: { error: (m: string) => void } }).logger, 'error').mockImplementation(() => undefined);

    await expect(svc.approvePost('p1')).resolves.toEqual({ ok: true });

    expect(prisma.communityProfile.updateMany).toHaveBeenCalledWith({ where: { userId: 'author' }, data: { isTrusted: false } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('refId=p1'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('user=author'));
  });
});

describe('CommunityFeedService.approvePost (thông báo — non-fatal)', () => {
  it('duyệt bài PENDING → notify COMMUNITY_POST_APPROVED cho tác giả', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).approvePost('p1');
    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_POST_APPROVED', { post_id: 'p1' });
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
      { id: 'p1', kind: 'TIP', title: 't', body: 'b', createdAt: new Date('2026-07-01'), user: { fullName: 'Long' }, category: { name: 'Chăm sóc' } },
    ]);
    const r = await makeSvc(prisma).adminPending();
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ status: 'PENDING' });
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
    expect(r[0]).toMatchObject({ id: 'p1', author: 'Long', category: 'Chăm sóc' });
  });

  it('ảnh chờ duyệt trả đường dẫn kèm mã (không nhúng base64) và không đọc cột images thô', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', kind: 'TIP', title: 't', body: 'b', createdAt: new Date('2026-07-01'), user: { fullName: 'Long' }, category: null },
    ]);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      { postId: 'p1', count: 2, idx: 0, url: null, hash: 'b'.repeat(32) },
      { postId: 'p1', count: 2, idx: 1, url: 'https://res.cloudinary.com/a.jpg', hash: null },
    ]);
    const r = await makeSvc(prisma).adminPending();
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.select.images).toBeUndefined();
    expect(args.include).toBeUndefined();
    expect(r[0]!.images).toEqual([`/feed/posts/p1/images/0?v=${'b'.repeat(32)}`, 'https://res.cloudinary.com/a.jpg']);
  });

  it('tác giả không tên, không danh mục → "Bạn Tubu" / null', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', kind: 'TIP', title: null, body: 'b', createdAt: new Date(), user: { fullName: null }, category: null },
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
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isPinned: true }, select: { id: true } });
  });

  it('set isPinned false', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).pinPost('p1', false);
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isPinned: false }, select: { id: true } });
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

describe('slugifyTag (pure fn)', () => {
  it('nhãn có dấu tiếng Việt → slug ASCII thuần', () => {
    expect(slugifyTag('Sen Đá')).toBe('sen-da');
  });
  it('nhiều dấu + hoa/thường trộn lẫn → ASCII + thường + gạch nối', () => {
    expect(slugifyTag('Cây Trồng Ở Việt Nam')).toBe('cay-trong-o-viet-nam');
  });
  it('không dấu sẵn → giữ nguyên (chỉ thường hoá + gạch nối)', () => {
    expect(slugifyTag('tuoi nuoc')).toBe('tuoi-nuoc');
  });
  it('khoảng trắng thừa + ký tự lạ → cắt gọn, bỏ ký tự ngoài [a-z0-9-]', () => {
    expect(slugifyTag('  Đá & Sỏi!!  ')).toBe('da-soi');
  });
});

describe('containsBannedContent (pure fn)', () => {
  it('nội dung bình thường → false', () => {
    expect(containsBannedContent('Vườn nhà mình hôm nay xanh tốt quá')).toBe(false);
  });

  it('rỗng/undefined → false', () => {
    expect(containsBannedContent('')).toBe(false);
    expect(containsBannedContent(undefined as unknown as string)).toBe(false);
  });

  it('chứa từ cấm CÓ dấu (vd "cờ bạc") → true', () => {
    expect(containsBannedContent('Group cờ bạc đổi thưởng uy tín')).toBe(true);
  });

  it('chứa từ cấm KHÔNG dấu (vd "vay nong") → true (so khớp không phân biệt dấu)', () => {
    expect(containsBannedContent('Cần tiền gấp? Vay nong lãi thấp inbox ngay')).toBe(true);
  });

  it('chứa link ngoài domain lạ (không whitelist) → true', () => {
    expect(containsBannedContent('Xem thêm tại http://trung-thuong-fake.biz/claim')).toBe(true);
  });

  it('chứa link thuộc domain whitelist (tubutree.com) → false', () => {
    expect(containsBannedContent('Xem chi tiết sản phẩm tại https://tubutree.com/san-pham/cay-a')).toBe(false);
  });

  it('chứa link thuộc domain whitelist (zalo.me) → false', () => {
    expect(containsBannedContent('Nhắn mình qua https://zalo.me/0901234567 nhé')).toBe(false);
  });

  it('link whitelist nhưng là subdomain giả mạo (vd tubutree.com.evil.com) → true (không bị lừa)', () => {
    expect(containsBannedContent('Xem tại http://tubutree.com.evil.com/claim')).toBe(true);
  });

  // ENGAGE-16: so khớp chuỗi con làm bài hợp lệ về nhà cửa/mỹ phẩm rơi vào hàng chờ duyệt.
  it.each([
    'Gợi ý các món hàng gia dụng sinh học cho bếp nhỏ',
    'Dầu gội unisex mùi bạc hà dùng được cho cả nhà',
    'Cỏ bạc hà trồng chậu rất thơm',
    'Mẹo gia vị và hàng gia đình tiết kiệm',
    'Trà hoa cúc chữa mất ngủ, nước ép cà rốt giàu vitamin',
  ])('bài hợp lệ không bị coi là vi phạm: %s', (text) => {
    expect(containsBannedContent(text)).toBe(false);
  });

  it.each([
    ['Bán hàng giả giá rẻ inbox ngay', true],
    ['Hội nhóm cờ bạc online uy tín', true],
    ['Web sex miễn phí', true],
    ['Cần tiền gấp, vay nong ngay trong ngày', true],
    ['Tham gia đa cấp kiếm tiền triệu', true],
  ])('vi phạm thật vẫn bị bắt: %s', (text, expected) => {
    expect(containsBannedContent(text)).toBe(expected);
  });

  it('từ cấm phải đứng riêng một từ, không nằm lọt trong từ dài hơn', () => {
    expect(containsBannedContent('Sản phẩm unisex và sexy')).toBe(false);
    expect(containsBannedContent('Sex.')).toBe(true);
  });
});

// R2-ENGAGE-11 / ENGAGE-16: bỏ dấu làm "cả đó", "cả cuộc", "trúng thưởng" trùng từ cấm nên bài hợp lệ bị giữ chờ duyệt.
describe('containsBannedContent — câu tiếng Việt thường gặp không bị bắt nhầm (R2-ENGAGE-11)', () => {
  it.each([
    'Cả đó đều thích sản phẩm này',
    'Cả cuộc đời mình gắn bó với vườn rau',
    'Chúc mừng bạn đã trúng thưởng trong sự kiện ảnh đẹp của Tubu',
    'Mình vừa trúng thưởng vòng quay, cả nhà vui lắm',
    'Cả đó giờ mình chỉ dùng nước rửa chén sinh học',
  ])('bài hợp lệ: %s', (text) => {
    expect(containsBannedContent(text)).toBe(false);
  });

  it.each([
    'Hội nhóm cá độ bóng đá uy tín',
    'Nhận cá cược online, rút tiền ngay',
    'Nhận ca do bong da, tài xỉu',
    'ca cuoc bong da luc nao cung co keo',
    'Group CÁ ĐỘ đổi thưởng',
  ])('cờ bạc rõ ràng vẫn bị bắt: %s', (text) => {
    expect(containsBannedContent(text)).toBe(true);
  });

  it('danh sách do admin cấu hình thay được mặc định: bỏ từ, thêm từ, từ có dấu khớp đúng dấu, từ không dấu khớp cả hai', () => {
    expect(containsBannedContent('Hội nhóm cờ bạc', ['casino'])).toBe(false);
    expect(containsBannedContent('Mở casino online', ['casino'])).toBe(true);
    expect(containsBannedContent('Bán thuốc lá lậu', ['thuốc lá lậu'])).toBe(true);
    expect(containsBannedContent('Bán thuoc la lau', ['thuốc lá lậu'])).toBe(false);
    expect(containsBannedContent('Bán thuốc lá lậu', ['thuoc la lau'])).toBe(true);
  });

  it('link ngoài vẫn bị hạ cờ kể cả khi danh sách từ rỗng', () => {
    expect(containsBannedContent('xem http://spam.biz/x', [])).toBe(true);
  });
});

describe('CommunityFeedService — danh sách từ cấm lấy từ SystemConfig (R2-ENGAGE-11)', () => {
  it('createPost: bài "cả đó" của user tin cậy vẫn PUBLISHED', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).createPost('u1', 'STAFF', { body: 'Cả đó đều thích sản phẩm này' });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PUBLISHED');
  });

  it('createPost dùng community.banned_keywords do admin đặt (từ mới vào hàng chờ duyệt)', async () => {
    const prisma = makePrisma();
    const config = makeConfig({ 'community.banned_keywords': ['thuốc lá lậu'] });
    await makeSvc(prisma, undefined, undefined, config).createPost('u1', 'STAFF', { body: 'Bán thuốc lá lậu giá rẻ' });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('cấu hình sai kiểu (không phải mảng chuỗi) → dùng danh sách mặc định, không làm hỏng việc đăng bài', async () => {
    const prisma = makePrisma();
    const config = makeConfig({ 'community.banned_keywords': 'casino' });
    await makeSvc(prisma, undefined, undefined, config).createPost('u1', 'STAFF', { body: 'Mở casino online' });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
  });
});

describe('CommunityFeedService.bumpReputation', () => {
  it('ghi 1 dòng sổ cái ReputationEvent (khoá theo reason+refId) rồi mới cộng điểm', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 5 });
    await makeSvc(prisma).bumpReputation('u1', 5, 'POST', 'p1');
    expect(prisma.reputationEvent.create).toHaveBeenCalledWith({
      data: { userId: 'u1', amount: 5, reason: 'POST', refId: 'p1' },
    });
    expect(prisma.communityProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', reputation: 5, level: 1 },
      update: { reputation: { increment: 5 } },
    });
  });

  it('sau upsert → đọc lại reputation rồi cập nhật level tương ứng (2 bước)', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 210 });
    await makeSvc(prisma).bumpReputation('u1', 10, 'BEST_ANSWER', 'p1');
    expect(prisma.communityProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { reputation: true } });
    expect(prisma.communityProfile.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { level: 3 } });
  });

  it('đọc ngưỡng từ SystemConfig community.rep_thresholds (fallback [0,50,200,500])', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 15 });
    const config = makeConfig({ 'community.rep_thresholds': [0, 10, 20] });
    await makeSvc(prisma, undefined, undefined, config).bumpReputation('u1', 15, 'POST', 'p1');
    expect(config.get).toHaveBeenCalledWith('community.rep_thresholds', [0, 50, 200, 500]);
    expect(prisma.communityProfile.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { level: 2 } });
  });

  // P1-1 (docs/2026-09-08-review-progress.md): trước đây bumpReputation KHÔNG có trần —
  // bình luận liên tục là +2 rep/lần, ở 60 req/phút thì lên top bảng xếp hạng trong ~4 phút.
  it('vượt trần điểm/ngày → KHÔNG ghi sổ cái, KHÔNG cộng điểm', async () => {
    const prisma = makePrisma();
    (prisma.reputationEvent.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 28 } });
    const config = makeConfig({ 'community.daily_rep_cap': 30 });
    await makeSvc(prisma, undefined, undefined, config).bumpReputation('u1', 5, 'ANSWER', 'c9');
    expect(prisma.reputationEvent.create).not.toHaveBeenCalled();
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled();
  });

  it('còn dưới trần → vẫn cộng bình thường', async () => {
    const prisma = makePrisma();
    (prisma.reputationEvent.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 20 } });
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 25 });
    const config = makeConfig({ 'community.daily_rep_cap': 30 });
    await makeSvc(prisma, undefined, undefined, config).bumpReputation('u1', 5, 'ANSWER', 'c9');
    expect(prisma.reputationEvent.create).toHaveBeenCalled();
  });

  it('cộng lại cho CÙNG nguồn (reason+refId) → P2002 từ unique → bỏ qua êm, không throw', async () => {
    const prisma = makePrisma();
    (prisma.reputationEvent.create as jest.Mock).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(makeSvc(prisma).bumpReputation('u1', 5, 'POST', 'p1')).resolves.toBeUndefined();
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled();
  });

  it('thua race Serializable (P2034) → bỏ qua êm (điểm rep là trang trí, không phải tiền)', async () => {
    const prisma = makePrisma();
    (prisma.$transaction as jest.Mock).mockRejectedValue(Object.assign(new Error('serialize'), { code: 'P2034' }));
    await expect(makeSvc(prisma).bumpReputation('u1', 5, 'POST', 'p1')).resolves.toBeUndefined();
  });

  it('upsert lỗi thật → nuốt lỗi, KHÔNG throw (non-fatal)', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.upsert as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(makeSvc(prisma).bumpReputation('u1', 5, 'POST', 'p1')).resolves.toBeUndefined();
  });
});

describe('CommunityFeedService.deletePost — đảo điểm reputation đã cộng', () => {
  // P1-1: deletePost trước đây chỉ set status REMOVED. Farmer đăng bài lấy +5 rep rồi xoá sạch
  // → giữ nguyên điểm, không còn nội dung nào để ai kiểm chứng. Phải đảo lại đúng số đã cộng.
  it('xoá bài → ghi dòng đảo REVERSE_POST + trừ đúng tổng điểm đã cộng từ bài đó', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author' });
    (prisma.reputationEvent.findMany as jest.Mock).mockResolvedValue([
      { amount: 5, reason: 'POST', refId: 'p1' },
      { amount: 10, reason: 'BEST_ANSWER', refId: 'p1' },
    ]);
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 40 });
    await makeSvc(prisma).deletePost('author', 'CUSTOMER', 'p1');
    expect(prisma.reputationEvent.create).toHaveBeenCalledWith({
      data: { userId: 'author', amount: -15, reason: 'REVERSE_POST', refId: 'p1' },
    });
    expect(prisma.communityProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'author' }, data: { reputation: { decrement: 15 } } }),
    );
  });

  it('xoá bài chưa từng được cộng điểm → không ghi dòng đảo, không trừ', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author' });
    (prisma.reputationEvent.findMany as jest.Mock).mockResolvedValue([]);
    await makeSvc(prisma).deletePost('author', 'CUSTOMER', 'p1');
    expect(prisma.reputationEvent.create).not.toHaveBeenCalled();
  });

  it('đã có dòng đảo REVERSE_POST (gỡ lại lần 2) → KHÔNG trừ điểm lần 2', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author' });
    (prisma.reputationEvent.findFirst as jest.Mock).mockResolvedValue({ id: 'ev-reverse' });
    (prisma.reputationEvent.findMany as jest.Mock).mockResolvedValue([{ amount: 5, reason: 'POST', refId: 'p1' }]);
    await expect(makeSvc(prisma).deletePost('author', 'CUSTOMER', 'p1')).resolves.toEqual({ ok: true });
    expect(prisma.reputationEvent.create).not.toHaveBeenCalled();
    expect(prisma.communityProfile.update).not.toHaveBeenCalled();
  });

  it('đảo điểm lỗi → deletePost ném lỗi (cùng giao dịch với đổi trạng thái nên bài không bị gỡ nửa vời) và không báo tác giả', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author', status: 'PUBLISHED', title: 't', body: 'b' });
    (prisma.reputationEvent.findMany as jest.Mock).mockRejectedValue(new Error('db down'));
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await expect(makeSvc(prisma, undefined, notify).deletePost('admin1', 'ADMIN', 'p1')).rejects.toThrow('db down');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });
});

// P1-3 (docs/2026-09-08-review-progress.md): TOÀN BỘ bảng feed_comments trước đây chỉ có
// create/findMany/isAccepted — không có đường nào gỡ 1 bình luận. Hub kiểm duyệt chỉ hiện nút
// ẩn cho targetType='POST' vì backend không có endpoint cho COMMENT → bình luận bị báo cáo
// (chửi bới, lộ SĐT người khác) hiển thị vĩnh viễn, chính tác giả cũng không xoá được.
describe('CommunityFeedService.removeComment', () => {
  it('tác giả tự gỡ bình luận của mình → đánh dấu isRemoved', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', userId: 'me', postId: 'p1' });
    const r = await makeSvc(prisma).removeComment('me', 'CUSTOMER', 'c1');
    expect(r).toEqual({ ok: true });
    expect(prisma.feedComment.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isRemoved: true } });
  });

  it('ADMIN gỡ bình luận của người khác → được phép (đường xử lý báo cáo)', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', userId: 'someone', postId: 'p1' });
    await makeSvc(prisma).removeComment('admin', 'ADMIN', 'c1');
    expect(prisma.feedComment.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isRemoved: true } });
  });

  it('người ngoài gỡ bình luận của người khác → Forbidden, KHÔNG đụng DB', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', userId: 'someone', postId: 'p1' });
    await expect(makeSvc(prisma).removeComment('intruder', 'CUSTOMER', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.feedComment.update).not.toHaveBeenCalled();
  });

  it('bình luận không tồn tại → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(makeSvc(prisma).removeComment('me', 'CUSTOMER', 'cX')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gỡ bình luận đang là best-answer → bỏ luôn cờ isAccepted + bestCommentId của bài', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', userId: 'me', postId: 'p1', isAccepted: true });
    await makeSvc(prisma).removeComment('me', 'CUSTOMER', 'c1');
    expect(prisma.feedComment.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { isRemoved: true, isAccepted: false },
    });
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { bestCommentId: null }, select: { id: true } });
  });
});

describe('CommunityFeedService.getComments — lọc bình luận đã gỡ', () => {
  it('chỉ trả bình luận chưa bị gỡ (isRemoved: false)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ status: 'PUBLISHED', userId: 'author' });
    await makeSvc(prisma).getComments('p1');
    expect((prisma.feedComment.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ postId: 'p1', isRemoved: false });
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

  it('họ tên đầy đủ chỉ hiện tên kèm chữ cái đầu của họ (B-88)', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findMany as jest.Mock).mockResolvedValue([
      { reputation: 9, level: 1, user: { fullName: 'Nguyễn Thị Quay Lại', avatarUrl: null } },
      { reputation: 8, level: 1, user: { fullName: 'Đỗ Hương', avatarUrl: null } },
      { reputation: 7, level: 1, user: { fullName: '0912345678', avatarUrl: null } },
    ]);
    const r = await makeSvc(prisma).getLeaderboard();
    expect(r.map((x) => x.author)).toEqual(['Lại N.', 'Hương Đ.', 'Bạn Tubu']);
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
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 10 });
    await makeSvc(prisma).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(prisma.communityProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'answerer' },
      create: { userId: 'answerer', reputation: 10, level: 1 },
      update: { reputation: { increment: 10 } },
    });
  });

  it('chủ bài tự trả lời + tự chọn best (self-pick) → KHÔNG cộng reputation (chống farm hạng)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'author' });
    await makeSvc(prisma).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled();
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
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    const r = await makeSvc(prisma).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(r).toEqual({ ok: true });
  });

  it('bài ĐÃ có best-answer, chủ bài đổi sang comment khác → KHÔNG cộng rep lần 2 (chặn farm hạng bằng đổi qua đổi lại)', async () => {
    const prisma = makePrisma();
    // bestCommentId khác null → không phải lần chọn đầu tiên cho bài này.
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION', status: 'PUBLISHED', bestCommentId: 'c-old' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c2', postId: 'p1', userId: 'answerer2' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    await makeSvc(prisma, undefined, notify).setBestAnswer('author', 'CUSTOMER', 'p1', 'c2');
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
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
    const r = (await makeSvc(prisma).getComments('p1')).items;
    expect(r[0]).toMatchObject({ authorLevel: 2 });
    expect(r[1]).toMatchObject({ authorLevel: 1 });
  });
});

// ---------------------------------------------------------------------------
// Pha 4 Task 2 — CommunityEvent: sự kiện cộng đồng + thưởng người thắng
// ---------------------------------------------------------------------------

describe('CommunityFeedService.listEvents', () => {
  it('lấy sự kiện OPEN, sắp endAt tăng dần, take mặc định 20', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).listEvents();
    expect(prisma.communityEvent.findMany).toHaveBeenCalledWith({
      where: { status: 'OPEN' },
      orderBy: { endAt: 'asc' },
      take: 20,
    });
  });

  it('truyền take tuỳ biến → dùng take đó', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).listEvents(5);
    expect((prisma.communityEvent.findMany as jest.Mock).mock.calls[0][0].take).toBe(5);
  });
});

describe('CommunityFeedService.createEvent (admin)', () => {
  it('tạo sự kiện mới từ dto', async () => {
    const prisma = makePrisma();
    const dto = { title: 'Thi khoe vườn', description: 'Mô tả', startAt: new Date('2026-08-01'), endAt: new Date('2026-08-10'), rewardPoints: 30_000 };
    const r = await makeSvc(prisma).createEvent(dto);
    expect(prisma.communityEvent.create).toHaveBeenCalledWith({ data: dto });
    expect(r).toMatchObject({ id: 'ev1', title: 'Thi khoe vườn' });
  });

  // Quyết định C (docs/2026-10-18-launch-review/03-cau-hoi-sang.md): quà sự kiện 20.000-50.000 Điểm Xanh. 0 = sự kiện không quà.
  const eventDto = (rewardPoints?: number) => ({
    title: 'Thi khoe vườn', startAt: new Date('2026-08-01'), endAt: new Date('2026-08-10'),
    ...(rewardPoints === undefined ? {} : { rewardPoints }),
  });

  it.each([5_000, 19_999, 50_001, 1_000_000])('U4-29: rewardPoints %i nằm ngoài 20.000-50.000 → BadRequest tiếng Việt, không tạo', async (points) => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).createEvent(eventDto(points))).rejects.toThrow(/20\.000.*50\.000/);
    expect(prisma.communityEvent.create).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, 20_000, 50_000])('U4-29: rewardPoints %s (không quà hoặc trong khoảng) → tạo được', async (points) => {
    const prisma = makePrisma();
    await makeSvc(prisma).createEvent(eventDto(points));
    expect(prisma.communityEvent.create).toHaveBeenCalledTimes(1);
  });

  it('startAt >= endAt → BadRequest, không tạo', async () => {
    const prisma = makePrisma();
    const dto = { title: 'Thi khoe vườn', startAt: new Date('2026-08-10'), endAt: new Date('2026-08-01') };
    await expect(makeSvc(prisma).createEvent(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityEvent.create).not.toHaveBeenCalled();
  });

  it('startAt === endAt → BadRequest, không tạo', async () => {
    const prisma = makePrisma();
    const same = new Date('2026-08-01');
    const dto = { title: 'Thi khoe vườn', startAt: same, endAt: same };
    await expect(makeSvc(prisma).createEvent(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.communityEvent.create).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.closeEvent (admin)', () => {
  it('set status CLOSED', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).closeEvent('ev1');
    expect(prisma.communityEvent.update).toHaveBeenCalledWith({ where: { id: 'ev1' }, data: { status: 'CLOSED' } });
  });
});

describe('CommunityFeedService.pickWinner (admin)', () => {
  it('sự kiện không tồn tại → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(makeSvc(prisma).pickWinner('evX', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sự kiện đã CLOSED → BadRequest sớm, KHÔNG thưởng, KHÔNG updateMany (chống trả thưởng đôi)', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'ev1', rewardXu: 5000, rewardPoints: 5, status: 'CLOSED' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn(), rewardEventWinner: jest.fn() };
    await expect(makeSvc(prisma, reward).pickWinner('ev1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(reward.rewardEventWinner).not.toHaveBeenCalled();
    expect(prisma.communityEvent.updateMany).not.toHaveBeenCalled();
  });

  it('U4-B04: người không có bài PUBLISHED dự thi sự kiện → BadRequest tiếng Việt, KHÔNG thưởng, KHÔNG đóng sự kiện', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'ev1', rewardPoints: 30_000, status: 'OPEN' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'uat_marketing' });
    (prisma.feedPost.findFirst as jest.Mock).mockResolvedValue(null);
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn(), rewardEventWinner: jest.fn() };
    await expect(makeSvc(prisma, reward).pickWinner('ev1', 'uat_marketing')).rejects.toThrow(/dự thi/);
    expect(reward.rewardEventWinner).not.toHaveBeenCalled();
    expect(prisma.communityEvent.updateMany).not.toHaveBeenCalled();
    // cùng điều kiện với adminEventParticipants: bài đã duyệt, meta.eventId = sự kiện
    expect((prisma.feedPost.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
      userId: 'uat_marketing', status: 'PUBLISHED', meta: { path: ['eventId'], equals: 'ev1' },
    });
  });

  it('người dùng không tồn tại → NotFound, KHÔNG thưởng, KHÔNG updateMany', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'ev1', rewardXu: 5000, rewardPoints: 5, status: 'OPEN' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn(), rewardEventWinner: jest.fn() };
    await expect(makeSvc(prisma, reward).pickWinner('ev1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(reward.rewardEventWinner).not.toHaveBeenCalled();
    expect(prisma.communityEvent.updateMany).not.toHaveBeenCalled();
  });

  it('đua chốt: updateMany trả count 0 (kẻ thua) → BadRequest, KHÔNG thưởng', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'ev1', rewardXu: 5000, rewardPoints: 5, status: 'OPEN' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
    (prisma.communityEvent.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn(), rewardEventWinner: jest.fn() };
    await expect(makeSvc(prisma, reward).pickWinner('ev1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(reward.rewardEventWinner).not.toHaveBeenCalled();
  });

  it('chốt atomic (updateMany count 1) → set winnerUserId + CLOSED có điều kiện status OPEN, thưởng rewardPoints (Điểm Xanh), không đọc rewardXu cũ', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'ev1', rewardXu: 5000, rewardPoints: 5, status: 'OPEN' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
    (prisma.communityEvent.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn(), rewardEventWinner: jest.fn() };
    const r = await makeSvc(prisma, reward).pickWinner('ev1', 'u1');
    expect(prisma.communityEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'ev1', status: 'OPEN' },
      data: { winnerUserId: 'u1', status: 'CLOSED' },
    });
    expect(reward.rewardEventWinner).toHaveBeenCalledWith('u1', 'ev1', 5);
    expect(r).toEqual({ ok: true });
  });

  it('rewardEventWinner ném lỗi → pickWinner vẫn trả ok (non-fatal)', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'ev1', rewardXu: 5000, rewardPoints: 5, status: 'OPEN' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
    (prisma.communityEvent.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const reward = {
      rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn(),
      rewardEventWinner: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const r = await makeSvc(prisma, reward).pickWinner('ev1', 'u1');
    expect(r).toEqual({ ok: true });
    expect(prisma.communityEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'ev1', status: 'OPEN' },
      data: { winnerUserId: 'u1', status: 'CLOSED' },
    });
  });
});

// R2-ENGAGE-14: người thắng không được báo, quản trị phải dán userId thô, sự kiện đã đóng biến mất khỏi danh sách.
describe('CommunityFeedService.pickWinner — báo người thắng (R2-ENGAGE-14)', () => {
  const setup = (rewardPoints = 5) => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'ev1', title: 'Thi khoe vườn', rewardPoints, status: 'OPEN' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
    (prisma.communityEvent.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn(), rewardEventWinner: jest.fn() };
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    return { prisma, reward, notify, svc: makeSvc(prisma, reward, notify) };
  };

  it('chốt xong thì báo người thắng kèm tên sự kiện và số Điểm Xanh được thưởng', async () => {
    const { svc, notify } = setup(5);
    await svc.pickWinner('ev1', 'u1');
    expect(notify.notify).toHaveBeenCalledWith('u1', 'COMMUNITY_EVENT_WINNER', {
      title: 'Thi khoe vườn',
      reward: ' Bạn được thưởng 5 Điểm Xanh.',
    });
  });

  it('rewardEventWinner ném lỗi → câu báo KHÔNG hứa thưởng điểm', async () => {
    const { svc, reward, notify } = setup(5);
    reward.rewardEventWinner.mockRejectedValue(new Error('boom'));
    await svc.pickWinner('ev1', 'u1');
    expect(notify.notify).toHaveBeenCalledWith('u1', 'COMMUNITY_EVENT_WINNER', { title: 'Thi khoe vườn', reward: '' });
  });

  it('sự kiện không có thưởng điểm → câu báo không nhắc điểm', async () => {
    const { svc, notify } = setup(0);
    await svc.pickWinner('ev1', 'u1');
    expect(notify.notify).toHaveBeenCalledWith('u1', 'COMMUNITY_EVENT_WINNER', { title: 'Thi khoe vườn', reward: '' });
  });

  it('chốt thất bại (đã có người chốt) thì không báo ai', async () => {
    const { prisma, svc, notify } = setup();
    (prisma.communityEvent.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(svc.pickWinner('ev1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('gửi thông báo lỗi không làm hỏng việc chốt người thắng', async () => {
    const { svc, notify } = setup();
    notify.notify.mockRejectedValue(new Error('db'));
    await expect(svc.pickWinner('ev1', 'u1')).resolves.toEqual({ ok: true });
  });
});

describe('CommunityFeedService.adminEvents (R2-ENGAGE-14)', () => {
  it('mặc định chỉ sự kiện đang mở, sắp theo hạn chót gần nhất', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).adminEvents();
    const args = (prisma.communityEvent.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ status: 'OPEN' });
    expect(args.orderBy).toEqual({ endAt: 'asc' });
  });

  it('"CLOSED" → liệt kê sự kiện đã đóng, mới nhất trước, kèm tên + ảnh người thắng', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findMany as jest.Mock).mockResolvedValue([
      { id: 'ev1', title: 'Thi khoe vườn', status: 'CLOSED', winnerUserId: 'u1' },
      { id: 'ev2', title: 'Không chọn', status: 'CLOSED', winnerUserId: null },
    ]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', fullName: 'An', avatarUrl: 'a.jpg' }]);
    const r = await makeSvc(prisma).adminEvents('CLOSED');
    const args = (prisma.communityEvent.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ status: 'CLOSED' });
    expect(args.orderBy).toEqual({ endAt: 'desc' });
    expect(r[0]).toMatchObject({ id: 'ev1', winner: { id: 'u1', name: 'An', avatar: 'a.jpg' } });
    expect(r[1]).toMatchObject({ id: 'ev2', winner: null });
  });

  it('giá trị lạ → coi như đang mở (không lộ toàn bộ bảng)', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).adminEvents('whatever' as never);
    expect((prisma.communityEvent.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ status: 'OPEN' });
  });
});

describe('CommunityFeedService.adminEventParticipants (R2-ENGAGE-14)', () => {
  it('mỗi người dự thi một dòng (bài mới nhất) kèm tên, ảnh và số bài; chỉ bài PUBLISHED của sự kiện đó', async () => {
    const prisma = makePrisma();
    const at = (d: string) => new Date(`2026-10-${d}T00:00:00.000Z`);
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      { id: 'p3', userId: 'u1', title: 'Vườn ban công', body: 'Mới nhất của An', createdAt: at('03'), user: { fullName: 'An', avatarUrl: 'a.jpg' } },
      { id: 'p2', userId: 'u2', title: null, body: 'Bài của Bình khá dài '.repeat(10), createdAt: at('02'), user: { fullName: null, avatarUrl: null } },
      { id: 'p1', userId: 'u1', title: 'Bài cũ', body: 'cũ', createdAt: at('01'), user: { fullName: 'An', avatarUrl: 'a.jpg' } },
    ]);
    const r = await makeSvc(prisma).adminEventParticipants('ev1');
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ status: 'PUBLISHED', meta: { path: ['eventId'], equals: 'ev1' } });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ userId: 'u1', name: 'An', avatar: 'a.jpg', postId: 'p3', postTitle: 'Vườn ban công', postCount: 2 });
    expect(r[1]).toMatchObject({ userId: 'u2', name: 'Bạn Tubu', avatar: null, postId: 'p2', postCount: 1 });
    expect(r[1]!.postTitle.length).toBeLessThanOrEqual(81);
  });
});

describe('CommunityFeedService.eventPosts', () => {
  it('lọc bài PUBLISHED có meta.eventId khớp, take mặc định 20', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row({ meta: { eventId: 'ev1' } })]);
    const r = await makeSvc(prisma).eventPosts('ev1', 'u1');
    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({
      status: 'PUBLISHED',
      meta: { path: ['eventId'], equals: 'ev1' },
    });
    // take + 1 để biết còn trang sau mà không cần đếm riêng.
    expect(args.take).toBe(21);
    expect(r.posts[0]).toMatchObject({ id: 'p1' });
    expect(r.nextCursor).toBeNull();
  });

  it('truyền take tuỳ biến → dùng take đó', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([]);
    await makeSvc(prisma).eventPosts('ev1', 'u1', 5);
    expect((prisma.feedPost.findMany as jest.Mock).mock.calls[0][0].take).toBe(6);
  });

  it('viewerId trùng chủ bài → isOwner true trong kết quả', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row({ userId: 'u1', meta: { eventId: 'ev1' } })]);
    const r = await makeSvc(prisma).eventPosts('ev1', 'u1');
    expect(r.posts[0]).toMatchObject({ isOwner: true });
  });

  /**
   * Trần cứng 20 bài trước đây nghĩa là sự kiện 200 bài dự thi thì 180 bài không có đường nào
   * xem tới — kể cả admin lúc chấm giải.
   */
  it('còn trang sau → trả nextCursor, cắt đúng số bài yêu cầu', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      row({ id: 'p1', meta: { eventId: 'ev1' } }),
      row({ id: 'p2', meta: { eventId: 'ev1' } }),
      row({ id: 'p3', meta: { eventId: 'ev1' } }),
    ]);
    const r = await makeSvc(prisma).eventPosts('ev1', 'u1', 2);
    expect(r.posts).toHaveLength(2);
    expect(r.nextCursor).toBe('p2');
  });
});

describe('CommunityFeedService.createPost (eventId → meta)', () => {
  it('eventId hợp lệ (sự kiện tồn tại + OPEN) → set meta.eventId trên bài tạo', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'ev1',
      status: 'OPEN',
      startAt: new Date(Date.now() - 3600_000),
      endAt: new Date(Date.now() + 3600_000),
    });
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'SHOWCASE', body: 'Tham gia sự kiện', eventId: 'ev1' });
    expect(prisma.communityEvent.findUnique).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      select: { id: true, status: true, startAt: true, endAt: true },
    });
    const data = (prisma.feedPost.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ meta: { eventId: 'ev1' } });
  });

  it('không có eventId → không set meta, không query communityEvent', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay' });
    const data = (prisma.feedPost.create as jest.Mock).mock.calls[0][0].data;
    expect(data.meta).toBeUndefined();
    expect(prisma.communityEvent.findUnique).not.toHaveBeenCalled();
  });

  /**
   * App khoá nút nộp bài sau hạn, nhưng BE thì không: chỉ cần admin chưa bấm đóng sự kiện là
   * gọi thẳng API (hoặc dùng bản app cũ) vẫn nộp được bài muộn, và bài đó đủ tư cách được chọn
   * trúng giải kèm rewardXu.
   */
  it('sự kiện OPEN nhưng ĐÃ QUÁ HẠN nộp → BadRequest, không tạo bài', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'ev1',
      status: 'OPEN',
      startAt: new Date(Date.now() - 7 * 864e5),
      endAt: new Date(Date.now() - 864e5),
    });
    await expect(
      makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'SHOWCASE', body: 'Nộp muộn', eventId: 'ev1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });

  it('sự kiện CHƯA tới giờ mở → BadRequest', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'ev1',
      status: 'OPEN',
      startAt: new Date(Date.now() + 864e5),
      endAt: new Date(Date.now() + 7 * 864e5),
    });
    await expect(
      makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'SHOWCASE', body: 'Nộp sớm', eventId: 'ev1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('eventId không tồn tại → BadRequest, không tạo bài', async () => {
    const prisma = makePrisma(); // communityEvent.findUnique mặc định trả null
    await expect(
      makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'SHOWCASE', body: 'Tham gia', eventId: 'evX' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });

  it('eventId ứng với sự kiện đã CLOSED → BadRequest, không tạo bài', async () => {
    const prisma = makePrisma();
    (prisma.communityEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'ev1', status: 'CLOSED' });
    await expect(
      makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'SHOWCASE', body: 'Tham gia', eventId: 'ev1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.createPost (categoryId hợp lệ)', () => {
  it('categoryId tồn tại + isActive → tạo bài bình thường', async () => {
    const prisma = makePrisma();
    (prisma.communityCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'cat1', isActive: true });
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const r = await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay', categoryId: 'cat1' });
    expect(r).toEqual({ id: 'newpost', status: 'PUBLISHED' });
    expect(prisma.communityCategory.findUnique).toHaveBeenCalledWith({ where: { id: 'cat1' }, select: { id: true, isActive: true } });
  });

  it('không truyền categoryId → không query communityCategory', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    await makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay' });
    expect(prisma.communityCategory.findUnique).not.toHaveBeenCalled();
  });

  it('categoryId không tồn tại → BadRequest, không tạo bài', async () => {
    const prisma = makePrisma(); // communityCategory.findUnique mặc định trả null
    await expect(
      makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay', categoryId: 'catX' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });

  it('categoryId tồn tại nhưng isActive=false → BadRequest, không tạo bài', async () => {
    const prisma = makePrisma();
    (prisma.communityCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'cat1', isActive: false });
    await expect(
      makeSvc(prisma).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo hay', categoryId: 'cat1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService — tín hiệu ngược của kiểm duyệt', () => {
  describe('rejectPost chỉ nhận bài PENDING (CSKH thao tác song song với nhau và với duyệt)', () => {
    const pending = { id: 'p1', userId: 'author', status: 'PENDING', title: 'Bán hàng', body: 'nội dung' };

    it('PENDING → REMOVED bằng updateMany có điều kiện PENDING, báo tác giả đúng một lần', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(pending);
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await makeSvc(prisma, undefined, notify).rejectPost('p1', 'Có link');

      expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'PENDING' }, data: { status: 'REMOVED' } });
      expect(notify.notify).toHaveBeenCalledTimes(1);
    });

    it('bài đã PUBLISHED (vừa được duyệt) → 409 gợi ý dùng "Ẩn"; không đổi trạng thái, không báo "chưa được đăng"', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...pending, status: 'PUBLISHED' });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      const err = await makeSvc(prisma, undefined, notify).rejectPost('p1', 'x').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toContain('Ẩn');
      expect(prisma.feedPost.updateMany).not.toHaveBeenCalled();
      expect(notify.notify).not.toHaveBeenCalled();
    });

    it('bài đã REMOVED (từ chối lần hai) → idempotent, không báo lần hai', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...pending, status: 'REMOVED' });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await expect(makeSvc(prisma, undefined, notify).rejectPost('p1')).resolves.toEqual({ ok: true });

      expect(prisma.feedPost.updateMany).not.toHaveBeenCalled();
      expect(notify.notify).not.toHaveBeenCalled();
    });

    it('thua cuộc đua với lượt từ chối khác (count 0, bài giờ REMOVED) → ok, không báo, không rút tin cậy', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValueOnce(pending).mockResolvedValueOnce({ status: 'REMOVED' });
      (prisma.feedPost.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await expect(makeSvc(prisma, undefined, notify).rejectPost('p1')).resolves.toEqual({ ok: true });

      expect(notify.notify).not.toHaveBeenCalled();
      expect(prisma.communityProfile.updateMany).not.toHaveBeenCalled();
    });

    it('thua cuộc đua với lượt duyệt (count 0, bài giờ PUBLISHED) → 409 chứ không báo CSKH là đã từ chối', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValueOnce(pending).mockResolvedValueOnce({ status: 'PUBLISHED' });
      (prisma.feedPost.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await expect(makeSvc(prisma, undefined, notify).rejectPost('p1')).rejects.toBeInstanceOf(ConflictException);

      expect(notify.notify).not.toHaveBeenCalled();
    });
  });

  it('từ chối bài → rút cờ tin cậy của tác giả (một lần được duyệt không nên miễn kiểm duyệt vĩnh viễn)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });

    await makeSvc(prisma).rejectPost('p1');

    expect(prisma.communityProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'author' },
      data: { isTrusted: false },
    });
  });

  // ENGAGE-16: bài bị từ chối trước đây biến mất không một lời.
  it('từ chối bài → báo tác giả COMMUNITY_POST_REJECTED kèm tiêu đề và lý do', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING', title: 'Bán hàng', body: 'nội dung' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).rejectPost('p1', 'Có link ngoài không được phép');

    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_POST_REJECTED', {
      title: 'Bán hàng',
      reason: 'Có link ngoài không được phép',
    });
  });

  it('từ chối không nêu lý do → dùng lý do mặc định về nội quy; bài không tiêu đề lấy đầu nội dung', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({
      id: 'p1', userId: 'author', status: 'PENDING', title: null, body: 'Khoe vườn ban công mới trồng được ba tuần rồi mà cây lên rất đẹp luôn',
    });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).rejectPost('p1');

    const [, , data] = notify.notify.mock.calls[0];
    expect(data.reason).toBe('nội dung chưa phù hợp với nội quy cộng đồng');
    expect(data.title.length).toBeLessThanOrEqual(41);
    expect(data.title.startsWith('Khoe vườn ban công')).toBe(true);
  });

  it('gửi thông báo lỗi thì vẫn gỡ bài (thông báo là phụ)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING', title: 'x', body: 'y' });
    const notify = { notify: jest.fn().mockRejectedValue(new Error('down')) };

    await expect(makeSvc(prisma, undefined, notify).rejectPost('p1')).resolves.toEqual({ ok: true });
    expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'PENDING' }, data: { status: 'REMOVED' } });
  });

  it('ADMIN gỡ bài người khác → rút cờ tin cậy; tác giả TỰ xoá bài mình thì KHÔNG', async () => {
    const asAdmin = makePrisma();
    (asAdmin.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author' });
    await makeSvc(asAdmin).deletePost('admin1', 'ADMIN', 'p1');
    expect(asAdmin.communityProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'author' },
      data: { isTrusted: false },
    });

    const selfDelete = makePrisma();
    (selfDelete.feedPost.findUnique as jest.Mock).mockResolvedValue({ userId: 'author' });
    await makeSvc(selfDelete).deletePost('author', 'CUSTOMER', 'p1');
    expect(selfDelete.communityProfile.updateMany).not.toHaveBeenCalled();
  });

  it('gỡ bình luận → đảo điểm của NGƯỜI TRẢ LỜI theo refId = commentId', async () => {
    // Điểm ANSWER/BEST_ANSWER ghi theo commentId; đảo theo postId như cũ thì không khớp dòng nào.
    const prisma = makePrisma();
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({
      id: 'c1', userId: 'answerer', postId: 'p1', isAccepted: false,
    });
    (prisma.reputationEvent.findMany as jest.Mock).mockResolvedValue([{ amount: 2 }, { amount: 10 }]);
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 12 });

    await makeSvc(prisma).removeComment('admin1', 'ADMIN', 'c1');

    expect(prisma.reputationEvent.create).toHaveBeenCalledWith({
      data: { userId: 'answerer', amount: -12, reason: 'REVERSE_COMMENT', refId: 'c1' },
    });
  });
});

/**
 * targetId trước đây là chuỗi tuỳ ý, không kiểm tra gì: gửi 60 báo cáo/phút trỏ vào id bịa hoặc
 * vào bình luận của người khác ở bài khác là hàng chờ kiểm duyệt ngập id rác, mà hub admin chỉ
 * hiện đúng cái cuid đó — bấm "Ẩn nội dung" là gỡ nhầm nội dung lành.
 */
describe('CommunityFeedService.report — kiểm tra mục tiêu và chống trùng', () => {
  it('báo cáo id không tồn tại → NotFound, không tạo dòng rác trong hàng chờ', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      makeSvc(prisma).report('u1', { targetType: 'POST', targetId: 'bịa', reason: 'spam' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.communityReport.create).not.toHaveBeenCalled();
  });

  it('cùng người báo cáo cùng nội dung lần 2 → bỏ qua, không nhân bản hàng chờ', async () => {
    const prisma = makePrisma();
    (prisma.communityReport.findFirst as jest.Mock).mockResolvedValue({ id: 'r-old' });
    await expect(
      makeSvc(prisma).report('u1', { targetType: 'POST', targetId: 'p1', reason: 'spam' }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.communityReport.create).not.toHaveBeenCalled();
  });

  it('báo cáo bình luận → kiểm tra trong bảng bình luận, không phải bảng bài viết', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).report('u1', { targetType: 'COMMENT', targetId: 'c1', reason: 'xúc phạm' });
    expect(prisma.feedComment.findUnique).toHaveBeenCalledWith({ where: { id: 'c1' }, select: { id: true } });
  });
});

/**
 * Trước đây cắt cứng ở 50 bình luận và không có đường xem tiếp: câu hỏi hot 80 câu trả lời thì
 * 30 người đã được cộng xu/uy tín nhưng không ai đọc được nội dung của họ, trong khi con số đếm
 * vẫn nói 80.
 */
describe('CommunityFeedService.getComments — phân trang', () => {
  const mkRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      body: `b${i}`,
      userId: 'u1',
      isAccepted: false,
      createdAt: new Date(),
      user: { fullName: 'A', avatarUrl: null, role: 'CUSTOMER', communityProfile: { level: 1 } },
    }));

  it('còn trang sau → trả nextCursor và KHÔNG kèm phần tử thừa', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ status: 'PUBLISHED', userId: 'author' });
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue(mkRows(4)); // take = 3 + 1

    const r = await makeSvc(prisma).getComments('p1', 'u1', 3);

    expect(r.items).toHaveLength(3);
    expect(r.nextCursor).toBe('c2');
  });

  it('hết dữ liệu → nextCursor null', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ status: 'PUBLISHED', userId: 'author' });
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue(mkRows(2));

    const r = await makeSvc(prisma).getComments('p1', 'u1', 3);

    expect(r.nextCursor).toBeNull();
  });

  it('truyền cursor → query dùng cursor + skip 1 (không lặp bình luận cuối trang trước)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ status: 'PUBLISHED', userId: 'author' });
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([]);

    await makeSvc(prisma).getComments('p1', 'u1', 20, 'c9');

    const args = (prisma.feedComment.findMany as jest.Mock).mock.calls[0][0];
    expect(args.cursor).toEqual({ id: 'c9' });
    expect(args.skip).toBe(1);
  });

  it('take quá lớn → kẹp về 100 (không cho client tự ý kéo cả bảng)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ status: 'PUBLISHED', userId: 'author' });
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([]);

    await makeSvc(prisma).getComments('p1', 'u1', 5000);

    expect((prisma.feedComment.findMany as jest.Mock).mock.calls[0][0].take).toBe(101);
  });
});

// C-026: trần điểm reputation/ngày đếm từ 00:00 giờ VN dù host chạy UTC.
describe('CommunityFeedService.bumpReputation — đầu ngày theo giờ VN (C-026)', () => {
  it('01:30 ngày 10/3 giờ VN → aggregate từ 2026-03-09T17:00Z', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 5 });
    jest.useFakeTimers().setSystemTime(new Date('2026-03-09T18:30:00Z'));
    try {
      await makeSvc(prisma).bumpReputation('u1', 5, 'POST', 'p1');
    } finally {
      jest.useRealTimers();
    }
    const where = (prisma.reputationEvent.aggregate as jest.Mock).mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-03-09T17:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Launch review D4-006: báo tác giả khi bài (mọi loại) có bình luận / lượt thích, gộp theo bài
// ---------------------------------------------------------------------------

describe('CommunityFeedService — báo tác giả khi bài có tương tác (D4-006)', () => {
  const HOUR_MS = 3_600_000;
  const post = (over: Record<string, unknown> = {}) => ({
    id: 'p1', userId: 'author', kind: 'SHOWCASE', status: 'PUBLISHED', title: 'Góc ban công', body: 'Khoe cây mới trồng', ...over,
  });

  describe('thả tim', () => {
    it('người khác thả tim → báo chủ bài, gộp theo bài trong 1 giờ', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await makeSvc(prisma, undefined, notify).toggleReaction('u1', 'p1');

      expect(notify.notify).toHaveBeenCalledWith(
        'author',
        'COMMUNITY_POST_LIKED',
        { title: 'Góc ban công', post_id: 'p1' },
        { dedupeKey: 'post-like:p1', dedupeWithinMs: HOUR_MS },
      );
    });

    it('bài không tiêu đề → tên bài lấy đầu nội dung', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post({ title: null, body: 'Khoe vườn ban công mới trồng được ba tuần rồi mà cây lên rất đẹp luôn' }));
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await makeSvc(prisma, undefined, notify).toggleReaction('u1', 'p1');

      const [, , data] = notify.notify.mock.calls[0];
      expect(data.title.startsWith('Khoe vườn ban công')).toBe(true);
      expect(data.title.length).toBeLessThanOrEqual(41);
    });

    it('tự thả tim bài của mình, bỏ tim, hoặc thiết bị kia vừa thả (P2002) → KHÔNG báo', async () => {
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      const own = makePrisma();
      (own.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      await makeSvc(own, undefined, notify).toggleReaction('author', 'p1');

      const unlike = makePrisma();
      (unlike.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      (unlike.feedReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r1' });
      await makeSvc(unlike, undefined, notify).toggleReaction('u1', 'p1');

      const dup = makePrisma();
      (dup.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      (dup.feedReaction.create as jest.Mock).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      await makeSvc(dup, undefined, notify).toggleReaction('u1', 'p1');

      expect(notify.notify).not.toHaveBeenCalled();
    });

    it('notify ném lỗi → lượt thích vẫn thành công', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      const notify = { notify: jest.fn().mockRejectedValue(new Error('down')) };

      await expect(makeSvc(prisma, undefined, notify).toggleReaction('u1', 'p1')).resolves.toEqual({ liked: true });
    });
  });

  describe('bình luận', () => {
    it.each(['SHOWCASE', 'TIP', 'MANUAL', 'HARVEST'])('bài %s được bình luận → báo chủ bài kèm tên người bình luận', async (kind) => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post({ kind }));
      (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ fullName: 'Lan' });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await makeSvc(prisma, undefined, notify).addComment('u2', 'CUSTOMER', 'p1', 'đẹp quá');

      expect(notify.notify).toHaveBeenCalledTimes(1);
      expect(notify.notify).toHaveBeenCalledWith(
        'author',
        'COMMUNITY_POST_COMMENTED',
        { author: 'Lan', title: 'Góc ban công', post_id: 'p1' },
        { dedupeKey: 'post-comment:p1', dedupeWithinMs: HOUR_MS },
      );
    });

    it('QUESTION được trả lời vẫn chỉ nhận tin "trả lời" cũ, không nhận thêm tin bình luận', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post({ kind: 'QUESTION', title: 'Lá vàng?' }));
      (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await makeSvc(prisma, undefined, notify).addComment('u2', 'CUSTOMER', 'p1', 'tưới ít lại');

      expect(notify.notify.mock.calls.map((c) => c[1])).toEqual(['COMMUNITY_NEW_ANSWER']);
    });

    it('tự bình luận bài của mình → KHÔNG báo', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };

      await makeSvc(prisma, undefined, notify).addComment('author', 'CUSTOMER', 'p1', 'cập nhật thêm');

      expect(notify.notify).not.toHaveBeenCalled();
    });

    it('notify ném lỗi → bình luận vẫn tạo', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
      const notify = { notify: jest.fn().mockRejectedValue(new Error('down')) };

      await expect(makeSvc(prisma, undefined, notify).addComment('u2', 'CUSTOMER', 'p1', 'đẹp')).resolves.toEqual({ id: 'c1' });
    });
  });

  describe('khoá cấu hình community.author_notify_interval_minutes', () => {
    it('đổi 60 phút thành 15 phút → cửa sổ gộp 15 phút', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };
      const config = makeConfig({ 'community.author_notify_interval_minutes': 15 });

      await makeSvc(prisma, undefined, notify, config).toggleReaction('u1', 'p1');

      expect(notify.notify.mock.calls[0][3]).toEqual({ dedupeKey: 'post-like:p1', dedupeWithinMs: 15 * 60_000 });
    });

    it('0 = tắt tin tương tác (cả thích lẫn bình luận)', async () => {
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };
      const config = makeConfig({ 'community.author_notify_interval_minutes': 0 });

      const like = makePrisma();
      (like.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      await makeSvc(like, undefined, notify, config).toggleReaction('u1', 'p1');

      const comment = makePrisma();
      (comment.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      (comment.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
      await makeSvc(comment, undefined, notify, config).addComment('u2', 'CUSTOMER', 'p1', 'đẹp');

      expect(notify.notify).not.toHaveBeenCalled();
    });

    it('COMMUNITY_NEW_ANSWER dùng chung cửa sổ gộp: đổi 15 phút → dedupeWithinMs 15 phút, khoá theo bài', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...post(), kind: 'QUESTION' });
      (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ fullName: 'Long' });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };
      const config = makeConfig({ 'community.author_notify_interval_minutes': 15 });

      await makeSvc(prisma, undefined, notify, config).addComment('u2', 'CUSTOMER', 'p1', 'tưới ít lại');

      expect(notify.notify.mock.calls[0][1]).toBe('COMMUNITY_NEW_ANSWER');
      expect(notify.notify.mock.calls[0][3]).toEqual({ dedupeKey: 'post-answer:p1', dedupeWithinMs: 15 * 60_000 });
    });

    it('0 (tắt tin thích/bình luận) không nuốt tin câu trả lời: vẫn gửi, không gộp', async () => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...post(), kind: 'QUESTION' });
      (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ fullName: 'Long' });
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };
      const config = makeConfig({ 'community.author_notify_interval_minutes': 0 });

      await makeSvc(prisma, undefined, notify, config).addComment('u2', 'CUSTOMER', 'p1', 'tưới ít lại');

      expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_NEW_ANSWER', expect.any(Object));
      expect(notify.notify.mock.calls[0][3]).toBeUndefined();
    });

    it.each([-5, 'abc', null, 1.5, 99999])('giá trị sai %p → dùng mặc định 60 phút, không âm thầm tắt hay mở toang', async (bad) => {
      const prisma = makePrisma();
      (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(post());
      const notify = { notify: jest.fn().mockResolvedValue(undefined) };
      const config = makeConfig({ 'community.author_notify_interval_minutes': bad });

      await makeSvc(prisma, undefined, notify, config).toggleReaction('u1', 'p1');

      expect(notify.notify.mock.calls[0][3].dedupeWithinMs).toBe(HOUR_MS);
    });
  });
});

// ---------------------------------------------------------------------------
// Launch review D4-022: ẩn bài báo tác giả (kèm lý do)
// ---------------------------------------------------------------------------

describe('CommunityFeedService.hidePost — kiểm duyệt ẩn bài đã đăng (D4-003, D4-022)', () => {
  const published = { id: 'p1', userId: 'author', status: 'PUBLISHED', title: 'Bán hàng', body: 'nội dung' };

  it('bài không tồn tại → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(makeSvc(prisma).hidePost('pX')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ẩn bài → REMOVED, đảo điểm đã cộng, rút cờ tin cậy, báo tác giả kèm lý do', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(published);
    (prisma.reputationEvent.findMany as jest.Mock).mockResolvedValue([{ amount: 5 }]);
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ reputation: 5 });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await expect(makeSvc(prisma, undefined, notify).hidePost('p1', '  Có link bán hàng ngoài  ')).resolves.toEqual({ ok: true });

    expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'PUBLISHED' }, data: { status: 'REMOVED' } });
    expect(prisma.reputationEvent.create).toHaveBeenCalledWith({ data: { userId: 'author', amount: -5, reason: 'REVERSE_POST', refId: 'p1' } });
    expect(prisma.communityProfile.updateMany).toHaveBeenCalledWith({ where: { userId: 'author' }, data: { isTrusted: false } });
    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_POST_HIDDEN', { title: 'Bán hàng', reason: 'Có link bán hàng ngoài' });
  });

  it('không nêu lý do → dùng lý do mặc định về nội quy', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(published);
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).hidePost('p1');

    expect(notify.notify.mock.calls[0][2].reason).toBe('nội dung chưa phù hợp với nội quy cộng đồng');
  });

  it('bài đang PENDING → 409 gợi ý dùng "Từ chối": chưa từng đăng nên không nói "đã được ẩn", không đụng DB, không báo', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...published, status: 'PENDING' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    const err = await makeSvc(prisma, undefined, notify).hidePost('p1', 'x').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toContain('Từ chối');
    expect(prisma.feedPost.updateMany).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('bài đã REMOVED rồi → idempotent: không đảo điểm lần hai, không báo lại', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...published, status: 'REMOVED' });
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await expect(makeSvc(prisma, undefined, notify).hidePost('p1', 'x')).resolves.toEqual({ ok: true });

    expect(prisma.feedPost.updateMany).not.toHaveBeenCalled();
    expect(prisma.reputationEvent.create).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('hai lượt ẩn song song: lượt thua (updateMany count 0) không đảo điểm, không rút tin cậy, không báo lần hai', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(published);
    (prisma.feedPost.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.reputationEvent.findMany as jest.Mock).mockResolvedValue([{ amount: 5 }]);
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await expect(makeSvc(prisma, undefined, notify).hidePost('p1', 'x')).resolves.toEqual({ ok: true });

    expect(prisma.reputationEvent.create).not.toHaveBeenCalled();
    expect(prisma.communityProfile.updateMany).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('đảo điểm lỗi → hidePost ném lỗi (đổi trạng thái, đảo điểm, rút tin cậy cùng một giao dịch), không báo tác giả', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(published);
    (prisma.reputationEvent.findMany as jest.Mock).mockRejectedValue(new Error('db down'));
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await expect(makeSvc(prisma, undefined, notify).hidePost('p1', 'x')).rejects.toThrow('db down');

    expect(notify.notify).not.toHaveBeenCalled();
    expect(prisma.communityProfile.updateMany).not.toHaveBeenCalled();
  });

  it('báo tác giả lỗi → bài vẫn bị ẩn', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(published);
    const notify = { notify: jest.fn().mockRejectedValue(new Error('down')) };

    await expect(makeSvc(prisma, undefined, notify).hidePost('p1')).resolves.toEqual({ ok: true });
    expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'PUBLISHED' }, data: { status: 'REMOVED' } });
  });
});

describe('CommunityFeedService.deletePost — ADMIN gỡ bài người khác thì báo tác giả (D4-022)', () => {
  const row = { id: 'p1', userId: 'author', status: 'PUBLISHED', title: 'Bán hàng', body: 'nội dung' };

  it('hai ADMIN gỡ cùng lúc: lượt thua (updateMany count 0) không đảo điểm, không rút tin cậy, không báo lần hai', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(row);
    (prisma.feedPost.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.reputationEvent.findMany as jest.Mock).mockResolvedValue([{ amount: 5 }]);
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await expect(makeSvc(prisma, undefined, notify).deletePost('admin1', 'ADMIN', 'p1')).resolves.toEqual({ ok: true });

    expect(prisma.reputationEvent.create).not.toHaveBeenCalled();
    expect(prisma.communityProfile.updateMany).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('ADMIN gỡ bài của người khác → COMMUNITY_POST_HIDDEN với lý do mặc định', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(row);
    withPostStatus(prisma, 'PUBLISHED');
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).deletePost('admin1', 'ADMIN', 'p1');

    expect(notify.notify).toHaveBeenCalledWith('author', 'COMMUNITY_POST_HIDDEN', {
      title: 'Bán hàng',
      reason: 'nội dung chưa phù hợp với nội quy cộng đồng',
    });
  });

  it('ADMIN gỡ bài của người khác khi bài còn PENDING → báo "chưa được đăng" (REJECTED), không báo "đã ẩn" cho bài chưa từng đăng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row, status: 'PENDING' });
    withPostStatus(prisma, 'PENDING');
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).deletePost('admin1', 'ADMIN', 'p1');

    expect(notify.notify).toHaveBeenCalledTimes(1);
    expect(notify.notify.mock.calls[0][1]).toBe('COMMUNITY_POST_REJECTED');
  });

  it('loại tin theo trạng thái bài lúc CHUYỂN chứ không theo lúc đọc: đọc thấy PENDING nhưng người khác vừa duyệt → báo "đã ẩn", không báo "chưa được đăng"', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row, status: 'PENDING' });
    withPostStatus(prisma, 'PUBLISHED');
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).deletePost('admin1', 'ADMIN', 'p1');

    expect(notify.notify).toHaveBeenCalledTimes(1);
    expect(notify.notify.mock.calls[0][1]).toBe('COMMUNITY_POST_HIDDEN');
    expect((prisma.feedPost.updateMany as jest.Mock).mock.calls.map((c) => c[0].where)).toEqual([
      { id: 'p1', status: 'PENDING' },
      { id: 'p1', status: { not: 'REMOVED' } },
    ]);
  });

  it('đọc thấy PUBLISHED nhưng lúc chuyển bài vẫn PENDING → báo "chưa được đăng"', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ ...row, status: 'PUBLISHED' });
    withPostStatus(prisma, 'PENDING');
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).deletePost('admin1', 'ADMIN', 'p1');

    expect(notify.notify.mock.calls[0][1]).toBe('COMMUNITY_POST_REJECTED');
  });

  it('tác giả tự xoá bài của mình → KHÔNG báo', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(row);
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };

    await makeSvc(prisma, undefined, notify).deletePost('author', 'CUSTOMER', 'p1');

    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('báo lỗi → bài vẫn bị gỡ', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(row);
    withPostStatus(prisma, 'PUBLISHED');
    const notify = { notify: jest.fn().mockRejectedValue(new Error('down')) };

    await expect(makeSvc(prisma, undefined, notify).deletePost('admin1', 'ADMIN', 'p1')).resolves.toEqual({ ok: true });
    expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: { not: 'REMOVED' } }, data: { status: 'REMOVED' } });
  });
});

// ---------------------------------------------------------------------------
// Launch review D4-003: hàng chờ kiểm duyệt cho CSKH
// ---------------------------------------------------------------------------

describe('CommunityFeedService.adminPublished', () => {
  const postRow = (id: string, over: Record<string, unknown> = {}) => ({
    id, kind: 'SHOWCASE', title: 't', body: 'x'.repeat(300), isPinned: false, createdAt: new Date('2026-10-17T03:00:00Z'),
    user: { fullName: 'Long' }, category: { name: 'Khoe vườn' }, ...over,
  });

  it('chỉ bài PUBLISHED, ghim lên đầu rồi mới nhất trước, có con trỏ trang kế', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([postRow('a', { isPinned: true }), postRow('b'), postRow('c')]);
    (prisma.feedReaction.groupBy as jest.Mock).mockResolvedValue([{ postId: 'a', _count: { _all: 4 } }]);
    (prisma.feedComment.groupBy as jest.Mock).mockResolvedValue([{ postId: 'b', _count: { _all: 2 } }]);

    const r = await makeSvc(prisma).adminPublished(2);

    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ status: 'PUBLISHED' });
    // màn kiểm duyệt không trả ảnh nên không được kéo cột images về Node
    expect(args.include).toBeUndefined();
    expect(args.select.images).toBeUndefined();
    expect(args.select).toMatchObject({ id: true, kind: true, title: true, body: true, isPinned: true, createdAt: true });
    expect(args.orderBy).toEqual([{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(3);
    expect(r.nextCursor).toBe('b');
    expect(r.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.items[0]).toMatchObject({ author: 'Long', category: 'Khoe vườn', isPinned: true, likeCount: 4, commentCount: 0 });
    expect(r.items[1]).toMatchObject({ isPinned: false, likeCount: 0, commentCount: 2 });
    expect(r.items[0]!.excerpt.length).toBeLessThanOrEqual(200);
  });

  it('truyền cursor sang Prisma; tác giả không tên → "Bạn Tubu"', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([postRow('z', { user: { fullName: null }, category: null })]);

    const r = await makeSvc(prisma).adminPublished(30, 'cur1');

    const args = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0];
    expect(args.cursor).toEqual({ id: 'cur1' });
    expect(args.skip).toBe(1);
    expect(r.nextCursor).toBeNull();
    expect(r.items[0]).toMatchObject({ author: 'Bạn Tubu', category: null });
  });
});

describe('CommunityFeedService.adminUnanswered', () => {
  const NOW = new Date('2026-10-17T12:00:00Z');
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('câu hỏi chưa ai trả lời quá 24 giờ (mặc định), cũ nhất trước, kèm số giờ đã chờ', async () => {
    const prisma = makePrisma();
    const created = new Date('2026-10-16T06:00:00Z');
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'q1', title: 'Lá vàng?', excerpt: 'Cây bị vàng lá', createdAt: created, author: 'Lan', category: 'Hỏi đáp' }]);
    (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = queryRaw;

    const r = await makeSvc(prisma).adminUnanswered();

    expect(r).toEqual([{ id: 'q1', title: 'Lá vàng?', excerpt: 'Cây bị vàng lá', createdAt: created, author: 'Lan', category: 'Hỏi đáp', waitingHours: 30 }]);
    const sql = queryRaw.mock.calls[0]![0] as { values: unknown[]; strings: string[] };
    expect(sql.values[0]).toEqual(new Date('2026-10-16T12:00:00Z'));
  });

  it('khoá community.unanswered_alert_hours đổi ngưỡng; giá trị sai thì quay về 24', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma();
    (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = queryRaw;

    await makeSvc(prisma, undefined, undefined, makeConfig({ 'community.unanswered_alert_hours': 12 })).adminUnanswered();
    await makeSvc(prisma, undefined, undefined, makeConfig({ 'community.unanswered_alert_hours': 'abc' })).adminUnanswered();

    expect((queryRaw.mock.calls[0]![0] as { values: unknown[] }).values[0]).toEqual(new Date('2026-10-17T00:00:00Z'));
    expect((queryRaw.mock.calls[1]![0] as { values: unknown[] }).values[0]).toEqual(new Date('2026-10-16T12:00:00Z'));
  });
});

describe('B-109: tên công khai ở bài viết, bình luận và hàng chờ kiểm duyệt rút gọn như bảng xếp hạng', () => {
  const FULL = 'Nguyễn Thị Quay Lại';
  const SHORT = 'Lại N.';

  it('getFeed: người khác thấy "Lại N.", chính chủ thấy họ tên đầy đủ của mình', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      row({ id: 'a', userId: 'owner', user: { fullName: FULL, avatarUrl: null, role: 'CUSTOMER', communityProfile: { level: 1 } } }),
    ]);
    const other = await makeSvc(prisma).getFeed('someone-else', {});
    expect(other.posts[0]).toMatchObject({ author: SHORT, isOwner: false });
    expect(JSON.stringify(other)).not.toContain(FULL);
    const own = await makeSvc(prisma).getFeed('owner', {});
    expect(own.posts[0]).toMatchObject({ author: FULL, isOwner: true });
  });

  it('getFeed: tên đặt bằng số điện thoại không bao giờ lộ số, kể cả khi dùng định dạng +84 hoặc có dấu cách', async () => {
    for (const phoneName of ['0912345678', '+84 912 345 678', '0912.345.678', 'Long 0912345678', 'an@mail.com']) {
      const prisma = makePrisma();
      (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
        row({ userId: 'owner', user: { fullName: phoneName, avatarUrl: null, role: 'CUSTOMER', communityProfile: { level: 1 } } }),
      ]);
      const r = await makeSvc(prisma).getFeed('someone-else', {});
      expect(r.posts[0]!.author).toBe('Bạn Tubu');
      expect(JSON.stringify(r)).not.toMatch(/0912|\+84|an@mail/);
    }
  });

  it('getPost: người khác thấy tên rút gọn', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue(
      row({ userId: 'owner', user: { fullName: FULL, avatarUrl: null, role: 'CUSTOMER', communityProfile: { level: 1 } } }),
    );
    const r = await makeSvc(prisma).getPost('someone-else', 'p1');
    expect(r.author).toBe(SHORT);
  });

  it('getComments: người khác thấy tên rút gọn, chính chủ thấy tên đầy đủ, tên số điện thoại thành "Bạn Tubu"', async () => {
    const prisma = makePrisma();
    (prisma.feedComment.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', userId: 'u1', body: 'hay', createdAt: new Date(), user: { fullName: FULL } },
      { id: 'c2', userId: 'u2', body: 'tốt', createdAt: new Date(), user: { fullName: '0912345678' } },
    ]);
    const asOther = (await makeSvc(prisma).getComments('p1', 'viewer')).items;
    expect(asOther.map((c: any) => c.author)).toEqual([SHORT, 'Bạn Tubu']);
    const asOwner = (await makeSvc(prisma).getComments('p1', 'u1')).items;
    expect(asOwner[0]).toMatchObject({ author: FULL, isOwner: true });
    expect(asOwner[1]!.author).toBe('Bạn Tubu');
  });

  it('adminPending và adminPublished: tên tác giả rút gọn', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', kind: 'TIP', title: 't', body: 'b', isPinned: false, createdAt: new Date('2026-07-01'), user: { fullName: FULL }, category: null },
    ]);
    const pending = await makeSvc(prisma).adminPending();
    expect(pending[0]!.author).toBe(SHORT);
    const published = await makeSvc(prisma).adminPublished();
    expect(published.items[0]!.author).toBe(SHORT);
  });
});
