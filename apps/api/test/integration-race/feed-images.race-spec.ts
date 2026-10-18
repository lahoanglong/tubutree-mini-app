import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { OptionalJwtAuthGuard } from '../../src/common/guards/optional-jwt-auth.guard';
import { CommunityFeedController } from '../../src/modules/feed/community-feed.controller';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { createUser, randCode, warmPool } from './helpers';

interface Viewer {
  sub: string;
  role: string;
  staffPermissions?: string[];
}
interface Item {
  id: string;
  images: string[];
  imageCount: number;
}

/**
 * D6-05: GET /feed không nhúng ảnh base64. Chạy HTTP thật (có helmet như main.ts) trên Postgres thật: SQL tách ảnh
 * (unnest + md5 ngay trong DB) và quyền xem theo trạng thái bài mock Prisma không bắt được. Người xem giả lập bằng header
 * `x-test-user` (thay cho JwtStrategy, vốn cần passport).
 */
describe('Ảnh bài cộng đồng phục vụ qua endpoint riêng (real Postgres + HTTP)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let feed: CommunityFeedService;
  let base: string;
  const tag = randCode(6).toLowerCase();
  // ~500 nghìn ký tự base64 = ảnh nén thật của miniapp (trần nhận là 700 nghìn).
  const BYTES = 375_000;
  const JPEG = `data:image/jpeg;base64,${Buffer.alloc(BYTES, 7).toString('base64')}`;
  const WEBP = `data:image/webp;base64,${Buffer.from('webp-bytes').toString('base64')}`;
  const GIF = `data:image/gif;base64,${Buffer.from('gif-bytes').toString('base64')}`;
  const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
  const CLOUD = 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg';
  let categorySlug = '';
  let categoryId = '';
  let author: { id: string };
  let stranger: { id: string };
  let admin: { id: string };
  let cskh: { id: string };
  let kho: { id: string };

  const as = (u: { id: string }, role = 'CUSTOMER', staffPermissions?: string[]): Viewer => ({ sub: u.id, role, ...(staffPermissions ? { staffPermissions } : {}) });
  const get = (path: string, viewer?: Viewer) =>
    fetch(`${base}${path}`, { headers: viewer ? { 'x-test-user': JSON.stringify(viewer) } : {} });
  const post = (over: Record<string, unknown> = {}) =>
    prisma.feedPost.create({ data: { userId: author.id, body: `Bài IT ${tag}`, status: 'PUBLISHED', categoryId, ...over } });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      controllers: [CommunityFeedController],
      providers: [SystemConfigService, AnalyticsEventsService, { provide: CommunityRewardService, useValue: {} }, CommunityFeedService],
    })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.use((req: { headers: Record<string, string | string[] | undefined>; user?: unknown }, _res: unknown, next: () => void) => {
      const raw = req.headers['x-test-user'];
      if (typeof raw === 'string') req.user = JSON.parse(raw);
      next();
    });
    app.setGlobalPrefix('api');
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api`.replace('[::1]', 'localhost');
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    feed = moduleRef.get(CommunityFeedService);

    [author, stranger, admin, cskh, kho] = await Promise.all([
      createUser(prisma),
      createUser(prisma),
      createUser(prisma, { role: 'ADMIN' }),
      createUser(prisma, { role: 'STAFF' }),
      createUser(prisma, { role: 'STAFF' }),
    ]);
    categorySlug = `it-feedimg-${tag}`;
    categoryId = (await prisma.communityCategory.create({ data: { slug: categorySlug, name: `IT ảnh ${tag}` } })).id;
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({ where: { categoryId } });
    await prisma.communityCategory.deleteMany({ where: { id: categoryId } });
    await app?.close();
  });

  const listPage = async (viewer: Viewer) => {
    const res = await get(`/feed?category=${categorySlug}`, viewer);
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as { posts: Item[] } };
  };

  it('20 bài mỗi bài 1 ảnh ~500KB: JSON của GET /feed chỉ vài chục KB (trước đây ~10MB), ảnh tải riêng đúng byte', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => post({ body: `Bài đo ${i}`, images: [JPEG] })));
    const t0 = Date.now();
    const { status, text, body } = await listPage(as(stranger));
    const bytes = Buffer.byteLength(text);
    console.log(`MEASURE-AFTER posts=${body.posts.length} imageChars=${JPEG.length} responseBytes=${bytes} ms=${Date.now() - t0}`);
    expect(status).toBe(200);
    expect(body.posts).toHaveLength(20);
    expect(bytes).toBeLessThan(40_000);
    expect(text).not.toContain('base64');
    for (const p of body.posts) {
      expect(p.imageCount).toBe(1);
      expect(p.images).toHaveLength(1);
      expect(p.images[0]).toMatch(new RegExp(`^/feed/posts/${p.id}/images/0\\?v=[0-9a-f]{32}$`));
    }

    const img = await get(body.posts[0]!.images[0]!);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(img.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(img.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await img.arrayBuffer()).length).toBe(BYTES);
  });

  it('ảnh hỗn hợp: danh sách chỉ ảnh bìa, chi tiết đủ ảnh theo thứ tự; URL https giữ nguyên, Content-Type theo data URI', async () => {
    const p = await post({ images: [WEBP, CLOUD, GIF] });
    const list = (await listPage(as(stranger))).body.posts.find((x) => x.id === p.id)!;
    expect(list.imageCount).toBe(3);
    expect(list.images).toHaveLength(1);
    expect(list.images[0]).toContain(`/feed/posts/${p.id}/images/0?v=`);

    const detail = (await (await get(`/feed/${p.id}`, as(stranger))).json()) as Item;
    expect(detail.imageCount).toBe(3);
    expect(detail.images[1]).toBe(CLOUD);
    expect(detail.images[0]).toContain(`/images/0?v=`);
    expect(detail.images[2]).toContain(`/images/2?v=`);
    expect((await get(detail.images[0]!)).headers.get('content-type')).toBe('image/webp');
    expect((await get(detail.images[2]!)).headers.get('content-type')).toBe('image/gif');

    const coverIsUrl = await post({ images: [CLOUD, WEBP] });
    const row = (await listPage(as(stranger))).body.posts.find((x) => x.id === coverIsUrl.id)!;
    expect(row.images).toEqual([CLOUD]);
    expect(row.imageCount).toBe(2);
  });

  it('chỉ số ngoài khoảng, chỉ số không phải số nguyên, bài không có ảnh đó: 404 hoặc 400', async () => {
    const p = await post({ images: [WEBP] });
    expect((await get(`/feed/posts/${p.id}/images/1`)).status).toBe(404);
    expect((await get(`/feed/posts/${p.id}/images/6`)).status).toBe(404);
    expect((await get(`/feed/posts/${p.id}/images/99`)).status).toBe(404);
    expect((await get(`/feed/posts/${p.id}/images/-1`)).status).toBe(404);
    expect((await get(`/feed/posts/${p.id}/images/abc`)).status).toBe(400);
    expect((await get(`/feed/posts/khong-co-bai/images/0`)).status).toBe(404);
    expect((await get(`/feed/posts/${p.id}/images/0`)).status).toBe(200);
  });

  it('ảnh cũ không phải raster (SVG, URL) không bao giờ được phục vụ qua endpoint', async () => {
    const p = await post({ images: [SVG, CLOUD] });
    expect((await get(`/feed/posts/${p.id}/images/0`)).status).toBe(404);
    expect((await get(`/feed/posts/${p.id}/images/1`)).status).toBe(404);
  });

  it('bài PENDING: tác giả, ADMIN, STAFF CSKH/MARKETING xem được (không cache dùng chung); khách, người khác, STAFF KHO/KE_TOAN nhận 404', async () => {
    const p = await post({ status: 'PENDING', images: [WEBP] });
    const url = `/feed/posts/${p.id}/images/0`;
    for (const viewer of [as(author), as(admin, 'ADMIN'), as(cskh, 'STAFF', ['CSKH']), as(kho, 'STAFF', ['MARKETING'])]) {
      const res = await get(url, viewer);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('content-type')).toBe('image/webp');
    }
    for (const viewer of [undefined, as(stranger), as(kho, 'STAFF', ['KHO']), as(cskh, 'STAFF', ['KE_TOAN'])]) {
      expect((await get(url, viewer)).status).toBe(404);
    }
  });

  it('bài PENDING: đường dẫn trong chi tiết của tác giả và hàng chờ duyệt tự mở được bằng thẻ img (mã v), mã sai thì 404', async () => {
    const p = await post({ status: 'PENDING', images: [WEBP, GIF] });
    const own = (await (await get(`/feed/${p.id}`, as(author))).json()) as Item;
    expect(own.images).toHaveLength(2);
    expect((await get(own.images[0]!)).status).toBe(200);
    expect((await get(own.images[1]!)).headers.get('content-type')).toBe('image/gif');

    const pending = (await feed.adminPending()).find((x) => x.id === p.id)!;
    expect(pending.images).toEqual(own.images);
    expect(JSON.stringify(pending)).not.toContain('base64');

    const wrong = own.images[0]!.replace(/v=[0-9a-f]{32}/, `v=${'0'.repeat(32)}`);
    expect((await get(wrong)).status).toBe(404);
    // mã của ảnh 1 không mở ảnh 0
    const swapped = `/feed/posts/${p.id}/images/0?v=${own.images[1]!.split('v=')[1]}`;
    expect((await get(swapped)).status).toBe(404);
  });

  it('bài REMOVED: chỉ tác giả/CSKH/ADMIN; mã v cũ của bài từng PENDING không còn mở được', async () => {
    const p = await post({ status: 'PENDING', images: [WEBP] });
    const own = (await (await get(`/feed/${p.id}`, as(author))).json()) as Item;
    expect((await get(own.images[0]!)).status).toBe(200);
    await prisma.feedPost.update({ where: { id: p.id }, data: { status: 'REMOVED' } });
    expect((await get(own.images[0]!)).status).toBe(404);
    expect((await get(own.images[0]!, as(stranger))).status).toBe(404);
    expect((await get(own.images[0]!, as(author))).status).toBe(200);
    expect((await get(own.images[0]!, as(cskh, 'STAFF', ['CSKH']))).status).toBe(200);
  });

  it('bài được duyệt: cùng đường dẫn chuyển sang công khai; cache dài chỉ khi URL mang đúng mã v, còn lại cache ngắn', async () => {
    const p = await post({ status: 'PENDING', images: [WEBP] });
    const url = `/feed/posts/${p.id}/images/0`;
    expect((await get(url)).status).toBe(404);
    const own = (await (await get(`/feed/${p.id}`, as(author))).json()) as Item;
    await prisma.feedPost.update({ where: { id: p.id }, data: { status: 'PUBLISHED' } });

    const bare = await get(url);
    expect(bare.status).toBe(200);
    expect(bare.headers.get('cache-control')).toBe('private, max-age=300');
    const wrong = await get(`${url}?v=${'0'.repeat(32)}`);
    expect(wrong.status).toBe(200);
    expect(wrong.headers.get('cache-control')).toBe('private, max-age=300');
    const versioned = await get(own.images[0]!);
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });

  it('sửa ảnh bài thì mã v đổi (URL cũ không dính cache cũ)', async () => {
    const p = await post({ images: [WEBP] });
    const before = ((await (await get(`/feed/${p.id}`, as(stranger))).json()) as Item).images[0]!;
    await prisma.feedPost.update({ where: { id: p.id }, data: { images: [GIF] } });
    const after = ((await (await get(`/feed/${p.id}`, as(stranger))).json()) as Item).images[0]!;
    expect(after).not.toBe(before);
    expect((await get(after)).headers.get('content-type')).toBe('image/gif');
  });

  it('bài dự thi của sự kiện cũng chỉ trả đường dẫn ảnh bìa', async () => {
    const event = await prisma.communityEvent.create({
      data: { title: `IT sự kiện ${tag}`, startAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 86_400_000) },
    });
    try {
      const p = await post({ images: [JPEG, WEBP], meta: { eventId: event.id } });
      const res = await get(`/feed/events/${event.id}/posts`, as(stranger));
      const text = await res.text();
      const body = JSON.parse(text) as { posts: Item[] };
      expect(text).not.toContain('base64');
      expect(body.posts[0]).toMatchObject({ id: p.id, imageCount: 2 });
      expect(body.posts[0]!.images).toHaveLength(1);
    } finally {
      await prisma.feedPost.deleteMany({ where: { categoryId } });
      await prisma.communityEvent.delete({ where: { id: event.id } });
    }
  });

  it('bài không ảnh: images rỗng, imageCount 0', async () => {
    const p = await post({ images: [] });
    const row = (await listPage(as(stranger))).body.posts.find((x) => x.id === p.id)!;
    expect(row).toMatchObject({ images: [], imageCount: 0 });
  });
});
