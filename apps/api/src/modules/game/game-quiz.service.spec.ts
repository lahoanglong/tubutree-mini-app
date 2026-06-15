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
    gameProfile: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1', totalSeeds: 50 }), update: jest.fn().mockResolvedValue({}) },
    gameQuiz: { findUnique: jest.fn().mockResolvedValue(QUIZ), findMany: jest.fn().mockResolvedValue([QUIZ]) },
    gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

describe('GameQuizService', () => {
  it('getTodayQuiz ẩn correct + explanation, kèm category/waterReward', async () => {
    const list = await new GameQuizService(prisma(), cfg()).getTodayQuiz('u1');
    expect(list[0]).toEqual({ id: 'q1', question: QUIZ.question, options: QUIZ.options, category: 'water', difficulty: 2, waterReward: 12 });
    expect((list[0] as any).correct).toBeUndefined();
    expect((list[0] as any).explanation).toBeUndefined();
  });

  it('answer đúng → cộng 💧 = waterReward, trả explanation', async () => {
    const p = prisma();
    const r = await new GameQuizService(p, cfg()).answerQuiz('u1', 'q1', 1);
    expect(r.isCorrect).toBe(true);
    expect(r.waterEarned).toBe(12);
    expect(r.explanation).toBe(QUIZ.explanation);
    const upd = (p.gameProfile.update as jest.Mock).mock.calls[0][0].data;
    expect(upd.totalSeeds).toBe(62); // 50 + 12
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
