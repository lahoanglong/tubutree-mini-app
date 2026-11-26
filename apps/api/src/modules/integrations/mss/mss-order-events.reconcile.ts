import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../../common/cron-tz';
import { markCronSkipped, noteCronError, TrackCron } from '../../../common/cron-run/track-cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderConfirmEmailService } from '../../notifications/order-email/order-confirm-email.service';
import { ORDER_CONFIRM_EMAIL_TEMPLATE } from '../../notifications/order-email/order-confirm-email';
import { MssFlagsService } from './mss-flags';
import { MssOrderEventFallback } from './mss-order-event.fallback';
import { MssOrderEventSender } from './mss-order-event.sender';
import {
  MSS_CLAIM_STALE_MS,
  MSS_COVERED_SKIP_REASONS,
  MSS_EMAIL_EVENT_TYPES,
  MSS_FALLBACK_STATUSES,
  MSS_FALLBACK_ZNS_GRACE_MS,
  MSS_HTTP_4XX_MAYBE_ACCEPTED,
  MSS_NO_ZNS_STATUSES,
  MSS_RESULT_RECONCILE_AFTER_MS,
  MSS_RESULT_STUCK_GRACE_MS,
  ORDER_ZALO_ACTIVE_STATUSES,
} from './mss-order-event-types';

export const MSS_ORDER_EVENTS_SWEEP_CRON = '30 */5 * * * *';
export const MSS_ORDER_EVENTS_RECONCILE_CRON = '45 */10 * * * *';
/** Dòng PENDING tới hạn lâu hơn chừng này mà chưa ai nhận: job đã mất (Redis hỏng, API chết sau commit), cron tự gửi. */
export const MSS_SWEEP_GRACE_MS = 60_000;
const BATCH = 50;
/** Cửa sổ tìm dòng đường lui để gửi email bù; email còn tự bỏ qua khi quá hạn sống của sự kiện (6 giờ + 15 phút). */
export const MSS_EMAIL_AFTER_ZNS_WINDOW_MS = 24 * 3_600_000;
/**
 * Dòng đường lui IN_APP_ONLY đã chốt quá chừng này mà đơn chưa có log EMAIL nào: email trong tiến trình đã mất (app tắt giữa chừng, cờ
 * `closing`, lỗi DB lúc gửi), cron gửi bù. Chờ đủ lâu để lần gửi trong tiến trình kịp ghi log PENDING.
 */
export const MSS_EMAIL_IN_APP_RESCUE_AFTER_MS = 2 * 60_000;
/** Mỗi lần gọi MSS tối đa 5 giây: giới hạn thời gian một lượt cron để MSS treo không giữ cron quá lượt kế. */
const RUN_BUDGET_MS = 120_000;

/**
 * Lưới an toàn của outbox MSS: quét bù dòng mất job hoặc kẹt SENDING, chạy nốt đường lui bị gián đoạn, và đối soát dòng đã giao MSS lâu
 * chưa có callback. Mọi bước đi qua cùng câu nhận dòng của worker nên chạy chồng worker không gửi đôi.
 */
@Injectable()
export class MssOrderEventReconcileService {
  private readonly logger = new Logger(MssOrderEventReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: MssFlagsService,
    private readonly sender: MssOrderEventSender,
    private readonly fallback: MssOrderEventFallback,
    @Optional() private readonly orderEmail?: OrderConfirmEmailService,
  ) {}

  @Cron(MSS_ORDER_EVENTS_SWEEP_CRON, { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 3 })
  async sweep(): Promise<void> {
    try {
      const r = await this.sweepOnce();
      if (r.delivered === 0 && r.fallbacks === 0 && !this.flags.configured()) markCronSkipped('NOT_CONFIGURED');
    } catch (err) {
      const msg = `Quét bù tin đơn MSS lỗi: ${err instanceof Error ? err.message : String(err)}`;
      noteCronError(msg);
      this.logger.error(msg);
    }
  }

