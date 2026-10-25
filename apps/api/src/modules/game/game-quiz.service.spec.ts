import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GameQuizService } from './game-quiz.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function cfg(over: Record<string, unknown> = {}): SystemConfigService {
  return { get: async <T>(k: string, fb?: T): Promise<T> => (k in over ? (over[k] as T) : (fb as T)) } as unknown as SystemConfigService;
}
const QUIZ = { id: 'q1', question: 'Rừng ngập mặn hấp thụ CO₂ ra sao?', options: ['Ít hơn', 'Gấp ~4 lần'], correct: 1,
  rewardPts: 0, category: 'water', difficulty: 2, explanation: 'Rừng ngập mặn hấp thụ CO₂ gấp ~4 lần rừng thường.', waterReward: 12 };

function prisma(over: Record<string, unknown> = {}) {
  const base = {
    gameProfile: {
      findUnique: jest.fn().mockResolvedValue({ userId: 'u1', totalSeeds: 50 }),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ userId: 'u1', totalSeeds: 0 }),
    },
    gameQuiz: { findUnique: jest.fn().mockResolvedValue(QUIZ), findMany: jest.fn().mockResolvedValue([QUIZ]), count: jest.fn().mockResolvedValue(1) },
    gameQuizAttempt: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

describe('GameQuizService', () => {
  it('getTodayQuiz ẩn correct + explanation, kèm category/waterReward', async () => {
    const list = await new GameQuizService(prisma(), cfg()).getTodayQuiz('u1');
    expect(list[0]).toEqual({ id: 'q1', question: QUIZ.question, options: QUIZ.options, category: 'water', difficulty: 2, waterReward: 12 });
    expect((list[0] as unknown as Record<string, unknown>).correct).toBeUndefined();
    expect((list[0] as unknown as Record<string, unknown>).explanation).toBeUndefined();
  });

  it('answer đúng → cộng 💧 = waterReward (atomic increment), trả explanation', async () => {
    const p = prisma();
    const r = await new GameQuizService(p, cfg()).answerQuiz('u1', 'q1', 1);
    expect(r.isCorrect).toBe(true);
    expect(r.waterEarned).toBe(12);
    expect(r.explanation).toBe(QUIZ.explanation);
    // Atomic { increment } thay cho read+write (chống race lost-update khi 2 quiz song song).
    const upd = (p.gameProfile.upsert as jest.Mock).mock.calls[0][0].update;
    expect(upd.totalSeeds).toEqual({ increment: 12 });
  });

  it('answer sai → +2 💧 (game.quiz_wrong_seeds), vẫn trả explanation + correct', async () => {
    const p = prisma();
    const r = await new GameQuizService(p, cfg()).answerQuiz('u1', 'q1', 0);
    expect(r.isCorrect).toBe(false);
    expect(r.waterEarned).toBe(2);
    expect(r.correct).toBe(1);
    expect(r.explanation).toBe(QUIZ.explanation);
    expect((p.gameProfile.upsert as jest.Mock).mock.calls[0][0].update.totalSeeds).toEqual({ increment: 2 });
  });

  it('answer sai theo config game.quiz_wrong_seeds', async () => {
    const p = prisma();
    const r = await new GameQuizService(p, cfg({ 'game.quiz_wrong_seeds': 5 })).answerQuiz('u1', 'q1', 0);
    expect(r.waterEarned).toBe(5);
    expect((p.gameProfile.upsert as jest.Mock).mock.calls[0][0].update.totalSeeds).toEqual({ increment: 5 });
  });

  it('game.quiz_wrong_seeds = 0 → câu sai không cộng gì, không ghi hồ sơ', async () => {
    const p = prisma();
    const r = await new GameQuizService(p, cfg({ 'game.quiz_wrong_seeds': 0 })).answerQuiz('u1', 'q1', 0);
    expect(r.waterEarned).toBe(0);
    expect(p.gameProfile.upsert).not.toHaveBeenCalled();
  });

  it('hồ sơ tạo từ upsert của câu đố có ecoImpact theo thang (target cây đầu 60)', async () => {
    const p = prisma();
    await new GameQuizService(p, cfg()).answerQuiz('u1', 'q1', 1);
    expect((p.gameProfile.upsert as jest.Mock).mock.calls[0][0].create.ecoImpact).toEqual(
      expect.objectContaining({ progress: 0, target: 60, treesPlanted: 0 }),
    );
  });

  it('trả lời lại trong ngày → BadRequest (unique constraint DB-level, race-safe)', async () => {
    const p = prisma({
      gameQuizAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
        ),
        count: jest.fn().mockResolvedValue(0),
      },
    });
    await expect(new GameQuizService(p, cfg()).answerQuiz('u1', 'q1', 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  // P1-5 (docs/2026-09-08-review-progress.md): answerQuiz() chỉ chặn TRẢ LỜI TRÙNG 1 câu/ngày
  // (unique userId+quizId+dayKey) — không chặn số CÂU KHÁC NHAU trả lời/ngày. getTodayQuiz()
  // chỉ là gợi ý hiển thị (take N câu chưa làm); gọi thẳng answerQuiz() cho quizId bất kỳ vẫn
  // qua được, nên có thể trả lời HẾT ngân hàng câu hỏi trong 1 ngày thay vì đúng
  // game.quiz_daily_count câu như thiết kế → nhân N lần nước thưởng.
  it('đã đạt trần số câu/ngày (game.quiz_daily_count) → BadRequest, KHÔNG cộng nước, KHÔNG tạo attempt', async () => {
    const p = prisma({ gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), count: jest.fn().mockResolvedValue(5) } });
    await expect(new GameQuizService(p, cfg({ 'game.quiz_daily_count': 5 })).answerQuiz('u1', 'q1', 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((p.gameQuizAttempt.create as jest.Mock)).not.toHaveBeenCalled();
    expect((p.gameProfile.upsert as jest.Mock)).not.toHaveBeenCalled();
  });

  it('còn dưới trần → vẫn trả lời được bình thường', async () => {
    const p = prisma({ gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(4) } });
    const r = await new GameQuizService(p, cfg({ 'game.quiz_daily_count': 5 })).answerQuiz('u1', 'q1', 1);
    expect(r.isCorrect).toBe(true);
  });
});

// C1: user mới chưa có gameProfile → ensure() tự tạo, không P2025/500.
describe('GameQuizService.ensureProfile (C1)', () => {
  function prismaNoProfile() {
    return {
      gameProfile: {
        // Lần đầu: chưa có profile. Lần thứ hai (sau ensure → trong nhánh isCorrect): đã có.
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ userId: 'u-new', totalSeeds: 0 }),
        create: jest.fn().mockResolvedValue({ userId: 'u-new', totalSeeds: 0 }),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      gameQuiz: { findUnique: jest.fn().mockResolvedValue(QUIZ), findMany: jest.fn().mockResolvedValue([QUIZ]), count: jest.fn().mockResolvedValue(1) },
      gameQuizAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;
  }

  it('answerQuiz cho user chưa có gameProfile → không crash, upsert tạo profile và cộng nước', async () => {
    const p = prismaNoProfile();
    const r = await new GameQuizService(p, cfg()).answerQuiz('u-new', 'q1', 1);
    expect(r.isCorrect).toBe(true);
    expect(r.waterEarned).toBe(12);
    // ensure() đã tạo profile trước khi vào nhánh cộng nước.
    expect((p.gameProfile.create as jest.Mock)).toHaveBeenCalledTimes(1);
    // Upsert được gọi (an toàn cả khi update path lẫn create path).
    expect((p.gameProfile.upsert as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('getTodayQuiz tự ensureProfile (không throw)', async () => {
    const p = prismaNoProfile();
    await expect(new GameQuizService(p, cfg()).getTodayQuiz('u-new')).resolves.toBeDefined();
    expect((p.gameProfile.create as jest.Mock)).toHaveBeenCalledTimes(1);
  });
});

// D4-009: trước đây findMany không orderBy nên mỗi ngày DB trả đúng vài câu đầu tiên → quiz lặp từng ngày.
describe('GameQuizService.getTodayQuiz — bộ câu trong ngày xoay vòng, thứ tự xác định', () => {
  afterEach(() => jest.useRealTimers());

  const bankOf = (n: number) => Array.from({ length: n }, (_, i) => ({ ...QUIZ, id: `q${String(i).padStart(2, '0')}` }));
  function withBank(n: number, done: string[] = []) {
    const bank = bankOf(n);
    const findMany = jest.fn(async ({ skip = 0, take }: { skip?: number; take: number }) => bank.slice(skip, skip + take));
    return {
      findMany,
      p: prisma({
        gameQuiz: { findUnique: jest.fn(), count: jest.fn().mockResolvedValue(n), findMany },
        gameQuizAttempt: { findMany: jest.fn().mockResolvedValue(done.map((quizId) => ({ quizId }))), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      }),
    };
  }
  const ids = async (p: PrismaService, at: string, over: Record<string, unknown> = {}) => {
    jest.useFakeTimers().setSystemTime(new Date(at));
    return (await new GameQuizService(p, cfg(over)).getTodayQuiz('u1')).map((q) => q.id);
  };

  it('cùng một ngày gọi nhiều lần (kể cả user khác) ra cùng bộ câu, đúng game.quiz_daily_count, lấy theo thứ tự id', async () => {
    const { p, findMany } = withBank(12);

    const first = await ids(p, '2026-10-17T03:00:00Z');
    const again = await ids(p, '2026-10-17T14:00:00Z');

    expect(first).toHaveLength(5);
    expect(again).toEqual(first);
    expect(findMany.mock.calls[0]![0]).toMatchObject({ orderBy: { id: 'asc' }, take: 5 });
  });

  it('hai ngày liền nhau không lặp câu nào; xoay hết ngân hàng sau một vòng; mỗi câu xuất hiện đều nhau', async () => {
    const { p } = withBank(12);
    const seen = new Map<string, number>();
    let prev: string[] = [];
    for (let day = 0; day < 12; day++) {
      const today = await ids(p, new Date(Date.UTC(2026, 9, 1 + day, 3)).toISOString());
      expect(today).toHaveLength(5);
      expect(new Set(today).size).toBe(5);
      expect(today.filter((id) => prev.includes(id))).toEqual([]);
      for (const id of today) seen.set(id, (seen.get(id) ?? 0) + 1);
      prev = today;
    }
    expect([...seen.keys()].sort()).toEqual(bankOf(12).map((q) => q.id));
    expect(new Set(seen.values())).toEqual(new Set([5]));
  });

  it('cửa sổ vắt qua cuối ngân hàng thì nối lại từ đầu, không thiếu không trùng', async () => {
    const { p, findMany } = withBank(7);
    // Tìm ngày có offset vắt qua cuối: lặp tới khi findMany phải gọi lần hai.
    let wrapped: string[] | null = null;
    for (let day = 0; day < 7 && !wrapped; day++) {
      findMany.mockClear();
      const today = await ids(p, new Date(Date.UTC(2026, 9, 1 + day, 3)).toISOString());
      if (findMany.mock.calls.length === 2) wrapped = today;
    }
    expect(wrapped).not.toBeNull();
    expect(wrapped).toHaveLength(5);
    expect(new Set(wrapped).size).toBe(5);
  });

  it('câu đã làm hôm nay biến khỏi danh sách nhưng KHÔNG kéo thêm câu ngoài bộ của hôm nay', async () => {
    const at = '2026-10-17T03:00:00Z';
    const full = await ids(withBank(12).p, at);
    const partial = await ids(withBank(12, [full[0]!, full[1]!]).p, at);

    expect(partial).toEqual(full.slice(2));
  });

  it('ngân hàng ít hơn số câu/ngày → trả cả ngân hàng một lần; ngân hàng rỗng → []', async () => {
    expect((await ids(withBank(3).p, '2026-10-17T03:00:00Z')).sort()).toEqual(['q00', 'q01', 'q02']);
    expect(await ids(withBank(0).p, '2026-10-17T03:00:00Z')).toEqual([]);
  });

  it('đổi ngày theo giờ Việt Nam: 23:59 và 00:00 giờ VN là hai bộ câu khác nhau', async () => {
    const { p } = withBank(12);

    const lateNight = await ids(p, '2026-10-17T16:59:00Z');
    const afterMidnight = await ids(p, '2026-10-17T17:00:00Z');
    const sameDayMorning = await ids(p, '2026-10-17T00:00:00Z');

    expect(afterMidnight).not.toEqual(lateNight);
    expect(sameDayMorning).toEqual(lateNight);
  });

  it('game.quiz_daily_count đổi số câu trong bộ', async () => {
    const { p } = withBank(12);
    expect(await ids(p, '2026-10-17T03:00:00Z', { 'game.quiz_daily_count': 3 })).toHaveLength(3);
  });
});
