import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ZnsClient } from '../integrations/zns/zns.client';
import { znsFailureText, type ZnsSendResult } from '../integrations/zns/zns-result';
import { QUEUE_NOTIFICATIONS, QUEUE_NOTIFICATIONS_INAPP_RETRY } from '../../jobs/queues';
import { withQueueTimeout } from '../../jobs/queue-timeout';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { startOfNextVnMonth, startOfVnMonth, VN_OFFSET_MS } from '../../common/vn-time';
import { getTemplateCached } from './notification-template-cache';
import { isAllowedByPrefs, type NotificationPrefs } from './notification-categories';
import { MARKETING_TEMPLATE_CODES } from './notification-templates-admin.service';
import { captureServerError } from '../../config/sentry';
import { ZNS_REVIEW_PREFIX } from './zns-review-prefix';

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

/** Job thử lại tin trong app (xem notifyWithRetry). */
export interface InAppRetryJobData {
  userId: string;
  templateCode: string;
  data: Record<string, string>;
  dedupeKey: string;
  context?: string;
}

export const INAPP_RETRY_JOB = 'inapp-retry';
/** Tên job gửi ZNS trong QUEUE_NOTIFICATIONS (dispatchZns xếp, processor và sự kiện failed lọc theo tên này). */
export const ZNS_SEND_JOB = 'zns-send';

/** Câu lỗi thô (Prisma tiếng Anh nhiều dòng, có khi kèm câu truy vấn) thành một dòng ngắn để đặt sau câu tiếng Việt trong cột `error`, hiện ở trang admin. */
export function oneLineReason(raw: unknown, max = 160): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Lỗi ghi tin trong app gần như luôn là DB hay kết nối chập chờn: 6 lần, 30 giây nhân đôi (≈ 15 phút) như ZNS. Không đặt jobId:
 * BullMQ giữ job xong/lỗi (removeOnComplete/removeOnFail) nên jobId cố định làm lần xếp sau thành no-op; chống trùng đã có dedupeKey.
 */
