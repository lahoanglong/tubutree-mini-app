import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { QUIZ_WRONG_SEEDS_DEFAULT, configInt } from './game.constants';
import { clampTankKeepingOverflow, ensureGameProfile, initialEcoImpact } from './game-profile';
import { vnDateKey } from '../../common/vn-time';
import { paginated } from '../../common/pagination';

/** Nhóm câu đố mà Mini App và web có nhãn riêng (categoryLabel); nhóm lạ chỉ hiện nhãn "Thiên nhiên". */
export const QUIZ_CATEGORIES = ['cay', 'nuoc', 'dat', 'khong_khi', 'dong_vat', 'tai_che', 'nang_luong', 'nature'] as const;
export const QUIZ_DIFFICULTIES = [1, 2, 3] as const;
/** Nước thưởng khi đáp đúng, theo độ khó, cùng bảng với seed-game-quiz.ts. Thưởng điểm (rewardPts) luôn 0. */
export const QUIZ_WATER_BY_DIFFICULTY: Record<number, number> = { 1: 8, 2: 10, 3: 12 };
const QUIZ_OPTIONS_MIN = 2;
const QUIZ_OPTIONS_MAX = 4;

export interface AdminQuizInput {
  question: string;
  options: string[];
  correct: number;
  category: string;
  difficulty: number;
  explanation?: string | null;
}

type QuizRow = { id: string; question: string; options: unknown; correct: number; category: string; difficulty: number; explanation: string | null; waterReward: number };

const toAdminQuiz = (r: QuizRow) => ({
  id: r.id,
  question: r.question,
  options: Array.isArray(r.options) ? r.options.map(String) : [],
  correct: r.correct,
  category: r.category,
  difficulty: r.difficulty,
  explanation: r.explanation,
  waterReward: r.waterReward,
});

