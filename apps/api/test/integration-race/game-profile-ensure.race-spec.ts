import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { GameQuizService } from '../../src/modules/game/game-quiz.service';
import { GameEconomyService } from '../../src/modules/game/game-economy.service';
import type { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { createUser, summarize, warmPool } from './helpers';

/**
 * ENGAGE-2: Mini App mở tab Vườn Xanh bắn song song nhiều endpoint game (profile, quiz hôm nay, điểm danh...). Với
 * tài khoản mới, mỗi endpoint đều "ensure" gameProfile; findUnique-rồi-create không atomic nên request thua nhận P2002
 * (409 "Dữ liệu trùng") ngay ở lần mở đầu tiên. Chạy Postgres thật vì thứ phân xử là unique(userId).
 */
describe('tạo GameProfile lần đầu khi nhiều endpoint game chạy song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  let quiz: GameQuizService;
  let economy: GameEconomyService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService, GameQuizService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    quiz = moduleRef.get(GameQuizService);
    const seasonPass = { addXp: async () => undefined } as unknown as SeasonPassService;
    economy = new GameEconomyService(prisma, moduleRef.get(SystemConfigService), seasonPass, moduleRef.get(AnalyticsEventsService));
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('12 GET /game/profile song song cho user mới → cả 12 thành công, đúng 1 hàng gameProfile', async () => {
    const user = await createUser(prisma);
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => game.getProfile(user.id)));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(s.fulfilled).toHaveLength(12);
    expect(await prisma.gameProfile.count({ where: { userId: user.id } })).toBe(1);
  });

  it('profile + quiz hôm nay + điểm danh song song → không request nào dính P2002', async () => {
    const user = await createUser(prisma);
    const calls = [
      ...Array.from({ length: 4 }, () => game.getProfile(user.id)),
      ...Array.from({ length: 4 }, () => quiz.getTodayQuiz(user.id)),
      ...Array.from({ length: 4 }, () => economy.checkIn(user.id)),
    ];
    const s = summarize(await Promise.allSettled(calls));
    const p2002 = s.rejected.filter((r) => (r.reason as { code?: string }).code === 'P2002');
    expect(p2002).toEqual([]);
    expect(await prisma.gameProfile.count({ where: { userId: user.id } })).toBe(1);
  });
});
