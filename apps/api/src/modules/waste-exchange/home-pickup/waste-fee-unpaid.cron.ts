import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { runExclusive } from '../../../common/cron-leader/run-exclusive';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';
import { CRON_TZ } from '../../../common/cron-tz';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { closeHomePickupRequest } from './waste-home-pickup-ledger';

const PAGE = 100;

/**
 * Cron 10 phút đóng các phiếu HOME_PICKUP chọn chuyển khoản VietQR (`AWAITING`: `shipFeeCashPaidAt = null`) đã quá hạn thanh toán
 * với lý do `FEE_UNPAID`. Hoàn lại Điểm Xanh đã trừ lúc tạo phiếu; tiền mặt chưa từng thu nên không hoàn Ví và chưa bao giờ đẩy Gomdon.
 */
@Injectable()
export class WasteFeeUnpaidCron {
  private readonly logger = new Logger(WasteFeeUnpaidCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly notifier: WasteNotifierService,
  ) {}

  @Cron('20 */10 * * * *', { name: 'waste.fee-unpaid', timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async handleCron(): Promise<void> {
    try {
      const res = await this.run();
      if (res.expired > 0) this.logger.log(`Quá hạn chuyển khoản phí lấy rác: đóng ${res.expired} phiếu.`);
    } catch (err) {
      this.logger.error(`Cron quá hạn chuyển khoản phí lấy rác lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async run(now: Date = new Date()): Promise<{ expired: number }> {
    if (this.running) {
      markCronSkipped('RUNNING');
      return { expired: 0 };
    }
    this.running = true;
    try {
      const run = await runExclusive(this.prisma, 'cron:waste.fee-unpaid', () => this.sweep(now));
      if (!run.acquired) {
        markCronSkipped('LOCKED');
        return { expired: 0 };
      }
      return run.value;
    } finally {
      this.running = false;
    }
  }

  private async sweep(now: Date): Promise<{ expired: number }> {
    const refundExpiresAt = await this.config.pointExpiresAt(now);
    let expired = 0;
    let lastId: string | null = null;
    for (;;) {
      const base = {
        method: 'HOME_PICKUP' as const,
        status: 'OPEN' as const,
        shipFeeCashMethod: 'BANK_TRANSFER' as const,
        shipFeeCashPaidAt: null,
        expiresAt: { lt: now },
      };
      const page: { id: string; code: string; userId: string; pointId: string; shipFeePointsUsed: number | null }[] =
        await this.prisma.wasteRequest.findMany({
          where: lastId === null ? base : { AND: [base, { id: { gt: lastId } }] },
          select: { id: true, code: true, userId: true, pointId: true, shipFeePointsUsed: true },
          orderBy: { id: 'asc' },
          take: PAGE,
        });
      for (const row of page) {
        try {
          const closed = await this.prisma.$transaction(async (tx) => {
            const res = await closeHomePickupRequest(tx, {
              req: {
                id: row.id,
                userId: row.userId,
                code: row.code,
                pointId: row.pointId,
                shipFeePointsUsed: row.shipFeePointsUsed ?? 0,
              },
              from: ['OPEN'],
              to: 'EXPIRED',
              closeReason: 'FEE_UNPAID',
              now,
              refundExpiresAt,
              where: { shipFeeCashMethod: 'BANK_TRANSFER', shipFeeCashPaidAt: null, expiresAt: { lt: now } },
              event: {
                kind: 'REQUEST_EXPIRED',
                actorUserId: null,
                actorRole: 'SYSTEM',
                meta: {
                  closeReason: 'FEE_UNPAID',
                  method: 'HOME_PICKUP',
                  before: { status: 'OPEN' },
                  after: { status: 'EXPIRED', closeReason: 'FEE_UNPAID' },
                },
              },
            });
            return res.closed;
          });
          if (!closed) continue;
          expired += 1;
          await this.notifier.requestExpired(row.userId, { id: row.id, code: row.code, method: 'HOME_PICKUP' }, 'FEE_UNPAID', now);
        } catch (err) {
          this.logger.error(`Đóng phiếu quá hạn phí ${row.code} lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
        }
      }
      if (page.length < PAGE) break;
      lastId = page[page.length - 1]!.id;
    }
    return { expired };
  }
}
