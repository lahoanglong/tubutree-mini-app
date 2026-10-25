import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { QUIZ_WRONG_SEEDS_DEFAULT, configInt } from './game.constants';
import { ensureGameProfile, initialEcoImpact } from './game-profile';
import { vnDateKey } from '../../common/vn-time';

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

  // User mới đăng nhập nhưng chưa vào Vườn Xanh → chưa có gameProfile.
  // Bảo đảm tồn tại để các thao tác quiz không P2025 → 500.
  private ensure(userId: string) {
    return ensureGameProfile(this.prisma, this.config, userId);
  }

  /**
   * Bộ câu của hôm nay: cửa sổ `game.quiz_daily_count` câu liên tiếp (sắp theo id) trong ngân hàng, dịch đi đúng bằng ngần ấy
   * câu mỗi ngày giờ VN rồi nối vòng. Ai cũng thấy cùng bộ trong ngày, hai ngày liền nhau không trùng câu nào, và xoay hết ngân
   * hàng trước khi lặp lại. Câu đã làm chỉ biến khỏi danh sách, không kéo thêm câu ngoài bộ (đằng nào cũng chạm trần trả lời).
   */
  async getTodayQuiz(userId: string) {
    await this.ensure(userId);
    const count = await this.config.get<number>('game.quiz_daily_count', 5);
    const total = await this.prisma.gameQuiz.count();
    if (total === 0 || count <= 0) return [];
    const size = Math.min(count, total);
    const dayNumber = Math.floor(Date.parse(`${vnDateKey()}T00:00:00Z`) / 86_400_000);
    const offset = (dayNumber * count) % total;
    const orderBy = { id: 'asc' as const };
    const window = await this.prisma.gameQuiz.findMany({ orderBy, skip: offset, take: size });
    const wrapped = window.length < size ? await this.prisma.gameQuiz.findMany({ orderBy, take: size - window.length }) : [];
    const done = await this.prisma.gameQuizAttempt.findMany({
      where: { userId, attemptedAt: { gte: this.startOfDay(new Date()) } },
      select: { quizId: true },
    });
    const answered = new Set(done.map((d) => d.quizId));
    return [...window, ...wrapped]
      .filter((q) => !answered.has(q.id))
      .map((q) => ({
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

    // Trần số CÂU KHÁC NHAU/ngày (P1-5, docs/2026-09-08-review-progress.md) — trước đây chỉ có
    // unique (userId,quizId,dayKey) chặn trả lời TRÙNG 1 câu, không chặn trả lời hết ngân hàng
    // câu hỏi trong 1 ngày (getTodayQuiz chỉ là gợi ý hiển thị `take` N câu, gọi thẳng
    // answerQuiz() cho quizId bất kỳ vẫn qua). Đếm attempt hôm nay TRƯỚC khi tạo mới.
    // Đếm-rồi-quyết KHÔNG atomic (không dùng Serializable như game.service.waterTree) — 2
    // request song song cho 2 quizId khác nhau về lý thuyết có thể cùng lọt qua, vượt trần 1-2
    // câu. Chấp nhận: phần thưởng mỗi câu chỉ vài giọt nước (đã bị chặn quy đổi ra tiền bởi
    // trần coupon thu hoạch/ngày ở game.service.ts), khác hẳn mức rủi ro của coupon 30k/lần.
    const dailyCap = await this.config.get<number>('game.quiz_daily_count', 5);
    const answeredToday = await this.prisma.gameQuizAttempt.count({
      where: { userId, attemptedAt: { gte: this.startOfDay(new Date()) } },
    });
    if (answeredToday >= dailyCap) {
      throw new BadRequestException(`Bạn đã trả lời đủ ${dailyCap} câu hôm nay, quay lại vào ngày mai nhé.`);
    }

    const isCorrect = quiz.correct === choice;
    // Chặn trả lời trùng/ngày bằng unique DB constraint (userId, quizId, dayKey) — race-safe,
    // thay cho pattern đọc-rồi-tạo (TOCTOU) cũ: 2 request answerQuiz() song song đều có thể đọc
    // "chưa trả lời hôm nay" trước khi request đầu commit → cả 2 cùng được cộng waterReward.
    try {
      await this.prisma.gameQuizAttempt.create({
        data: { userId, quizId, isCorrect, dayKey: vnDateKey() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Bạn đã trả lời câu này hôm nay.');
      }
      throw err;
    }

    let waterEarned = 0;
    // Câu sai vẫn được ít nước (quiz_wrong_seeds) để người mới không trả lời xong hai tay trắng.
    const reward = isCorrect ? quiz.waterReward : await configInt(this.config, 'game.quiz_wrong_seeds', QUIZ_WRONG_SEEDS_DEFAULT);
    if (reward > 0) {
      const tankCap = await this.config.get<number>('game.tank_capacity', 500);
      waterEarned = reward;
      const ecoImpact = await initialEcoImpact(this.config);
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
          ecoImpact,
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
