import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { createUser, randCode, setConfig, summarize } from './helpers';

/**
 * R6-SYNC-3: Season Pass claim đọc SystemConfig (cache 60s nguội) BÊN TRONG transaction → mỗi tx giữ một
 * kết nối và xin thêm một kết nối nữa cho lần đọc config ⇒ pool nhỏ cạn (P2028). Ở đây pool Prisma của
 * service chỉ có 2 kết nối, module mới ⇒ cache config nguội, N lần nhận thưởng đồng thời.
 */
describe('SeasonPassService.claim với pool 2 kết nối, cache config nguội (real Postgres)', () => {
  const BASE_URL = process.env.DATABASE_URL as string;
  const N = 8;
  let fixtures: PrismaClient;
  let moduleRef: TestingModule | undefined;
  let prisma: PrismaService;
  let pass: SeasonPassService;
  const seasonId = `it-season-${randCode(6)}`;

  beforeAll(async () => {
    fixtures = new PrismaClient({ datasourceUrl: BASE_URL });
    await fixtures.season.create({
      data: { id: seasonId, name: 'IT', startAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 3600_000) },
    });
    await setConfig(fixtures as unknown as PrismaService, 'game.tank_capacity', 500);
    await setConfig(fixtures as unknown as PrismaService, 'loyalty.point_expire_months', 12);
    await setConfig(fixtures as unknown as PrismaService, 'seasonpass.tiers', [
      { xp: 0, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 5 } },
      { xp: 0, free: { type: 'POINTS', amount: 3 }, premium: { type: 'POINTS', amount: 5 } },
    ]);
  });

  afterAll(async () => {
    await fixtures.season.deleteMany({ where: { id: seasonId } });
    await fixtures.$disconnect();
  });

  async function coldModule() {
    process.env.DATABASE_URL = `${BASE_URL}&connection_limit=2&pool_timeout=4`;
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RewardPointsService, SeasonPassService],
    }).compile();
    await moduleRef.init();
    process.env.DATABASE_URL = BASE_URL;
    prisma = moduleRef.get(PrismaService);
    pass = moduleRef.get(SeasonPassService);
  }

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  async function users() {
    const list = await Promise.all(Array.from({ length: N }, () => createUser(fixtures as unknown as PrismaService)));
    await fixtures.userSeasonPass.createMany({ data: list.map((u) => ({ userId: u.id, seasonId, xp: 100 })) });
    return list;
  }

  it('N lần nhận thưởng bậc POINTS (free) đồng thời: tất cả thành công, mỗi người đúng 1 dòng điểm', async () => {
    const list = await users();
    await coldModule();

    const results = await Promise.allSettled(list.map((u) => pass.claim(u.id, 1, 'free')));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(s.fulfilled).toHaveLength(N);
    for (const u of list) {
      const rows = await fixtures.pointsTransaction.findMany({ where: { userId: u.id, refType: 'SEASONPASS' } });
      expect(rows).toHaveLength(1);
      const row = await fixtures.user.findUniqueOrThrow({ where: { id: u.id }, select: { pointsBalance: true } });
      expect(row.pointsBalance).toBe(3);
    }
    expect(prisma).toBeDefined();
  });

  it('N lần nhận thưởng bậc SEEDS (free) đồng thời: tất cả thành công, hạt giống đúng', async () => {
    const list = await users();
    await coldModule();

    const results = await Promise.allSettled(list.map((u) => pass.claim(u.id, 0, 'free')));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(s.fulfilled).toHaveLength(N);
    for (const u of list) {
      const gp = await fixtures.gameProfile.findUniqueOrThrow({ where: { userId: u.id } });
      expect(gp.totalSeeds).toBe(10);
    }
  });
});
