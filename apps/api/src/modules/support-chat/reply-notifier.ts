import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_SUPPORT_CHAT_NOTIFY } from '../../jobs/queues';
import { withQueueTimeout } from '../../jobs/queue-timeout';
import { NotificationsService } from '../notifications/notifications.service';

export const SUPPORT_NOTIFY_JOB = 'notify';
/** Chờ chừng này trước khi báo: khách đang mở màn chat sẽ thấy tin ngay và đánh dấu đã đọc, nên không cần chuông. */
export const NOTIFY_DELAY_MS = 20_000;
/** Gộp các chuông trả lời trong 10 phút thành một: nhân viên gõ nhiều câu liền nhau không làm khách nhận nhiều thông báo. */
export const NOTIFY_DEDUPE_MS = 10 * 60_000;
const PREVIEW_MAX = 60;
const IMAGE_PREVIEW = 'Ảnh từ Tubu Tree';

/** Dòng ngắn cho chuông: không số điện thoại (nhân viên có thể gõ tay), cắt đúng 60 ký tự. */
export function replyPreview(body: string, imageUrl: string | null): string {
  const text = body.replace(/\d[\d .-]{6,}\d/g, '…').replace(/\s+/g, ' ').trim();
  if (!text) return imageUrl ? IMAGE_PREVIEW : '';
  // Cắt theo ký tự (code point), không theo đơn vị UTF-16: cắt giữa cặp thay thế của emoji sinh ký tự hỏng.
  const chars = Array.from(text);
  return chars.length <= PREVIEW_MAX ? text : `${chars.slice(0, PREVIEW_MAX - 1).join('')}…`;
}

@Injectable()
export class ReplyNotifier {
  private readonly logger = new Logger(ReplyNotifier.name);

  constructor(
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_SUPPORT_CHAT_NOTIFY) private readonly queue: Queue,
  ) {}

  /** Đặt chuông trễ 20 giây; không đặt được (Redis sập/treo) thì báo ngay, vì sót chuông tệ hơn thừa một chuông. */
  async scheduleReplyBell(conv: { id: string; userId: string; customerReadAt?: Date | null }, message: { id: string; body: string; imageUrl: string | null }): Promise<void> {
    try {
      await withQueueTimeout(
        this.queue.add(SUPPORT_NOTIFY_JOB, { messageId: message.id }, { jobId: `notify-${message.id}`, delay: NOTIFY_DELAY_MS }),
        `${QUEUE_SUPPORT_CHAT_NOTIFY} ${message.id}`,
      );
    } catch (err) {
      this.logger.warn(`Không đặt được chuông trễ cho tin ${message.id}, báo ngay: ${(err as Error).message}`);
      await this.notifyNow(conv, replyPreview(message.body, message.imageUrl));
    }
  }

  /**
   * Khoá gộp có thêm mốc đọc của khách: chuông sau chỉ bị gộp khi khách chưa đọc gì kể từ chuông trước.
   * markRead đẩy customerReadAt tới, nên khách đã mở chat xem tin A rồi thì tin B trong 10 phút sau vẫn báo.
   */
  notifyNow(conv: { id: string; userId: string; customerReadAt?: Date | null }, preview: string): Promise<unknown> {
    return this.notifications.notify(
      conv.userId,
      'SUPPORT_CHAT_REPLY',
      { preview, route: '/chat' },
      { dedupeKey: conv.customerReadAt ? `support-reply-${conv.id}-${conv.customerReadAt.getTime()}` : `support-reply-${conv.id}`, dedupeWithinMs: NOTIFY_DEDUPE_MS },
    );
  }
}
