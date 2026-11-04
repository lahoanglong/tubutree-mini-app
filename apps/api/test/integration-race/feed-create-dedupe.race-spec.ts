import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { createUser, summarize, warmPool } from './helpers';

/** m5: bấm gửi đôi / mạng gửi lại POST /feed và POST /feed/events (song song) chỉ tạo một bản ghi. */
describe('Feed: gửi trùng đăng bài / tạo sự kiện (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let feed: CommunityFeedService;

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

  it('tạo sự kiện cùng tiêu đề + giờ 4 lần song song → 1 sự kiện', async () => {
    const title = `Sự kiện đôi ${Date.now()}`;
    const dto = { title, startAt: new Date('2027-01-01T00:00:00Z'), endAt: new Date('2027-01-10T00:00:00Z') };
    const res = await Promise.allSettled(Array.from({ length: 4 }, () => feed.createEvent(dto)));
    expect(summarize(res).errors).toEqual([]);
    expect(await prisma.communityEvent.count({ where: { title } })).toBe(1);
  });
});
