import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { GameQuizService } from '../../src/modules/game/game-quiz.service';
import { createRealUser, randCode, setConfig, summarize } from './helpers';

/** Trần câu đố/ngày giữ khi các câu KHÁC nhau gửi song song, và chỉ nhận câu thuộc bộ hôm nay. */
describe('GameQuizService.answerQuiz song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let quiz: GameQuizService;
  const tag = randCode(6).toLowerCase();
  const ids = Array.from({ length: 20 }, (_, i) => `it_${tag}_${String(i).padStart(2, '0')}`);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, GameQuizService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    quiz = moduleRef.get(GameQuizService);
    await setConfig(prisma, 'game.quiz_daily_count', 5);
    await setConfig(prisma, 'game.quiz_wrong_seeds', 2);
    await setConfig(prisma, 'game.tank_capacity', 5000);
    await prisma.gameQuiz.createMany({
      data: ids.map((id) => ({ id, question: `Câu ${id}`, options: ['A', 'B'], correct: 1, rewardPts: 0, waterReward: 8 })),
    });
  });

  afterAll(async () => {
    await prisma.gameQuiz.deleteMany({ where: { id: { in: ids } } });
    await moduleRef.close();
  });

  it('20 câu khác nhau gửi song song: đúng 5 lượt được ghi và cộng nước, câu ngoài bộ hôm nay bị từ chối rõ ràng', async () => {
    const u = await createRealUser(prisma);
    const today = (await quiz.getTodayQuiz(u.id)).map((q) => q.id);
    expect(today).toHaveLength(5);
    const bank = await prisma.gameQuiz.findMany({ where: { id: { in: [...ids, ...today] } } });
    const before = (await prisma.gameProfile.findUniqueOrThrow({ where: { userId: u.id } })).totalSeeds;
    const others = ids.filter((id) => !today.includes(id)).slice(0, 15);

    const results = await Promise.allSettled(
      [...others, ...today].map((id) => quiz.answerQuiz(u.id, id, bank.find((q) => q.id === id)!.correct)),
    );
    expect(summarize(results).fulfilled).toHaveLength(5);
    for (const r of results) {
      if (r.status === 'rejected') expect(String(r.reason?.message)).toBe('Câu hỏi này không thuộc bộ câu hôm nay.');
    }
    expect(await prisma.gameQuizAttempt.count({ where: { userId: u.id } })).toBe(5);
    const gp = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(gp.totalSeeds - before).toBe(bank.filter((q) => today.includes(q.id)).reduce((a, q) => a + q.waterReward, 0));
  });

  it('cùng bộ hôm nay gửi nhiều lần song song: mỗi câu chỉ ghi và cộng nước một lần', async () => {
    const u = await createRealUser(prisma);
    const today = await quiz.getTodayQuiz(u.id);
    const results = await Promise.allSettled([...today, ...today, ...today].map((q) => quiz.answerQuiz(u.id, q.id, 0)));
    expect(summarize(results).fulfilled).toHaveLength(today.length);
    expect(await prisma.gameQuizAttempt.count({ where: { userId: u.id } })).toBe(today.length);
  });
});
