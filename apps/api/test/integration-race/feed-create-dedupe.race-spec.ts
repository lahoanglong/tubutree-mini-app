import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { createUser as makeUser, randCode, summarize, warmPool } from './helpers';

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

  it('sự kiện tạo nhầm rồi đóng, tạo lại đúng quà ngay sau đó → sự kiện mới, không trả cái đã đóng', async () => {
    const title = `Sự kiện đôi đóng ${Date.now()}`;
    const dto = { title, startAt: new Date('2027-02-01T00:00:00Z'), endAt: new Date('2027-02-10T00:00:00Z'), rewardPoints: 20_000 };
    const wrong = await feed.createEvent(dto);
    await feed.closeEvent(wrong.id);
    const again = await feed.createEvent({ ...dto, rewardPoints: 30_000 });
    expect(again.id).not.toBe(wrong.id);
    expect(again.status).toBe('OPEN');
    const sameAsClosed = await feed.createEvent(dto);
    expect(sameAsClosed.id).not.toBe(wrong.id);
  });

  it('tiêu đề chỉ khác khoảng trắng hai đầu → cùng sự kiện', async () => {
    const t = `Sự kiện đôi trim ${Date.now()}`;
    const dto = { startAt: new Date('2027-03-01T00:00:00Z'), endAt: new Date('2027-03-10T00:00:00Z') };
    const a = await feed.createEvent({ ...dto, title: t });
    const b = await feed.createEvent({ ...dto, title: `${t} ` });
    expect(b.id).toBe(a.id);
  });

  it('4 yêu cầu song song y hệt có cả thẻ #tag lẫn sản phẩm gắn → 1 bài, thẻ và sản phẩm gắn đủ', async () => {
    const u = await createUser(prisma);
    const code = randCode(8).toLowerCase();
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${code}`, brand: 'IT', slug: `it-sp-${code}`, name: `SP ${code}`, description: 'IT', basePrice: 1000, approvalStatus: 'APPROVED' },
    });
    const input = { kind: 'TIP' as const, body: `Có thẻ ${code}`, tagSlugs: [`sen-da-${code}`, `tuoi-nuoc-${code}`], productSlugs: [product.slug] };
    const res = await Promise.allSettled(Array.from({ length: 4 }, () => feed.createPost(u.id, 'CUSTOMER', input)));
    expect(summarize(res).errors).toEqual([]);
    const ids = new Set(res.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
    const posts = await prisma.feedPost.findMany({
      where: { userId: u.id },
      select: { id: true, tags: { select: { tag: { select: { slug: true } } } }, productTags: { select: { productId: true } } },
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.tags.map((t) => t.tag.slug).sort()).toEqual([`sen-da-${code}`, `tuoi-nuoc-${code}`]);
    expect(posts[0]!.productTags.map((t) => t.productId)).toEqual([product.id]);
    await prisma.feedPost.deleteMany({ where: { userId: u.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.tag.deleteMany({ where: { slug: { endsWith: `-${code}` } } });
  });

  it('thẻ mới chưa tồn tại tạo đồng thời bởi 2 người khác nhau → cả 2 bài có thẻ, chỉ 1 dòng tag', async () => {
    const [a, b] = [await createUser(prisma), await createUser(prisma)];
    const slug = `the-moi-${randCode(8).toLowerCase()}`;
    const mk = (uid: string) => feed.createPost(uid, 'CUSTOMER', { kind: 'TIP', body: `Bài ${uid}`, tagSlugs: [slug] });
    const res = await Promise.allSettled([mk(a.id), mk(b.id)]);
    expect(summarize(res).errors).toEqual([]);
    expect(await prisma.tag.count({ where: { slug } })).toBe(1);
    for (const u of [a, b]) {
      const p = await prisma.feedPost.findFirstOrThrow({ where: { userId: u.id }, select: { tags: { select: { tag: { select: { slug: true } } } } } });
      expect(p.tags.map((t) => t.tag.slug)).toEqual([slug]);
    }
    await prisma.tag.deleteMany({ where: { slug } });
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
