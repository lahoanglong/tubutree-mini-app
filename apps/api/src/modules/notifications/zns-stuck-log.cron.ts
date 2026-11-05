import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService, oneLineReason } from './notifications.service';
import { ZNS_REVIEW_PREFIX } from './zns-review-prefix';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';
import { withQueueTimeout } from '../../jobs/queue-timeout';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { captureServerError } from '../../config/sentry';
import { CRON_TZ } from '../../common/cron-tz';

/**
 * Log ZNS còn RETRYING quá chừng này kể từ lúc tạo thì đóng FAILED. Phải không nhỏ hơn mọi `dedupeWithinMs` đang dùng, để log đã quá mọi cửa chống
 * trùng khi bị đóng và lượt notify() sau không thể gửi trùng nhờ việc nó thôi chặn: lớn nhất là khoá cấu hình `community.author_notify_interval_minutes`
 * (tối đa 1440 phút = 24 giờ); các nơi khác dùng 10 phút (CSKH) hoặc không cửa sổ. Log có khoá không cửa sổ (chặn vĩnh viễn) chỉ gửi lại được qua
 * `retryZns` (chỉ có nhắc hạ hạng, và nơi đó chỉ gọi lại khi notify() ném lỗi lúc xếp hàng, không gọi lại khi log đóng FAILED bất đồng bộ).
 * Retry của job chỉ kéo dài ~16 phút (6 lượt, backoff 30 giây nhân đôi) nên không job hợp lệ nào còn RETRYING sau 24 giờ.
 */
export const ZNS_RETRYING_EXPIRE_MS = 24 * 3_600_000;

export type ZnsStuckSweepResult =
  | { skipped: 'RUNNING' | 'LOCKED' | 'NO_QUEUE' | 'REDIS' | 'ERROR' }
  | { scanned: number; closed: number; sent: number; ambiguous: number; alive: number };

export type ZnsExpireResult = { skipped: 'RUNNING' | 'LOCKED' | 'ERROR' } | { scanned: number; expired: number };

/** Log cuối cùng đã xét ở lượt trước, theo (sentAt, id): lượt sau đi tiếp ngay sau nó. */
type Cursor = { sentAt: string; id: string };

type Verdict = 'CLOSE_GONE' | 'CLOSE_FAILED' | 'MARK_SENT' | 'AMBIGUOUS' | 'ALIVE';

/**
 * Đường dự phòng cho log ZNS kẹt PENDING/RETRYING khi sự kiện 'failed' của worker không tới (API chết đúng lúc job failed,
 * job mất khỏi Redis). Chỉ đọc trạng thái job rồi ghi bằng CAS (NotificationsService.closeStuckZnsLog / markStuckZnsSent);
 * không bao giờ gọi Zalo hay xếp job, nên không tạo đường gửi đôi.
 */
@Injectable()
export class ZnsStuckLogCron {
  /** Dưới ngưỡng này log còn có thể đang chờ hết giờ yên tĩnh, đang gửi hoặc đang chờ lượt thử lại: chưa xét. */
  private static readonly STUCK_AFTER_MS = 3_600_000;
  private static readonly BATCH = 200;
  private static readonly LOCK_KEY = 'cron:notifications.zns_stuck_logs';
  private static readonly EXPIRE_LOCK_KEY = 'cron:notifications.zns_retrying_expiry';
  private static readonly EXPIRE_REASON =
    'Hết thời gian chờ kết quả gửi ZNS (24 giờ): log còn RETRYING quá 24 giờ mà không có kết cục nên đóng FAILED, không gửi lại tin (đóng khi quét log kẹt). Nếu Zalo đã nhận tin, tra tracking_id = id log rồi đối soát tay theo runbook 1.20.';
  /** Con trỏ quay vòng nằm trong Redis để bản API nào giành được khoá lượt chạy cũng đi tiếp đúng chỗ; hết hạn sau 1 ngày thì quét lại từ đầu. */
  private static readonly CURSOR_KEY = 'zns-stuck-cron:cursor';
  private static readonly CURSOR_TTL_S = 86_400;
  /** Giá trị processor trả khi Zalo đã nhận tin (xem NotificationsProcessor.sendZns). */
  private static readonly SENT_RETURN = 'SENT';

