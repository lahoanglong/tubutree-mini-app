import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { createUser, randCode, setConfig, summarize } from './helpers';

/**
 * R6-SYNC-3 + R6-SYNC-6: thưởng bài cộng đồng khi duyệt song song.
 *  - pool 2 kết nối + cache config nguội: không được đọc config trong tx (cạn pool);
 *  - nhiều NGƯỜI KHÁC NHAU cùng được thưởng: không ai bị mất thưởng vì xung đột tuần tự hoá;
 *  - cùng 1 người nhiều bài: trần số lần/ngày vẫn giữ.
 */
describe('CommunityRewardService.rewardPost đồng thời (real Postgres)', () => {
  const BASE_URL = process.env.DATABASE_URL as string;
  let fixtures: PrismaClient;
  let db: PrismaService;
  let moduleRef: TestingModule | undefined;
  let community: CommunityRewardService;

  beforeAll(() => {
    fixtures = new PrismaClient({ datasourceUrl: BASE_URL });
    db = fixtures as unknown as PrismaService;
  });

  afterAll(async () => {
    await setConfig(db, 'community.daily_post_reward_cap', 1);
    await fixtures.$disconnect();
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    process.env.DATABASE_URL = BASE_URL;
  });

  async function build(poolQuery = '') {
    await setConfig(db, 'community.post_reward_points', 1);
    process.env.DATABASE_URL = `${BASE_URL}${poolQuery}`;
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RewardPointsService, CommunityRewardService],
    }).compile();
    await moduleRef.init();
    process.env.DATABASE_URL = BASE_URL;
    community = moduleRef.get(CommunityRewardService);
  }

  const rewarded = (userId: string) => fixtures.pointsTransaction.count({ where: { userId, refType: 'COMMUNITY' } });

  it('pool 2 kết nối, cache nguội: 6 người khác nhau cùng được thưởng, không ai mất', async () => {
    await setConfig(db, 'community.daily_post_reward_cap', 1);
    const list = await Promise.all(Array.from({ length: 6 }, () => createUser(db)));
    await build('&connection_limit=2&pool_timeout=4');

    const results = await Promise.allSettled(list.map((u) => community.rewardPost(u.id, `it-post-${randCode(8)}`)));
    expect(summarize(results).errors).toEqual([]);
    for (const u of list) expect(await rewarded(u.id)).toBe(1);
  });

  it('pool thường: 12 người khác nhau được duyệt song song, cả 12 đều nhận đúng 1 thưởng', async () => {
    await setConfig(db, 'community.daily_post_reward_cap', 1);
    const list = await Promise.all(Array.from({ length: 12 }, () => createUser(db)));
    await build();

    const results = await Promise.allSettled(list.map((u) => community.rewardPost(u.id, `it-post-${randCode(8)}`)));
    expect(summarize(results).errors).toEqual([]);
    for (const u of list) expect(await rewarded(u.id)).toBe(1);
  });

  it('cùng 1 người 6 bài song song, trần 2/ngày: đúng 2 thưởng, số dư khớp', async () => {
    await setConfig(db, 'community.daily_post_reward_cap', 2);
    const user = await createUser(db);
    await build();

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => community.rewardPost(user.id, `it-post-${randCode(8)}`)));
    expect(summarize(results).errors).toEqual([]);
    expect(await rewarded(user.id)).toBe(2);
    const row = await fixtures.user.findUniqueOrThrow({ where: { id: user.id }, select: { pointsBalance: true } });
    expect(row.pointsBalance).toBe(2);
  });

  it('trộn: 4 người, mỗi người 3 bài song song, trần 1/ngày: mỗi người đúng 1 thưởng', async () => {
    await setConfig(db, 'community.daily_post_reward_cap', 1);
    const list = await Promise.all(Array.from({ length: 4 }, () => createUser(db)));
    await build();

    const jobs = list.flatMap((u) => Array.from({ length: 3 }, () => community.rewardPost(u.id, `it-post-${randCode(8)}`)));
    const results = await Promise.allSettled(jobs);
    expect(summarize(results).errors).toEqual([]);
    for (const u of list) expect(await rewarded(u.id)).toBe(1);
  });
});
