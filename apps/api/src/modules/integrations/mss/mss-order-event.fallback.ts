import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { OrderConfirmEmailService } from '../../notifications/order-email/order-confirm-email.service';
import {
  fallbackDecision,
  MSS_EMAIL_EVENT_TYPES,
  MSS_FALLBACK_STATUSES,
  MSS_FALLBACK_ZNS_GRACE_MS,
  mssEmailEligible,
  type MssFallbackDecision,
  type MssOutboxStatus,
} from './mss-order-event-types';
import { parseHeldZns } from './mss-zns-hold';

/** Khoá chống trùng của tin ZNS đường lui: một sự kiện MSS một tin ZNS, kể cả khi đường lui bị gọi lại. */
export const mssFallbackDedupeKey = (eventId: string) => `mss:${eventId}`;

/**
 * Tắt ứng dụng chờ email đường lui đang gửi tối đa chừng này: compose cho 30 giây (`stop_grace_period`), worker BullMQ cần phần còn lại
 * để chờ lệnh Pancake (≤ 15 giây). Email chưa kịp nhận việc thì nhánh cứu IN_APP_ONLY của cron quét gửi sau khi app lên lại.
 */
export const MSS_FALLBACK_SHUTDOWN_WAIT_MS = 5_000;

/**
 * Đường lui khi MSS không gửi được (hợp đồng mục 12): chạy đúng một lần mỗi sự kiện, nhận phần việc bằng `fallbackAt IS NULL`. Tin trong
 * app đã lưu lúc nghiệp vụ gọi notify (luật hoãn chỉ hoãn kênh ZNS), nên "chỉ trong app" là không gửi thêm gì; "ZNS" gửi tin đã hoãn.
 * Tin đặt đơn / đã nhận tiền của người mua mà không có ZNS nào đi (chưa có mẫu ZNS, khách không có SĐT hay tắt nhóm tin) thì gửi email
 * xác nhận đơn (PO A3, cờ `notify.order_email_fallback_enabled`); ZNS đã đi mà lỗi hẳn thì cron quét gửi email sau.
 */
