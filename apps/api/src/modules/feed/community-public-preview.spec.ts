import { NotFoundException } from '@nestjs/common';
import { CommunityFeedService } from './community-feed.service';
import { CommunityFeedController } from './community-feed.controller';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PUBLIC_CACHE, PUBLIC_CACHE_POLICY_KEY } from '../../common/decorators/public-cache.decorator';
import { PUBLIC_PREVIEW_KINDS, PUBLIC_PREVIEW_POSTS, publicAuthorName, publicSnippet, publicTitle } from './community-public-preview';
import type { PrismaService } from '../../prisma/prisma.service';

// D5-07: khách chưa đăng nhập xem trước vài bài đã đăng (đọc, không đăng/thích/bình luận); cờ community.public_preview mặc định bật.
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    kind: 'TIP',
    title: 'Pha nước rửa chén từ vỏ bưởi',
    body: 'Vỏ bưởi ngâm giấm 2 tuần rồi lọc, dùng rất sạch dầu mỡ.',
    isPinned: false,
    createdAt: new Date('2026-10-10T03:00:00.000Z'),
    user: { fullName: 'Nguyễn Thị Lan', role: 'CUSTOMER' },
    category: { slug: 'meo-vat', name: 'Mẹo vặt', icon: '💡' },
    ...over,
  };
}

function makeSvc(flag: unknown, rows: unknown[] = [row()]) {
  const prisma = {
    feedPost: { findMany: jest.fn().mockResolvedValue(rows) },
    feedReaction: { groupBy: jest.fn().mockResolvedValue([{ postId: 'p1', _count: { _all: 4 } }]) },
    feedComment: { groupBy: jest.fn().mockResolvedValue([{ postId: 'p1', _count: { _all: 2 } }]) },
    $queryRaw: jest.fn().mockResolvedValue([{ postId: 'p1', count: 2, idx: 0, url: 'https://cdn.example/a.jpg', hash: null }]),
  };
  const config = { get: jest.fn(async (key: string, fallback?: unknown) => (key === 'community.public_preview' ? flag : fallback)) };
  const svc = new CommunityFeedService(prisma as unknown as PrismaService, {} as never, config as never, { record: jest.fn(), recordBestEffort: jest.fn() } as never);
  return { svc, prisma, config };
}

