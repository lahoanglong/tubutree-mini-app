import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { createRealUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * Nhận thưởng chặng mùa (`SeasonPassService.claim`) CÙNG MỘT khách, nhiều yêu cầu cùng lúc (chạm đúp, hai máy, thử lại).
 * `season-pass-pool` chỉ chạy N khách khác nhau nên không bắt được nhận đôi cùng một bậc. Bảo vệ cần chứng minh: `updateMany`
 * lọc "mảng chưa có bậc này" khoá dòng `user_season_passes` nên lượt sau đọc lại điều kiện rồi thua; hai bậc khác nhau không
 * đè mảng `claimedFree` của nhau; giọt nước và Điểm Xanh chỉ cộng đúng theo số bậc đã nhận.
 */
describe('SeasonPassService.claim cùng khách song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let pass: SeasonPassService;
  const seasonId = `it-season-same-${randCode(6)}`;
  const ALREADY = 'Đã nhận rồi.';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RewardPointsService, SeasonPassService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    pass = moduleRef.get(SeasonPassService);
    await prisma.season.create({
      data: { id: seasonId, name: 'IT same user', startAt: new Date(Date.now() - 500), endAt: new Date(Date.now() + 3600_000) },
    });
    await setConfig(prisma, 'game.tank_capacity', 500);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    await setConfig(prisma, 'seasonpass.tiers', [
      { xp: 0, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 5 } },
      { xp: 0, free: { type: 'POINTS', amount: 3 }, premium: { type: 'POINTS', amount: 5 } },
      { xp: 0, free: { type: 'SEEDS', amount: 7 }, premium: { type: 'POINTS', amount: 5 } },
      { xp: 150, free: { type: 'SEEDS', amount: 5 }, premium: { type: 'POINTS', amount: 5 } },
    ]);
  });

  afterAll(async () => {
    await prisma?.season.deleteMany({ where: { id: seasonId } });
    await moduleRef?.close();
  });

  async function player() {
    const user = await createRealUser(prisma);
    await prisma.userSeasonPass.create({ data: { userId: user.id, seasonId, xp: 100 } });
    return user;
  }

  const passOf = (userId: string) => prisma.userSeasonPass.findUniqueOrThrow({ where: { userId_seasonId: { userId, seasonId } } });
  const pointsRows = (userId: string) => prisma.pointsTransaction.findMany({ where: { userId, refType: 'SEASONPASS' } });

  it('8 yêu cầu nhận cùng một bậc giọt nước (free, bậc 0): đúng 1 thành công, 7 báo đã nhận, giọt nước cộng đúng 1 lần', async () => {
    const user = await player();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => pass.claim(user.id, 0, 'free')));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(7);
    for (const e of s.errors) expect(e).toContain(ALREADY);
    expect((await passOf(user.id)).claimedFree).toEqual([0]);
    expect((await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } })).totalSeeds).toBe(10);
  });

  it('8 yêu cầu nhận cùng một bậc Điểm Xanh (free, bậc 1): đúng 1 thành công, đúng 1 dòng điểm, số dư 3', async () => {
    const user = await player();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => pass.claim(user.id, 1, 'free')));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(7);
    for (const e of s.errors) expect(e).toContain(ALREADY);
    expect(await pointsRows(user.id)).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { pointsBalance: true } })).pointsBalance).toBe(3);
    expect((await passOf(user.id)).claimedFree).toEqual([1]);
  });

  it('3 bậc khác nhau nhận cùng lúc, mỗi bậc 3 lần: cả 3 bậc được ghi (mảng không bị đè), giọt nước 10+7, điểm 3, mỗi bậc đúng một lần', async () => {
    const user = await player();
    const calls = [0, 1, 2].flatMap((tier) => Array.from({ length: 3 }, () => pass.claim(user.id, tier, 'free')));
    const results = await Promise.allSettled(calls);
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(3);
    for (const e of s.errors) expect(e).toContain(ALREADY);
    expect([...(await passOf(user.id)).claimedFree].sort()).toEqual([0, 1, 2]);
    expect((await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } })).totalSeeds).toBe(17);
    expect(await pointsRows(user.id)).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { pointsBalance: true } })).pointsBalance).toBe(3);
  });

  it('chưa đủ XP (bậc 3 cần 150, khách có 100): nhiều yêu cầu song song đều bị từ chối, không cộng thưởng và bậc không bị đánh dấu', async () => {
    const user = await player();
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => pass.claim(user.id, 3, 'free')));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(0);
    for (const e of s.errors) expect(e).toContain('Chưa đủ XP.');
    expect((await passOf(user.id)).claimedFree).toEqual([]);
    expect(await prisma.gameProfile.findUnique({ where: { userId: user.id } })).toBeNull();
  });
});
