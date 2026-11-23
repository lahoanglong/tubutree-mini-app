import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CRON_TZ } from '../../common/cron-tz';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { formatVnDate, startOfVnDay, vnDateKey } from '../../common/vn-time';
import { isSellableVariation } from '../cart/sellable';
import { isPartnerOwnedVariation } from '../cart/partner-goods';

/** Mẫu tin "ngày mai Tubu tự đặt đơn định kỳ". Có trong prisma/seed.ts, lên PROD qua `prisma:seed:reference` lúc deploy (không migration). */
export const SUBSCRIPTION_UPCOMING_TEMPLATE = 'SUBSCRIPTION_UPCOMING';

/** Khoá chống trùng của tin: một gói một tin cho mỗi ngày giao (YYYY-MM-DD giờ VN). Dời sang ngày khác thì ngày mới được nhắc lại. */
export const subscriptionUpcomingDedupeKey = (subscriptionId: string, runAt: Date) => `sub_upcoming:${subscriptionId}:${vnDateKey(runAt)}`;

/** `sent`: lượt notify() không lỗi, gồm cả tin đã gửi từ trước (trùng khoá) và khách tắt nhận tin, nên chạy lại trong ngày vẫn đếm. */
export type SubscriptionUpcomingRun =
  | { skipped: 'RUNNING' | 'LOCKED' | 'NO_TEMPLATE' | 'ERROR' }
  | { due: number; sent: number; notSellable: number; failed: number };

/**
 * 09:00 giờ VN: nhắc khách có gói ACTIVE mà kỳ giao rơi vào NGÀY MAI (giờ VN) trước khi cron 03:00 tự ra đơn, để khách kịp đổi số lượng, dời
 * ngày hay bỏ qua kỳ. Nút của tin mở tab Định kỳ (app-core notification-route, nhánh SUBSCRIPTION*).
 * - Chống trùng bằng `dedupeKey` của notification_logs (`sub_upcoming:<gói>:<ngày giao>`): chạy lại hay nhiều instance cũng chỉ một tin mỗi kỳ.
 * - Bỏ gói đang thử lại kỳ vì hết hàng (retryCount > 0): khách đã nhận tin "Tubu sẽ tự thử lại vào ngày mai".
 * - Bỏ gói có sản phẩm đã ngừng bán hoặc là hàng gian hàng đối tác: đêm đó cron tạm dừng gói và báo riêng, nói "sẽ tự đặt đơn" là sai.
 *   Ví thiếu tiền, hết hàng, địa chỉ hỏng thì không đoán trước (có thể đổi trước 03:00): vẫn nhắc, đêm đó cron báo riêng nếu không ra đơn.
 * - Chưa có mẫu tin (DB chưa chạy seed:reference) thì không gửi gì: thiếu mẫu, notify() rơi về câu trung tính.
 */
@Injectable()
export class SubscriptionUpcomingService {
  private static readonly LOCK_KEY = 'cron:subscriptions.upcoming_nudge';
  static readonly PAGE = 200;
  static readonly MAX_PAGES = 50;
  private readonly logger = new Logger(SubscriptionUpcomingService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 9 * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async nudgeUpcoming(now: Date = new Date()): Promise<SubscriptionUpcomingRun> {
    if (this.running) {
      markCronSkipped('RUNNING');
      return { skipped: 'RUNNING' };
    }
    this.running = true;
    try {
      const tpl = await this.prisma.notificationTemplate.findUnique({ where: { code: SUBSCRIPTION_UPCOMING_TEMPLATE }, select: { id: true } });
      if (!tpl) {
        this.logger.warn(`Thiếu mẫu ${SUBSCRIPTION_UPCOMING_TEMPLATE} (chưa chạy prisma:seed:reference): bỏ lượt nhắc gói định kỳ.`);
        markCronSkipped('NOT_CONFIGURED');
        return { skipped: 'NO_TEMPLATE' };
      }
      const run = await runExclusive(this.prisma, SubscriptionUpcomingService.LOCK_KEY, () => this.runOnce(now));
      if (!run.acquired) {
        markCronSkipped('LOCKED');
        return { skipped: 'LOCKED' };
      }
      return run.value;
    } catch (err) {
      this.logger.error(`Nhắc gói định kỳ ngày mai lỗi: ${err instanceof Error ? err.message : err}`);
      return { skipped: 'ERROR' };
    } finally {
      this.running = false;
    }
  }

  private async runOnce(now: Date): Promise<Exclude<SubscriptionUpcomingRun, { skipped: string }>> {
    const from = new Date(startOfVnDay(now).getTime() + 864e5);
    const to = new Date(from.getTime() + 864e5);
    const stats = { due: 0, sent: 0, notSellable: 0, failed: 0 };
    let afterId: string | null = null;
    for (let page = 0; page < SubscriptionUpcomingService.MAX_PAGES; page++) {
      const subs: Array<{ id: string; userId: string; variationId: string; nextRunAt: Date }> = await this.prisma.subscription.findMany({
        where: { status: 'ACTIVE', retryCount: 0, nextRunAt: { gte: from, lt: to }, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: 'asc' },
        take: SubscriptionUpcomingService.PAGE,
        select: { id: true, userId: true, variationId: true, nextRunAt: true },
      });
      if (subs.length === 0) break;
      const variations = await this.prisma.variation.findMany({
        where: { id: { in: [...new Set(subs.map((s) => s.variationId))] } },
        select: { id: true, isActive: true, product: { select: { name: true, isActive: true, approvalStatus: true, storefrontId: true } } },
      });
      const byId = new Map(variations.map((v) => [v.id, v]));
      for (const s of subs) {
        stats.due++;
        const v = byId.get(s.variationId);
        if (!v || !isSellableVariation(v) || isPartnerOwnedVariation(v)) {
          stats.notSellable++;
          continue;
        }
        const ok = await this.notifications.notifySafe(
          s.userId,
          'SUBSCRIPTION_UPCOMING',
          { product: v.product.name, date: formatVnDate(s.nextRunAt) },
          { dedupeKey: subscriptionUpcomingDedupeKey(s.id, s.nextRunAt) },
          `sub=${s.id}`,
        );
        if (ok) stats.sent++;
        else stats.failed++;
      }
      afterId = subs[subs.length - 1]!.id;
      if (subs.length < SubscriptionUpcomingService.PAGE) break;
    }
    if (stats.due > 0) this.logger.log(`Nhắc gói định kỳ ngày mai: ${JSON.stringify(stats)}.`);
    return stats;
  }
}