describe('CommunityFeedService.publicPreview', () => {
  it.each([[undefined], [false], ['true'], [1], [null]])('cờ %j: không phải boolean true thì 404 và không đọc bài nào', async (flag) => {
    const { svc, prisma } = makeSvc(flag);
    await expect(svc.publicPreview()).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.feedPost.findMany).not.toHaveBeenCalled();
  });

  it('cờ bật: chỉ bài đã đăng, chỉ loại do người dùng viết, ghim trước rồi mới nhất, đúng số bài xem trước', async () => {
    const { svc, prisma } = makeSvc(true);
    await svc.publicPreview();
    const args = prisma.feedPost.findMany.mock.calls[0]![0] as { where: unknown; orderBy: unknown; take: number; select: Record<string, unknown> };
    expect(args.where).toEqual({ status: 'PUBLISHED', kind: { in: [...PUBLIC_PREVIEW_KINDS] } });
    expect(PUBLIC_PREVIEW_KINDS).not.toContain('HARVEST');
    expect(PUBLIC_PREVIEW_KINDS).not.toContain('MILESTONE');
    expect(PUBLIC_PREVIEW_KINDS).not.toContain('SPECIES');
    expect(args.orderBy).toEqual([{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(PUBLIC_PREVIEW_POSTS);
  });

  it('không truy vấn cột cá nhân: không meta, userId, avatar, phản ứng của người xem', async () => {
    const { svc, prisma } = makeSvc(true);
    await svc.publicPreview();
    const { select } = prisma.feedPost.findMany.mock.calls[0]![0] as { select: { user: { select: Record<string, unknown> } } & Record<string, unknown> };
    for (const col of ['meta', 'userId', 'reactions', 'status', 'bestCommentId']) expect(select).not.toHaveProperty(col);
    expect(select.user.select).toEqual({ fullName: true, role: true });
  });

  it('trả đúng danh sách trường công khai, không rò avatar, id người đăng, trạng thái, cờ của người xem', async () => {
    const { svc } = makeSvc(true, [row({ userId: 'u-secret', meta: { garden: 'x' }, status: 'PUBLISHED', user: { fullName: 'Nguyễn Thị Lan', role: 'CUSTOMER', avatarUrl: 'https://cdn/a.png' } })]);
    const out = await svc.publicPreview();
    expect(out.posts).toHaveLength(1);
    expect(Object.keys(out.posts[0]!).sort()).toEqual(
      ['author', 'badge', 'category', 'commentCount', 'createdAt', 'id', 'image', 'isPinned', 'kind', 'likeCount', 'snippet', 'title'].sort(),
    );
    expect(out.posts[0]).toMatchObject({
      id: 'p1', kind: 'TIP', author: 'Lan', badge: null, likeCount: 4, commentCount: 2, image: 'https://cdn.example/a.jpg',
      category: { slug: 'meo-vat', name: 'Mẹo vặt', icon: '💡' },
    });
    expect(JSON.stringify(out)).not.toMatch(/u-secret|avatar|garden|Nguyễn/);
  });

  it('tiêu đề cũng che số điện thoại và email người dùng tự gõ, không chỉ đoạn đầu bài', async () => {
    const { svc } = makeSvc(true, [row({ title: 'Cần mua sỉ, gọi 0901 234 567 hoặc lan@gmail.com' })]);
    const out = await svc.publicPreview();
    expect(out.posts[0]!.title).toBe('Cần mua sỉ, gọi … hoặc …');
    expect(JSON.stringify(out)).not.toMatch(/0901|gmail/);
  });

  it('chưa có bài nào: trả danh sách rỗng chứ không lỗi', async () => {
    const { svc } = makeSvc(true, []);
    expect(await svc.publicPreview()).toEqual({ posts: [] });
  });

  it('huy hiệu chuyên gia của nhân viên/quản trị vẫn hiện', async () => {
    const { svc } = makeSvc(true, [row({ user: { fullName: 'Tubu Tree', role: 'ADMIN' } })]);
    expect((await svc.publicPreview()).posts[0]!.badge).toBe('EXPERT');
  });
});

describe('publicAuthorName', () => {
  it('chỉ lấy tên gọi (từ cuối), không lộ họ tên đầy đủ', () => {
    expect(publicAuthorName('Nguyễn Thị Lan')).toBe('Lan');
    expect(publicAuthorName('  Minh  ')).toBe('Minh');
  });
  it('thiếu tên, tên chứa số/email (người dùng gõ SĐT hay email làm tên): dùng tên chung', () => {
    expect(publicAuthorName(null)).toBe('Bạn Tubu');
    expect(publicAuthorName('')).toBe('Bạn Tubu');
    expect(publicAuthorName('0901234567')).toBe('Bạn Tubu');
    expect(publicAuthorName('Lan 0901234567')).toBe('Bạn Tubu');
    expect(publicAuthorName('lan@gmail.com')).toBe('Bạn Tubu');
  });
});

describe('publicSnippet', () => {
  it('gộp xuống dòng, cắt ở 160 ký tự kèm …', () => {
    expect(publicSnippet('Dòng một\n\nDòng   hai')).toBe('Dòng một Dòng hai');
    const long = publicSnippet('a'.repeat(300));
    expect(long).toHaveLength(161);
    expect(long.endsWith('…')).toBe(true);
  });
  it('che số điện thoại và email người dùng tự gõ trong bài', () => {
    expect(publicSnippet('Gọi mình 0901 234 567 nhé')).toBe('Gọi mình … nhé');
    expect(publicSnippet('Zalo 090.123.4567 hoặc +84 90 123 4567')).toBe('Zalo … hoặc …');
    expect(publicSnippet('mail lan@gmail.com nha')).toBe('mail … nha');
    expect(publicSnippet('Ngâm 2 tuần, dùng 100ml')).toBe('Ngâm 2 tuần, dùng 100ml');
  });
});

describe('publicTitle', () => {
  it('không có tiêu đề (bài thường không đặt tiêu đề) vẫn là null', () => {
    expect(publicTitle(null)).toBeNull();
    expect(publicTitle(undefined)).toBeNull();
    expect(publicTitle('   ')).toBeNull();
  });
  it('che số điện thoại, email, gộp khoảng trắng; tiêu đề thường giữ nguyên', () => {
    expect(publicTitle('Pha nước rửa chén từ vỏ bưởi')).toBe('Pha nước rửa chén từ vỏ bưởi');
    expect(publicTitle('  Ai có 0901.234.567   không  ')).toBe('Ai có … không');
    expect(publicTitle('+84 90 123 4567')).toBe('…');
    expect(publicTitle('mail lan@gmail.com')).toBe('mail …');
  });
});

describe('CommunityFeedController — xem trước công khai', () => {
  const meta = (h: keyof CommunityFeedController, key: string) => Reflect.getMetadata(key, CommunityFeedController.prototype[h]);

  it('route xem trước công khai và cache được; mọi thao tác đọc chi tiết/ghi vẫn cần đăng nhập', () => {
    expect(meta('publicPreview', IS_PUBLIC_KEY)).toBe(true);
    const policy = meta('publicPreview', PUBLIC_CACHE_POLICY_KEY) as keyof typeof PUBLIC_CACHE;
    // Nội dung người dùng viết cần gỡ nhanh khi kiểm duyệt hoặc tắt cờ: proxy giữ tối đa 60 giây (STATIC là 300).
    expect(policy).toBe('USER_CONTENT');
    expect(PUBLIC_CACHE[policy]).toMatch(/s-maxage=60$/);
    for (const h of ['getFeed', 'getPost', 'comments', 'createPost', 'react', 'addComment', 'report'] as const) {
      expect(meta(h, IS_PUBLIC_KEY)).toBeUndefined();
    }
  });

  it('khai báo trước @Get(":id") để không bị :id nuốt', () => {
    const order = Object.getOwnPropertyNames(CommunityFeedController.prototype);
    expect(order.indexOf('publicPreview')).toBeLessThan(order.indexOf('getPost'));
  });
});
