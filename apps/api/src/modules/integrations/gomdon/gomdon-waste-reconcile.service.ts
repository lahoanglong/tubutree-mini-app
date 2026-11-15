import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { CRON_TZ } from '../../../common/cron-tz';
import { TrackCron } from '../../../common/cron-run/track-cron';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { PrismaService } from '../../../prisma/prisma.service';
import { HOME_PICKUP_STATE } from '../../waste-exchange/home-pickup/waste-home-pickup-text';
import { enqueueGomdonWastePush } from './gomdon-queue';

/**
 * Lưới an toàn cho vận đơn của phiếu shipper lấy rác tận nhà (HOME_PICKUP), chạy cùng nhịp với GomdonReconcileService:
 *  1. Phiếu OPEN chưa từng tạo vận đơn (gomdonStatus null: xếp job lúc tạo phiếu lỗi) → xếp lại job tạo vận đơn (có claim, an toàn).
 *  2. CREATING quá lâu (tiến trình chết giữa lúc gọi Gomdon) → xếp job: job thấy claim quá hạn thì chốt NEEDS_MANUAL_CHECK + báo CSKH, không tạo lại.
 * Huỷ vận đơn của phiếu đã đóng chỉ xếp một lần lúc đóng phiếu (job có 8 lần thử, lần cuối lỗi báo CSKH), không quét lại để khỏi báo lặp.
 */
@Injectable()
export class GomdonWasteReconcileService {
  private readonly logger = new Logger(GomdonWasteReconcileService.name);
  static readonly PUSH_STALE_MINUTES = 15;
  static readonly CREATING_STALE_MINUTES = 30;
  static readonly BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_GOMDON_PUSH) private readonly pushQueue: Queue,
  ) {}

  @Cron('45 */10 * * * *', { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async reconcile(): Promise<void> {
    for (const [name, step] of [
      ['push', () => this.redrivePushes()],
      ['creating', () => this.escalateStuckCreating()],
    ] as const) {
      try {
        await step();
      } catch (err) {
        this.logger.error(`Gomdon waste reconcile (${name}) lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private minutesAgo(m: number): Date {
    return new Date(Date.now() - m * 60_000);
  }

  async redrivePushes(): Promise<number> {
    const rows = await this.prisma.wasteRequest.findMany({
      where: {
        method: 'HOME_PICKUP',
        status: 'OPEN',
        gomdonOrderId: null,
        gomdonPartnerCode: null,
        gomdonStatus: null,
        createdAt: { lt: this.minutesAgo(GomdonWasteReconcileService.PUSH_STALE_MINUTES) },
      },
      select: { id: true, code: true },
      orderBy: { createdAt: 'asc' },
      take: GomdonWasteReconcileService.BATCH_SIZE,
    });
    await this.enqueueAll(rows);
    if (rows.length > 0) this.logger.warn(`Xếp lại job tạo vận đơn Gomdon cho ${rows.length} phiếu thu gom.`);
    return rows.length;
  }

  async escalateStuckCreating(): Promise<number> {
    const rows = await this.prisma.wasteRequest.findMany({
      where: {
        method: 'HOME_PICKUP',
        gomdonStatus: HOME_PICKUP_STATE.CREATING,
        gomdonOrderId: null,
        gomdonPartnerCode: null,
        updatedAt: { lt: this.minutesAgo(GomdonWasteReconcileService.CREATING_STALE_MINUTES) },
      },
      select: { id: true, code: true },
      orderBy: { updatedAt: 'asc' },
      take: GomdonWasteReconcileService.BATCH_SIZE,
    });
    await this.enqueueAll(rows);
    return rows.length;
  }

  private async enqueueAll(rows: { id: string; code: string }[]): Promise<void> {
    for (const r of rows) {
      try {
        await enqueueGomdonWastePush(this.pushQueue, r.id, r.code);
      } catch (err) {
        this.logger.error(`Xếp job vận đơn Gomdon cho phiếu ${r.code} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
