import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ZnsClient } from '../integrations/zns/zns.client';
import { znsFailureText, type ZnsSendResult } from '../integrations/zns/zns-result';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';
import { withQueueTimeout } from '../../jobs/queue-timeout';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { isAllowedByPrefs, type NotificationPrefs } from './notification-categories';

/** Nội dung dùng khi template chưa được seed — tuyệt đối không in mã code ra cho khách. */
const MISSING_TEMPLATE_BODY = 'Tubu Tree có cập nhật mới cho bạn. Mở mục liên quan trong app để xem chi tiết nhé 🌿';

/** Job gửi ZNS qua BullMQ (xem notifications.processor.ts): lần gửi đầu và mọi lần thử lại. */
export interface ZnsSendJobData {
  notificationLogId: string;
  phone: string;
  templateId: string;
  templateData: Record<string, string>;
}

/**
 * Lần gửi ZNS đầu tiên cũng đi qua queue để request đặt hàng/thanh toán không phải chờ Zalo (timeout 25s mỗi lần
 * gọi, xem ZNS_REQUEST_TIMEOUT_MS). Backoff dài hơn mặc định của queue (2s): ZNS lỗi tạm thời thường là Zalo gián đoạn hoặc access token chờ làm
 * mới nên thử lại sau vài chục giây là vô ích. 6 lần ≈ 15 phút.
 */
export const ZNS_SEND_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

/** Kết cục một lần xử lý job ZNS: RETRY = lỗi tạm thời còn lượt thử lại, processor phải ném lỗi để BullMQ xếp lịch. */
export type ZnsDeliveryOutcome = 'SENT' | 'RETRY' | 'FAILED';

