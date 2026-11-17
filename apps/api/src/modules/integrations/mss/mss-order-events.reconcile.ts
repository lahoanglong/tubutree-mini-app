import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../../common/cron-tz';
import { markCronSkipped, noteCronError, TrackCron } from '../../../common/cron-run/track-cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { MssFlagsService } from './mss-flags';
import { MssOrderEventFallback } from './mss-order-event.fallback';
import { MssOrderEventSender } from './mss-order-event.sender';
import { MSS_CLAIM_STALE_MS, MSS_FALLBACK_STATUSES, MSS_RESULT_RECONCILE_AFTER_MS, MSS_RESULT_STUCK_GRACE_MS } from './mss-order-event-types';

export const MSS_ORDER_EVENTS_SWEEP_CRON = '30 */5 * * * *';
export const MSS_ORDER_EVENTS_RECONCILE_CRON = '45 */10 * * * *';
/** Dòng PENDING tới hạn lâu hơn chừng này mà chưa ai nhận: job đã mất (Redis hỏng, API chết sau commit), cron tự gửi. */
export const MSS_SWEEP_GRACE_MS = 60_000;
const BATCH = 50;
/** Mỗi lần gọi MSS tối đa 5 giây: giới hạn thời gian một lượt cron để MSS treo không giữ cron quá lượt kế. */
const RUN_BUDGET_MS = 120_000;

/**
 * Lưới an toàn của outbox MSS: quét bù dòng mất job hoặc kẹt SENDING, chạy nốt đường lui bị gián đoạn, và đối soát dòng đã giao MSS lâu
 * chưa có callback. Mọi bước đi qua cùng câu nhận dòng của worker nên chạy chồng worker không gửi đôi.
 */
@Injectable()
export class MssOrderEventReconcileService {
  private readonly logger = new Logger(MssOrderEventReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: MssFlagsService,
    private readonly sender: MssOrderEventSender,
    private readonly fallback: MssOrderEventFallback,
  ) {}

  @Cron(MSS_ORDER_EVENTS_SWEEP_CRON, { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 3 })
  async sweep(): Promise<void> {
    try {
      const r = await this.sweepOnce();
      if (r.delivered === 0 && r.fallbacks === 0 && !this.flags.configured()) markCronSkipped('NOT_CONFIGURED');
    } catch (err) {
      const msg = `Quét bù tin đơn MSS lỗi: ${err instanceof Error ? err.message : String(err)}`;
      noteCronError(msg);
      this.logger.error(msg);
    }
  }

  /** Một lượt quét (export cho test): gửi dòng mất job/kẹt, chạy đường lui còn dở. */
  async sweepOnce(now = Date.now()): Promise<{ delivered: number; fallbacks: number }> {
    const started = Date.now();
    const due = await this.prisma.mssOrderEventOutbox.findMany({
      where: {
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: new Date(now - MSS_SWEEP_GRACE_MS) } },
          { status: 'SENDING', claimedAt: { lt: new Date(now - MSS_CLAIM_STALE_MS) } },
        ],
      },
      select: { eventId: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH,
    });
    let delivered = 0;
    for (const row of due) {
      if (Date.now() - started > RUN_BUDGET_MS) break;
      const outcome = await this.sender.deliver(row.eventId);
      if (outcome !== 'not_claimable' && outcome !== 'not_found') delivered++;
    }
    const unsettled = await this.prisma.mssOrderEventOutbox.findMany({
      where: { status: { in: [...MSS_FALLBACK_STATUSES] }, fallbackAt: null },
      select: { eventId: true },
      orderBy: { updatedAt: 'asc' },
      take: BATCH,
    });
    let fallbacks = 0;
    for (const row of unsettled) {
      if ((await this.fallback.run(row.eventId)) !== null) fallbacks++;
    }
    if (delivered > 0 || fallbacks > 0) this.logger.log(`Quét bù tin đơn MSS: gửi lại ${delivered}, đường lui ${fallbacks}.`);
    return { delivered, fallbacks };
  }

  @Cron(MSS_ORDER_EVENTS_RECONCILE_CRON, { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 3 })
  async reconcile(): Promise<void> {
    try {
      if (!this.flags.configured()) {
        if ((await this.settleStuckOnce()) === 0) markCronSkipped('NOT_CONFIGURED');
        return;
      }
      await this.settleStuckOnce();
      await this.reconcileOnce();
    } catch (err) {
      const msg = `Đối soát tin đơn MSS lỗi: ${err instanceof Error ? err.message : String(err)}`;
      noteCronError(msg);
      this.logger.error(msg);
    }
  }

  /**
   * Dòng MSS đã nhận mà quá hạn sống 2 giờ vẫn chưa có kết quả (MSS treo, hỏi GET lỗi mãi, hay đã gỡ biến MSS_*): chốt "không rõ", chỉ còn
   * tin trong app (có thể MSS đã gửi nên không gửi ZNS). Không gọi MSS.
   */
  async settleStuckOnce(now = Date.now()): Promise<number> {
    const rows = await this.prisma.mssOrderEventOutbox.findMany({
      where: { status: 'DELIVERED', expiresAt: { lt: new Date(now - MSS_RESULT_STUCK_GRACE_MS) } },
      select: { eventId: true },
      orderBy: { expiresAt: 'asc' },
      take: BATCH,
    });
    let settled = 0;
    for (const row of rows) {
      if ((await this.sender.applyResult(row.eventId, {}, 'unknown', 'stuck', 'reconcile')) === 'applied') settled++;
    }
    return settled;
  }

  /** Hỏi MSS kết quả của dòng đã giao quá 15 phút chưa có callback (hợp đồng mục 4.3). */
  async reconcileOnce(now = Date.now()): Promise<number> {
    const started = Date.now();
    const rows = await this.prisma.mssOrderEventOutbox.findMany({
      where: { status: 'DELIVERED', deliveredAt: { lt: new Date(now - MSS_RESULT_RECONCILE_AFTER_MS) } },
      select: { eventId: true, orderCode: true, eventType: true, expiresAt: true },
      orderBy: { deliveredAt: 'asc' },
      take: BATCH,
    });
    let settled = 0;
    for (const row of rows) {
      if (Date.now() - started > RUN_BUDGET_MS) break;
      const r = await this.sender.reconcileOne(row);
      if (r === 'applied' || r === 'stuck' || r === 'requeued') settled++;
    }
    return settled;
  }
}
