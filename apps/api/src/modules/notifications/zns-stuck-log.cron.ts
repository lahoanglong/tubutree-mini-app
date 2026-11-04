import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';
import { withQueueTimeout } from '../../jobs/queue-timeout';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { captureServerError } from '../../config/sentry';
import { CRON_TZ } from '../../common/cron-tz';

export type ZnsStuckSweepResult =
  | { skipped: 'RUNNING' | 'LOCKED' | 'NO_QUEUE' | 'REDIS' | 'ERROR' }
  | { scanned: number; closed: number; sent: number; ambiguous: number; alive: number };

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
  /** Giá trị processor trả khi Zalo đã nhận tin (xem NotificationsProcessor.sendZns). */
  private static readonly SENT_RETURN = 'SENT';

  private readonly logger = new Logger(ZnsStuckLogCron.name);
  private running = false;

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

  private async sweep(queue: Queue): Promise<ZnsStuckSweepResult> {
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        channel: 'ZNS',
        status: { in: ['PENDING', 'RETRYING'] },
        sentAt: { lt: new Date(Date.now() - ZnsStuckLogCron.STUCK_AFTER_MS) },
      },
      orderBy: { sentAt: 'asc' },
      take: ZnsStuckLogCron.BATCH,
      select: { id: true, status: true },
    });

    // Đọc hết trạng thái job trước, ghi sau: Redis chập chờn giữa chừng thì bỏ cả lượt, không đóng log nào trên bằng chứng nửa vời.
    const verdicts: { id: string; verdict: Verdict }[] = [];
    try {
      for (const log of logs) verdicts.push({ id: log.id, verdict: await this.judge(queue, log.id, log.status) });
    } catch (err) {
      this.logger.warn(`Quét log ZNS kẹt: đọc Redis lỗi, bỏ lượt này (${err instanceof Error ? err.message : err})`);
      markCronSkipped('REDIS');
      return { skipped: 'REDIS' };
    }

    const result = { scanned: logs.length, closed: 0, sent: 0, ambiguous: 0, alive: 0 };
    for (const { id, verdict } of verdicts) {
      try {
        if (verdict === 'ALIVE') result.alive++;
        else if (verdict === 'AMBIGUOUS') result.ambiguous++;
        else if (verdict === 'MARK_SENT') {
          if (await this.notifications.markStuckZnsSent(id)) result.sent++;
        } else {
          const reason =
            verdict === 'CLOSE_FAILED'
              ? 'Gửi ZNS dừng: job trong hàng đợi đã hỏng hẳn mà không ghi kết cục (phát hiện khi quét log kẹt).'
              : 'Gửi ZNS dừng: không còn job trong hàng đợi, log chưa từng được gửi (phát hiện khi quét log kẹt).';
          if (await this.notifications.closeStuckZnsLog(id, reason, verdict === 'CLOSE_GONE' ? ['PENDING'] : ['PENDING', 'RETRYING'])) result.closed++;
        }
      } catch (err) {
        this.logger.error(`Quét log ZNS kẹt: ghi log ${id} lỗi: ${err instanceof Error ? err.message : err}`);
        captureServerError(err);
      }
    }
    if (result.closed + result.sent + result.ambiguous > 0) {
      this.logger.warn(`Quét log ZNS kẹt: ${JSON.stringify(result)} (ambiguous = job đã hoàn tất hoặc mất mà không rõ Zalo đã nhận chưa, giữ nguyên để admin đối soát).`);
    }
    return result;
  }

  private async judge(queue: Queue, logId: string, status: string): Promise<Verdict> {
    const job = await withQueueTimeout(queue.getJob(`zns-${logId}`), `${QUEUE_NOTIFICATIONS} getJob ${logId}`, undefined, { breaker: false });
    if (!job) {
      // Log RETRYING đã qua tay worker (Zalo có thể đã nhận): job completed bị dọn khỏi Redis (removeOnComplete 1000) trông y như job mất.
      // Đóng FAILED ở đây không tự gửi gì, nhưng gỡ khoá chống trùng cho lần notify() sau: chỉ đóng khi chắc Zalo chưa được gọi (PENDING).
      return status === 'PENDING' ? 'CLOSE_GONE' : 'AMBIGUOUS';
    }
    const state = await withQueueTimeout(job.getState(), `${QUEUE_NOTIFICATIONS} getState ${logId}`, undefined, { breaker: false });
    if (state === 'failed') return 'CLOSE_FAILED';
    if (state === 'completed') return status === 'RETRYING' && job.returnvalue === ZnsStuckLogCron.SENT_RETURN ? 'MARK_SENT' : 'AMBIGUOUS';
    return 'ALIVE';
  }
}