/**
 * Gửi thông báo theo template code (Build Spec §4.10, §11).
 * Tra NotificationTemplate → gửi qua kênh tương ứng (ZNS/INAPP) → ghi NotificationLog.
 * Luôn ghi INAPP để user xem trong app dù ZNS chưa cấu hình.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zns: ZnsClient,
    private readonly analytics: AnalyticsEventsService,
    // Optional: giữ tương thích test/call site cũ khởi tạo trực tiếp `new NotificationsService(prisma, zns, analytics)`
    // (không qua DI, không truyền queue) — notify() vẫn chạy đúng, chỉ bỏ qua bước enqueue retry.
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationsQueue?: Queue,
  ) {}

  /**
   * `dedupeKey`: tin gắn với một sự kiện chỉ xảy ra một lần (vd một dòng sổ điểm) — gọi lại với cùng khoá cho cùng khách thì
   * không ghi/gửi lần hai. Khoá nằm trong payload, kiểm và ghi dưới khoá advisory theo (khách, khoá) nên hai lần gọi song song
   * cũng chỉ một lần thắng. `dedupeWithinMs`: khoá chỉ chặn khi tin trước còn trong chừng này mili giây (gộp tin lặp theo
   * thời gian, vd "bài của bạn có người thích" tối đa một tin mỗi giờ); bỏ trống thì chặn vĩnh viễn như trước.
   */
  async notify(
    userId: string,
    templateCode: string,
    data: Record<string, string>,
    opts: { dedupeKey?: string; dedupeWithinMs?: number } = {},
  ): Promise<void> {
    const tpl = await this.prisma.notificationTemplate.findUnique({ where: { code: templateCode } });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!isAllowedByPrefs(templateCode, user)) {
      this.logger.debug(`Bỏ qua ${templateCode} cho ${userId}: khách đã tắt nhóm tin này.`);
      return;
    }

    // In-app luôn lưu để hiển thị danh sách thông báo.
    // Thiếu template KHÔNG được in mã code ra cho khách (họ nhận thông báo nội dung là
    // "SUBSCRIPTION_ORDER_FAILED"). Hiện câu trung tính, còn mã vẫn nằm ở cột templateCode để
    // dò, kèm log warn để template thiếu được phát hiện thay vì âm thầm.
    if (!tpl) {
      this.logger.warn(`Thiếu NotificationTemplate "${templateCode}" — đã gửi nội dung mặc định.`);
    }
    const body = tpl ? this.render(tpl.bodyTemplate, data) : MISSING_TEMPLATE_BODY;
    const dedupeKey = opts.dedupeKey;
    const inAppLog = dedupeKey
      ? await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notify:${userId}:${dedupeKey}`}))`;
          const seen = await tx.notificationLog.findFirst({
            where: {
              userId,
              channel: 'INAPP',
              payload: { path: ['dedupeKey'], equals: dedupeKey },
              ...(opts.dedupeWithinMs ? { sentAt: { gte: new Date(Date.now() - opts.dedupeWithinMs) } } : {}),
            },
            select: { id: true },
          });
          if (seen) return null;
          return tx.notificationLog.create({
            data: { userId, templateCode, channel: 'INAPP', payload: { body, data, dedupeKey }, status: 'SENT' },
          });
        })
      : await this.prisma.notificationLog.create({
          data: { userId, templateCode, channel: 'INAPP', payload: { body, data }, status: 'SENT' },
        });
    if (!inAppLog) {
      this.logger.debug(`Bỏ qua ${templateCode} cho ${userId}: đã gửi tin cho sự kiện này.`);
      return;
    }
    await this.analytics.recordBestEffort({
      eventName: 'notification_sent',
      userId,
      platform: 'system',
      notificationId: inAppLog.id,
      props: { templateCode, channel: 'INAPP' },
    });

    // ZNS nếu template là kênh ZNS + user có phone.
    if (tpl?.channel === 'ZNS' && user?.phone && tpl.zaloTemplateId) {
      await this.dispatchZns(userId, templateCode, user.phone, tpl.zaloTemplateId, data);
    }
  }

  /**
   * Có queue: ghi log PENDING rồi xếp job — người gọi (checkout, thanh toán...) không chờ Zalo. Trạng thái cuối
   * (SENT/RETRYING/FAILED kèm mã + lý do trong cột `error`) do deliverZns() ghi. Không có queue (test, khởi tạo trực
   * tiếp): gửi ngay tại chỗ và ghi kết quả, lỗi tạm thời không ai thử lại nên ghi FAILED.
   */
  private async dispatchZns(
    userId: string,
    templateCode: string,
    phone: string,
    templateId: string,
    data: Record<string, string>,
  ): Promise<void> {
    const queue = this.notificationsQueue;
    let result: ZnsSendResult | null = null;
    if (!queue) result = await this.zns.sendTemplate(phone, templateId, data);

    const log = await this.prisma.notificationLog.create({
      data: {
        userId,
        templateCode,
        channel: 'ZNS',
        payload: { data },
        status: !result ? 'PENDING' : result.ok ? 'SENT' : 'FAILED',
        error: result && !result.ok ? znsFailureText(result) : null,
      },
    });
    await this.analytics.recordBestEffort({
      eventName: 'notification_sent',
      userId,
      platform: 'system',
      notificationId: log.id,
      props: { templateCode, channel: 'ZNS' },
    });
    if (!queue) return;

    const job: ZnsSendJobData = { notificationLogId: log.id, phone, templateId, templateData: data };
    try {
      await withQueueTimeout(
        queue.add('zns-send', job, { ...ZNS_SEND_JOB_OPTIONS, jobId: `zns-${log.id}` }),
        `${QUEUE_NOTIFICATIONS} ${log.id}`,
      );
    } catch (err) {
      const reason = `Không xếp được hàng đợi gửi ZNS: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`${reason} (log ${log.id})`);
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: reason } });
    }
  }

  /**
   * Gọi bởi NotificationsProcessor cho mỗi lượt gửi ZNS của một NotificationLog (lượt đầu lẫn thử lại). Ghi kết quả vào
   * log: SENT; RETRYING (lỗi tạm thời, còn lượt); FAILED (lỗi vĩnh viễn hoặc hết lượt) kèm mã + lý do để admin lọc.
   * Trả kết cục thay vì ném — processor tự quyết định khi nào ném cho BullMQ xếp lịch thử lại.
   */
  async deliverZns(job: ZnsSendJobData, finalAttempt: boolean): Promise<ZnsDeliveryOutcome> {
    const where = { id: job.notificationLogId };
    const current = await this.prisma.notificationLog.findUnique({ where, select: { status: true } });
    if (current?.status === 'SENT') return 'SENT';

    const result = await this.zns.sendTemplate(job.phone, job.templateId, job.templateData, job.notificationLogId);
    if (result.ok) {
      await this.prisma.notificationLog.update({ where, data: { status: 'SENT', error: null } });
      return 'SENT';
    }
    const error = znsFailureText(result);
    if (result.retryable && !finalAttempt) {
      await this.prisma.notificationLog.update({ where, data: { status: 'RETRYING', error } });
      return 'RETRY';
    }
    await this.prisma.notificationLog.update({ where, data: { status: 'FAILED', error } });
    return 'FAILED';
  }

  async getPrefs(userId: string): Promise<NotificationPrefs> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { notifyPromo: u.notifyPromo, notifyGarden: u.notifyGarden };
  }

  updatePrefs(userId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const data: Partial<NotificationPrefs> = {};
    if (patch.notifyPromo !== undefined) data.notifyPromo = patch.notifyPromo;
    if (patch.notifyGarden !== undefined) data.notifyGarden = patch.notifyGarden;
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { notifyPromo: true, notifyGarden: true },
    });
  }

  listForUser(userId: string) {
    return this.prisma.notificationLog.findMany({
      where: { userId, channel: 'INAPP' },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, id: string): Promise<{ ok: boolean }> {
    // updateMany match 0 dòng (id không tồn tại, hoặc thuộc user khác) trước đây vẫn trả
    // {ok:true} — dùng count thật của updateMany để phản ánh đúng có match hay không.
    const result = await this.prisma.notificationLog.updateMany({
      where: { id, userId },
      data: { status: 'READ' },
    });
    return { ok: result.count > 0 };
  }

  /** Chỉ chạm tin INAPP chưa đọc của chính khách; gọi lại khi không còn tin chưa đọc trả count 0. */
  async markAllRead(userId: string): Promise<{ ok: true; count: number }> {
    const result = await this.prisma.notificationLog.updateMany({
      where: { userId, channel: 'INAPP', status: { not: 'READ' } },
      data: { status: 'READ' },
    });
    return { ok: true, count: result.count };
  }

  private render(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => data[k] ?? '');
  }
}
