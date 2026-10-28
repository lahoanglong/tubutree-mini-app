import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { createUser, summarize, warmPool } from './helpers';

/**
 * Chọn người thắng sự kiện: đóng sự kiện và cộng Điểm Xanh cùng một giao dịch. Cộng lỗi thì sự kiện vẫn OPEN
 * (trước đây đóng trước, cộng lỗi chỉ ghi warn nên người thắng mất thưởng mà không chọn lại được).
 */
describe('CommunityFeedService.pickWinner (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let feed: CommunityFeedService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, RewardPointsService, CommunityRewardService, CommunityFeedService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    feed = moduleRef.get(CommunityFeedService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup(rewardPoints: number, entrants = 1) {
    const event = await prisma.communityEvent.create({
      data: { title: 'Thi khoe vườn IT', startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000), rewardPoints },
    });
    const users = await Promise.all(Array.from({ length: entrants }, () => createUser(prisma)));
    for (const u of users) {
      await prisma.feedPost.create({ data: { userId: u.id, body: 'Bài dự thi IT', status: 'PUBLISHED', meta: { eventId: event.id } } });
    }
    return { event, users };
  }
  const eventRow = (id: string) => prisma.communityEvent.findUniqueOrThrow({ where: { id } });
  const wins = (eventId: string) => prisma.pointsTransaction.findMany({ where: { refType: 'COMMUNITY', reason: { startsWith: `COMMUNITY_EVENT_WIN:${eventId}:` } } });

  it('chốt thành công: sự kiện CLOSED, điểm vào sổ và số dư, rewarded true', async () => {
    const { event, users } = await setup(5);
    const [winner] = users;
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: winner!.id } })).pointsBalance;

    await expect(feed.pickWinner(event.id, winner!.id)).resolves.toEqual({ ok: true, rewarded: true });

    expect(await eventRow(event.id)).toMatchObject({ status: 'CLOSED', winnerUserId: winner!.id });
    const rows = await wins(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: winner!.id, delta: 5 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: winner!.id } })).pointsBalance).toBe(before + 5);
  });

  it('cộng điểm lỗi (số điểm vượt trần cấp) → sự kiện vẫn OPEN, không dòng sổ nào, chọn lại được sau khi sửa số điểm', async () => {
    const { event, users } = await setup(2_000_001);
    const [winner] = users;

    await expect(feed.pickWinner(event.id, winner!.id)).rejects.toBeDefined();
    expect(await eventRow(event.id)).toMatchObject({ status: 'OPEN', winnerUserId: null });
    expect(await wins(event.id)).toHaveLength(0);

    await prisma.communityEvent.update({ where: { id: event.id }, data: { rewardPoints: 5 } });
    await expect(feed.pickWinner(event.id, winner!.id)).resolves.toEqual({ ok: true, rewarded: true });
    expect(await eventRow(event.id)).toMatchObject({ status: 'CLOSED', winnerUserId: winner!.id });
    expect(await wins(event.id)).toHaveLength(1);
  });

  it('sự kiện không có thưởng: vẫn đóng, không dòng sổ, rewarded false', async () => {
    const { event, users } = await setup(0);
    await expect(feed.pickWinner(event.id, users[0]!.id)).resolves.toEqual({ ok: true, rewarded: false });
    expect(await eventRow(event.id)).toMatchObject({ status: 'CLOSED' });
    expect(await wins(event.id)).toHaveLength(0);
  });

  it('hai quản trị chọn hai người khác nhau cùng lúc: đúng một người thắng và đúng một khoản thưởng', async () => {
    const { event, users } = await setup(5, 2);

    const results = await Promise.allSettled(users.map((u) => feed.pickWinner(event.id, u.id)));

    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(1);
    const row = await eventRow(event.id);
    expect(row.status).toBe('CLOSED');
    const rows = await wins(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(row.winnerUserId);
  });
});
