import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

interface SpinPrize {
  id: string;
  name: string;
  weight: number;
  rewardType: 'POINTS' | 'COUPON' | 'SEEDS' | 'NONE';
  value: number;
}

interface EcoImpact {
  progress: number;
  target: number;
  treeType: string;
  treesPlanted: number;
}

/** Vườn Xanh Tubu (Build Spec §6.7). Tham số đọc từ SystemConfig. */
@Injectable()
export class GameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  // ── Profile ────────────────────────────────────────
  async ensureProfile(userId: string) {
    const target = await this.config.get<number>('game.tree_default_target', 600);
    const existing = await this.prisma.gameProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.gameProfile.create({
      data: {
        userId,
        ecoImpact: { progress: 0, target, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 } as object,
      },
    });
  }

  async getProfile(userId: string) {
    return this.ensureProfile(userId);
  }

  // ── Daily check-in ─────────────────────────────────
  async checkIn(userId: string) {
    const profile = await this.ensureProfile(userId);
    const today = this.dayKey(new Date());
    if (profile.lastCheckInAt && this.dayKey(profile.lastCheckInAt) === today) {
      throw new BadRequestException('Hôm nay bạn đã điểm danh rồi 🌿');
    }

    const wasYesterday =
      profile.lastCheckInAt && this.dayKey(this.addDays(new Date(), -1)) === this.dayKey(profile.lastCheckInAt);
    const streakDays = wasYesterday ? profile.streakDays + 1 : 1;

    const loginSeeds = await this.config.get<number>('game.daily_login_seeds', 10);
    const checkinPoints = await this.config.get<number>('game.daily_checkin_points', 2);
    const tankCap = await this.config.get<number>('game.tank_capacity', 200);

    let seeds = loginSeeds;
    let bonusNote = '';
    if (streakDays % 7 === 0) {
      const bonus = await this.config.get<{ seeds: number }>('game.streak_7_bonus', { seeds: 20 });
      const bonusSeeds = bonus.seeds ?? 20;
      seeds += bonusSeeds;
      bonusNote = `+${bonusSeeds} 💧 chuỗi 7 ngày!`;
    } else if (streakDays % 3 === 0) {
      seeds += 5;
      bonusNote = '+5 💧 chuỗi 3 ngày!';
    }

    const newSeeds = Math.min(tankCap, profile.totalSeeds + seeds);
    await this.prisma.gameProfile.update({
      where: { userId },
      data: {
        totalSeeds: newSeeds,
        streakDays,
        longestStreak: Math.max(profile.longestStreak, streakDays),
        lastCheckInAt: new Date(),
      },
    });
    await this.creditPoints(userId, checkinPoints, 'GAME_CHECKIN');

    return { seedsEarned: seeds, pointsEarned: checkinPoints, streakDays, totalSeeds: newSeeds, bonusNote };
  }

  // ── Spin wheel ─────────────────────────────────────
  async spin(userId: string) {
    const cost = await this.config.get<number>('game.spin_buy_cost_points', 10);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.pointsBalance < cost) {
      throw new BadRequestException(`Cần ${cost} điểm Xanh để quay.`);
    }
    const prizes = await this.config.get<SpinPrize[]>('game.spin_prizes', []);
    if (prizes.length === 0) throw new BadRequestException('Vòng quay chưa cấu hình.');

    await this.creditPoints(userId, -cost, 'GAME_SPIN_COST');
    const prize = this.pickWeighted(prizes);

    let rewardRefId: string | null = null;
    if (prize.rewardType === 'POINTS') {
      await this.creditPoints(userId, prize.value, `GAME_SPIN_WIN:${prize.id}`);
    } else if (prize.rewardType === 'SEEDS') {
      const tankCap = await this.config.get<number>('game.tank_capacity', 200);
      const p = await this.ensureProfile(userId);
      await this.prisma.gameProfile.update({
        where: { userId },
        data: { totalSeeds: Math.min(tankCap, p.totalSeeds + prize.value) },
      });
    } else if (prize.rewardType === 'COUPON') {
      rewardRefId = await this.grantCoupon(userId, prize.value);
    }

    await this.prisma.gameSpin.create({
      data: {
        userId,
        prizeId: prize.id,
        prizeName: prize.name,
        prizeValue: prize.value,
        rewardType: prize.rewardType,
        rewardRefId,
      },
    });
    return { prize: { id: prize.id, name: prize.name, rewardType: prize.rewardType, value: prize.value } };
  }

  // ── Quiz ───────────────────────────────────────────
  async getTodayQuiz(userId: string) {
    const count = await this.config.get<number>('game.quiz_daily_count', 5);
    const since = this.startOfDay(new Date());
    const attemptedToday = await this.prisma.gameQuizAttempt.findMany({
      where: { userId, attemptedAt: { gte: since } },
      select: { quizId: true },
    });
    const doneIds = attemptedToday.map((a) => a.quizId);
    const quizzes = await this.prisma.gameQuiz.findMany({
      where: { id: { notIn: doneIds } },
      take: count,
    });
    // Ẩn đáp án đúng
    return quizzes.map((q) => ({ id: q.id, question: q.question, options: q.options, rewardPts: q.rewardPts }));
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
    const points = await this.config.get<number>('game.quiz_correct_points', 3);
    if (isCorrect) await this.creditPoints(userId, points, `GAME_QUIZ:${quizId}`);
    return { isCorrect, correct: quiz.correct, pointsEarned: isCorrect ? points : 0 };
  }

  // ── Tree water + harvest ───────────────────────────
  async waterTree(userId: string, drops: number) {
    if (drops <= 0) throw new BadRequestException('Số giọt nước không hợp lệ.');
    const profile = await this.ensureProfile(userId);
    if (profile.totalSeeds < drops) throw new BadRequestException('Không đủ giọt nước.');

    const eco = this.eco(profile.ecoImpact);
    eco.progress += drops;

    // Thu hoạch khi đủ target; phần dư được CARRY-OVER sang cây mới (không mất nước).
    // Dùng vòng lặp phòng trường hợp target cấu hình nhỏ → một lần tưới đủ nhiều cây.
    const harvestAmount = await this.config.get<number>('game.harvest_coupon_amount', 30000);
    let harvestCount = 0;
    let couponCode: string | undefined;
    while (eco.progress >= eco.target) {
      eco.progress -= eco.target;
      eco.treesPlanted += 1;
      harvestCount += 1;
      couponCode = await this.grantCoupon(userId, harvestAmount);
    }
    const harvested = harvestCount > 0;
    const reward: { coupon?: string } = couponCode ? { coupon: couponCode } : {};

    // Giai đoạn cây theo tiến độ hiện tại (sau carry-over). progress=0 → mầm mới (stage 1).
    const stage = Math.min(4, Math.max(1, Math.ceil((eco.progress / eco.target) * 4)));
    await this.prisma.gameProfile.update({
      where: { userId },
      data: {
        totalSeeds: profile.totalSeeds - drops,
        treeStage: stage,
        ecoImpact: eco as object,
      },
    });
    return { progress: eco.progress, target: eco.target, harvested, treesPlanted: eco.treesPlanted, reward };
  }

  // ── Missions & leaderboard ─────────────────────────
  async getMissions(userId: string) {
    const missions = await this.prisma.mission.findMany();
    const progress = await this.prisma.missionProgress.findMany({ where: { userId } });
    const byMission = new Map(progress.map((p) => [p.missionId, p]));
    return missions.map((m) => {
      const p = byMission.get(m.id);
      return {
        code: m.code,
        title: m.title,
        description: m.description,
        rewardPoints: m.rewardPoints,
        progress: p?.progress ?? 0,
        goal: p?.goal ?? 1,
        completed: !!p?.completedAt,
      };
    });
  }

  async getLeaderboard() {
    const top = await this.prisma.gameProfile.findMany({
      orderBy: [{ longestStreak: 'desc' }, { totalSeeds: 'desc' }],
      take: 10,
      include: { user: { select: { fullName: true } } },
    });
    return top.map((p, i) => ({
      rank: i + 1,
      nickname: this.maskName(p.user.fullName),
      streak: p.longestStreak,
      treesPlanted: this.eco(p.ecoImpact).treesPlanted,
    }));
  }

  // ── Helpers ────────────────────────────────────────
  private async creditPoints(userId: string, delta: number, reason: string) {
    await this.prisma.$transaction([
      this.prisma.pointsTransaction.create({ data: { userId, delta, reason, refType: 'GAME' } }),
      this.prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: delta } } }),
    ]);
  }

  /** Tạo coupon cá nhân AMOUNT cho user (thưởng game). Trả về code. */
  private async grantCoupon(userId: string, amount: number): Promise<string> {
    const code = `GAME${amount}-${userId.slice(-5)}-${Math.floor(Math.random() * 9000 + 1000)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    await this.prisma.coupon.create({
      data: {
        code,
        type: 'AMOUNT',
        value: amount,
        startAt: new Date(),
        endAt: end,
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId } as object,
      },
    });
    return code;
  }

  private pickWeighted(prizes: SpinPrize[]): SpinPrize {
    const total = prizes.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of prizes) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return prizes[prizes.length - 1]!;
  }

  private eco(json: unknown): EcoImpact {
    const e = (json ?? {}) as Partial<EcoImpact>;
    return {
      progress: e.progress ?? 0,
      target: e.target ?? 600,
      treeType: e.treeType ?? 'Cây Dứa Fuwa3e',
      treesPlanted: e.treesPlanted ?? 0,
    };
  }

  private maskName(name: string | null): string {
    if (!name) return 'Bạn Tubu';
    const parts = name.trim().split(' ');
    const last = parts[parts.length - 1] ?? 'Tubu';
    return `${last}***`;
  }

  private dayKey(d: Date): string {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    return utc7.toISOString().slice(0, 10);
  }
  private startOfDay(d: Date): Date {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    utc7.setUTCHours(0, 0, 0, 0);
    return new Date(utc7.getTime() - 7 * 3600 * 1000);
  }
  private addDays(d: Date, n: number): Date {
    return new Date(d.getTime() + n * 24 * 3600 * 1000);
  }
}
