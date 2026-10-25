import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { createUser, warmPool } from './helpers';

/** Chia sẻ thành tích thu hoạch: hai lượt bấm song song cho cùng một mức cây chỉ sinh đúng một bài. */
describe('GameService.shareHarvest (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;

  beforeAll(async () => {
    const feedStub = {
      createAchievementPost: (userId: string, kind: 'HARVEST', body: string, meta?: object) =>
        prisma.feedPost.create({ data: { userId, kind, body, meta: meta as object } }),
    };
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        LoyaltyService,
        { provide: CommunityFeedService, useValue: feedStub },
        GameService,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const withTrees = async (treesPlanted: number, zaloId = `zalo_${Math.random().toString(36).slice(2)}`) => {
    const user = await createUser(prisma, { zaloId });
    await prisma.gameProfile.create({
      data: { userId: user.id, ecoImpact: { progress: 0, target: 60, treeType: 't', treesPlanted } },
    });
    return user;
  };
  const posts = (userId: string) => prisma.feedPost.count({ where: { userId, kind: 'HARVEST' } });

  it('6 lượt chia sẻ song song cùng mức cây → đúng 1 bài, các lượt còn lại báo đã chia sẻ', async () => {
    const user = await withTrees(2);
    const results = await Promise.all(Array.from({ length: 6 }, () => game.shareHarvest(user.id)));
    expect(results.filter((r) => !r.alreadyShared)).toHaveLength(1);
    expect(await posts(user.id)).toBe(1);
  });

  it('thu hoạch thêm cây (mức mới) thì chia sẻ được thêm một bài', async () => {
    const user = await withTrees(1);
    await game.shareHarvest(user.id);
    await prisma.gameProfile.update({
      where: { userId: user.id },
      data: { ecoImpact: { progress: 0, target: 60, treeType: 't', treesPlanted: 2 } },
    });
    const [a, b] = await Promise.all([game.shareHarvest(user.id), game.shareHarvest(user.id)]);
    expect([a, b].filter((r) => !r.alreadyShared)).toHaveLength(1);
    expect(await posts(user.id)).toBe(2);
  });

  it('guest → 403; chưa thu hoạch → 400; không tạo bài', async () => {
    const guest = await withTrees(2, `guest_${Math.random().toString(36).slice(2)}`);
    await expect(game.shareHarvest(guest.id)).rejects.toBeInstanceOf(ForbiddenException);
    const fresh = await withTrees(0);
    await expect(game.shareHarvest(fresh.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(await posts(guest.id)).toBe(0);
    expect(await posts(fresh.id)).toBe(0);
  });
});
