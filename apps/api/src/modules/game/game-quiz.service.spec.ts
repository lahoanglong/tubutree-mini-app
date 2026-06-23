import { BadRequestException } from '@nestjs/common';
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
    gameQuiz: { findUnique: jest.fn().mockResolvedValue(QUIZ), findMany: jest.fn().mockResolvedValue([QUIZ]) },
    gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
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

  it('answer sai → 0 💧, vẫn trả explanation + correct', async () => {
    const r = await new GameQuizService(prisma(), cfg()).answerQuiz('u1', 'q1', 0);
    expect(r.isCorrect).toBe(false);
    expect(r.waterEarned).toBe(0);
    expect(r.correct).toBe(1);
  });

  it('trả lời lại trong ngày → BadRequest', async () => {
    const p = prisma({ gameQuizAttempt: { findFirst: jest.fn().mockResolvedValue({ id: 'a1' }), create: jest.fn() } });
    await expect(new GameQuizService(p, cfg()).answerQuiz('u1', 'q1', 1)).rejects.toBeInstanceOf(BadRequestException);
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
      gameQuiz: { findUnique: jest.fn().mockResolvedValue(QUIZ), findMany: jest.fn().mockResolvedValue([QUIZ]) },
      gameQuizAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
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
