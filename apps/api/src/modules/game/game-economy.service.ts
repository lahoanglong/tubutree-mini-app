import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

const DAY = 864e5;

@Injectable()
export class GameEconomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private dayKey(d: Date): string {
    return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /** UTC+7 start-of-today as a Date (for idempotent DB writes) */
  private startOfDay(d: Date): Date {
    const key = this.dayKey(d); // "YYYY-MM-DD" in UTC+7
    // Parse as UTC midnight then subtract the +7h offset to get the true UTC instant
    return new Date(Date.parse(key) - 7 * 3600 * 1000);
  }

  private async ensure(userId: string) {
    const target = await this.config.get<number>('game.tree_default_target', 600);
    const existing = await this.prisma.gameProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.gameProfile.create({
      data: { userId, ecoImpact: { progress: 0, target, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 } as object },
    });
  }

  async checkIn(userId: string) {
    const p = await this.ensure(userId);
    const today = this.dayKey(new Date());
    if (p.lastCheckInAt && this.dayKey(p.lastCheckInAt) === today) {
      throw new BadRequestException('Hôm nay bạn đã điểm danh rồi 🌿');
    }

    // Compute exact day gap using UTC+7 dayKey strings to avoid DST drift
    const gapDays = p.lastCheckInAt
      ? Math.round((Date.parse(today) - Date.parse(this.dayKey(p.lastCheckInAt))) / DAY)
      : null;

    // gapDays === 1 → consecutive (yesterday)
    // gapDays === 2 → exactly one missed day → freeze-eligible
    // gapDays > 2   → multiple missed days → reset, no freeze consumed

    let streakDays: number;
    let streakFreezes = p.streakFreezes;
    let streakFrozeUsed = false;
    if (gapDays === 1) {
      streakDays = p.streakDays + 1;
    } else if (gapDays === 2 && p.streakFreezes > 0) {
      // lỡ đúng 1 ngày và có vé giữ lửa → tiêu 1 vé, giữ chuỗi
      streakDays = p.streakDays + 1;
      streakFreezes = p.streakFreezes - 1;
      streakFrozeUsed = true;
    } else {
      streakDays = 1;
    }

    const loginSeeds = await this.config.get<number>('game.daily_login_seeds', 10);
    const tankCap = await this.config.get<number>('game.tank_capacity', 500);
    let seeds = loginSeeds;
    let bonusNote = '';
    if (streakDays % 7 === 0) {
      const bonus = await this.config.get<{ seeds: number }>('game.streak_7_bonus', { seeds: 20 });
      seeds += bonus.seeds ?? 20;
      bonusNote = `+${bonus.seeds ?? 20} 💧 chuỗi 7 ngày!`;
    } else if (streakDays % 3 === 0) {
      seeds += 5;
      bonusNote = '+5 💧 chuỗi 3 ngày!';
    }
    const totalSeeds = Math.min(tankCap, p.totalSeeds + seeds);

    // Idempotent write: only one concurrent call wins (race-safe backstop)
    const res = await this.prisma.gameProfile.updateMany({
      where: {
        userId,
        OR: [{ lastCheckInAt: null }, { lastCheckInAt: { lt: this.startOfDay(new Date()) } }],
      },
      data: {
        totalSeeds,
        streakDays,
        streakFreezes,
        longestStreak: Math.max(p.longestStreak, streakDays),
        lastCheckInAt: new Date(),
      },
    });
    if (res.count === 0) throw new BadRequestException('Hôm nay bạn đã điểm danh rồi 🌿');

    return { seedsEarned: seeds, pointsEarned: 0, streakDays, totalSeeds, streakFrozeUsed, bonusNote };
  }

  async collectDew(userId: string) {
    const p = await this.ensure(userId);
    if (p.lastDewAt && this.dayKey(p.lastDewAt) === this.dayKey(new Date())) {
      throw new BadRequestException('Hôm nay bạn đã hứng giọt sương rồi 🌿');
    }
    const dew = await this.config.get<number>('game.dew_seeds', 15);
    const tankCap = await this.config.get<number>('game.tank_capacity', 500);
    const totalSeeds = Math.min(tankCap, p.totalSeeds + dew);

    // Idempotent write: only one concurrent call wins (race-safe backstop)
    const res = await this.prisma.gameProfile.updateMany({
      where: {
        userId,
        OR: [{ lastDewAt: null }, { lastDewAt: { lt: this.startOfDay(new Date()) } }],
      },
      data: { totalSeeds, lastDewAt: new Date() },
    });
    if (res.count === 0) throw new BadRequestException('Hôm nay bạn đã hứng giọt sương rồi 🌿');

    return { seedsEarned: dew, totalSeeds };
  }

  async buyStreakFreeze(userId: string) {
    await this.ensure(userId);
    const cost = await this.config.get<number>('game.streak_freeze_cost', 80);
    const dec = await this.prisma.gameProfile.updateMany({
      where: { userId, totalSeeds: { gte: cost } },
      data: { totalSeeds: { decrement: cost }, streakFreezes: { increment: 1 } },
    });
    if (dec.count === 0) throw new BadRequestException(`Cần ${cost} 💧 để mua vé giữ lửa.`);
    const p = await this.prisma.gameProfile.findUnique({ where: { userId } });
    return { streakFreezes: p?.streakFreezes ?? 1, totalSeeds: p?.totalSeeds ?? 0 };
  }
}
