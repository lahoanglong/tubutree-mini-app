import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_TZ } from '../../common/cron-tz';
import { NotificationsService } from '../notifications/notifications.service';
import { MerchantFulfilmentService, slaStateOf } from './merchant-fulfilment.service';
import { TrackCron } from '../../common/cron-run/track-cron';

const LOCK_KEY = 'cron:merchant.sla_reminder';
/** Nhắc lại cùng một đơn tối đa mỗi chừng này giờ. */
export const SLA_REMIND_EVERY_HOURS = 12;

const STEP_LABEL = {
  CONFIRM_OVERDUE: 'xác nhận đơn',
  SHIP_OVERDUE: 'gửi hàng cho đơn vị vận chuyển',
  DELIVER_OVERDUE: 'xác nhận đã giao',
} as const;

/** Bước chậm nói với khách — chỉ các bước trước khi gửi hàng, lúc khách còn tự huỷ được (D1). */
const BUYER_STEP_LABEL: Partial<Record<keyof typeof STEP_LABEL, string>> = {
  CONFIRM_OVERDUE: 'xác nhận đơn',
  SHIP_OVERDUE: 'gửi hàng',
};

export type SlaReminderResult = { skipped: 'RUNNING' | 'LOCKED' } | { scanned: number; notified: number };

/** Mỗi giờ nhắc đối tác các đơn tự giao quá hạn (docs/2026-10-14-merchant-fulfilment-design.md mục 6, 8). */
@Injectable()
export class MerchantSlaCron {
  private readonly logger = new Logger(MerchantSlaCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfilment: MerchantFulfilmentService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  @Cron('0 15 * * * *', { name: 'merchant.sla-reminder', timeZone: CRON_TZ })
  @TrackCron()
  async handleCron(): Promise<void> {
    try {
      const res = await this.remind();
      if ('notified' in res && res.notified > 0) this.logger.log(`Nhắc đối tác đơn quá hạn: ${res.notified}/${res.scanned}.`);
    } catch (err) {
      this.logger.error(`Cron nhắc đối tác lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async remind(now: Date = new Date()): Promise<SlaReminderResult> {
    if (this.running) return { skipped: 'RUNNING' };
    this.running = true;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS "locked"`;
          if (!row?.locked) return { skipped: 'LOCKED' as const };
          return this.remindOverdue(now);
        },
        { maxWait: 10_000, timeout: 10 * 60_000 },
      );
    } finally {
      this.running = false;
    }
  }

  private async remindOverdue(now: Date): Promise<{ scanned: number; notified: number }> {
    const sla = await this.fulfilment.slaConfig();
    const overdue = await this.fulfilment.overdueOrders(sla, now, 500);
    const remindBefore = new Date(now.getTime() - SLA_REMIND_EVERY_HOURS * 3_600_000);
    let notified = 0;
    for (const o of overdue) {
      const { state } = slaStateOf(o, sla, now);
      const ownerId = o.fulfillerStorefront?.ownerUserId;
      if (!state || !ownerId) continue;
      // Ghi mốc nhắc có điều kiện trước khi gửi: hai instance (hoặc lượt chạy chồng) không nhắc trùng.
      const claimed = await this.prisma.order.updateMany({
        where: {
          id: o.id,
          OR: [{ merchantSlaNotifiedAt: null }, { merchantSlaNotifiedAt: { lt: remindBefore } }],
        },
        data: { merchantSlaNotifiedAt: now },
      });
      if (claimed.count === 0 || !this.notifications) continue;
      try {
        await this.notifications.notify(ownerId, 'MERCHANT_ORDER_OVERDUE', { order_code: o.code, step: STEP_LABEL[state] });
        notified++;
        // Lần nhắc đầu: báo luôn khách đang chờ (R2-MERCHANT-11), để khách chọn chờ tiếp hoặc tự huỷ khi hàng chưa gửi.
        const buyerStep = BUYER_STEP_LABEL[state];
        if (buyerStep && !o.merchantSlaNotifiedAt) {
          await this.notifications.notify(o.userId, 'ORDER_MERCHANT_DELAYED', {
            order_code: o.code,
            store: o.fulfillerStorefront?.title ?? 'Gian hàng',
            step: buyerStep,
          });
        }
      } catch (err) {
        this.logger.warn(`Nhắc đối tác đơn ${o.code} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { scanned: overdue.length, notified };
  }
}
