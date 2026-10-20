import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { StorefrontQuestService } from '../../src/modules/storefront/storefront-quest.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * T14 (PD-3): mọi nguồn thưởng ngoài giới thiệu (nhiệm vụ gian hàng, cộng đồng) cấp Điểm Xanh lô
 * STANDARD; thưởng đã cấp bằng xu TRƯỚC gộp (dòng ở coin_transactions) không được cấp lại bằng điểm.
 * Postgres thật: RewardPointsService + các service gọi nó.
 */
describe('PD-3 nguồn thưởng chuyển sang Điểm Xanh (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let quests: StorefrontQuestService;
  let community: CommunityRewardService;
  let feed: CommunityFeedService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RewardPointsService,
        StorefrontQuestService,
        CommunityRewardService,
        CommunityFeedService,
        AnalyticsEventsService,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    quests = moduleRef.get(StorefrontQuestService);
    community = moduleRef.get(CommunityRewardService);
    feed = moduleRef.get(CommunityFeedService);
    await setConfig(prisma, 'community.best_answer_reward_points', 1);
    await setConfig(prisma, 'community.daily_best_answer_cap', 3);
    await setConfig(prisma, 'community.post_reward_points', 1);
    await setConfig(prisma, 'community.daily_post_reward_cap', 2);
  });

  afterAll(async () => {
    await setConfig(prisma, 'community.daily_post_reward_cap', 1);
    await moduleRef?.close();
  });

  async function standard(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true, coinsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    return { balance: u.pointsBalance, ledger: sum._sum.delta ?? 0, coins: u.coinsBalance };
  }

  /** CTV có gian hàng đã đăng (nhiệm vụ "publish" hoàn thành). */
  async function publishedCtv() {
    const user = await createUser(prisma, { role: 'AFFILIATE' });
    await prisma.storefront.create({
      data: { type: 'CTV', slug: `it-${randCode(10).toLowerCase()}`, title: 'Gian IT', ownerUserId: user.id, isPublished: true },
    });
    return user;
  }

  /** Dòng thưởng cũ ở sổ xu, như trước gộp (migration B đã quy số dư nên coinsBalance để 0). */
  async function legacyCoinRow(userId: string, delta: number, reason: string, refType: string, refId: string | null = null) {
    await prisma.coinTransaction.create({ data: { userId, delta, reason, refType, refId } });
  }

  it('(q1) nhiệm vụ đã nhận bằng xu trước gộp → listQuests báo đã nhận, claim trả alreadyClaimed, không cộng điểm', async () => {
    const user = await publishedCtv();
    await legacyCoinRow(user.id, 1000, 'STOREFRONT_QUEST:publish', 'QUEST');

    const list = await quests.listQuests(user.id);
    expect(list.quests.find((q) => q.code === 'publish')).toMatchObject({ done: true, claimed: true });
    expect(list.totalEarnedPoints).toBe(1000);

    const res = await quests.claimQuest(user.id, 'publish');
    expect(res).toMatchObject({ claimed: true, alreadyClaimed: true, rewardPoints: 1000, pointsBalance: 0 });
    expect(await standard(user.id)).toEqual({ balance: 0, ledger: 0, coins: 0 });
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id } })).toBe(0);
  });

  it('(q2) 5 lần nhận nhiệm vụ song song → đúng 1 dòng điểm STANDARD có hạn, số dư khớp sổ', async () => {
    const user = await publishedCtv();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => quests.claimQuest(user.id, 'publish')));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    const fresh = s.fulfilled.filter((r) => !r.value.alreadyClaimed);
    expect(fresh).toHaveLength(1);

    const rows = await prisma.pointsTransaction.findMany({
      where: { userId: user.id, refType: 'QUEST' },
      select: { delta: true, lot: true, expiresAt: true, reason: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 1000, lot: 'STANDARD', reason: 'STOREFRONT_QUEST:publish' });
    expect(rows[0]!.expiresAt).not.toBeNull();
    expect(await standard(user.id)).toEqual({ balance: 1000, ledger: 1000, coins: 0 });
    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(0);
  });

  it('(c1) bài đã thưởng best-answer bằng xu trước gộp → chọn lại best-answer (kể cả người khác) không cấp điểm', async () => {
    const author = await createUser(prisma);
    const old = await createUser(prisma);
    const other = await createUser(prisma);
    const postId = `post_${randCode(10)}`;
    await legacyCoinRow(old.id, 1000, `COMMUNITY_BEST:${postId}`, 'COMMUNITY', postId);

    await Promise.allSettled([
      community.rewardBestAnswer(old.id, author.id, postId),
      community.rewardBestAnswer(other.id, author.id, postId),
    ]);
    expect(await standard(old.id)).toEqual({ balance: 0, ledger: 0, coins: 0 });
    expect(await standard(other.id)).toEqual({ balance: 0, ledger: 0, coins: 0 });
    expect(await prisma.pointsTransaction.count({ where: { reason: `COMMUNITY_BEST:${postId}` } })).toBe(0);
  });

  it('(c2) trần ngày đếm HỢP hai sổ: 1 bài thưởng xu hôm nay + trần 2 → chỉ thêm 1 bài được điểm', async () => {
    const user = await createUser(prisma);
    await legacyCoinRow(user.id, 200, `COMMUNITY_POST:legacy_${randCode(6)}`, 'COMMUNITY');

    const posts = Array.from({ length: 4 }, () => `post_${randCode(10)}`);
    for (const p of posts) await community.rewardPost(user.id, p);
    expect(await standard(user.id)).toEqual({ balance: 1, ledger: 1, coins: 0 });
    expect(
      await prisma.pointsTransaction.count({ where: { userId: user.id, reason: { startsWith: 'COMMUNITY_POST:' } } }),
    ).toBe(1);
  });

  it('(c3) 5 lần đăng bài song song, trần 2 → không vượt trần, số dư khớp sổ', async () => {
    const user = await createUser(prisma);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => community.rewardPost(user.id, `post_${randCode(10)}`)),
    );
    expect(summarize(results).errors).toEqual([]);
    const st = await standard(user.id);
    expect(st.balance).toBe(st.ledger);
    expect(st.balance).toBeGreaterThanOrEqual(1);
    expect(st.balance).toBeLessThanOrEqual(2);
  });

  it('(e1) chọn người thắng sự kiện → +rewardPoints Điểm Xanh, rewardXu cũ bị bỏ qua; chọn song song chỉ 1 lần', async () => {
    const winner = await createUser(prisma);
    const event = await prisma.communityEvent.create({
      data: {
        title: 'Sự kiện IT',
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
        rewardXu: 50_000,
        rewardPoints: 50,
      },
    });
    await prisma.feedPost.create({
      data: { userId: winner.id, body: 'Bài dự thi IT', status: 'PUBLISHED', meta: { eventId: event.id } },
    });
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => feed.pickWinner(event.id, winner.id)));
    expect(summarize(results).fulfilled).toHaveLength(1);
    expect(await standard(winner.id)).toEqual({ balance: 50, ledger: 50, coins: 0 });
    expect(await prisma.coinTransaction.count({ where: { userId: winner.id } })).toBe(0);
  });

  it('(e2) người không có bài dự thi → 400, không có dòng COMMUNITY_EVENT_WIN, sự kiện vẫn OPEN', async () => {
    const outsider = await createUser(prisma);
    const event = await prisma.communityEvent.create({
      data: {
        title: 'Sự kiện IT không bài',
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
        rewardPoints: 50,
      },
    });
    await expect(feed.pickWinner(event.id, outsider.id)).rejects.toThrow('chưa có bài dự thi');
    expect(
      await prisma.pointsTransaction.count({ where: { userId: outsider.id, reason: { startsWith: 'COMMUNITY_EVENT_WIN:' } } }),
    ).toBe(0);
    const after = await prisma.communityEvent.findUniqueOrThrow({ where: { id: event.id }, select: { status: true, winnerUserId: true } });
    expect(after).toEqual({ status: 'OPEN', winnerUserId: null });
  });
});
