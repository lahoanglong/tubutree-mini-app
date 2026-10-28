import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_ZALO_OA_EVENTS } from '../../../jobs/queues';
import { CRON_TZ } from '../../../common/cron-tz';
import { addGomdonJob } from '../gomdon/gomdon-queue';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';

const LOCK_KEY = 'zalo-oa.events-reconcile';
const PROCESS_JOB = 'process';

export type OaRedriveResult = { skipped: 'RUNNING' | 'LOCKED' } | { enqueued: number };

/**
 * Cứu tin khách nhắn vào Zalo OA còn nằm RECEIVED: webhook đã lưu tin nhưng enqueue lỗi (Redis chập), nên worker không bao
 * giờ nhận. Không cứu tin cũ hơn MAX_AGE_HOURS: trả lời tự động cho câu hỏi của hôm kia vừa vô nghĩa vừa ngoài cửa sổ 48 giờ
 * của Zalo. Tin đã PROCESSING (worker claim rồi chết giữa chừng) cố ý không chạy lại, để không gửi hai lần cùng một câu trả lời.
 */
@Injectable()
export class ZaloOaEventsReconcileService {
  private readonly logger = new Logger(ZaloOaEventsReconcileService.name);
  static readonly STALE_MINUTES = 5;
  static readonly MAX_AGE_HOURS = 24;
  static readonly BATCH_SIZE = 100;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_ZALO_OA_EVENTS) private readonly queue: Queue,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('30 */10 * * * *', { name: 'zalo-oa.events-reconcile', timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async reconcile(): Promise<void> {
    try {
      await this.redriveEvents();
    } catch (err) {
      this.logger.error(`Cứu tin Zalo OA kẹt lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  async redriveEvents(now: Date = new Date()): Promise<OaRedriveResult> {
    if (this.running) { markCronSkipped('RUNNING'); return { skipped: 'RUNNING' }; }
    this.running = true;
    try {
      // Khoá advisory giữ suốt lượt chạy: nhiều instance API cùng lên lịch thì chỉ một instance quét.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS "locked"`;
          if (!row?.locked) { markCronSkipped('LOCKED'); return { skipped: 'LOCKED' as const }; }
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
    const events = await this.prisma.oaInboundMessage.findMany({
      where: {
        status: 'RECEIVED',
        createdAt: { lt: ago(ZaloOaEventsReconcileService.STALE_MINUTES), gte: ago(ZaloOaEventsReconcileService.MAX_AGE_HOURS * 60) },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: ZaloOaEventsReconcileService.BATCH_SIZE,
    });
    let enqueued = 0;
    for (const e of events) {
      try {
        // Xoá job cùng jobId đã xong/lỗi rồi add lại (BullMQ giữ hash job cũ → add trơn là no-op). An toàn vì worker claim
        // RECEIVED → PROCESSING nguyên tử và bỏ qua tin không còn RECEIVED.
        await addGomdonJob(this.queue, PROCESS_JOB, { eventId: e.id }, e.id);
        enqueued += 1;
      } catch (err) {
        this.logger.error(`Enqueue lại tin Zalo OA ${e.id} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (enqueued > 0) this.logger.warn(`Enqueue lại ${enqueued} tin Zalo OA kẹt RECEIVED.`);
    return enqueued;
  }
}
