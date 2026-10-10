import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { GameService } from '../../src/modules/game/game.service';
import { createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * C-043: trần lượt quay/ngày (game.spin_buy_daily_limit) dưới N request đồng thời trên Postgres thật.
 * Giải thưởng chỉ có NONE để số dư cuối tất định (chỉ trừ phí quay).
 */
describe('GameService.spin daily limit race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;

  const LIMIT = 3;
  const COST = 10;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, GameService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);

    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'game.spin_buy_cost_points', COST);
    await setConfig(prisma, 'game.spin_buy_daily_limit', LIMIT);
    await setConfig(prisma, 'game.spin_prizes', [{ id: 'none', name: 'Chúc may mắn', weight: 1, rewardType: 'NONE', value: 0 }]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('10 lượt quay song song của 1 user, trần 3/ngày → đúng 3 lượt, trừ đúng 3 lần phí, 7 lỗi 400', async () => {
    const user = await createUser(prisma, { pointsBalance: 1000 });

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => game.spin(user.id)));
    const s = summarize(results);

    const spins = await prisma.gameSpin.count({ where: { userId: user.id } });
    const costRows = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'GAME_SPIN_COST' } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    console.log('[spin-limit] fulfilled=%d rejected=%d spins=%d errors=%j', s.fulfilled.length, s.rejected.length, spins, [...new Set(s.errors)]);

    expect(s.fulfilled).toHaveLength(LIMIT);
    expect(s.rejected).toHaveLength(10 - LIMIT);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(spins).toBe(LIMIT);
    expect(costRows).toHaveLength(LIMIT);
    expect(after.pointsBalance).toBe(1000 - LIMIT * COST);
  });

  it('lượt quay của hôm qua (giờ VN) không tính vào trần hôm nay', async () => {
    const user = await createUser(prisma, { pointsBalance: 1000 });
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000);
    await prisma.gameSpin.createMany({
      data: Array.from({ length: LIMIT }, () => ({
        userId: user.id,
        prizeId: 'none',
        prizeName: 'cũ',
        rewardType: 'NONE',
        spunAt: yesterday,
      })),
    });

    const results = await Promise.allSettled(Array.from({ length: LIMIT + 2 }, () => game.spin(user.id)));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(LIMIT);
    expect(s.rejected).toHaveLength(2);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsBalance).toBe(1000 - LIMIT * COST);
  });
});
