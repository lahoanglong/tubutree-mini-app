import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_TZ } from '../../common/cron-tz';
import { OrderStatusService } from './order-status.service';
import { REVERSAL_EFFECTS_GRACE_MINUTES, REVERSAL_EFFECTS_WINDOW_DAYS } from './reversal-effects';
import { TrackCron } from '../../common/cron-run/track-cron';

const PAGE = 50;
const MAX_PER_TICK = 200;
const LOCK_KEY = 'cron:orders.reversal_effects_resync';

type Cursor = { updatedAt: Date; id: string };
type PendingRow = { id: string; code: string; updatedAt: Date };

export type ReversalEffectsResyncResult =
  | { skipped: 'RUNNING' | 'LOCKED' }
  | { scanned: number; repaired: number; failed: number };

/**
 * Chạy lại phần đảo sau commit của đơn CANCELLED/RETURNED chưa có mốc reversalEffectsAt: tiến trình chết giữa lần commit huỷ/trả
 * và các việc sau (đảo điểm tích, thu hồi hoa hồng, lệnh huỷ Pancake, tin báo) thì không ai gọi lại setStatus. Chỉ đơn lần ghi cuối
 * trong cửa sổ ngày và đã quá thời gian chờ (không chạy chồng lên request đang huỷ). Mỗi lượt tối đa MAX_PER_TICK đơn theo keyset
 * (updatedAt, id); lượt sau đi tiếp từ chỗ dừng rồi quay về đầu, nên vài đơn lỗi mãi không chặn đơn khác.
 */
@Injectable()
export class ReversalEffectsResyncCron {
  private readonly logger = new Logger(ReversalEffectsResyncCron.name);
  private running = false;
  private cursor: Cursor | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatus: OrderStatusService,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 */5 * * * *', { name: 'orders.reversal-effects-resync', timeZone: CRON_TZ })
  @TrackCron()
  async handleCron(): Promise<void> {
    try {
      const res = await this.resyncPending();
      if ('scanned' in res && res.scanned > 0) {
        this.logger.log(`Chạy lại phần đảo sau huỷ/trả: quét ${res.scanned}, xong ${res.repaired}, lỗi ${res.failed}.`);
      }
    } catch (err) {
      this.logger.error(`Cron chạy lại phần đảo sau huỷ/trả lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async resyncPending(now: Date = new Date()): Promise<ReversalEffectsResyncResult> {
    if (this.running) return { skipped: 'RUNNING' };
    this.running = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt chạy: hai replica cùng lên lịch thì chỉ một bên quét. Từng đơn chạy trên
      // kết nối khác — tx này chỉ để giữ khoá.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS "locked"`;
          if (!row?.locked) return { skipped: 'LOCKED' as const };
          return this.sweep(now);
        },
        { maxWait: 10_000, timeout: 15 * 60_000 },
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * SQL thô với đúng vị từ của orders_reversal_effects_pending_idx: qua Prisma, status bị gói CAST($1::text AS "OrderStatus") nên
   * planner không chứng minh được vị từ chỉ mục và quét cả bảng orders (mà đơn chưa đóng nào cũng có mốc null).
   */
  private page(now: Date, after: Cursor | null, take: number): Promise<PendingRow[]> {
    const upper = new Date(now.getTime() - REVERSAL_EFFECTS_GRACE_MINUTES * 60_000);
    const lower = new Date(now.getTime() - REVERSAL_EFFECTS_WINDOW_DAYS * 86_400_000);
    return this.prisma.$queryRaw<PendingRow[]>(Prisma.sql`
      SELECT "id", "code", "updatedAt"
        FROM "orders"
       WHERE "reversalEffectsAt" IS NULL AND "status" IN ('CANCELLED', 'RETURNED')
         AND "updatedAt" < ${upper} AND "updatedAt" >= ${lower}
         ${after ? Prisma.sql`AND ("updatedAt", "id") > (${after.updatedAt}, ${after.id})` : Prisma.empty}
       ORDER BY "updatedAt", "id"
       LIMIT ${take}`);
  }

  private async sweep(now: Date): Promise<{ scanned: number; repaired: number; failed: number }> {
    let scanned = 0;
    let repaired = 0;
    let failed = 0;
    let after = this.cursor;
    while (scanned < MAX_PER_TICK) {
      const take = Math.min(PAGE, MAX_PER_TICK - scanned);
      const rows = await this.page(now, after, take);
      for (const o of rows) {
        scanned += 1;
        try {
          const res = await this.orderStatus.resyncReversalEffects(o.id);
          if (res.outcome === 'DONE') {
            repaired += 1;
            this.logger.warn(`Đã chạy lại phần đảo sau huỷ/trả cho đơn ${o.code} (cập nhật lần cuối ${o.updatedAt.toISOString()}).`);
          } else if (res.outcome === 'INCOMPLETE') {
            failed += 1;
            this.logger.error(`Đơn ${o.code}: chạy lại phần đảo sau huỷ/trả chưa xong — ${res.error}`);
          }
        } catch (err) {
          failed += 1;
          this.logger.error(`Đơn ${o.code}: chạy lại phần đảo sau huỷ/trả lỗi — ${err instanceof Error ? err.message : err}`);
        }
      }
      const last = rows[rows.length - 1];
      if (rows.length < take || !last) {
        after = null;
        break;
      }
      after = { updatedAt: last.updatedAt, id: last.id };
    }
    this.cursor = after;
    return { scanned, repaired, failed };
  }
}
