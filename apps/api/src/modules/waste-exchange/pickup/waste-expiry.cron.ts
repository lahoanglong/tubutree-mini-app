import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { CRON_TZ } from '../../../common/cron-tz';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { WasteShipLockService } from '../core/waste-ship-lock.service';
import { GOMDON_DISPATCHED_STATUSES } from '../waste.constants';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';

const PAGE = 200;

type ExpiryCloseReason = 'HOLD_EXPIRED' | 'PICKUP_NO_SHOW' | 'PICKUP_NOT_DISPATCHED';

/** §12.2 bước 4: chỉ vận đơn đã tới tay bưu tá (3, 4, 5, 7) mới là khách không giao; không phân loại theo gomdonOrderId. */
export function expiryCloseReason(row: { status: 'OPEN' | 'IN_TRANSIT'; gomdonStatus: string | null }): ExpiryCloseReason {
  if (row.status === 'OPEN') return 'HOLD_EXPIRED';
  if (row.gomdonStatus !== null && (GOMDON_DISPATCHED_STATUSES as readonly string[]).includes(row.gomdonStatus)) return 'PICKUP_NO_SHOW';
  return 'PICKUP_NOT_DISPATCHED';
}

type Candidate = { id: string; code: string; userId: string; method: 'DROP_OFF' | 'MAIL_IN' | 'PICKUP'; status: string; orderId: string | null };

@Injectable()
export class WasteExpiryCron {
  private readonly logger = new Logger(WasteExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly notifier: WasteNotifierService,
    private readonly shipLock: WasteShipLockService,
  ) {}

  // @Cron không tự bắt lỗi: lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 30 3 * * *', { name: 'waste.expiry', timeZone: CRON_TZ })
  @TrackCron()
  async handleCron(): Promise<void> {
    try {
      const res = await this.run();
      if (res.expired > 0) this.logger.log(`Hết hạn yêu cầu đổi rác: đóng ${res.expired} yêu cầu.`);
    } catch (err) {
      this.logger.error(`Cron hết hạn yêu cầu đổi rác lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async run(now: Date = new Date()): Promise<{ expired: number }> {
    if (this.running) { markCronSkipped('RUNNING'); return { expired: 0 }; }
    this.running = true;
    try {
      const cfg = await this.config.snapshot();
      // Khoá advisory theo transaction giữ suốt lượt chạy: hai replica cùng lên lịch thì chỉ một bên quét. Từng dòng đóng trên
      // kết nối khác; tx này chỉ để giữ khoá. Khoá viết thẳng trong SQL để cổng quét khoá thấy `hashtext('cron:`.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext('cron:waste.expiry')) AS "locked"`;
          if (!row?.locked) { markCronSkipped('LOCKED'); return { expired: 0 }; }
          return this.sweep(now, cfg);
        },
        { maxWait: 10_000, timeout: 15 * 60_000 },
      );
    } finally {
      this.running = false;
    }
  }

  private async sweep(now: Date, cfg: { shortfallLockPct: number; shortfallLockStreak: number }): Promise<{ expired: number }> {
    const base: Prisma.WasteRequestWhereInput = {
      expiresAt: { lt: now },
      OR: [{ status: 'OPEN', orderId: null }, { status: 'IN_TRANSIT', method: 'PICKUP' }],
    };
    const noShowUsers = new Set<string>();
    let expired = 0;
    let lastId: string | null = null;
    for (;;) {
      const page: Candidate[] = await this.prisma.wasteRequest.findMany({
        where: lastId === null ? base : { AND: [base, { id: { gt: lastId } }] },
        select: { id: true, code: true, userId: true, method: true, status: true, orderId: true },
        orderBy: { id: 'asc' },
        take: PAGE,
      });
      for (const row of page) {
        try {
          const closed = await this.closeRow(row, now);
          if (!closed) continue;
          expired += 1;
          await this.notifier.requestExpired(row.userId, { id: row.id, code: row.code }, closed, now);
          if (closed === 'PICKUP_NO_SHOW') noShowUsers.add(row.userId);
        } catch (err) {
          this.logger.error(`Đóng yêu cầu hết hạn ${row.id} lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
        }
      }
      if (page.length < PAGE) break;
      lastId = page[page.length - 1]!.id;
    }
    for (const userId of noShowUsers) {
      try {
        await this.shipLock.evaluateAndLock(userId, { shortfallLockPct: cfg.shortfallLockPct, shortfallLockStreak: cfg.shortfallLockStreak });
      } catch (err) {
        this.logger.error(`Xét khoá giao hàng cho ${userId} lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
      }
    }
    return { expired };
  }

  /** Một transaction ngắn cho một dòng; không lấy khoá nào khác (rule 15). Trả lý do đóng khi dòng trúng điều kiện. */
  private closeRow(row: Candidate, now: Date): Promise<ExpiryCloseReason | null> {
    return this.prisma.$transaction(async (tx) => {
      const inTransit = row.status === 'IN_TRANSIT';
      const gomdonStatus =
        inTransit && row.orderId ? ((await tx.order.findUnique({ where: { id: row.orderId }, select: { gomdonStatus: true } }))?.gomdonStatus ?? null) : null;
      const closeReason = expiryCloseReason({ status: inTransit ? 'IN_TRANSIT' : 'OPEN', gomdonStatus });
      const data = { status: 'EXPIRED' as const, closedAt: now, closeReason };
      const { count } = inTransit
        ? await tx.wasteRequest.updateMany({ where: { id: row.id, status: 'IN_TRANSIT', method: 'PICKUP', orderId: row.orderId, expiresAt: { lt: now } }, data })
        : await tx.wasteRequest.updateMany({ where: { id: row.id, status: 'OPEN', orderId: null, expiresAt: { lt: now } }, data });
      if (count !== 1) return null;
      await writeWasteEvent(tx, {
        kind: 'REQUEST_EXPIRED',
        actorUserId: null,
        actorRole: 'SYSTEM',
        requestId: row.id,
        meta: { closeReason, method: row.method, before: { status: row.status }, after: { status: 'EXPIRED', closeReason } },
      });
      return closeReason;
    });
  }
}
