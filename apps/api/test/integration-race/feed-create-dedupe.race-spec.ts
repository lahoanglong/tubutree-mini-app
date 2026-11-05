import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { createUser as makeUser, summarize, warmPool } from './helpers';

/** m5: bấm gửi đôi / mạng gửi lại POST /feed và POST /feed/events (song song) chỉ tạo một bản ghi. */
describe('Feed: gửi trùng đăng bài / tạo sự kiện (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let feed: CommunityFeedService;
  const userIds: string[] = [];
  const createUser = async (p: PrismaService) => {
    const u = await makeUser(p);
    userIds.push(u.id);
    return u;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        { provide: CommunityRewardService, useValue: { rewardPost: async () => undefined } },
        CommunityFeedService,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    feed = moduleRef.get(CommunityFeedService);
  });

  afterAll(async () => {
    // Bài chờ duyệt do spec này tạo không được nằm lại: hàng chờ duyệt của spec khác chỉ lấy 50 bài cũ nhất.
    if (prisma) {
      await prisma.feedPost.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.communityEvent.deleteMany({ where: { title: { startsWith: 'Sự kiện đôi' } } });
    }
    await moduleRef?.close();
  });

  it('một người gửi cùng bài 4 lần song song → 1 bài, cùng id trả về', async () => {
    const u = await createUser(prisma);
    const body = `Bài gửi đôi ${Date.now()}`;
    const res = await Promise.allSettled(
      Array.from({ length: 4 }, () => feed.createPost(u.id, 'CUSTOMER', { kind: 'TIP', body, title: 'Mẹo' })),
    );
    expect(summarize(res).errors).toEqual([]);
    const ids = new Set(res.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
    expect(await prisma.feedPost.count({ where: { userId: u.id, body } })).toBe(1);
  });

  it('nội dung khác nhau thì vẫn tạo đủ', async () => {
    const u = await createUser(prisma);
    const res = await Promise.allSettled(
      [1, 2, 3].map((i) => feed.createPost(u.id, 'CUSTOMER', { kind: 'TIP', body: `Khác nhau ${i}` })),
    );
    expect(summarize(res).errors).toEqual([]);
    expect(await prisma.feedPost.count({ where: { userId: u.id } })).toBe(3);
  });

  describe('khác một trường nội dung khách gửi thì là bài mới, không bị nuốt', () => {
    const base = { kind: 'TIP' as const, body: 'Cùng chú thích', images: ['https://res.cloudinary.com/a.jpg'] };
    const variants: [string, Record<string, unknown>][] = [
      ['ảnh khác', { images: ['https://res.cloudinary.com/b.jpg'] }],
      ['không ảnh', { images: [] }],
      ['loại bài khác', { kind: 'SHOWCASE' }],
      ['thẻ #tag khác', { tagSlugs: ['sen-da'] }],
      ['tiêu đề khác', { title: 'Tiêu đề mới' }],
    ];
    it.each(variants)('%s → 2 bài', async (_n, over) => {
      const u = await createUser(prisma);
      const first = await feed.createPost(u.id, 'CUSTOMER', { ...base });
      const second = await feed.createPost(u.id, 'CUSTOMER', { ...base, ...over });
      expect(second.id).not.toBe(first.id);
      expect(await prisma.feedPost.count({ where: { userId: u.id } })).toBe(2);
    });

    it('danh mục khác → 2 bài', async () => {
      const u = await createUser(prisma);
      const cat = await prisma.communityCategory.create({ data: { slug: `cat-${Date.now()}-${Math.random()}`, name: 'Mục' } });
      const first = await feed.createPost(u.id, 'CUSTOMER', { ...base });
      const second = await feed.createPost(u.id, 'CUSTOMER', { ...base, categoryId: cat.id });
      expect(second.id).not.toBe(first.id);
    });

    it('giống hệt (kể cả ảnh, thẻ) → trả bài cũ', async () => {
      const u = await createUser(prisma);
      const input = { ...base, tagSlugs: ['sen-da'] };
      const first = await feed.createPost(u.id, 'CUSTOMER', input);
      const again = await feed.createPost(u.id, 'CUSTOMER', input);
      expect(again.id).toBe(first.id);
    });
  });

  it('khách vãng lai có 2 bài ảnh chờ duyệt (chạm trần) gửi lại bài thứ 2 → nhận bài đó, không lỗi trần, số bài không đổi', async () => {
    const u = await createUser(prisma);
    const img = (n: number) => `data:image/png;base64,${'A'.repeat(200)}${n}`;
    const p1 = await feed.createPost(u.id, 'CUSTOMER', { kind: 'TIP', body: 'Bài 1', images: [img(1)] });
    const p2 = await feed.createPost(u.id, 'CUSTOMER', { kind: 'TIP', body: 'Bài 2', images: [img(2)] });
    await expect(feed.createPost(u.id, 'CUSTOMER', { kind: 'TIP', body: 'Bài 3', images: [img(3)] })).rejects.toThrow();
    const again = await feed.createPost(u.id, 'CUSTOMER', { kind: 'TIP', body: 'Bài 2', images: [img(2)] });
    expect(again.id).toBe(p2.id);
    expect(p1.id).not.toBe(p2.id);
    expect(await prisma.feedPost.count({ where: { userId: u.id } })).toBe(2);
  });

  it('tạo sự kiện cùng tiêu đề + giờ 4 lần song song → 1 sự kiện', async () => {
    const title = `Sự kiện đôi ${Date.now()}`;
    const dto = { title, startAt: new Date('2027-01-01T00:00:00Z'), endAt: new Date('2027-01-10T00:00:00Z') };
    const res = await Promise.allSettled(Array.from({ length: 4 }, () => feed.createEvent(dto)));
    expect(summarize(res).errors).toEqual([]);
    expect(await prisma.communityEvent.count({ where: { title } })).toBe(1);
  });
});
