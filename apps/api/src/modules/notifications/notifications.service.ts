import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ZnsClient } from '../integrations/zns/zns.client';
import { znsFailureText, type ZnsSendResult } from '../integrations/zns/zns-result';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';
import { withQueueTimeout } from '../../jobs/queue-timeout';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { startOfNextVnMonth, startOfVnMonth, VN_OFFSET_MS } from '../../common/vn-time';
import { isAllowedByPrefs, type NotificationPrefs } from './notification-categories';
import { MARKETING_TEMPLATE_CODES } from './notification-templates-admin.service';

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

const QUIET_START_KEY = 'notifications.zns_quiet_start_hour';
const QUIET_END_KEY = 'notifications.zns_quiet_end_hour';
const PROMO_CAP_KEY = 'notifications.zns_promo_monthly_cap';
const DEFAULT_QUIET_START_HOUR = 21;
const DEFAULT_QUIET_END_HOUR = 8;
const DEFAULT_PROMO_MONTHLY_CAP = 2;
const HOUR_MS = 3_600_000;

/**
 * Số mili giây phải chờ để ZNS rời khỏi giờ yên tĩnh (giờ VN, từ `startHour` tới trước `endHour`, qua nửa đêm được);
 * 0 khi đang trong giờ gửi hoặc khi hai mốc bằng nhau (tắt giờ yên tĩnh).
 */
export function znsQuietDelayMs(now: Date, startHour: number, endHour: number): number {
  if (startHour === endHour) return 0;
  const vnNow = now.getTime() + VN_OFFSET_MS;
  const hour = new Date(vnNow).getUTCHours();
  const quiet = startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
  if (!quiet) return 0;
  const day = new Date(vnNow);
  const endToday = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), endHour);
  return (endToday > vnNow ? endToday : endToday + 24 * HOUR_MS) - vnNow;
}

