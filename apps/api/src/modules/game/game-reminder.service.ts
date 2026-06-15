import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY = 864e5;

/**
 * Vườn Xanh 2.0 — Phase 1C: push nhắc giữ chân (OA/in-app; ZNS gate).
 * - Nhắc điểm danh: user có chuỗi đang chạy, điểm danh hôm qua nhưng hôm nay chưa
 *   → loss-aversion giữ lửa (Duolingo). Cron 1 lần/ngày nên tự nhiên 1 nhắc/ngày/user.
 * - Nhắc cây khát: cây đã từng tưới, quá (wilt-1) ngày chưa tưới nhưng chưa quá ngày
 *   chết → cảnh báo trước khi héo/mất tiến trình.
 * Notify luôn lưu INAPP; ZNS khi OA cấu hình. Lỗi gửi từng user không chặn cả lô.
 */
@Injectable()
export class GameReminderService {
  private readonly logger = new Logger(GameReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private startOfVNDay(d: Date): Date {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    utc7.setUTCHours(0, 0, 0, 0);
    return new Date(utc7.getTime() - 7 * 3600 * 1000);
  }

  /** Cron 11h sáng: gửi cả 2 loại nhắc trong ngày. */
  @Cron('0 11 * * *')
  async sendDailyReminders(): Promise<void> {
    const checkin = await this.sendCheckInReminders();
    const thirsty = await this.sendThirstyTreeReminders();
    if (checkin || thirsty) {
      this.logger.log(`Game reminders sent — check-in: ${checkin}, thirsty: ${thirsty}`);
    }
  }

  async sendCheckInReminders(): Promise<number> {
    const startToday = this.startOfVNDay(new Date());
    const startYesterday = new Date(startToday.getTime() - DAY);
    const profiles = await this.prisma.gameProfile.findMany({
      where: {
        streakDays: { gte: 1 },
        // điểm danh gần nhất rơi vào "hôm qua" (chưa điểm danh hôm nay)
        lastCheckInAt: { gte: startYesterday, lt: startToday },
      },
      select: { userId: true, streakDays: true, streakFreezes: true },
    });
    let sent = 0;
    for (const p of profiles) {
      await this.notifications
        .notify(p.userId, 'GAME_CHECKIN_REMINDER', {
          streak: String(p.streakDays),
          freezes: String(p.streakFreezes),
        })
        .catch(() => undefined);
      sent++;
    }
    return sent;
  }

  async sendThirstyTreeReminders(): Promise<number> {
    const wiltDays = await this.config.get<number>('game.wilt_days', 3);
    const deathDays = await this.config.get<number>('game.death_days', 7);
    const now = Date.now();
    const warnAfter = new Date(now - (wiltDays - 1) * DAY); // chưa tưới ≥ (wilt-1) ngày
    const deadBefore = new Date(now - deathDays * DAY); // nhưng chưa quá ngày chết
    const profiles = await this.prisma.gameProfile.findMany({
      where: {
        // đã từng tưới (cây đang lớn) + rơi vào cửa sổ sắp héo, chưa chết
        lastWateredAt: { lte: warnAfter, gt: deadBefore },
      },
      select: { userId: true },
    });
    let sent = 0;
    for (const p of profiles) {
      await this.notifications.notify(p.userId, 'GAME_TREE_THIRSTY', {}).catch(() => undefined);
      sent++;
    }
    return sent;
  }
}
