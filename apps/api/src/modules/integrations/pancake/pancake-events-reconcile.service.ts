import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';
import { CRON_TZ } from '../../../common/cron-tz';
import { addGomdonJob } from '../gomdon/gomdon-queue';
import {
  PANCAKE_CLAIM_STALE_MINUTES,
  PANCAKE_EVENT_STATUS,
  PANCAKE_JOB_EVENT,
  PANCAKE_STOCK_EVENT,
} from './pancake-webhook-dedupe';
import { TrackCron } from '../../../common/cron-run/track-cron';

const LOCK_KEY = 'pancake.events-reconcile';

export type RedriveResult = { skipped: 'RUNNING' | 'LOCKED' } | { enqueued: number };

/**
 * Cứu webhook Pancake kẹt: RECEIVED (enqueue lúc nhận lỗi), FAILED (hết lượt retry BullMQ), PROCESSING
 * quá hạn (worker chết giữa chừng). Không có cron này thì đơn kẹt mãi ở trạng thái cũ khi Redis/DB chập.
 * Thêm UNMATCHED (chưa khớp được đơn Tubu — webhook tới trước khi pushOrder lưu pancakeOrderId): đối chiếu lại
 * vài lần trong UNMATCHED_WINDOW_MINUTES rồi thôi — shop Pancake còn đơn của kênh khác, không bao giờ khớp.
 *
 * Không cứu:
 *  - sự kiện đã claim MAX_ATTEMPTS lần (lỗi vĩnh viễn — xem cột error, xử lý tay);
 *  - sự kiện quá MAX_AGE_HOURS: trạng thái/thanh toán cũ áp muộn dễ sai hơn là bỏ;
 *  - variation.stock_changed: số tồn kho cũ áp muộn ghi đè số mới (hồi sinh hàng đã bán) — PancakeSyncService
 *    đồng bộ lại tồn kho định kỳ;
 *  - sự kiện người vận hành đã bấm "Đã xử lý" (dismissedAt) — họ đã chỉnh tay đơn, chạy lại sẽ đè quyết định đó.
 */
@Injectable()
export class PancakeEventsReconcileService {
  private readonly logger = new Logger(PancakeEventsReconcileService.name);
  static readonly STALE_MINUTES = 5;
  static readonly MAX_ATTEMPTS = 15;
  static readonly MAX_AGE_HOURS = 24;
  static readonly BATCH_SIZE = 100;
  static readonly UNMATCHED_WINDOW_MINUTES = 60;
  static readonly UNMATCHED_MAX_ATTEMPTS = 4;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_PANCAKE_EVENTS) private readonly queue: Queue,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('45 */10 * * * *', { name: 'pancake.events-reconcile', timeZone: CRON_TZ })
  @TrackCron()
  async reconcile(): Promise<void> {
    try {
      await this.redriveEvents();
    } catch (err) {
      this.logger.error(`Cứu webhook Pancake kẹt lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  async redriveEvents(now: Date = new Date()): Promise<RedriveResult> {
    if (this.running) return { skipped: 'RUNNING' };
    this.running = true;
    try {
      // Khoá advisory giữ suốt lượt chạy: nhiều instance API cùng lên lịch thì chỉ một instance quét.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS "locked"`;
          if (!row?.locked) return { skipped: 'LOCKED' as const };
          return { enqueued: await this.enqueueStuck(now) };
        },
        { maxWait: 10_000, timeout: 5 * 60_000 },
      );
    } finally {
      this.running = false;
    }
  }

  private async enqueueStuck(now: Date): Promise<number> {
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    const events = await this.prisma.pancakeWebhookEvent.findMany({
      where: {
        receivedAt: {
          lt: ago(PancakeEventsReconcileService.STALE_MINUTES),
          gte: ago(PancakeEventsReconcileService.MAX_AGE_HOURS * 60),
        },
        attempts: { lt: PancakeEventsReconcileService.MAX_ATTEMPTS },
        eventType: { not: PANCAKE_STOCK_EVENT },
        dismissedAt: null,
        OR: [
          { status: { in: [PANCAKE_EVENT_STATUS.RECEIVED, PANCAKE_EVENT_STATUS.FAILED] } },
          { status: PANCAKE_EVENT_STATUS.PROCESSING, claimedAt: { lt: ago(PANCAKE_CLAIM_STALE_MINUTES) } },
          {
            status: PANCAKE_EVENT_STATUS.UNMATCHED,
            receivedAt: { gte: ago(PancakeEventsReconcileService.UNMATCHED_WINDOW_MINUTES) },
            attempts: { lt: PancakeEventsReconcileService.UNMATCHED_MAX_ATTEMPTS },
          },
        ],
      },
      select: { id: true },
      // Cũ nhất trước: giữ gần đúng thứ tự Pancake gửi cho cùng một đơn.
      orderBy: { receivedAt: 'asc' },
      take: PancakeEventsReconcileService.BATCH_SIZE,
    });
    let enqueued = 0;
    for (const e of events) {
      try {
        // Xoá job đã xong/lỗi cùng jobId rồi add lại (BullMQ giữ hash job cũ → add trơn là no-op).
        // An toàn vì worker claim nguyên tử và bỏ qua sự kiện đã PROCESSED.
        await addGomdonJob(this.queue, PANCAKE_JOB_EVENT, { eventId: e.id }, e.id);
        enqueued += 1;
      } catch (err) {
        this.logger.error(`Enqueue lại webhook Pancake ${e.id} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (enqueued > 0) this.logger.warn(`Enqueue lại ${enqueued} webhook Pancake kẹt.`);
    return enqueued;
  }
}