@Injectable()
export class MssOrderEventFallback implements OnModuleDestroy {
  private readonly logger = new Logger(MssOrderEventFallback.name);
  private readonly emails = new Set<Promise<void>>();
  /** Đang tắt ứng dụng: không mở email mới. */
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly orderEmail?: OrderConfirmEmailService,
  ) {}

  async run(eventId: string): Promise<MssFallbackDecision | null> {
    for (let i = 0; i < 3; i++) {
      const row = await this.prisma.mssOrderEventOutbox.findUnique({
        where: { eventId },
        select: {
          id: true,
          eventId: true,
          eventType: true,
          recipientRole: true,
          orderCode: true,
          status: true,
          resultReason: true,
          lastHttpStatus: true,
          expiresAt: true,
          fallbackAt: true,
          znsHeldTemplate: true,
          znsHeldData: true,
          order: { select: { userId: true } },
        },
      });
      if (!row || row.fallbackAt) return null;
      const status = row.status as MssOutboxStatus;
      if (!MSS_FALLBACK_STATUSES.includes(status)) return null;
      const held = row.znsHeldTemplate ? parseHeldZns(row.znsHeldData) : null;
      // Đường lui chạy muộn (API tắt lâu, dừng tin chờ sau nhiều ngày): tin ZNS đã quá hạn sống thì chỉ còn tin trong app.
      const fresh = Date.now() <= row.expiresAt.getTime() + MSS_FALLBACK_ZNS_GRACE_MS;
      const decision = fallbackDecision(status, row.resultReason, held !== null && fresh);
      if (decision === 'NONE') return 'NONE';
      const claimedAt = new Date();
      const claimed = await this.prisma.mssOrderEventOutbox.updateMany({
        where: { id: row.id, status, fallbackAt: null, znsHeldTemplate: row.znsHeldTemplate },
        data: { fallbackAt: claimedAt, fallbackChannel: decision },
      });
      if (claimed.count === 0) continue;
      this.logger.log(`mss_order_event_fallback ${decision} order=${row.orderCode} event=${row.eventId} status=${status} reason=${row.resultReason ?? '-'}`);
      // Email chỉ cho sự kiện người mua mà khách chắc chắn chưa nhận tin Zalo nào, và còn trong hạn sống (cùng hạn với ZNS).
      const emailable = row.recipientRole === 'buyer' && MSS_EMAIL_EVENT_TYPES.has(row.eventType) && mssEmailEligible(status, row.resultReason, row.lastHttpStatus) && fresh;
      if (decision === 'IN_APP_ONLY' && emailable) this.sendEmail(row.id);
      if (decision === 'ZNS' && held && row.znsHeldTemplate) {
        try {
          const zns = await this.notifications.sendHeldZns(row.order.userId, row.znsHeldTemplate, held.data, held.znsTemplateId, mssFallbackDedupeKey(row.eventId));
          if ((zns === 'NO_PHONE' || zns === 'PREFS') && emailable) this.sendEmail(row.id);
        } catch (err) {
          this.logger.error(`Gửi ZNS đường lui đơn ${row.orderCode} (sự kiện ${row.eventId}) lỗi, lượt quét sau thử lại: ${err instanceof Error ? err.message : String(err)}`);
          // Nhả phần việc để cron quét bù thử lại; khoá chống trùng mss:<eventId> của sendHeldZns giữ đúng một tin nếu lần này đã kịp gửi.
          await this.prisma.mssOrderEventOutbox
            .updateMany({ where: { id: row.id, fallbackAt: claimedAt, fallbackChannel: 'ZNS' }, data: { fallbackAt: null, fallbackChannel: null } })
            .catch(() => undefined);
          return null;
        }
      }
      return decision;
    }
    return null;
  }

  /**
   * Gửi nền, không chờ: đường lui chạy cả trong callback MSS, SMTP chậm (tới 30 giây) không được giữ phản hồi cho MSS. Lỗi chỉ ghi log,
   * phần việc đường lui (ZNS/trong app) đã chốt; khoá + log EMAIL của OrderConfirmEmailService giữ đúng một email dù cron quét chạy cùng lúc.
   */
  private sendEmail(outboxRowId: string): void {
    // Đang tắt: không mở email mới (dòng đã chốt IN_APP_ONLY, nhánh cứu của cron quét gửi sau khi app lên lại).
    if (!this.orderEmail || this.closing) return;
    const job: Promise<void> = this.orderEmail
      .sendForEvent(outboxRowId)
      .then(
        () => undefined,
        (err: unknown) => this.logger.error(`Email xác nhận đơn (đường lui, dòng ${outboxRowId}) lỗi: ${err instanceof Error ? err.message : String(err)}`),
      )
      .finally(() => this.emails.delete(job));
    this.emails.add(job);
  }

  /** Chờ các email đường lui đang gửi dở (tắt ứng dụng, test). */
  async emailsSettled(): Promise<void> {
    await Promise.all([...this.emails]);
  }

  /**
   * Chờ email đang gửi tối đa MSS_FALLBACK_SHUTDOWN_WAIT_MS rồi thôi (SMTP treo tới 30 giây không được ăn hết thời gian tắt của compose).
   * Job email không bao giờ reject (`.then(ok, err)` ở sendEmail) nên `emailsSettled` không ném. Timer `unref` + `clearTimeout`: không giữ
   * tiến trình sống, không để timer treo khi email xong sớm.
   */
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.emails.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      this.emailsSettled().then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), MSS_FALLBACK_SHUTDOWN_WAIT_MS);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) {
      this.logger.warn(
        `Tắt ứng dụng: thôi chờ ${this.emails.size} email đường lui sau ${MSS_FALLBACK_SHUTDOWN_WAIT_MS} ms (log EMAIL còn PENDING thì đơn đó không gửi lại).`,
      );
    }
  }
}
