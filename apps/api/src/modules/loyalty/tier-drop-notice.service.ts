import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoyaltyService } from './loyalty.service';
import { CRON_TZ } from '../../common/cron-tz';
import { formatVndText } from '../../common/format-vnd';
import { formatPoints } from '../../common/format-points';
import { startOfVnDay, vnDateParts } from '../../common/vn-time';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';

export const TIER_DROP_NOTICE_CODE = 'TIER_DROP_NOTICE';
export const TIER_DROP_NOTICE_DAYS_KEY = 'loyalty.tier_drop_notice_days';
export const TIER_DROP_NOTICE_DAYS_DEFAULT = 14;
/** Mã mẫu ZNS Zalo đã duyệt cho tin này (biến tier, date, need). Trống = chỉ báo trong app. */
export const TIER_DROP_ZNS_TEMPLATE_KEY = 'loyalty.tier_drop_zns_template_id';

const DAY_MS = 864e5;
const PAGE = 200;

/**
 * Báo khách trước khi hạ hạng: khi hạn giữ hạng (tierGraceUntil) còn ≤ N ngày lịch VN. Mỗi kỳ giữ hạng báo đúng một lần:
 * `tierDropNoticeFor` ghi lại hạn đã báo, kỳ giữ hạng mới có hạn khác nên được báo lại.
 */
@Injectable()
export class TierDropNoticeService {
  private readonly logger = new Logger(TierDropNoticeService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly notifications: NotificationsService,
  ) {}

  // 03:45: sau lượt tính lại hạng 03:15, nên khách vừa đủ điều kiện giữ hạng đã được gỡ hạn và không bị báo nhầm.
  @Cron('0 45 3 * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async runDaily(): Promise<void> {
    if (this.running) {
      markCronSkipped('RUNNING');
      return;
    }
    this.running = true;
    try {
      const n = await this.sendNotices();
      if (n > 0) this.logger.log(`Đã báo trước hạ hạng cho ${n} khách.`);
    } catch (err) {
      this.logger.error(`Cron báo trước hạ hạng lỗi: ${err instanceof Error ? err.stack ?? err.message : err}`);
    } finally {
      this.running = false;
    }
  }

  private async noticeDays(): Promise<number> {
    const raw = await this.config.get<unknown>(TIER_DROP_NOTICE_DAYS_KEY, TIER_DROP_NOTICE_DAYS_DEFAULT);
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 365 ? raw : TIER_DROP_NOTICE_DAYS_DEFAULT;
  }

  private async znsTemplateId(): Promise<string | undefined> {
    const raw = await this.config.get<unknown>(TIER_DROP_ZNS_TEMPLATE_KEY, '');
    return typeof raw === 'string' && /^\d{1,20}$/.test(raw.trim()) ? raw.trim() : undefined;
  }

  /** Số khách đã được báo ở lượt này. */
  async sendNotices(now: Date = new Date()): Promise<number> {
    const days = await this.noticeDays();
    if (days === 0) return 0;
    // Hạn tính theo NGÀY lịch VN: hạn rơi bất kỳ giờ nào của ngày (hôm nay + N) vẫn được báo.
    const cutoff = new Date(startOfVnDay(now).getTime() + (days + 1) * DAY_MS);
    const znsTemplateId = await this.znsTemplateId();
    let sent = 0;
    let after: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { tierGraceUntil: { gt: now, lt: cutoff }, tierId: { not: null }, mergedIntoId: null, isBlocked: false },
        include: { tier: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      });
      if (users.length === 0) break;
      after = users[users.length - 1]!.id;
      for (const u of users) {
        const until = u.tierGraceUntil;
        if (!until || !u.tier || u.tierDropNoticeFor?.getTime() === until.getTime()) continue;
        try {
          if (await this.noticeOne(u.id, u.tier, until, u.tierDropNoticeFor, znsTemplateId)) sent++;
        } catch (err) {
          this.logger.error(`Báo trước hạ hạng cho ${u.id} lỗi: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (users.length < PAGE) break;
    }
    return sent;
  }

  private async noticeOne(
    userId: string,
    tier: { name: string; minSpending: number | null; minPoints: number },
    until: Date,
    previous: Date | null,
    znsTemplateId: string | undefined,
  ): Promise<boolean> {
    const gap = await this.loyalty.tierKeepGap(userId, tier);
    const need =
      gap.spendingToKeep != null
        ? gap.spendingToKeep > 0
          ? `Mua thêm ${formatVndText(gap.spendingToKeep)} đơn giao thành công`
          : null
        : gap.pointsToKeep > 0
          ? `Tích thêm ${formatPoints(gap.pointsToKeep)} Điểm Xanh từ đơn giao thành công`
          : null;
    // Đã đủ điều kiện giữ hạng (lượt tính lại hạng kế tiếp sẽ gỡ hạn): không doạ khách.
    if (!need) return false;

    // Nhận phần việc trước khi gửi: hai bản chạy song song chỉ một bên thắng nên không gửi trùng.
    const claim = await this.prisma.user.updateMany({
      where: { id: userId, tierGraceUntil: until, tierDropNoticeFor: previous },
      data: { tierDropNoticeFor: until },
    });
    if (claim.count !== 1) return false;
    try {
      const { year, month, day } = vnDateParts(until);
      const p2 = (n: number) => String(n).padStart(2, '0');
      await this.notifications.notify(
        userId,
        TIER_DROP_NOTICE_CODE,
        { tier: tier.name, date: `${p2(day)}/${p2(month)}/${year}`, need },
        // dedupeKey: tin trong app đã lưu mà bước ZNS lỗi thì đêm sau thử lại không được lưu thêm một tin nữa.
        { dedupeKey: `tier-drop:${until.toISOString()}`, ...(znsTemplateId ? { znsTemplateId } : {}) },
      );
    } catch (err) {
      // Chưa gửi được thì trả phần việc lại để đêm sau thử tiếp.
      await this.prisma.user.updateMany({ where: { id: userId, tierDropNoticeFor: until }, data: { tierDropNoticeFor: previous } });
      throw err;
    }
    return true;
  }
}
