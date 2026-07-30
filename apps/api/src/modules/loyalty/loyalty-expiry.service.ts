import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY = 864e5;
const BATCH = 500; // giới hạn số user xử lý mỗi lần chạy cron (bound công việc).

/** Shape tối giản của PointsTransaction mà helper thuần cần. */
export interface PointExpiryTxn {
  id: string;
  delta: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface PointExpiryResult {
  /** Điểm đã hết hạn ngay bây giờ (còn tồn trong các lô hết hạn, chưa bị tiêu). */
  expiredNow: number;
  /** Điểm sắp hết hạn trong cửa sổ nhắc + mốc hết hạn sớm nhất. */
  expiringSoon: { amount: number; earliestExpiresAt: Date | null };
}

/**
 * Tính điểm hết hạn theo FIFO (lô cũ tiêu trước) — HÀM THUẦN, không đụng DB, tất định.
 *
 * Bất biến: pointsBalance == SUM(delta). Mỗi delta DƯƠNG là một "lô" điểm (có/không expiresAt),
 * mỗi delta ÂM (tiêu/đổi/hoàn/POINTS_EXPIRED kỳ trước) tiêu dần từ lô CŨ NHẤT.
 *
 * Idempotent: dòng POINTS_EXPIRED âm do cron tạo, ở lần chạy sau lại được replay tiêu FIFO
 * đúng lô đã hết hạn → expiredNow về 0 → chạy lại cùng ngày KHÔNG trừ đôi.
 *
 * KHÔNG bao giờ "đòi lại" điểm đã tiêu: điểm đã bị delta âm tiêu thì lô giảm remaining, phần
 * đã tiêu không còn nằm trong lô hết hạn.
 *
 * @param reminderWindowMs độ dài cửa sổ "sắp hết hạn" tính từ now (ms).
 */
export function computePointExpiry(
  txns: PointExpiryTxn[],
  now: Date,
  reminderWindowMs: number,
): PointExpiryResult {
  // Tất định: sort createdAt asc, tiebreak id asc (không phụ thuộc thứ tự đầu vào).
  const sorted = [...txns].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const lots: { remaining: number; expiresAt: Date | null }[] = [];
  for (const t of sorted) {
    if (t.delta > 0) {
      lots.push({ remaining: t.delta, expiresAt: t.expiresAt });
    } else if (t.delta < 0) {
      let toConsume = -t.delta;
      for (const lot of lots) {
        if (toConsume <= 0) break;
        const take = Math.min(lot.remaining, toConsume);
        lot.remaining -= take;
        toConsume -= take;
      }
      // Nếu còn dư (toConsume>0): lô đã cạn — bất biến vỡ, bỏ qua (không tạo remaining âm).
    }
  }

  const nowMs = now.getTime();
  const windowEnd = nowMs + reminderWindowMs;
  let expiredNow = 0;
  let soonAmount = 0;
  let earliest: Date | null = null;
  for (const lot of lots) {
    if (lot.remaining <= 0 || lot.expiresAt == null) continue; // null = không bao giờ hết hạn
    const expMs = lot.expiresAt.getTime();
    if (expMs <= nowMs) {
      expiredNow += lot.remaining;
    } else if (expMs <= windowEnd) {
      soonAmount += lot.remaining;
      if (earliest == null || expMs < earliest.getTime()) earliest = lot.expiresAt;
    }
  }

  return { expiredNow, expiringSoon: { amount: soonAmount, earliestExpiresAt: earliest } };
}

/**
 * Trừ điểm Xanh hết hạn theo FIFO + nhắc điểm sắp hết hạn (bổ sung vào loyalty §6.6).
 * KHÔNG thay đổi cách cộng/tiêu điểm ở nơi khác — chỉ THÊM 2 cron.
 */
@Injectable()
export class LoyaltyExpiryService {
  private readonly logger = new Logger(LoyaltyExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private loadTxns(userId: string): Promise<PointExpiryTxn[]> {
    return this.prisma.pointsTransaction.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, delta: true, expiresAt: true, createdAt: true },
    });
  }

  /**
   * Cron 1h sáng: trừ điểm đã hết hạn. Ứng viên = user có ÍT NHẤT 1 lô (delta>0) đã tới hạn;
   * với mỗi user tính lại FIFO từ TOÀN BỘ sổ cái → chỉ trừ phần còn tồn trong lô hết hạn.
   */
  @Cron('0 1 * * *')
  async expirePoints(): Promise<void> {
    const now = new Date();
    const candidates = await this.prisma.pointsTransaction.findMany({
      where: { delta: { gt: 0 }, expiresAt: { lte: now } },
      select: { userId: true },
      distinct: ['userId'],
      take: BATCH,
    });

    let totalExpired = 0;
    let affected = 0;
    for (const c of candidates) {
      const expired = await this.expireUser(c.userId, now).catch((e) => {
        this.logger.warn(`expirePoints lỗi user=${c.userId}: ${(e as Error).message}`);
        return 0;
      });
      if (expired > 0) {
        totalExpired += expired;
        affected++;
      }
    }
    if (affected) this.logger.log(`Điểm hết hạn: trừ ${totalExpired} điểm của ${affected} user.`);
  }

  /** Trừ điểm hết hạn cho 1 user (cặp atomic: decrement có guard + tạo txn âm). Trả về số điểm đã trừ. */
  private async expireUser(userId: string, now: Date): Promise<number> {
    const txns = await this.loadTxns(userId);
    const { expiredNow } = computePointExpiry(txns, now, 0);
    if (expiredNow <= 0) return 0;

    const applied = await this.prisma.$transaction(async (tx) => {
      // Guard gte: chỉ trừ khi số dư đủ → pointsBalance KHÔNG bao giờ âm. Nếu count=0
      // (bất biến vỡ: balance < expiredNow) → KHÔNG tạo txn âm, giữ ledger nhất quán.
      const res = await tx.user.updateMany({
        where: { id: userId, pointsBalance: { gte: expiredNow } },
        data: { pointsBalance: { decrement: expiredNow } },
      });
      if (res.count === 0) return false;
      await tx.pointsTransaction.create({
        data: { userId, delta: -expiredNow, reason: 'POINTS_EXPIRED', refType: 'EXPIRE' },
      });
      return true;
    });

    if (!applied) {
      this.logger.warn(
        `expirePoints bỏ qua user=${userId}: số dư < expiredNow=${expiredNow} (guard gte)`,
      );
      return 0;
    }
    return expiredNow;
  }

  /**
   * Cron 8h sáng: nhắc user có điểm sắp hết hạn trong cửa sổ (config point_expiry_reminder_days).
   * Dedup qua NotificationLog: bỏ qua nếu đã gửi POINTS_EXPIRING trong ≤ reminderDays ngày.
   */
  @Cron('0 8 * * *')
  async remindExpiringPoints(): Promise<void> {
    const reminderDays = await this.config.get<number>('loyalty.point_expiry_reminder_days', 7);
    const now = new Date();
    const windowMs = reminderDays * DAY;
    const windowEnd = new Date(now.getTime() + windowMs);

    const candidates = await this.prisma.pointsTransaction.findMany({
      where: { delta: { gt: 0 }, expiresAt: { gt: now, lte: windowEnd } },
      select: { userId: true },
      distinct: ['userId'],
      take: BATCH,
    });

    let sent = 0;
    for (const c of candidates) {
      const ok = await this.remindUser(c.userId, now, windowMs, reminderDays).catch((e) => {
        this.logger.warn(`remindExpiringPoints lỗi user=${c.userId}: ${(e as Error).message}`);
        return false;
      });
      if (ok) sent++;
    }
    if (sent) this.logger.log(`Nhắc điểm sắp hết hạn: ${sent} user.`);
  }

  private async remindUser(
    userId: string,
    now: Date,
    windowMs: number,
    reminderDays: number,
  ): Promise<boolean> {
    const txns = await this.loadTxns(userId);
    const { expiringSoon } = computePointExpiry(txns, now, windowMs);
    if (expiringSoon.amount <= 0 || !expiringSoon.earliestExpiresAt) return false;

    // Dedup: đã nhắc trong kỳ (POINTS_EXPIRING trong ≤ reminderDays) → bỏ qua (chống spam).
    const since = new Date(now.getTime() - reminderDays * DAY);
    const recent = await this.prisma.notificationLog.findFirst({
      where: { userId, templateCode: 'POINTS_EXPIRING', sentAt: { gte: since } },
      select: { id: true },
    });
    if (recent) return false;

    await this.notifications
      .notify(userId, 'POINTS_EXPIRING', {
        points: String(expiringSoon.amount),
        date: expiringSoon.earliestExpiresAt.toLocaleDateString('vi-VN'),
      })
      .catch(() => undefined); // gửi lỗi không chặn lô (notify tự nuốt lỗi ZNS)
    return true;
  }
}