  /** Một lượt quét (export cho test): gửi dòng mất job/kẹt, chạy đường lui còn dở. */
  async sweepOnce(now = Date.now()): Promise<{ delivered: number; fallbacks: number }> {
    const started = Date.now();
    const due = await this.prisma.mssOrderEventOutbox.findMany({
      where: {
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: new Date(now - MSS_SWEEP_GRACE_MS) } },
          { status: 'SENDING', claimedAt: { lt: new Date(now - MSS_CLAIM_STALE_MS) } },
        ],
      },
      select: { eventId: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH,
    });
    let delivered = 0;
    for (const row of due) {
      if (Date.now() - started > RUN_BUDGET_MS) break;
      const outcome = await this.sender.deliver(row.eventId);
      if (outcome !== 'not_claimable' && outcome !== 'not_found') delivered++;
    }
    const unsettled = await this.prisma.mssOrderEventOutbox.findMany({
      where: { status: { in: [...MSS_FALLBACK_STATUSES] }, fallbackAt: null },
      select: { eventId: true },
      orderBy: { updatedAt: 'asc' },
      take: BATCH,
    });
    let fallbacks = 0;
    for (const row of unsettled) {
      if ((await this.fallback.run(row.eventId)) !== null) fallbacks++;
    }
    const emails = await this.emailRescueOnce(now);
    if (delivered > 0 || fallbacks > 0 || emails > 0) this.logger.log(`Quét bù tin đơn MSS: gửi lại ${delivered}, đường lui ${fallbacks}, email ${emails}.`);
    return { delivered, fallbacks };
  }

  /**
   * Email xác nhận đơn gửi bù cho tin đặt đơn / đã nhận tiền của người mua, ở hai nhánh:
   * (A) đường lui đã gửi ZNS mà log ZNS của sự kiện kết thúc FAILED (hết lượt hoặc lỗi vĩnh viễn, khoá `mssFallbackDedupeKey` đã nhả thành
   *     `mss:<eventId>:failed:<id>`), không có log ZNS nào khác của sự kiện đang chờ hay đã gửi;
   * (B) đường lui IN_APP_ONLY đã chốt quá MSS_EMAIL_IN_APP_RESCUE_AFTER_MS mà email trong tiến trình chưa từng nhận việc (app tắt giữa chừng).
   * Cả hai chỉ khi đơn chưa có email nào (khoá `orderEmailDedupeKey`, kể cả FAILED: lượt quét không gửi lại email lỗi). Câu chọn bỏ trước
   * mọi dòng OrderConfirmEmailService sẽ từ chối (luật `mssEmailEligible` bản SQL, quá hạn sống, đơn đã đóng, đơn đã có tin Zalo MSS tới
   * hoặc có thể đã tới khách: dòng người mua `MSS_NO_ZNS_STATUSES`) để chúng không chiếm chỗ trong lô của dòng còn gửi được. SMTP chưa sẵn sàng thì không chạy câu chọn. Log tìm theo khoá, không
   * theo userId (đơn đổi chủ khi khách vãng lai đăng nhập), giới hạn từ trước lúc tạo đơn một ngày theo chỉ mục (channel, status, sentAt) /
   * (templateCode, sentAt). Gửi đôi bị chặn bởi khoá advisory theo mã đơn + log PENDING/SENT trong service. Trả số email đã gửi.
   */
  async emailRescueOnce(now = Date.now()): Promise<number> {
    if (!this.orderEmail || !(await this.orderEmail.enabled()) || !this.orderEmail.ready()) return 0;
    const started = Date.now();
    // Cột timestamp(3) không múi giờ: so với mốc UTC tường minh, không theo TimeZone của phiên.
    const since = new Date(now - MSS_EMAIL_AFTER_ZNS_WINDOW_MS);
    const freshFrom = new Date(now - MSS_FALLBACK_ZNS_GRACE_MS);
    const inAppSettledBefore = new Date(now - MSS_EMAIL_IN_APP_RESCUE_AFTER_MS);
    const maybeAccepted = Prisma.join([...MSS_HTTP_4XX_MAYBE_ACCEPTED]);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT o."id"
        FROM "mss_order_event_outbox" o
        JOIN "orders" ord ON ord."id" = o."orderId"
       WHERE o."recipientRole" = 'buyer'
         AND o."eventType" IN (${Prisma.join([...MSS_EMAIL_EVENT_TYPES])})
         AND o."fallbackAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
         AND o."expiresAt" >= (${freshFrom.toISOString()}::timestamptz AT TIME ZONE 'UTC')
         AND ord."status"::text IN (${Prisma.join([...ORDER_ZALO_ACTIVE_STATUSES])})
         AND (
              (o."status" = 'RESULT_SKIPPED' AND (o."resultReason" IS NULL OR o."resultReason" NOT IN (${Prisma.join([...MSS_COVERED_SKIP_REASONS])})))
           OR  o."status" = 'RESULT_FAILED'
           OR (o."status" = 'DEAD' AND o."resultReason" IS DISTINCT FROM 'event_id_reused'
               AND (o."lastHttpStatus" IS NULL OR (o."lastHttpStatus" BETWEEN 400 AND 499 AND o."lastHttpStatus" NOT IN (${maybeAccepted}))))
           OR (o."status" = 'EXPIRED' AND (o."resultReason" = 'mss_lost'
               OR (o."lastHttpStatus" BETWEEN 400 AND 499 AND o."lastHttpStatus" NOT IN (${maybeAccepted}))))
         )
         AND NOT EXISTS (
           SELECT 1 FROM "mss_order_event_outbox" s
            WHERE s."orderId" = o."orderId" AND s."recipientRole" = 'buyer' AND s."status" IN (${Prisma.join([...MSS_NO_ZNS_STATUSES])}))
         AND NOT EXISTS (
           SELECT 1 FROM "notification_logs" e
            WHERE e."templateCode" = ${ORDER_CONFIRM_EMAIL_TEMPLATE} AND e."channel" = 'EMAIL' AND e."sentAt" >= ord."createdAt" - interval '1 day'
              AND e."payload" ->> 'dedupeKey' = 'order-email:' || ord."code")
         AND (
              (o."fallbackChannel" = 'ZNS'
               AND EXISTS (
                 SELECT 1 FROM "notification_logs" z
                  WHERE z."channel" = 'ZNS' AND z."status" = 'FAILED' AND z."sentAt" >= ord."createdAt" - interval '1 day'
                    AND (z."payload" ->> 'dedupeKey' = 'mss:' || o."eventId"
                         OR left(z."payload" ->> 'dedupeKey', length(o."eventId") + 12) = 'mss:' || o."eventId" || ':failed:'))
               AND NOT EXISTS (
                 SELECT 1 FROM "notification_logs" z
                  WHERE z."channel" = 'ZNS' AND z."status" IN ('PENDING', 'RETRYING', 'SENT') AND z."sentAt" >= ord."createdAt" - interval '1 day'
                    AND z."payload" ->> 'dedupeKey' = 'mss:' || o."eventId"))
           OR (o."fallbackChannel" = 'IN_APP_ONLY' AND o."fallbackAt" <= (${inAppSettledBefore.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
         )
       ORDER BY o."fallbackAt" ASC
       LIMIT ${BATCH}`;
    let sent = 0;
    for (const row of rows) {
      if (Date.now() - started > RUN_BUDGET_MS) break;
      if ((await this.orderEmail.sendForEvent(row.id, now)) === 'SENT') sent++;
    }
    return sent;
  }

  @Cron(MSS_ORDER_EVENTS_RECONCILE_CRON, { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 3 })
  async reconcile(): Promise<void> {
    try {
      if (!this.flags.configured()) {
        if ((await this.settleStuckOnce()) === 0) markCronSkipped('NOT_CONFIGURED');
        return;
      }
      await this.settleStuckOnce();
      await this.reconcileOnce();
    } catch (err) {
      const msg = `Đối soát tin đơn MSS lỗi: ${err instanceof Error ? err.message : String(err)}`;
      noteCronError(msg);
      this.logger.error(msg);
    }
  }

  /**
   * Dòng MSS đã nhận mà quá hạn sống 2 giờ vẫn chưa có kết quả (MSS treo, hỏi GET lỗi mãi, hay đã gỡ biến MSS_*): chốt "không rõ", chỉ còn
   * tin trong app (có thể MSS đã gửi nên không gửi ZNS). Không gọi MSS.
   */
  async settleStuckOnce(now = Date.now()): Promise<number> {
    const rows = await this.prisma.mssOrderEventOutbox.findMany({
      where: { status: 'DELIVERED', expiresAt: { lt: new Date(now - MSS_RESULT_STUCK_GRACE_MS) } },
      select: { eventId: true },
      orderBy: { expiresAt: 'asc' },
      take: BATCH,
    });
    let settled = 0;
    for (const row of rows) {
      if ((await this.sender.applyResult(row.eventId, {}, 'unknown', 'stuck', 'reconcile')) === 'applied') settled++;
    }
    return settled;
  }

  /** Hỏi MSS kết quả của dòng đã giao quá 15 phút chưa có callback (hợp đồng mục 4.3). */
  async reconcileOnce(now = Date.now()): Promise<number> {
    const started = Date.now();
    const rows = await this.prisma.mssOrderEventOutbox.findMany({
      where: { status: 'DELIVERED', deliveredAt: { lt: new Date(now - MSS_RESULT_RECONCILE_AFTER_MS) } },
      select: { eventId: true, orderCode: true, eventType: true, expiresAt: true },
      orderBy: { deliveredAt: 'asc' },
      take: BATCH,
    });
    let settled = 0;
    for (const row of rows) {
      if (Date.now() - started > RUN_BUDGET_MS) break;
      const r = await this.sender.reconcileOne(row);
      if (r === 'applied' || r === 'stuck' || r === 'requeued') settled++;
    }
    return settled;
  }
}