  private readonly logger = new Logger(ZnsStuckLogCron.name);
  private running = false;
  private expiring = false;
  /** Bản sao trong bộ nhớ, dùng khi Redis không đọc/ghi được con trỏ. */
  private memCursor: Cursor | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue?: Queue,
  ) {}

  @Cron('*/30 * * * *', { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async sweepStuckZnsLogs(): Promise<ZnsStuckSweepResult> {
    if (!this.queue) return { skipped: 'NO_QUEUE' };
    if (this.running) { markCronSkipped('RUNNING'); return { skipped: 'RUNNING' }; }
    this.running = true;
    try {
      const run = await runExclusive(this.prisma, ZnsStuckLogCron.LOCK_KEY, () => this.sweep(this.queue as Queue));
      if (!run.acquired) { markCronSkipped('LOCKED'); return { skipped: 'LOCKED' }; }
      return run.value;
    } catch (err) {
      this.logger.error(`sweepStuckZnsLogs lỗi: ${err instanceof Error ? err.message : err}`);
      return { skipped: 'ERROR' };
    } finally {
      this.running = false;
    }
  }

  /**
   * Log ZNS RETRYING quá 24 giờ (kể cả log đã gắn tiền tố "Chờ đối soát tay" mà sweepStuckZnsLogs bỏ qua từ đó) chuyển FAILED để không treo mãi
   * ở Sức khoẻ hệ thống và go-live:check. Không đọc hàng đợi, không gọi Zalo, không xếp job: chỉ ghi bằng CAS (closeStuckZnsLog theo status RETRYING, sentAt
   * cũ hơn mốc, đúng chuỗi lỗi đã đọc), nhả khoá chống trùng như mọi đường đóng khác, và giữ lỗi cũ sau lý do mới. Chạy lệch nửa giờ so với quét log kẹt
   * để log còn xác định được kết cục (job failed, job completed SENT) đã được quét đó xử lý đúng trước.
   */
  @Cron('15 * * * *', { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 3 })
  async expireStaleRetryingZnsLogs(): Promise<ZnsExpireResult> {
    if (this.expiring) { markCronSkipped('RUNNING'); return { skipped: 'RUNNING' }; }
    this.expiring = true;
    try {
      const run = await runExclusive(this.prisma, ZnsStuckLogCron.EXPIRE_LOCK_KEY, () => this.expireStale());
      if (!run.acquired) { markCronSkipped('LOCKED'); return { skipped: 'LOCKED' }; }
      return run.value;
    } catch (err) {
      this.logger.error(`expireStaleRetryingZnsLogs lỗi: ${err instanceof Error ? err.message : err}`);
      return { skipped: 'ERROR' };
    } finally {
      this.expiring = false;
    }
  }

  private async expireStale(): Promise<ZnsExpireResult> {
    const cutoff = new Date(Date.now() - ZNS_RETRYING_EXPIRE_MS);
    // Log đã đóng rời khỏi tập (status FAILED) nên không cần con trỏ: mỗi lượt lấy lại BATCH log cũ nhất còn RETRYING. Đúng thứ tự cột của notification_logs_channel_status_sentAt_idx.
    const rows = await this.prisma.notificationLog.findMany({
      where: { channel: 'ZNS', status: 'RETRYING', sentAt: { lt: cutoff } },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      take: ZnsStuckLogCron.BATCH,
      select: { id: true, error: true },
    });
    let expired = 0;
    const reviewExpired: string[] = [];
    for (const { id, error } of rows) {
      try {
        if (await this.notifications.closeStuckZnsLog(id, ZnsStuckLogCron.EXPIRE_REASON, ['RETRYING'], { olderThan: cutoff, keepError: true })) {
          expired++;
          if (error?.startsWith(ZNS_REVIEW_PREFIX)) reviewExpired.push(id);
        }
      } catch (err) {
        this.logger.error(`Hết hạn log ZNS RETRYING: ghi log ${id} lỗi: ${err instanceof Error ? err.message : err}`);
        captureServerError(err);
      }
    }
    if (expired > 0) {
      this.logger.warn(`Hết hạn log ZNS: đã đóng FAILED ${expired}/${rows.length} log còn RETRYING quá 24 giờ (không gửi lại tin; đối soát tay theo runbook 1.20 nếu cần).`);
    }
    // Đóng xong, log rời db.zns_review_pending mà không vào ZNS_FAILED_24H_ALERT (chỉ số đó đếm theo sentAt trong 24 giờ): không báo lỗi ở đây
    // thì một tin khách có thể chưa nhận biến mất khỏi mọi bảng theo dõi.
    if (reviewExpired.length > 0) {
      const msg = `Hết hạn ${reviewExpired.length} log ZNS đang chờ đối soát tay (khách có thể chưa nhận tin), đối soát theo runbook 1.20: ${reviewExpired.join(', ')}`;
      this.logger.error(msg);
      captureServerError(new Error(msg));
    }
    return { scanned: rows.length, expired };
  }

  private async sweep(queue: Queue): Promise<ZnsStuckSweepResult> {
    // Mỗi lượt chỉ xét tối đa BATCH log (mỗi log hai lần gọi Redis): log cũ mà job còn sống (delayed tới hết giờ yên tĩnh, đang chạy lâu)
    // luôn nằm đầu danh sách theo sentAt, nên nếu mỗi lượt đều bắt đầu từ đầu thì log kẹt thật mới hơn không bao giờ tới lượt.
    // Con trỏ (sentAt, id) đi tiếp qua các lượt và quay về đầu khi hết danh sách, nên mọi log ứng viên được xét trong ceil(N / BATCH) lượt.
    const cursor = await this.loadCursor(queue);
    // Mỗi trạng thái một truy vấn (channel = , status = , ORDER BY sentAt, id): đúng thứ tự cột của notification_logs_channel_status_sentAt_idx
    // nên planner đi thẳng index, còn `status IN (...)` buộc sắp lại hoặc đi theo index sentAt và lọc gần hết bảng.
    const stuckOf = (status: 'PENDING' | 'RETRYING') =>
      this.prisma.notificationLog.findMany({
        where: {
          channel: 'ZNS',
          status,
          // Prisma không có so sánh bộ ("sentAt", id) > (c, id): cận dưới sentAt >= c là điều kiện thừa so với OR keyset ở dưới, nhưng nó cho planner
          // cắt đầu dải index (channel, status, sentAt) thay vì đọc từ đầu rồi lọc; (sentAt = c AND id > c.id) vẫn do OR bên dưới phân định.
          sentAt: { lt: new Date(Date.now() - ZnsStuckLogCron.STUCK_AFTER_MS), ...(cursor ? { gte: new Date(cursor.sentAt) } : {}) },
          // Log đã xét là mơ hồ (không có đường tự gỡ) bị loại: nếu không, chúng chiếm hết `take` theo sentAt tăng dần và log kẹt mới hơn không bao giờ được xét.
          OR: [{ error: null }, { error: { not: { startsWith: ZNS_REVIEW_PREFIX } } }],
          ...(cursor ? { AND: [{ OR: [{ sentAt: { gt: new Date(cursor.sentAt) } }, { sentAt: new Date(cursor.sentAt), id: { gt: cursor.id } }] }] } : {}),
        },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        take: ZnsStuckLogCron.BATCH,
        select: { id: true, status: true, sentAt: true },
      });
    const [pending, retrying] = await Promise.all([stuckOf('PENDING'), stuckOf('RETRYING')]);
    const logs = [...pending, ...retrying]
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, ZnsStuckLogCron.BATCH);

    // Đọc hết trạng thái job trước, ghi sau: Redis chập chờn giữa chừng thì bỏ cả lượt, không đóng log nào trên bằng chứng nửa vời.
    const verdicts: { id: string; status: string; verdict: Verdict; failedReason?: string }[] = [];
    try {
      for (const log of logs) verdicts.push({ id: log.id, status: log.status, ...(await this.judge(queue, log.id, log.status)) });
    } catch (err) {
      this.logger.warn(`Quét log ZNS kẹt: đọc Redis lỗi, bỏ lượt này (${err instanceof Error ? err.message : err})`);
      markCronSkipped('REDIS');
      return { skipped: 'REDIS' };
    }

    // Chỉ đi tiếp con trỏ khi cả lượt đọc Redis xong (nhánh REDIS ở trên đã return, con trỏ đứng yên): đủ BATCH là còn log phía sau, thiếu là hết danh sách.
    const last = logs[logs.length - 1];
    await this.saveCursor(queue, logs.length >= ZnsStuckLogCron.BATCH && last ? { sentAt: last.sentAt.toISOString(), id: last.id } : null);

    const result = { scanned: logs.length, closed: 0, sent: 0, ambiguous: 0, alive: 0 };
    for (const { id, status, verdict, failedReason } of verdicts) {
      try {
        if (verdict === 'ALIVE') result.alive++;
        else if (verdict === 'AMBIGUOUS') {
          const note = 'không rõ Zalo đã nhận tin chưa (tác vụ gửi đã hoàn tất hoặc đã mất khỏi hàng đợi).';
          if (await this.notifications.markZnsLogForReview(id, status, note)) result.ambiguous++;
        }
        else if (verdict === 'MARK_SENT') {
          if (await this.notifications.markStuckZnsSent(id)) result.sent++;
        } else {
          const reason =
            verdict === 'CLOSE_FAILED'
              ? `Gửi ZNS dừng: tác vụ gửi trong hàng đợi đã hỏng hẳn mà không ghi kết cục (phát hiện khi quét log kẹt).${failedReason ? ` Chi tiết kỹ thuật: ${oneLineReason(failedReason)}` : ''}`
              : 'Gửi ZNS dừng: không còn tác vụ gửi trong hàng đợi, log chưa từng được gửi (phát hiện khi quét log kẹt).';
          if (await this.notifications.closeStuckZnsLog(id, reason, verdict === 'CLOSE_GONE' ? ['PENDING'] : ['PENDING', 'RETRYING'])) result.closed++;
        }
      } catch (err) {
        this.logger.error(`Quét log ZNS kẹt: ghi log ${id} lỗi: ${err instanceof Error ? err.message : err}`);
        captureServerError(err);
      }
    }
    // ambiguous chỉ đếm log MỚI bị đánh dấu ở lượt này, nên dòng cảnh báo không lặp lại mỗi 30 phút cho cùng một log.
    // Log "chưa rõ" chặn gửi lại tin cùng sự kiện cho tới khi người đối soát: không để chỉ nằm trong log, báo Sentry một lần mỗi lượt quét.
    if (result.ambiguous > 0) {
      captureServerError(new Error(`Quét log ZNS kẹt: ${result.ambiguous} log chờ đối soát tay (không rõ Zalo đã nhận tin chưa), xem runbook 1.20.`));
    }
    if (result.closed + result.sent + result.ambiguous > 0) {
      this.logger.warn(
        `Quét log ZNS kẹt (${result.scanned} log): đã đóng ${result.closed}, ghi nốt đã gửi ${result.sent}, chưa rõ ${result.ambiguous}, còn chạy ${result.alive}. Log "chưa rõ" (không biết Zalo đã nhận tin chưa) giữ nguyên trạng thái và được đánh dấu chờ đối soát tay.`,
      );
    }
    return result;
  }

  /** Đọc con trỏ: Redis lỗi hay hỏng dữ liệu thì dùng bản trong bộ nhớ (quét lại từ đầu cũng an toàn vì cron chỉ đọc rồi ghi bằng CAS). */
  private async loadCursor(queue: Queue): Promise<Cursor | null> {
    try {
      const client = await withQueueTimeout(Promise.resolve(queue.client), `${QUEUE_NOTIFICATIONS} client`, undefined, { breaker: false });
      if (!client) return this.memCursor;
      const raw = await withQueueTimeout(Promise.resolve(client.get(ZnsStuckLogCron.CURSOR_KEY)), `${QUEUE_NOTIFICATIONS} cursor get`, undefined, { breaker: false });
      if (raw == null) return null;
      const parsed = JSON.parse(raw) as Partial<Cursor>;
      if (typeof parsed.sentAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(new Date(parsed.sentAt).getTime())) return null;
      return { sentAt: parsed.sentAt, id: parsed.id };
    } catch (err) {
      this.logger.warn(`Quét log ZNS kẹt: không đọc được con trỏ trong Redis, dùng bản trong bộ nhớ (${err instanceof Error ? err.message : err})`);
      return this.memCursor;
    }
  }

  private async saveCursor(queue: Queue, cursor: Cursor | null): Promise<void> {
    this.memCursor = cursor;
    try {
      const client = await withQueueTimeout(Promise.resolve(queue.client), `${QUEUE_NOTIFICATIONS} client`, undefined, { breaker: false });
      if (!client) return;
      if (cursor) await withQueueTimeout(Promise.resolve(client.set(ZnsStuckLogCron.CURSOR_KEY, JSON.stringify(cursor), { EX: ZnsStuckLogCron.CURSOR_TTL_S })), `${QUEUE_NOTIFICATIONS} cursor set`, undefined, { breaker: false });
      else await withQueueTimeout(Promise.resolve(client.del(ZnsStuckLogCron.CURSOR_KEY)), `${QUEUE_NOTIFICATIONS} cursor del`, undefined, { breaker: false });
    } catch (err) {
      this.logger.warn(`Quét log ZNS kẹt: không ghi được con trỏ vào Redis (${err instanceof Error ? err.message : err})`);
    }
  }

  private async judge(queue: Queue, logId: string, status: string): Promise<{ verdict: Verdict; failedReason?: string }> {
    const job = await withQueueTimeout(queue.getJob(`zns-${logId}`), `${QUEUE_NOTIFICATIONS} getJob ${logId}`, undefined, { breaker: false });
    if (!job) {
      // Log RETRYING đã qua tay worker (Zalo có thể đã nhận): job completed bị dọn khỏi Redis (removeOnComplete 1000) trông y như job mất.
      // Đóng FAILED ở đây không tự gửi gì, nhưng gỡ khoá chống trùng cho lần notify() sau: chỉ đóng khi chắc Zalo chưa được gọi (PENDING).
      return { verdict: status === 'PENDING' ? 'CLOSE_GONE' : 'AMBIGUOUS' };
    }
    const state = await withQueueTimeout(job.getState(), `${QUEUE_NOTIFICATIONS} getState ${logId}`, undefined, { breaker: false });
    if (state === 'failed') return { verdict: 'CLOSE_FAILED', failedReason: job.failedReason };
    if (state === 'completed') return { verdict: status === 'RETRYING' && job.returnvalue === ZnsStuckLogCron.SENT_RETURN ? 'MARK_SENT' : 'AMBIGUOUS' };
    return { verdict: 'ALIVE' };
  }
}
