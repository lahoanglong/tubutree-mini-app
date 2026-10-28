import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { SeasonPassService } from './season-pass.service';
import { clampTankKeepingOverflow, ensureGameProfile } from './game-profile';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { vnDateKey } from '../../common/vn-time';
import {
  COMEBACK_GAP_DAYS_DEFAULT,
  COMEBACK_SEEDS_DEFAULT,
  DAILY_LOGIN_SEEDS_DEFAULT,
  DEW_SEEDS_DEFAULT,
  FIRST_CHECKIN_BONUS_DEFAULT,
  configInt,
  streak7Seeds,
} from './game.constants';

const DAY = 864e5;

@Injectable()
export class GameEconomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly seasonPass: SeasonPassService,
    private readonly analytics: AnalyticsEventsService,
  ) {}

  /** UTC+7 start-of-today as a Date (for idempotent DB writes) */
  private startOfDay(d: Date): Date {
    const key = vnDateKey(d); // "YYYY-MM-DD" in UTC+7
    // Parse as UTC midnight then subtract the +7h offset to get the true UTC instant
    return new Date(Date.parse(key) - 7 * 3600 * 1000);
  }

  private ensure(userId: string) {
    return ensureGameProfile(this.prisma, this.config, userId);
  }

  /** Số lần đọc lại hồ sơ khi thao tác song song (mua vé, hồi sinh) đổi chuỗi giữa lúc đọc và lúc ghi. */
  private static readonly STREAK_CAS_ATTEMPTS = 4;

  async checkIn(userId: string) {
    for (let attempt = 0; attempt < GameEconomyService.STREAK_CAS_ATTEMPTS; attempt++) {
      const done = await this.tryCheckIn(userId);
      if (done) {
        const { p, seeds, streakDays, streakFrozeUsed, bonusNote, bonuses } = done;
        // Task 9: sự kiện engagement — best-effort (không transaction bao quanh checkIn).
        await this.analytics.recordBestEffort({
          eventName: 'engagement_action',
          userId,
          platform: 'miniapp',
          props: { action: 'garden_checkin', streakDays },
        });
        const tankCap = await this.config.get<number>('game.tank_capacity', 500);
        await clampTankKeepingOverflow(this.prisma, userId, tankCap, seeds);

        // Hook Season Pass: cộng XP chặng mùa (side-effect an toàn, không ảnh hưởng streak math).
        await this.seasonPass
          .addXp(userId, await this.config.get<number>('seasonpass.checkin_xp', 10))
          .catch(() => undefined);

        const after = await this.prisma.gameProfile.findUnique({ where: { userId }, select: { totalSeeds: true } });
        const totalSeeds = after?.totalSeeds ?? Math.min(tankCap, p.totalSeeds + seeds);
        // Số 💧 thật vào bình (bình đầy thì phần tràn bị cắt), không phải số định cộng.
        const seedsEarned = Math.max(0, Math.min(seeds, totalSeeds - p.totalSeeds));
        // Bình đầy cắt phần tràn: chỉ khi toàn bộ số định cộng vào bình mới được khoe thưởng, kẻo báo "+5 💧" mà bình không tăng.
        const credited = seedsEarned >= seeds;
        return { seedsEarned, pointsEarned: 0, streakDays, totalSeeds, streakFrozeUsed, bonusNote: credited ? bonusNote : '', bonuses: credited ? bonuses : [] };
      }
    }
    throw new BadRequestException('Điểm danh chưa xong, bạn thử lại nhé 🌿');
  }

  /**
   * Một lượt đọc-tính-ghi. Trả null khi ghi hụt vì hồ sơ vừa đổi (streakDays/streakFreezes/brokenStreakAt) — người gọi
   * đọc lại và tính lại; đã điểm danh hôm nay thì ném lỗi ngay ở lần đọc sau.
   */
  private async tryCheckIn(userId: string) {
    const p = await this.ensure(userId);
    const today = vnDateKey();
    if (p.lastCheckInAt && vnDateKey(p.lastCheckInAt) === today) {
      throw new BadRequestException('Hôm nay bạn đã điểm danh rồi 🌿');
    }

    // Compute exact day gap using UTC+7 dayKey strings to avoid DST drift
    const gapDays = p.lastCheckInAt
      ? Math.round((Date.parse(today) - Date.parse(vnDateKey(p.lastCheckInAt))) / DAY)
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

    // §streak-repair: ghi nhận chuỗi vừa mất (để cho phép hồi sinh), hoặc xoá record cũ khi chuỗi được giữ.
    let brokenStreakDays = p.brokenStreakDays;
    let brokenStreakAt = p.brokenStreakAt;
    if (gapDays === 1) {
      brokenStreakDays = 0;
      brokenStreakAt = null; // chuỗi tiếp tục → xoá record cũ (nếu có)
    } else if (gapDays === 2 && p.streakFreezes > 0) {
      brokenStreakDays = 0;
      brokenStreakAt = null; // vé giữ lửa cứu → xoá record
    } else {
      // reset: nếu vừa mất một chuỗi thực sự (>1) thì ghi lại để cho hồi sinh
      if (p.streakDays > 1) {
        brokenStreakDays = p.streakDays;
        brokenStreakAt = new Date();
      }
    }

    const loginSeeds = await configInt(this.config, 'game.daily_login_seeds', DAILY_LOGIN_SEEDS_DEFAULT);
    let seeds = loginSeeds;
    const notes: string[] = [];
    // Các khoản này đã nằm trong `seeds` (tổng cộng vào bình): màn hình phải ghi "gồm", không cộng dồn lần hai.
    const bonuses: Array<{ seeds: number; label: string }> = [];
    if (streakDays % 7 === 0) {
      const bonus = await streak7Seeds(this.config);
      seeds += bonus;
      notes.push(`+${bonus} 💧 chuỗi 7 ngày!`);
      bonuses.push({ seeds: bonus, label: 'chuỗi 7 ngày' });
    } else if (streakDays % 3 === 0) {
      seeds += 5;
      notes.push('+5 💧 chuỗi 3 ngày!');
      bonuses.push({ seeds: 5, label: 'chuỗi 3 ngày' });
    }
    // Quà lần điểm danh đầu: chỉ một lần, vì điều kiện ghi bên dưới (lastCheckInAt null hoặc trước hôm nay) chỉ cho một
    // request thắng, request song song còn lại ghi hụt rồi gặp "đã điểm danh hôm nay".
    if (p.lastCheckInAt === null) {
      const first = await configInt(this.config, 'game.first_checkin_bonus', FIRST_CHECKIN_BONUS_DEFAULT);
      if (first > 0) {
        seeds += first;
        notes.push(`+${first} 💧 quà điểm danh đầu tiên!`);
        bonuses.push({ seeds: first, label: 'quà điểm danh đầu tiên' });
      }
    } else if (gapDays !== null) {
      const gapNeeded = await configInt(this.config, 'game.comeback_gap_days', COMEBACK_GAP_DAYS_DEFAULT);
      const comeback = await configInt(this.config, 'game.comeback_seeds', COMEBACK_SEEDS_DEFAULT);
      if (gapDays >= gapNeeded && comeback > 0) {
        seeds += comeback;
        notes.unshift(`Chào mừng bạn quay lại! +${comeback} 💧`);
        bonuses.unshift({ seeds: comeback, label: 'quà quay lại' });
      }
    }
    const bonusNote = notes.join(' ');
    // Idempotent write: only one concurrent call wins (race-safe backstop).
    // totalSeeds ghi ATOMIC bằng increment (không phải absolute value đọc-ngoài-tx) — chống
    // lost-update khi checkIn đụng độ với spin/buySeeds/quiz/gift khác đang đổi totalSeeds cùng
    // lúc; clamp cap bằng updateMany guard riêng ở checkIn (không unconditional-overwrite giá trị
    // vừa được thao tác khác cộng thêm).
    // streakDays/streakFreezes/brokenStreakAt là giá trị tuyệt đối suy ra từ lần đọc, nên điều kiện WHERE phải khớp
    // đúng lần đọc đó: mua vé giữ lửa hoặc hồi sinh chuỗi chen vào giữa thì không ghi đè mất kết quả của chúng.
    const res = await this.prisma.gameProfile.updateMany({
      where: {
        userId,
        OR: [{ lastCheckInAt: null }, { lastCheckInAt: { lt: this.startOfDay(new Date()) } }],
        streakDays: p.streakDays,
        streakFreezes: p.streakFreezes,
        brokenStreakAt: p.brokenStreakAt,
      },
      data: {
        totalSeeds: { increment: seeds },
        streakDays,
        streakFreezes,
        longestStreak: Math.max(p.longestStreak, streakDays),
        lastCheckInAt: new Date(),
        brokenStreakDays,
        brokenStreakAt,
        ...(streakFrozeUsed ? { lastStreakFreezeAt: new Date() } : {}),
      },
    });
    if (res.count === 0) return null;
    return { p, seeds, streakDays, streakFrozeUsed, bonusNote, bonuses };
  }

  async collectDew(userId: string) {
    const p = await this.ensure(userId);
    if (p.lastDewAt && vnDateKey(p.lastDewAt) === vnDateKey()) {
      throw new BadRequestException('Hôm nay bạn đã hứng giọt sương rồi 🌿');
    }
    const dew = await configInt(this.config, 'game.dew_seeds', DEW_SEEDS_DEFAULT);
    const tankCap = await this.config.get<number>('game.tank_capacity', 500);

    // Idempotent write: only one concurrent call wins (race-safe backstop).
    // totalSeeds ghi ATOMIC bằng increment (không phải absolute value đọc-ngoài-tx) — chống
    // lost-update khi collectDew đụng độ với spin/checkin/quiz/gift khác đang đổi totalSeeds.
    const res = await this.prisma.gameProfile.updateMany({
      where: {
        userId,
        OR: [{ lastDewAt: null }, { lastDewAt: { lt: this.startOfDay(new Date()) } }],
      },
      data: { totalSeeds: { increment: dew }, lastDewAt: new Date() },
    });
    if (res.count === 0) throw new BadRequestException('Hôm nay bạn đã hứng giọt sương rồi 🌿');
    await clampTankKeepingOverflow(this.prisma, userId, tankCap, dew);

    const after = await this.prisma.gameProfile.findUnique({ where: { userId }, select: { totalSeeds: true } });
    const totalSeeds = after?.totalSeeds ?? Math.min(tankCap, p.totalSeeds + dew);
    const seedsEarned = Math.max(0, Math.min(dew, totalSeeds - p.totalSeeds));
    return { seedsEarned, totalSeeds };
  }

  /** §streak-repair: hồi sinh chuỗi vừa mất bằng 💧, trong cửa sổ 48h, tối đa 1 lần/30 ngày. */
  async repairStreak(userId: string) {
    const windowH = await this.config.get<number>('game.streak_repair_window_hours', 48);
    const cooldownD = await this.config.get<number>('game.streak_repair_cooldown_days', 30);
    const cost = await this.config.get<number>('game.streak_repair_cost', 150);
    for (let attempt = 0; attempt < GameEconomyService.STREAK_CAS_ATTEMPTS; attempt++) {
      const p = await this.ensure(userId);
      if (!p.brokenStreakAt || p.brokenStreakDays <= 0) {
        throw new BadRequestException('Không có chuỗi nào để hồi sinh.');
      }
      if (Date.now() - p.brokenStreakAt.getTime() > windowH * 3600 * 1000) {
        throw new BadRequestException('Đã quá hạn hồi sinh chuỗi 🔥');
      }
      if (p.lastStreakRepairAt && Date.now() - p.lastStreakRepairAt.getTime() < cooldownD * 86400 * 1000) {
        throw new BadRequestException('Bạn đã hồi sinh chuỗi gần đây, hãy thử lại sau 🌿');
      }
      const newStreak = p.brokenStreakDays + 1;
      // newStreak và longestStreak suy ra từ lần đọc: điểm danh chen vào (đổi streakDays/brokenStreakAt) thì ghi hụt
      // và đọc lại, không ghi đè chuỗi mới bằng số tính từ hồ sơ cũ.
      const res = await this.prisma.gameProfile.updateMany({
        where: {
          userId,
          totalSeeds: { gte: cost },
          streakDays: p.streakDays,
          brokenStreakAt: p.brokenStreakAt,
          brokenStreakDays: p.brokenStreakDays,
        },
        data: {
          totalSeeds: { decrement: cost },
          streakDays: newStreak,
          longestStreak: Math.max(p.longestStreak, newStreak),
          brokenStreakDays: 0,
          brokenStreakAt: null,
          lastStreakRepairAt: new Date(),
        },
      });
      if (res.count === 1) {
        const after = await this.prisma.gameProfile.findUnique({ where: { userId } });
        return { repaired: true, streakDays: newStreak, totalSeeds: after?.totalSeeds ?? 0 };
      }
      // Hồ sơ không đổi chuỗi mà vẫn hụt → thiếu 💧; còn đổi thì đọc lại.
      const fresh = await this.prisma.gameProfile.findUnique({ where: { userId } });
      const unchanged =
        fresh &&
        fresh.streakDays === p.streakDays &&
        fresh.brokenStreakDays === p.brokenStreakDays &&
        fresh.brokenStreakAt?.getTime() === p.brokenStreakAt.getTime();
      if (unchanged) break;
    }
    throw new BadRequestException(`Cần ${cost} 💧 để hồi sinh chuỗi.`);
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
