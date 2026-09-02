import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { DEFAULT_TREE_TYPE } from './game.constants';

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

  private dayKey(d: Date): string {
    return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

  // User mới đăng nhập nhưng chưa vào Vườn Xanh → chưa có gameProfile.
  // Bảo đảm tồn tại để các thao tác quiz không P2025 → 500.
  private async ensure(userId: string) {
    const target = await this.config.get<number>('game.tree_default_target', 600);
    const existing = await this.prisma.gameProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.gameProfile.create({
      data: { userId, ecoImpact: { progress: 0, target, treeType: DEFAULT_TREE_TYPE, treesPlanted: 0 } as object },
    });
  }

  async getTodayQuiz(userId: string) {
    await this.ensure(userId);
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
    await this.ensure(userId);
    const quiz = await this.prisma.gameQuiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new BadRequestException('Câu hỏi không tồn tại.');

    const isCorrect = quiz.correct === choice;
    // Chặn trả lời trùng/ngày bằng unique DB constraint (userId, quizId, dayKey) — race-safe,
    // thay cho pattern đọc-rồi-tạo (TOCTOU) cũ: 2 request answerQuiz() song song đều có thể đọc
    // "chưa trả lời hôm nay" trước khi request đầu commit → cả 2 cùng được cộng waterReward.
    try {
      await this.prisma.gameQuizAttempt.create({
        data: { userId, quizId, isCorrect, dayKey: this.dayKey(new Date()) },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Bạn đã trả lời câu này hôm nay.');
      }
      throw err;
    }

    let waterEarned = 0;
    if (isCorrect) {
      const tankCap = await this.config.get<number>('game.tank_capacity', 500);
      waterEarned = quiz.waterReward;
      const target = await this.config.get<number>('game.tree_default_target', 600);
      // Atomic increment để 2 quiz answer song song (cùng user, khác quizId) KHÔNG mất 1 lần cộng:
      // pattern cũ (read totalSeeds → write Math.min(...)) là race lost-update — cả 2 đọc X rồi
      // cùng ghi X+w → totalSeeds = X+w thay vì X+2w.
      // Upsert: nếu profile bị xoá giữa ensure() và update() (race hiếm) vẫn không P2025.
      const upserted = await this.prisma.gameProfile.upsert({
        where: { userId },
        update: { totalSeeds: { increment: waterEarned } },
        create: {
          userId,
          totalSeeds: Math.min(tankCap, waterEarned),
          ecoImpact: { progress: 0, target, treeType: DEFAULT_TREE_TYPE, treesPlanted: 0 } as object,
        },
      });
      // Clamp về tankCap nếu increment vượt — chấp nhận đôi khi mất nước thừa khi đã đầy bình,
      // nhưng không bao giờ mất tích luỹ vì lost-update. Guard bằng updateMany (totalSeeds > cap)
      // thay vì update() tuyệt đối — nếu 1 quiz khác trả lời song song vừa cộng thêm nước sau khi
      // ta đọc `upserted`, unconditional update sẽ đè mất phần cộng đó dù vẫn > cap.
      if (upserted.totalSeeds > tankCap) {
        await this.prisma.gameProfile.updateMany({
          where: { userId, totalSeeds: { gt: tankCap } },
          data: { totalSeeds: tankCap },
        });
      }
    }
    return { isCorrect, correct: quiz.correct, waterEarned, explanation: quiz.explanation ?? null };
  }
}
