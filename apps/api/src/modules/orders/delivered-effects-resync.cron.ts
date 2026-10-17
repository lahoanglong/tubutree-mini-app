import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_TZ } from '../../common/cron-tz';
import { OrderStatusService } from './order-status.service';
import { deliveredEffectsResyncWhere } from './delivered-effects';

const PAGE = 50;
const MAX_PER_TICK = 200;
const LOCK_KEY = 'cron:orders.delivered_effects_resync';

type Cursor = { deliveredAt: Date; id: string };

export type DeliveredEffectsResyncResult =
  | { skipped: 'RUNNING' | 'LOCKED' }
  | { scanned: number; repaired: number; failed: number };

/**
 * Chạy lại việc sau giao (cộng Điểm Xanh, khoá hoa hồng CTV, thưởng giới thiệu) cho đơn đã giao mà chưa có mốc
 * deliveredEffectsAt: đường chính lỗi/chết sau khi lật DELIVERED commit. Chỉ đơn giao trong cửa sổ ngày và đã quá thời gian chờ
 * (không chạy chồng lên request đang giao). Mỗi lượt tối đa MAX_PER_TICK đơn theo keyset (deliveredAt, id); lượt sau đi tiếp từ
 * chỗ dừng rồi quay về đầu, nên vài đơn lỗi mãi không chặn đơn khác.
 */
@Injectable()
export class DeliveredEffectsResyncCron {
  private readonly logger = new Logger(DeliveredEffectsResyncCron.name);
  private running = false;
  private cursor: Cursor | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatus: OrderStatusService,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 */10 * * * *', { name: 'orders.delivered-effects-resync', timeZone: CRON_TZ })
  async handleCron(): Promise<void> {
    try {
      const res = await this.resyncPending();
      if ('scanned' in res && res.scanned > 0) {
        this.logger.log(`Chạy lại việc sau giao: quét ${res.scanned}, sửa ${res.repaired}, lỗi ${res.failed}.`);
      }
    } catch (err) {
      this.logger.error(`Cron chạy lại việc sau giao lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async resyncPending(now: Date = new Date()): Promise<DeliveredEffectsResyncResult> {
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

  private async sweep(now: Date): Promise<{ scanned: number; repaired: number; failed: number }> {
    const where = deliveredEffectsResyncWhere(now);
    let scanned = 0;
    let repaired = 0;
    let failed = 0;
    let after = this.cursor;
    while (scanned < MAX_PER_TICK) {
      const take = Math.min(PAGE, MAX_PER_TICK - scanned);
      const page = await this.prisma.order.findMany({
        where: after
          ? {
              AND: [
                where,
                { OR: [{ deliveredAt: { gt: after.deliveredAt } }, { deliveredAt: after.deliveredAt, id: { gt: after.id } }] },
              ],
            }
          : where,
        orderBy: [{ deliveredAt: 'asc' }, { id: 'asc' }],
        take,
        select: { id: true, code: true, deliveredAt: true },
      });
      for (const o of page) {
        scanned += 1;
        try {
          const res = await this.orderStatus.resyncDeliveredEffects(o.id);
          if (res.outcome === 'DONE') {
            repaired += 1;
            // Đơn do pod cũ giao trong lúc triển khai (chưa ghi mốc) cũng qua đây với mọi việc đã xong: lời báo nói rõ lần này
            // có làm gì không, không mặc định là có sự cố.
            this.logger.warn(
              `Chạy lại việc sau giao cho đơn ${o.code} (giao lúc ${o.deliveredAt?.toISOString()}): ` +
                `cộng điểm ${res.pointsCredited ? 'vừa cộng' : 'đã có từ trước/không có'}, khoá hoa hồng ${res.commissionsLocked} dòng.`,
            );
          } else if (res.outcome === 'INCOMPLETE') {
            failed += 1;
            this.logger.error(`Đơn ${o.code}: chạy lại việc sau giao chưa xong — ${res.error}`);
          }
        } catch (err) {
          failed += 1;
          this.logger.error(`Đơn ${o.code}: chạy lại việc sau giao lỗi — ${err instanceof Error ? err.message : err}`);
        }
      }
      const last = page[page.length - 1];
      if (page.length < take || !last?.deliveredAt) {
        after = null;
        break;
      }
      after = { deliveredAt: last.deliveredAt, id: last.id };
    }
    this.cursor = after;
    return { scanned, repaired, failed };
  }
}