interface PromoCap {
  userId: string;
  limit: number;
  from: Date;
  to: Date;
}

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
    // Optional như queue: khởi tạo trực tiếp không có cấu hình thì dùng mặc định trong mã.
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /**
   * `dedupeKey`: tin gắn với một sự kiện chỉ xảy ra một lần (vd một dòng sổ điểm) — gọi lại với cùng khoá cho cùng khách thì
   * không ghi/gửi lần hai. Khoá nằm trong payload, kiểm và ghi dưới khoá advisory theo (khách, khoá) nên hai lần gọi song song
   * cũng chỉ một lần thắng. `dedupeWithinMs`: khoá chỉ chặn khi tin trước còn trong chừng này mili giây (gộp tin lặp theo
   * thời gian, vd "bài của bạn có người thích" tối đa một tin mỗi giờ). Chỉ số dương mới là cửa sổ hợp lệ; bỏ trống, 0, âm
   * hay NaN đều chặn vĩnh viễn như trước (không bao giờ hiểu nhầm thành "không chặn").
   */
  async notify(
    userId: string,
    templateCode: string,
    data: Record<string, string>,
    opts: { dedupeKey?: string; dedupeWithinMs?: number } = {},
  ): Promise<void> {
    const dedupeKey = opts.dedupeKey;
    const withinMs = opts.dedupeWithinMs != null && opts.dedupeWithinMs > 0 ? opts.dedupeWithinMs : null;
    // Đọc nhanh ngoài transaction: bài viral có hàng trăm lượt tương tác/phút mà chỉ một tin được ghi, nên các lượt còn lại
    // phải rời đi sau đúng một truy vấn thay vì mỗi lượt giữ một kết nối chờ khoá advisory. Kiểm lại trong transaction bên
    // dưới vẫn là cổng quyết định khi hai lượt cùng thấy "chưa có tin".
    if (dedupeKey && (await this.prisma.notificationLog.findFirst({ where: this.dedupeWhere(userId, dedupeKey, withinMs), select: { id: true } }))) {
      this.logger.debug(`Bỏ qua ${templateCode} cho ${userId}: đã gửi tin cho sự kiện này.`);
      return;
    }
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
    const inAppLog = dedupeKey
      ? await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notify:${userId}:${dedupeKey}`}))`;
          const seen = await tx.notificationLog.findFirst({ where: this.dedupeWhere(userId, dedupeKey, withinMs), select: { id: true } });
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

  private dedupeWhere(userId: string, dedupeKey: string, withinMs: number | null) {
    return {
      userId,
      channel: 'INAPP' as const,
      payload: { path: ['dedupeKey'], equals: dedupeKey },
      ...(withinMs != null ? { sentAt: { gte: new Date(Date.now() - withinMs) } } : {}),
    };
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
    // Trần chỉ áp cho tin khuyến mãi/hậu mãi (cùng danh sách mẫu Marketing được sửa); bỏ ZNS thì tin trong app vẫn đã lưu.
    const cap = MARKETING_TEMPLATE_CODES.has(templateCode) ? await this.promoCap(userId) : null;
    if (cap && (await this.promoZnsCount(this.prisma, cap)) >= cap.limit) {
      this.logger.debug(`Bỏ ZNS ${templateCode} cho ${userId}: đủ ${cap.limit} tin khuyến mãi ZNS trong tháng.`);
      return;
    }
    let result: ZnsSendResult | null = null;
    if (!queue) result = await this.zns.sendTemplate(phone, templateId, data);

    const logData = {
      userId,
      templateCode,
      channel: 'ZNS',
      payload: { data },
      status: !result ? 'PENDING' : result.ok ? 'SENT' : 'FAILED',
      error: result && !result.ok ? znsFailureText(result) : null,
    };
    const log = cap && queue ? await this.createCappedZnsLog(logData, cap) : await this.prisma.notificationLog.create({ data: logData });
    if (!log) {
      this.logger.debug(`Bỏ ZNS ${templateCode} cho ${userId}: đủ ${cap?.limit} tin khuyến mãi ZNS trong tháng.`);
      return;
    }
    await this.analytics.recordBestEffort({
      eventName: 'notification_sent',
      userId,
      platform: 'system',
      notificationId: log.id,
      props: { templateCode, channel: 'ZNS' },
    });
    if (!queue) return;

    const job: ZnsSendJobData = { notificationLogId: log.id, phone, templateId, templateData: data };
    const delay = await this.quietDelayMs();
    try {
      await withQueueTimeout(
        queue.add('zns-send', job, { ...ZNS_SEND_JOB_OPTIONS, jobId: `zns-${log.id}`, ...(delay > 0 ? { delay } : {}) }),
        `${QUEUE_NOTIFICATIONS} ${log.id}`,
      );
    } catch (err) {
      const reason = `Không xếp được hàng đợi gửi ZNS: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`${reason} (log ${log.id})`);
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: reason } });
    }
  }

  private async configHour(key: string, fallback: number): Promise<number> {
    const raw = this.config ? await this.config.get<unknown>(key, fallback) : fallback;
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : fallback;
  }

  private async quietDelayMs(): Promise<number> {
    const [start, end] = await Promise.all([
      this.configHour(QUIET_START_KEY, DEFAULT_QUIET_START_HOUR),
      this.configHour(QUIET_END_KEY, DEFAULT_QUIET_END_HOUR),
    ]);
    return znsQuietDelayMs(new Date(), start, end);
  }

  /** null khi trần tắt (0) hoặc giá trị không hợp lệ thì dùng mặc định. */
  private async promoCap(userId: string): Promise<PromoCap | null> {
    const raw = this.config ? await this.config.get<unknown>(PROMO_CAP_KEY, DEFAULT_PROMO_MONTHLY_CAP) : DEFAULT_PROMO_MONTHLY_CAP;
    const limit = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_PROMO_MONTHLY_CAP;
    if (limit === 0) return null;
    const now = new Date();
    return { userId, limit, from: startOfVnMonth(now), to: startOfNextVnMonth(now) };
  }

  private promoZnsCount(db: Pick<PrismaService, 'notificationLog'>, cap: PromoCap): Promise<number> {
    return db.notificationLog.count({
      where: {
        userId: cap.userId,
        channel: 'ZNS',
        templateCode: { in: [...MARKETING_TEMPLATE_CODES] },
        status: { in: ['PENDING', 'RETRYING', 'SENT'] },
        sentAt: { gte: cap.from, lt: cap.to },
      },
    });
  }

  /** Đếm lại và ghi log dưới khoá advisory theo khách: hai tin khuyến mãi song song không cùng thấy "còn chỗ". */
  private createCappedZnsLog(data: Prisma.NotificationLogUncheckedCreateInput, cap: PromoCap) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`zns-cap:${cap.userId}`}))`;
      if ((await this.promoZnsCount(tx, cap)) >= cap.limit) return null;
      return tx.notificationLog.create({ data });
    });
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