/** Luật chéo trường mà DTO không kiểm được: đáp án đúng phải trỏ vào một đáp án có thật, không trùng chữ giữa các đáp án. */
function assertQuizShape(options: string[], correct: number) {
  if (options.length < QUIZ_OPTIONS_MIN || options.length > QUIZ_OPTIONS_MAX) {
    throw new BadRequestException(`Câu đố cần từ ${QUIZ_OPTIONS_MIN} đến ${QUIZ_OPTIONS_MAX} đáp án.`);
  }
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
    throw new BadRequestException('Đáp án đúng phải là một trong các đáp án đã nhập.');
  }
  if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) {
    throw new BadRequestException('Các đáp án không được trùng nhau.');
  }
}

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
    const set = await this.todaySet();
    if (set.length === 0) return [];
    const done = await this.prisma.gameQuizAttempt.findMany({
      where: { userId, attemptedAt: { gte: this.startOfDay(new Date()) } },
      select: { quizId: true },
    });
    const answered = new Set(done.map((d) => d.quizId));
    return set
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

  /** Bộ câu của hôm nay (theo ngày VN), dùng chung cho danh sách hiển thị và cho việc chỉ nhận câu thuộc bộ khi trả lời. */
  private async todaySet() {
    const count = await this.config.get<number>('game.quiz_daily_count', 5);
    const total = await this.prisma.gameQuiz.count();
    if (total === 0 || count <= 0) return [];
    const size = Math.min(count, total);
    const dayNumber = Math.floor(Date.parse(`${vnDateKey()}T00:00:00Z`) / 86_400_000);
    const offset = (dayNumber * count) % total;
    const orderBy = { id: 'asc' as const };
    const window = await this.prisma.gameQuiz.findMany({ orderBy, skip: offset, take: size });
    const wrapped = window.length < size ? await this.prisma.gameQuiz.findMany({ orderBy, take: size - window.length }) : [];
    return [...window, ...wrapped];
  }

  async answerQuiz(userId: string, quizId: string, choice: number) {
    await this.ensure(userId);
    const quiz = await this.prisma.gameQuiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new BadRequestException('Câu hỏi không tồn tại.');
    const set = await this.todaySet();
    if (!set.some((q) => q.id === quizId)) throw new BadRequestException('Câu hỏi này không thuộc bộ câu hôm nay.');

    // Config đọc TRƯỚC tx: cache nguội mà đọc trong tx thì mỗi tx giữ 1 kết nối và xin thêm 1 nữa (cạn pool).
    const dailyCap = await this.config.get<number>('game.quiz_daily_count', 5);
    const isCorrect = quiz.correct === choice;
    // Câu sai vẫn được ít nước (quiz_wrong_seeds) để người mới không trả lời xong hai tay trắng.
    const reward = isCorrect ? quiz.waterReward : await configInt(this.config, 'game.quiz_wrong_seeds', QUIZ_WRONG_SEEDS_DEFAULT);
    const tankCap = reward > 0 ? await this.config.get<number>('game.tank_capacity', 500) : 0;
    const ecoImpact = reward > 0 ? await initialEcoImpact(this.config) : undefined;
    const dayKey = vnDateKey();
    const dayStart = this.startOfDay(new Date());

    // Trong một ngày, bộ câu hôm nay (≤ trần) cộng unique (userId, quizId, dayKey) đã đủ chặn. Khoá theo user chỉ là lớp phụ cho lúc
    // bộ câu đổi giữa ngày (admin lưu thêm câu hoặc đổi số câu/ngày): khi đó câu chưa trả lời có thể nhiều hơn phần trần còn lại,
    // và đếm-rồi-ghi không khoá sẽ cho các câu khác nhau gửi song song lọt quá trần.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`game-quiz:${userId}`}, 0))`;
      const answeredToday = await tx.gameQuizAttempt.count({ where: { userId, attemptedAt: { gte: dayStart } } });
      if (answeredToday >= dailyCap) {
        throw new BadRequestException(`Bạn đã trả lời đủ ${dailyCap} câu hôm nay, quay lại vào ngày mai nhé.`);
      }
      try {
        await tx.gameQuizAttempt.create({ data: { userId, quizId, isCorrect, dayKey } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new BadRequestException('Bạn đã trả lời câu này hôm nay.');
        }
        throw err;
      }
      if (reward > 0) {
        // Atomic increment: 2 nguồn cộng nước song song không mất lần cộng nào (đọc-rồi-ghi là lost-update).
        const upserted = await tx.gameProfile.upsert({
          where: { userId },
          update: { totalSeeds: { increment: reward } },
          create: { userId, totalSeeds: Math.min(tankCap, reward), ecoImpact },
        });
        // Clamp về tankCap nếu increment vượt, guard bằng updateMany (totalSeeds > cap) để không đè phần cộng song song.
        if (upserted.totalSeeds > tankCap) await clampTankKeepingOverflow(tx, userId, tankCap, reward);
      }
    });
    return { isCorrect, correct: quiz.correct, waterEarned: reward > 0 ? reward : 0, explanation: quiz.explanation ?? null };
  }

  /** Danh sách cho quản trị theo thứ tự id, cùng thứ tự vòng xoay hằng ngày của getTodayQuiz. */
  async listForAdmin(page: number, limit: number) {
    const [rows, total] = await Promise.all([
      this.prisma.gameQuiz.findMany({ orderBy: { id: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.gameQuiz.count(),
    ]);
    return paginated(rows.map(toAdminQuiz), page, limit, total);
  }

  /** Câu mới nằm chung bảng với câu seed nên vào vòng xoay hằng ngày của getTodayQuiz ngay khi lưu (có thể làm bộ câu hôm nay đổi). */
  async createForAdmin(input: AdminQuizInput) {
    assertQuizShape(input.options, input.correct);
    const row = await this.prisma.gameQuiz.create({
      data: {
        id: `nq_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        question: input.question,
        options: input.options,
        correct: input.correct,
        category: input.category,
        difficulty: input.difficulty,
        explanation: input.explanation ?? null,
        waterReward: QUIZ_WATER_BY_DIFFICULTY[input.difficulty] ?? QUIZ_WATER_BY_DIFFICULTY[1]!,
        rewardPts: 0,
      },
    });
    return toAdminQuiz(row);
  }

  async updateForAdmin(id: string, patch: Partial<AdminQuizInput>) {
    const cur = await this.prisma.gameQuiz.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Không tìm thấy câu đố.');
    const options = patch.options ?? toAdminQuiz(cur).options;
    const correct = patch.correct ?? cur.correct;
    assertQuizShape(options, correct);
    const difficulty = patch.difficulty ?? cur.difficulty;
    const row = await this.prisma.gameQuiz.update({
      where: { id },
      data: {
        ...(patch.question !== undefined ? { question: patch.question } : {}),
        ...(patch.options !== undefined ? { options: patch.options } : {}),
        correct,
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        difficulty,
        ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
        waterReward: QUIZ_WATER_BY_DIFFICULTY[difficulty] ?? cur.waterReward,
        rewardPts: 0,
      },
    });
    return toAdminQuiz(row);
  }
}
