import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { fallbackDecision, MSS_FALLBACK_STATUSES, MSS_FALLBACK_ZNS_GRACE_MS, type MssFallbackDecision, type MssOutboxStatus } from './mss-order-event-types';
import { parseHeldZns } from './mss-zns-hold';

/** Khoá chống trùng của tin ZNS đường lui: một sự kiện MSS một tin ZNS, kể cả khi đường lui bị gọi lại. */
export const mssFallbackDedupeKey = (eventId: string) => `mss:${eventId}`;

/**
 * Đường lui khi MSS không gửi được (hợp đồng mục 12): chạy đúng một lần mỗi sự kiện, nhận phần việc bằng `fallbackAt IS NULL`. Tin trong
 * app đã lưu lúc nghiệp vụ gọi notify (luật hoãn chỉ hoãn kênh ZNS), nên "chỉ trong app" là không gửi thêm gì; "ZNS" gửi tin đã hoãn.
 */
@Injectable()
export class MssOrderEventFallback {
  private readonly logger = new Logger(MssOrderEventFallback.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(eventId: string): Promise<MssFallbackDecision | null> {
    for (let i = 0; i < 3; i++) {
      const row = await this.prisma.mssOrderEventOutbox.findUnique({
        where: { eventId },
        select: {
          id: true,
          eventId: true,
          orderCode: true,
          status: true,
          resultReason: true,
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
      if (decision === 'ZNS' && held && row.znsHeldTemplate) {
        try {
          await this.notifications.sendHeldZns(row.order.userId, row.znsHeldTemplate, held.data, held.znsTemplateId, mssFallbackDedupeKey(row.eventId));
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
}
