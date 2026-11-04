import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { CRON_TZ } from '../../../common/cron-tz';
import { PrismaService } from '../../../prisma/prisma.service';
import { WastePickupHooks } from './waste-pickup-hooks.service';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';
import { runExclusive } from '../../../common/cron-leader/run-exclusive';

const PAGE = 200;

type SweepResult = { cancelled: number; started: number; anomalies: number };

const BASE_WHERE: Prisma.WasteRequestWhereInput = {
  status: 'OPEN',
  orderId: { not: null },
  order: { is: { status: { in: ['CANCELLED', 'DELIVERED', 'RETURNED'] } } },
};

/**
 * Quét bù cho yêu cầu thu gom còn OPEN mà đơn đã sang CANCELLED/DELIVERED/RETURNED: hook sau đổi trạng thái đơn lỗi hoặc chết
 * giữa chừng. Lọc từ phía yêu cầu nên đơn đã có mốc việc sau giao vẫn được xử lý. Hook tự quyết bằng updateMany có điều kiện,
 * bên thua nhánh "bỏ qua", nên quét chạy chồng với hook không gây xử lý đôi.
 */
@Injectable()
export class WastePickupSweepCron {
  private readonly logger = new Logger(WastePickupSweepCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hooks: WastePickupHooks,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 */5 * * * *', { name: 'waste.pickup-sweep', timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async handleCron(): Promise<void> {
    try {
      const res = await this.run();
      if (res.cancelled > 0 || res.started > 0 || res.anomalies > 0) {
        this.logger.log(`Quét bù thu gom: huỷ ${res.cancelled}, bắt đầu ${res.started}, bất thường ${res.anomalies}.`);
      }
    } catch (err) {
      this.logger.error(`Cron quét bù thu gom lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async run(): Promise<SweepResult> {
    const none: SweepResult = { cancelled: 0, started: 0, anomalies: 0 };
    if (this.running) { markCronSkipped('RUNNING'); return none; }
    this.running = true;
    try {
      // Khoá lượt chạy (cron_leases), không giữ kết nối DB: nhiều instance cùng lên lịch thì chỉ một chạy.
      const run = await runExclusive(this.prisma, 'cron:waste.pickup_sweep', () => this.sweep());
      if (!run.acquired) { markCronSkipped('LOCKED'); return none; }
      return run.value;
    } finally {
      this.running = false;
    }
  }

  // Không đặt trần số dòng mỗi lượt: lượt nào cũng bắt đầu từ id nhỏ nhất, trần sẽ để các dòng cứ trả SKIPPED chặn đói dòng sau.
  private async sweep(): Promise<SweepResult> {
    const result: SweepResult = { cancelled: 0, started: 0, anomalies: 0 };
    let lastId: string | null = null;
    for (;;) {
      const page: { id: string; orderId: string | null; order: { status: string } | null }[] =
        await this.prisma.wasteRequest.findMany({
          where: lastId === null ? BASE_WHERE : { AND: [BASE_WHERE, { id: { gt: lastId } }] },
          select: { id: true, orderId: true, order: { select: { status: true } } },
          orderBy: { id: 'asc' },
          take: PAGE,
        });
      for (const row of page) {
        const orderId = row.orderId;
        if (!orderId || !row.order) continue;
        const cancelled = row.order.status === 'CANCELLED';
        try {
          const outcome = await (cancelled ? this.hooks.applyOrderCancelled(orderId) : this.hooks.applyOrderDelivered(orderId));
          if (outcome === 'APPLIED') result[cancelled ? 'cancelled' : 'started'] += 1;
          else if (outcome === 'ANOMALY') result.anomalies += 1;
        } catch (err) {
          this.logger.error(`Quét bù thu gom, yêu cầu ${row.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (page.length < PAGE) break;
      lastId = page[page.length - 1]!.id;
    }
    return result;
  }
}
