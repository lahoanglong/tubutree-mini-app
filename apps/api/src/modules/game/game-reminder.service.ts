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
  private static readonly PAGE = 500;
  /** 500 × 200 = 100.000 vườn mỗi lượt — quá đủ, và chặn vòng lặp vô tận nếu truy vấn sai. */
  private static readonly MAX_PAGES = 200;
  /** Không nhắc "cây khát" lại trong ngần này ngày (cửa sổ héo rộng tới 5 ngày). */
  private static readonly THIRSTY_COOLDOWN_DAYS = 3;

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
    let sent = 0;
    // Phân trang: `findMany` không giới hạn sẽ nạp toàn bộ vườn đang hoạt động vào RAM rồi gửi
    // tuần tự — 50 nghìn vườn là job chạy hàng giờ và giữ nguyên chừng ấy dòng trong bộ nhớ.
    for await (const batch of this.pageProfiles({
      streakDays: { gte: 1 },
      // điểm danh gần nhất rơi vào "hôm qua" (chưa điểm danh hôm nay)
      lastCheckInAt: { gte: startYesterday, lt: startToday },
    })) {
      for (const p of batch) {
        await this.notifications
          .notify(p.userId, 'GAME_CHECKIN_REMINDER', {
            streak: String(p.streakDays ?? 0),
            freezes: String(p.streakFreezes ?? 0),
          })
          .catch(() => undefined);
        sent++;
      }
    }
    return sent;
  }

  /** Duyệt GameProfile theo lô bằng cursor — trần an toàn để job không chạy vô tận. */
  private async *pageProfiles(
    where: Record<string, unknown>,
  ): AsyncGenerator<{ userId: string; streakDays?: number; streakFreezes?: number }[]> {
    let cursor: string | undefined;
    for (let page = 0; page < GameReminderService.MAX_PAGES; page++) {
      const rows = await this.prisma.gameProfile.findMany({
        where,
        orderBy: { id: 'asc' },
        take: GameReminderService.PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, userId: true, streakDays: true, streakFreezes: true },
      });
      if (rows.length === 0) return;
      cursor = rows[rows.length - 1]!.id;
      yield rows;
      if (rows.length < GameReminderService.PAGE) return;
    }
  }

  async sendThirstyTreeReminders(): Promise<number> {
    const wiltDays = await this.config.get<number>('game.wilt_days', 3);
    const deathDays = await this.config.get<number>('game.death_days', 7);
    const now = Date.now();
    const warnAfter = new Date(now - (wiltDays - 1) * DAY); // chưa tưới ≥ (wilt-1) ngày
    const deadBefore = new Date(now - deathDays * DAY); // nhưng chưa quá ngày chết
    // Cửa sổ "sắp héo" rộng tới (death − wilt + 1) ngày, mặc định là 5 — không có cờ chống lặp
    // nghĩa là CÙNG một người nhận đúng thông báo này 5 ngày liên tiếp. Dò lại nhật ký thông báo
    // trong 3 ngày gần nhất thay vì thêm cột mới: một truy vấn cho cả lô.
    const recentlyReminded = new Set(
      (
        await this.prisma.notificationLog.findMany({
          where: {
            templateCode: 'GAME_TREE_THIRSTY',
            sentAt: { gte: new Date(now - GameReminderService.THIRSTY_COOLDOWN_DAYS * DAY) },
          },
          select: { userId: true },
          distinct: ['userId'],
          take: 20_000,
        })
      ).map((r) => r.userId),
    );

    let sent = 0;
    for await (const batch of this.pageProfiles({
      // đã từng tưới (cây đang lớn) + rơi vào cửa sổ sắp héo, chưa chết
      lastWateredAt: { lte: warnAfter, gt: deadBefore },
    })) {
      for (const p of batch) {
        if (recentlyReminded.has(p.userId)) continue;
        await this.notifications.notify(p.userId, 'GAME_TREE_THIRSTY', {}).catch(() => undefined);
        sent++;
      }
    }
    return sent;
  }
}