export const INAPP_RETRY_JOB_OPTIONS = {
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

export { ZNS_REVIEW_PREFIX };

const releasedZnsDedupeKey = (dedupeKey: string, logId: string) => `${dedupeKey}:failed:${logId}`;

/**
 * Payload của log ZNS sắp đóng FAILED với khoá chống trùng đã nhả (`<khoá>:failed:<id>`, giữ nguyên `data` và `dedupeWithinMs`), hoặc undefined
 * nếu log không có khoá hay khoá đã nhả. Mọi chỗ đóng log ZNS mà log đó còn có thể được job chạy lại phải ghi kèm payload này: không thì job
 * sống lại (khôi phục Redis, retry tay) thấy FAILED chưa nhả khoá và gửi tiếp (isReleasedZnsLog), trong khi tin cùng sự kiện đã đi bằng log khác.
 */
function releasedPayload(payload: unknown, logId: string): Prisma.InputJsonObject | undefined {
  const p = payload as { dedupeKey?: unknown } | null;
  const key = p?.dedupeKey;
  if (typeof key !== 'string' || /:failed:[^:]+$/.test(key)) return undefined;
  return { ...p, dedupeKey: releasedZnsDedupeKey(key, logId) } as Prisma.InputJsonObject;
}

/**
 * Log ZNS đã đóng FAILED và đã nhả khoá chống trùng. Mọi đường nhả đều ghi `<khoá>:failed:<id>`: dispatchZns (không xếp được hàng đợi),
 * claimUnderDedupeLock (nhánh FAILED), closeStuckZnsLog (cron và sự kiện failed của processor) và deliverZns (FAILED cuối, writeFailure).
 */
function isReleasedZnsLog(payload: unknown, logId: string): boolean {
  const key = (payload as { dedupeKey?: unknown } | null)?.dedupeKey;
  return typeof key === 'string' && key.endsWith(`:failed:${logId}`);
}

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

/**
 * Kết cục một lần xử lý job ZNS: RETRY = lỗi tạm thời còn lượt thử lại, processor phải ném lỗi để BullMQ xếp lịch;
 * SKIPPED = job đến muộn sau khi log đã bị đóng và khoá chống trùng đã nhả, không gọi Zalo.
 */
export type ZnsDeliveryOutcome = 'SENT' | 'RETRY' | 'FAILED' | 'SKIPPED';

/**
 * Gửi thông báo theo template code (Build Spec §4.10, §11).
 * Tra NotificationTemplate → gửi qua kênh tương ứng (ZNS/INAPP) → ghi NotificationLog.
 * Luôn ghi INAPP để user xem trong app dù ZNS chưa cấu hình.
 */
@Injectable()
export class NotificationsService {
  /** Khoảng nghỉ giữa các lần ghi lại SENT: 3 lần thử tổng cộng. */
  private static readonly SENT_WRITE_RETRY_DELAYS_MS = [100, 300];

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
    // Hàng riêng cho job thử lại tin trong app; không có (khởi tạo trực tiếp) thì notifyWithRetry trả LOST khi lỗi như khi không có hàng.
    @Optional() @InjectQueue(QUEUE_NOTIFICATIONS_INAPP_RETRY) private readonly inAppRetryQueue?: Queue,
  ) {}

  /**
   * `dedupeKey`: tin gắn với một sự kiện chỉ xảy ra một lần (vd một dòng sổ điểm) — gọi lại với cùng khoá cho cùng khách thì
   * không ghi/gửi lần hai. Khoá nằm trong payload, kiểm và ghi dưới khoá advisory theo (khách, khoá) nên hai lần gọi song song
   * cũng chỉ một lần thắng. `dedupeWithinMs`: khoá chỉ chặn khi tin trước còn trong chừng này mili giây (gộp tin lặp theo
   * thời gian, vd "bài của bạn có người thích" tối đa một tin mỗi giờ). Chỉ số dương mới là cửa sổ hợp lệ; bỏ trống, 0, âm
   * hay NaN đều chặn vĩnh viễn như trước (không bao giờ hiểu nhầm thành "không chặn").
   * `retryZns` (cần `dedupeKey`): khoá được tính riêng cho kênh ZNS. Tin trong app đã lưu mà bước ZNS lỗi thì lần gọi lại chỉ
   * gửi nốt ZNS (không lưu thêm tin trong app); log ZNS mang cùng khoá nên đã gửi thì không gửi lại. Chỉ dành cho nơi gọi
   * đã tự tuần tự hoá các lượt (vd cron có bước nhận phần việc), vì lượt song song đều thấy "chưa có log ZNS".
   */
  async notify(
    userId: string,
    templateCode: string,
    data: Record<string, string>,
    opts: { dedupeKey?: string; dedupeWithinMs?: number; znsTemplateId?: string; retryZns?: boolean } = {},
  ): Promise<void> {
    const dedupeKey = opts.dedupeKey;
    const withinMs = opts.dedupeWithinMs != null && opts.dedupeWithinMs > 0 ? opts.dedupeWithinMs : null;
    // Đọc nhanh ngoài transaction: bài viral có hàng trăm lượt tương tác/phút mà chỉ một tin được ghi, nên các lượt còn lại
    // phải rời đi sau đúng một truy vấn thay vì mỗi lượt giữ một kết nối chờ khoá advisory. Kiểm lại trong transaction bên
    // dưới vẫn là cổng quyết định khi hai lượt cùng thấy "chưa có tin".
    let znsOnly = false;
    if (dedupeKey && (await this.prisma.notificationLog.findFirst({ where: this.dedupeWhere(userId, dedupeKey, withinMs), select: { id: true } }))) {
      if (!opts.retryZns || (await this.prisma.notificationLog.findFirst({ where: this.dedupeWhere(userId, dedupeKey, withinMs, 'ZNS'), select: { id: true } }))) {
        this.logger.debug(`Bỏ qua ${templateCode} cho ${userId}: đã gửi tin cho sự kiện này.`);
        return;
      }
      znsOnly = true;
    }
    const tpl = await getTemplateCached(this.prisma, templateCode);
    // Chỉ các cột dưới đây được dùng: số điện thoại cho ZNS và hai cờ nhóm tin của isAllowedByPrefs.
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, notifyPromo: true, notifyGarden: true } });
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
    const inAppLog = znsOnly
      ? null
      : dedupeKey
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
    if (!inAppLog && !znsOnly) {
      this.logger.debug(`Bỏ qua ${templateCode} cho ${userId}: đã gửi tin cho sự kiện này.`);
      return;
    }
    if (inAppLog) {
      await this.analytics.recordBestEffort({
        eventName: 'notification_sent',
        userId,
        platform: 'system',
        notificationId: inAppLog.id,
        props: { templateCode, channel: 'INAPP' },
      });
    }

    // ZNS nếu template là kênh ZNS + user có phone. `opts.znsTemplateId` (mã mẫu ZNS lấy từ cấu hình của nơi gọi) chỉ dùng khi
    // mẫu chưa gắn mã ZNS riêng.
    const znsTemplateId = (tpl?.channel === 'ZNS' && tpl.zaloTemplateId) || opts.znsTemplateId || null;
    if (user?.phone && znsTemplateId) {
      await this.dispatchZns(userId, templateCode, user.phone, znsTemplateId, data, opts.retryZns ? dedupeKey : undefined, withinMs);
    }
  }

  /**
   * Như notifySafe nhưng tin không được mất (vd "đã xuất hoá đơn": nút admin không bấm lại được sau ISSUED): lỗi thì xếp
   * job thử lại vào QUEUE_NOTIFICATIONS_INAPP_RETRY cùng `dedupeKey`, nên lượt thử lại và mọi nơi khác gọi cùng khoá chỉ ghi một tin. Không ném.
   * Trả SENT (đã gửi, đã có tin cho khoá này, hoặc khách tắt nhóm tin), QUEUED (đã xếp hàng thử lại) hay LOST (không có hàng đợi hoặc
   * xếp hàng lỗi: ghi log error và báo Sentry để không mất im lặng). `context` là nhãn ngắn kiểu `order=<mã>`.
   * Chỉ bảo đảm tin trong app: mẫu kênh ZNS mà bước ZNS lỗi sau khi tin trong app đã lưu thì lượt thử lại thấy khoá và dừng, ZNS không
   * gửi nốt (`retryZns` chỉ dành cho nơi gọi tự tuần tự hoá các lượt, ở đây nút admin và webhook chạy song song).
   */
  async notifyWithRetry(
    userId: string,
    templateCode: string,
    data: Record<string, string>,
    opts: { dedupeKey: string },
    context?: string,
  ): Promise<'SENT' | 'QUEUED' | 'LOST'> {
    try {
      await this.notify(userId, templateCode, data, { dedupeKey: opts.dedupeKey });
      return 'SENT';
    } catch (err) {
      const what = `${templateCode} cho ${userId}${context ? ` (${context})` : ''}`;
      const reason = err instanceof Error ? err.message : String(err);
      const queue = this.inAppRetryQueue;
      if (queue) {
        const job: InAppRetryJobData = { userId, templateCode, data, dedupeKey: opts.dedupeKey, ...(context ? { context } : {}) };
        try {
          await withQueueTimeout(queue.add(INAPP_RETRY_JOB, job, INAPP_RETRY_JOB_OPTIONS), `${QUEUE_NOTIFICATIONS_INAPP_RETRY} ${INAPP_RETRY_JOB}`);
          this.logger.warn(`Gửi tin ${what} lỗi (${reason}), đã xếp hàng thử lại.`);
          return 'QUEUED';
        } catch (queueErr) {
          this.logger.error(
            `Gửi tin ${what} lỗi: ${reason}; xếp hàng thử lại cũng lỗi: ${queueErr instanceof Error ? queueErr.message : String(queueErr)}`,
          );
          captureServerError(err);
          return 'LOST';
        }
      }
      this.logger.error(`Gửi tin ${what} lỗi: ${reason}; không có hàng đợi để thử lại.`);
      captureServerError(err);
      return 'LOST';
    }
  }

  /**
   * Dùng ở nơi tin là việc phụ của một thao tác đã xong (đơn đã xác nhận, đã hoàn tiền...): lỗi gửi không được làm hỏng thao tác
   * đó, nhưng cũng không được mất dấu — ghi log error (mã tin, khách, ngữ cảnh) và báo Sentry. Trả false khi lỗi để nơi gọi
   * biết mà nhả phần việc đã nhận (nếu có). `context` là nhãn ngắn kiểu `order=<mã>`, không đưa dữ liệu cá nhân vào.
   */
  async notifySafe(
    userId: string,
    templateCode: string,
    data: Record<string, string>,
    opts?: { dedupeKey?: string; dedupeWithinMs?: number; znsTemplateId?: string; retryZns?: boolean },
    context?: string,
  ): Promise<boolean> {
    try {
      await this.notify(userId, templateCode, data, opts);
      return true;
    } catch (err) {
      this.logger.error(
        `Gửi tin ${templateCode} cho ${userId}${context ? ` (${context})` : ''} lỗi: ${err instanceof Error ? err.message : String(err)}`,
      );
      captureServerError(err);
      return false;
    }
  }

  private dedupeWhere(userId: string, dedupeKey: string, withinMs: number | null, channel: 'INAPP' | 'ZNS' = 'INAPP') {
    return {
      userId,
      channel,
      payload: { path: ['dedupeKey'], equals: dedupeKey },
      // Log ZNS FAILED không chặn lượt gửi lại: chỉ log đang chờ, đang thử lại hay đã gửi mới tính là "đã gửi ZNS cho sự kiện này".
      // Lưu ý: hàm này chỉ cho phép gửi lại khi nơi gọi gọi lại notify(). Cron báo hạ hạng chỉ gọi lại khi lần trước ném lỗi
      // (xếp hàng hỏng); Zalo từ chối hết lượt ở worker thì log FAILED bất đồng bộ và cron không gửi lại trong cùng kỳ giữ hạng.
      ...(channel === 'ZNS' ? { status: { in: ['PENDING', 'RETRYING', 'SENT'] } } : {}),
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
    dedupeKey?: string,
    withinMs: number | null = null,
  ): Promise<void> {
    const queue = this.notificationsQueue;
    // Đọc cấu hình giờ yên tĩnh TRƯỚC khi ghi log: lỗi DB ở đây không để lại log PENDING không có job (kẹt mãi, và tin
    // khuyến mãi vẫn bị đếm vào trần). Không có queue thì gửi ngay, không trễ.
    const delay = queue ? await this.quietDelayMs() : 0;
    const deliverAt = new Date(Date.now() + delay);
    // Trần chỉ áp cho tin khuyến mãi/hậu mãi (cùng danh sách mẫu Marketing được sửa); bỏ ZNS thì tin trong app vẫn đã lưu.
    // Tin tạo trong giờ yên tĩnh tới tay khách sau nửa đêm: tính vào tháng của lúc tới, nếu không khách nhận 3 tin trong một
    // tháng dương lịch khi tin tạo ngày cuối tháng.
    const cap = MARKETING_TEMPLATE_CODES.has(templateCode) ? await this.promoCap(userId, deliverAt) : null;
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
      // dedupeWithinMs đi theo log để lúc gửi (deliverZns) xét đúng cửa sổ của nơi gọi: log SENT cũ hơn cửa sổ không chặn tin mới cùng khoá.
      payload: dedupeKey ? { data, dedupeKey, ...(withinMs ? { dedupeWithinMs: withinMs } : {}) } : { data },
      status: !result ? 'PENDING' : result.ok ? 'SENT' : 'FAILED',
      error: result && !result.ok ? znsFailureText(result) : null,
      // Trần đếm theo sentAt: tin khuyến mãi bị trễ ghi mốc tới tay khách để rơi đúng tháng.
      ...(cap && delay > 0 ? { sentAt: deliverAt } : {}),
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
    try {
      await withQueueTimeout(
        queue.add(ZNS_SEND_JOB, job, { ...ZNS_SEND_JOB_OPTIONS, jobId: `zns-${log.id}`, ...(delay > 0 ? { delay } : {}) }),
        `${QUEUE_NOTIFICATIONS} ${log.id}`,
      );
    } catch (err) {
      const reason = `Không xếp được hàng đợi gửi ZNS: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`${reason} (log ${log.id})`);
      // Chỉ đóng log còn PENDING: job vào Redis trước khi báo lỗi quá hạn có thể đã được worker nhận (deliverZns đổi PENDING thành
      // RETRYING trước khi gọi Zalo), đã gửi (SENT) hoặc đang thử lại; đóng đè lên đó rồi nhả khoá sẽ làm đêm sau gửi đôi.
      const closed = await this.prisma.notificationLog.updateMany({
        where: { id: log.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          error: reason,
          // Nhả khoá để lượt gửi lại sau (retryZns) tạo log mới thay vì coi là đã gửi.
          ...(dedupeKey ? { payload: { data, dedupeKey: releasedZnsDedupeKey(dedupeKey, log.id) } } : {}),
        },
      });
      // Chỉ nơi gọi dùng retryZns (đã tự nhận phần việc) mới cần biết để nhả phần việc của nó; tin thường thì lỗi này không ném ra ngoài.
      // Không đóng được log nào (count 0) nghĩa là worker đã nhận log: kết cục (SENT/FAILED) do worker ghi, như khi xếp hàng thành
      // công, nên không ném; nếu ném, nơi gọi trả phần việc và đêm sau tính lại một khách đã được báo.
      if (dedupeKey && closed.count > 0) throw err;
    }
  }

  private async configHour(key: string, fallback: number): Promise<number> {
    const raw = this.config ? await this.config.get<unknown>(key, fallback) : fallback;
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : fallback;
  }

  /** Số ms còn lại của giờ yên tĩnh ZNS (0 khi đang trong giờ gửi); processor dùng lại để dời cả lượt thử lại. */
  async quietDelayMs(): Promise<number> {
    const [start, end] = await Promise.all([
      this.configHour(QUIET_START_KEY, DEFAULT_QUIET_START_HOUR),
      this.configHour(QUIET_END_KEY, DEFAULT_QUIET_END_HOUR),
    ]);
    return znsQuietDelayMs(new Date(), start, end);
  }

  /** null khi trần tắt (0) hoặc giá trị không hợp lệ thì dùng mặc định. */
  private async promoCap(userId: string, at: Date): Promise<PromoCap | null> {
    const raw = this.config ? await this.config.get<unknown>(PROMO_CAP_KEY, DEFAULT_PROMO_MONTHLY_CAP) : DEFAULT_PROMO_MONTHLY_CAP;
    const limit = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_PROMO_MONTHLY_CAP;
    if (limit === 0) return null;
    return { userId, limit, from: startOfVnMonth(at), to: startOfNextVnMonth(at) };
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
   * log: SENT; RETRYING (đang gửi, hoặc lỗi tạm thời còn lượt); FAILED (lỗi vĩnh viễn hoặc hết lượt) kèm mã + lý do để admin lọc.
   * Trả kết cục thay vì ném — processor tự quyết định khi nào ném cho BullMQ xếp lịch thử lại.
   */
  async deliverZns(job: ZnsSendJobData, finalAttempt: boolean): Promise<ZnsDeliveryOutcome> {
    const where = { id: job.notificationLogId };
    // Log mang dedupeKey: quyết định "ai được gửi" và nhận log nằm chung trong một khoá advisory ngắn (xem claimUnderDedupeLock).
    const guarded = await this.claimUnderDedupeLock(job.notificationLogId, finalAttempt);
    if (guarded === 'SKIPPED' || guarded === 'RETRY' || guarded === 'FAILED') return guarded;
    // Nhận log trước khi gọi Zalo, cùng một câu lệnh với việc kiểm trạng thái: catch của dispatchZns (queue.add quá hạn dù Redis đã
    // nhận job) chỉ đóng log còn PENDING, nên sau bước này nó không còn nhả khoá của một tin đang đi được. RETRYING ở đây là "đang
    // gửi hoặc chờ thử lại"; kết quả cuối ghi đè ở dưới. Với log không có khoá, đây không phải khoá loại trừ giữa các worker: RETRYING
    // vẫn nhận lại được, nên job BullMQ bị coi là treo khi Zalo trả chậm có thể được worker khác gửi lần nữa (giống trước đây).
    const claimed =
      guarded === 'CLAIMED'
        ? { count: 1 }
        : await this.prisma.notificationLog.updateMany({
            where: { ...where, status: { in: ['PENDING', 'RETRYING'] } },
            data: { status: 'RETRYING' },
          });
    // Log từng được cron đánh dấu chờ đối soát mà nay được nhận lại: bỏ tiền tố, nếu không lần kẹt tiếp theo bị cron loại khỏi truy vấn mãi.
    if (claimed.count > 0) {
      await this.prisma.notificationLog.updateMany({ where: { ...where, error: { startsWith: ZNS_REVIEW_PREFIX } }, data: { error: null } });
    }
    if (claimed.count === 0) {
      const current = await this.prisma.notificationLog.findUnique({ where, select: { status: true, payload: true } });
      if (current?.status === 'SENT') return 'SENT';
      // Log bị đóng vì xếp hàng báo lỗi (dù Redis vẫn nhận job) đã nhả khoá để lượt retryZns sau tạo log mới: gửi tiếp ở đây là gửi đôi.
      // Tin thường không có khoá để nhả và không ai gửi lại, nên job đến muộn vẫn phải gửi (catch chỉ đóng PENDING nên không còn
      // ai tranh log này nữa).
      if (current?.status === 'FAILED' && isReleasedZnsLog(current.payload, job.notificationLogId)) return 'SKIPPED';
    }

    const result = await this.zns.sendTemplate(job.phone, job.templateId, job.templateData, job.notificationLogId);
    if (result.ok) {
      await this.markZnsSent(job.notificationLogId);
      return 'SENT';
    }
    const error = znsFailureText(result);
    const retrying = result.retryable && !finalAttempt;
    // Một câu UPDATE có điều kiện status <> 'SENT' (xem writeFailure): worker khác có thể đã ghi SENT cho log này trong lúc ta chờ Zalo.
    // Khi đó log đã đúng là "đã gửi": trả SENT (processor không ném nên BullMQ không thử lại), không đè FAILED/RETRYING và không nhả khoá.
    if ((await this.writeFailure(job.notificationLogId, retrying ? 'RETRYING' : 'FAILED', error)) === 0) {
      const now = await this.prisma.notificationLog.findUnique({ where, select: { status: true } });
      if (now?.status === 'SENT') {
        this.logger.warn(`ZNS log ${job.notificationLogId} đã SENT bởi lượt khác; kết quả lỗi của lượt này bị bỏ qua: ${error}`);
        return 'SENT';
      }
      // Lượt RETRYING muộn gặp log đã đóng FAILED (sự kiện failed/cron, đã nhả khoá): không còn gì để thử lại, đừng tốn lượt của BullMQ.
      if (now?.status === 'FAILED') return 'SKIPPED';
    }
    return retrying ? 'RETRY' : 'FAILED';
  }

  /**
   * Ghi kết cục chưa gửi được (RETRYING còn lượt, FAILED hết lượt) bằng MỘT câu UPDATE, không ghi đè log đã SENT. RETRYING chỉ từ PENDING/RETRYING:
   * log đã đóng FAILED bởi sự kiện failed/cron (đã nhả khoá) không được worker cũ mở lại. FAILED nhả luôn khoá
   * chống trùng trong cùng câu (`<khoá>:failed:<id>`, cùng quy tắc releasedPayload): job completed vẫn retry tay được, log FAILED còn khoá
   * nguyên thì lần chạy lại gửi tiếp dù nơi gọi đã gửi tin cùng sự kiện bằng log khác. Trả số dòng đã ghi (0 = log đã SENT, hoặc đã đóng khi ghi RETRYING, hoặc biến mất).
   */
  private async writeFailure(logId: string, status: 'RETRYING' | 'FAILED', error: string): Promise<number> {
    const release = status === 'FAILED';
    return this.prisma.$executeRaw`
      UPDATE notification_logs
         SET status = ${status}, "error" = ${error},
             payload = CASE
               WHEN ${release}::boolean AND jsonb_typeof(payload -> 'dedupeKey') = 'string' AND (payload ->> 'dedupeKey') !~ ':failed:[^:]+$'
               THEN jsonb_set(payload, '{dedupeKey}', to_jsonb((payload ->> 'dedupeKey') || ':failed:' || id))
               ELSE payload END
       WHERE id = ${logId}
         AND (CASE WHEN ${release}::boolean THEN status <> 'SENT' ELSE status IN ('PENDING', 'RETRYING') END)`;
  }

  /**
   * Hai log ZNS cùng (khách, dedupeKey) chỉ được gửi một. Quyết định và nhận log nằm trong CÙNG một transaction giữ khoá advisory
   * theo (khách, khoá), nên không phụ thuộc thứ tự sentAt/commit; khoá nhả ngay khi transaction xong, không giữ trong lúc gọi Zalo:
   * - có log khác đã SENT: bỏ qua (SKIPPED);
   * - có log khác đang RETRYING (đang gửi hoặc chờ thử lại): hoãn (RETRY, không đóng, BullMQ thử lại sau); tới lượt cuối vẫn
   *   vậy thì đóng FAILED có lý do, vì gửi tiếp là đánh cược gửi đôi;
   * - còn lại (log khác PENDING/FAILED hẳn/không có): nhận log này (RETRYING) rồi gửi.
   * NONE = không có khoá để so (tin thường, khoá đã nhả) hoặc log không còn nhận được: đi tiếp đường nhận log thường.
   */
  private async claimUnderDedupeLock(logId: string, finalAttempt: boolean): Promise<'NONE' | 'CLAIMED' | 'SKIPPED' | 'RETRY' | 'FAILED'> {
    const mine = await this.prisma.notificationLog.findUnique({ where: { id: logId }, select: { userId: true, status: true, payload: true } });
    const payload = mine?.payload as { dedupeKey?: unknown; dedupeWithinMs?: unknown } | null | undefined;
    const key = payload?.dedupeKey;
    if (!mine || typeof key !== 'string' || /:failed:[^:]+$/.test(key) || !['PENDING', 'RETRYING'].includes(mine.status)) return 'NONE';
    const withinMs = typeof payload?.dedupeWithinMs === 'number' && payload.dedupeWithinMs > 0 ? payload.dedupeWithinMs : null;
    const closable = { id: logId, status: { in: ['PENDING', 'RETRYING'] } };
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`zns-send:${mine.userId}:${key}`}))`;
      const others = await tx.notificationLog.findMany({
        where: {
          userId: mine.userId,
          channel: 'ZNS',
          id: { not: logId },
          payload: { path: ['dedupeKey'], equals: key },
          status: { in: ['SENT', 'RETRYING'] },
          ...(withinMs != null ? { sentAt: { gte: new Date(Date.now() - withinMs) } } : {}),
        },
        select: { id: true, status: true },
      });
      const sent = others.find((o) => o.status === 'SENT');
      if (sent) {
        await tx.notificationLog.updateMany({
          where: closable,
          data: { status: 'FAILED', error: `Bỏ qua: tin cho cùng sự kiện đã gửi ở log ${sent.id}.`, payload: releasedPayload(mine.payload, logId) },
        });
        return 'SKIPPED' as const;
      }
      if (others.length > 0) {
        if (!finalAttempt) return 'RETRY' as const;
        await tx.notificationLog.updateMany({
          where: closable,
          data: { status: 'FAILED', error: `Không gửi: log ${others[0]!.id} cùng sự kiện vẫn đang gửi hoặc thử lại sau nhiều lượt chờ.`, payload: releasedPayload(mine.payload, logId) },
        });
        return 'FAILED' as const;
      }
      const claimed = await tx.notificationLog.updateMany({ where: closable, data: { status: 'RETRYING' } });
      return claimed.count > 0 ? ('CLAIMED' as const) : ('NONE' as const);
    });
  }

  /**
   * Đóng log ZNS mà job BullMQ đã chết hẳn (hết lượt, stalled quá giới hạn, hoặc không còn trong Redis) và không ai ghi kết cục.
   * CAS theo trạng thái cũ (`from`: nơi gọi chỉ đóng từ trạng thái nó đã dựa vào để quyết, vd log vừa sang RETRYING thì không đóng theo bằng chứng của PENDING): hai đường cùng đóng (sự kiện của worker, cron quét, hai bản API) chỉ một lần ghi, log đã SENT/FAILED không đổi.
   * Log mang dedupeKey thì nhả khoá như dispatchZns (`<khoá>:failed:<id>`, giữ `data` và `dedupeWithinMs`): log FAILED đã không chặn dedupeWhere
   * nên khoá không cần nhả để tin sau đi được, nhưng job sống lại (khôi phục Redis, retry tay) mà log FAILED còn khoá nguyên thì deliverZns gửi
   * tiếp trong lúc khoá đã mở cho log mới = gửi đôi; nhả khoá thì deliverZns trả SKIPPED. Tiền tố khoá còn trong chuỗi nên vẫn đối soát được.
   * Không gọi Zalo và không tạo job.
   */
  async closeStuckZnsLog(logId: string, reason: string, from: readonly string[] = ['PENDING', 'RETRYING']): Promise<boolean> {
    const log = await this.prisma.notificationLog.findUnique({ where: { id: logId }, select: { payload: true } });
    if (!log) return false;
    // Chỉ closer ghi payload của log đang PENDING/RETRYING nên đọc rồi ghi kèm CAS theo status là đủ; key đã nhả (đường khác đóng trước) thì không nhả lần hai.
    const released = releasedPayload(log.payload, logId);
    const release = released ? { payload: released } : {};
    const closed = await this.prisma.notificationLog.updateMany({
      where: { id: logId, status: { in: [...from] } },
      data: { status: 'FAILED', error: reason, ...release },
    });
    return closed.count > 0;
  }

  /**
   * Log mà cron không đoán được kết cục (Zalo có thể đã nhận tin): giữ nguyên status, ghi tiền tố chờ đối soát vào `error` (giữ lỗi cũ phía sau)
   * để các lượt quét sau không xét lại và không để chúng chiếm hết mỗi lượt. CAS theo status đã thấy; true chỉ khi vừa đánh dấu.
   */
  async markZnsLogForReview(logId: string, seenStatus: string, note: string): Promise<boolean> {
    const mark = `${ZNS_REVIEW_PREFIX}${note}`;
    const updated = await this.prisma.$executeRaw`
      UPDATE notification_logs
         SET "error" = ${mark} || CASE WHEN "error" IS NULL THEN '' ELSE ' | ' || "error" END
       WHERE id = ${logId} AND status = ${seenStatus} AND channel = 'ZNS' AND ("error" IS NULL OR "error" NOT LIKE ${`${ZNS_REVIEW_PREFIX}%`})`;
    return updated > 0;
  }

  /** Job đã hoàn tất và báo SENT (Zalo đã nhận) mà log còn RETRYING vì markZnsSent ghi lỗi: ghi nốt SENT, chỉ từ RETRYING. */
  async markStuckZnsSent(logId: string): Promise<boolean> {
    return (await this.writeSent(logId, 'RETRYING')) > 0;
  }

  /**
   * Ghi SENT. Log đã bị đóng và nhả khoá (`<khoá>:failed:<id>`, xem closeStuckZnsLog) mà worker còn sống vẫn gọi Zalo thành công thì phải
   * khôi phục khoá gốc ngay trong CÙNG câu UPDATE: nếu không, log SENT mang khoá đã nhả sẽ không còn bị dedupeWhere/claimUnderDedupeLock
   * thấy và lần notify(retryZns) sau cùng khoá gửi tin lần nữa. Chỉ khôi phục khoá đã nhả của chính log này; `data`, `dedupeWithinMs` giữ nguyên.
   * `onlyFrom`: chỉ ghi khi log đang ở trạng thái đó (CAS); bỏ trống là ghi vô điều kiện như đường gửi thường. Trả số dòng đã ghi.
   */
  private async writeSent(logId: string, onlyFrom?: string): Promise<number> {
    const suffix = `:failed:${logId}`;
    return this.prisma.$executeRaw`
      UPDATE notification_logs
         SET status = 'SENT', "error" = NULL,
             payload = CASE
               WHEN jsonb_typeof(payload -> 'dedupeKey') = 'string' AND right(payload ->> 'dedupeKey', ${suffix.length}::int) = ${suffix}
               THEN jsonb_set(payload, '{dedupeKey}', to_jsonb(left(payload ->> 'dedupeKey', length(payload ->> 'dedupeKey') - ${suffix.length}::int)))
               ELSE payload END
       WHERE id = ${logId} AND (${onlyFrom ?? null}::text IS NULL OR status = ${onlyFrom ?? null}::text)`;
  }

  /**
   * Zalo đã nhận tin. Ghi SENT lỗi (DB chớp tắt) mà ném ra thì BullMQ chạy lại job và khách nhận tin lần hai, nên thử lại vài lần
   * rồi nuốt lỗi: log còn RETRYING (nhận lúc bắt đầu) là dấu vết đủ để admin đối chiếu, tin đôi thì không gỡ được.
   */
  private async markZnsSent(logId: string): Promise<void> {
    const delays = NotificationsService.SENT_WRITE_RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        // $executeRaw không ném khi không trúng dòng nào (khác update của Prisma ném P2025): log biến mất sau khi Zalo đã nhận thì phải lên log lỗi.
        if ((await this.writeSent(logId)) === 0) {
          this.logger.error(`ZNS log ${logId} đã gửi thành công nhưng không còn dòng log để ghi SENT.`);
        }
        return;
      } catch (err) {
        if (attempt >= delays.length) {
          this.logger.error(`ZNS log ${logId} đã gửi thành công nhưng ghi SENT lỗi sau ${attempt + 1} lần: ${err instanceof Error ? err.message : err}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
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
