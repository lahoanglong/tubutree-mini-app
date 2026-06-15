import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

@Injectable()
export class GameQuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private startOfDay(d: Date): Date {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    utc7.setUTCHours(0, 0, 0, 0);
    return new Date(utc7.getTime() - 7 * 3600 * 1000);
  }

  async getTodayQuiz(userId: string) {
    const count = await this.config.get<number>('game.quiz_daily_count', 5);
    const since = this.startOfDay(new Date());
    const done = await this.prisma.gameQuizAttempt.findMany({
      where: { userId, attemptedAt: { gte: since } },
      select: { quizId: true },
    });
    const quizzes = await this.prisma.gameQuiz.findMany({
      where: { id: { notIn: done.map((d) => d.quizId) } },
      take: count,
    });
    return quizzes.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      category: q.category,
      difficulty: q.difficulty,
      waterReward: q.waterReward,
    }));
  }

  async answerQuiz(userId: string, quizId: string, choice: number) {
    const quiz = await this.prisma.gameQuiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new BadRequestException('Câu hỏi không tồn tại.');
    const since = this.startOfDay(new Date());
    const already = await this.prisma.gameQuizAttempt.findFirst({
      where: { userId, quizId, attemptedAt: { gte: since } },
    });
    if (already) throw new BadRequestException('Bạn đã trả lời câu này hôm nay.');

    const isCorrect = quiz.correct === choice;
    await this.prisma.gameQuizAttempt.create({ data: { userId, quizId, isCorrect } });

    let waterEarned = 0;
    if (isCorrect) {
      const tankCap = await this.config.get<number>('game.tank_capacity', 500);
      const p = await this.prisma.gameProfile.findUnique({ where: { userId } });
      waterEarned = quiz.waterReward;
      await this.prisma.gameProfile.update({
        where: { userId },
        data: { totalSeeds: Math.min(tankCap, (p?.totalSeeds ?? 0) + waterEarned) },
      });
    }
    return { isCorrect, correct: quiz.correct, waterEarned, explanation: quiz.explanation ?? null };
  }
}
