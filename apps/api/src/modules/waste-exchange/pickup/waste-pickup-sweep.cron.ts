import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { CRON_TZ } from '../../../common/cron-tz';
import { PrismaService } from '../../../prisma/prisma.service';
import { WastePickupHooks } from './waste-pickup-hooks.service';

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
    if (this.running) return none;
    this.running = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt chạy: hai replica cùng lên lịch thì chỉ một bên quét. Từng yêu cầu chạy
      // trên kết nối khác — tx này chỉ để giữ khoá.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext('cron:waste.pickup_sweep')) AS "locked"`;
          if (!row?.locked) return none;
          return this.sweep();
        },
        { maxWait: 10_000, timeout: 15 * 60_000 },
      );
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
