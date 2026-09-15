import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import { PancakeOrderService } from './pancake-order.service';

/**
 * Lưới an toàn cuối cho P0-2 (docs/2026-09-08-review-progress.md): nếu enqueuePush() ở
 * checkout.service THẤT BẠI ngay lúc gọi (Redis blip khi add job — hiếm nhưng có thể),
 * hoặc job đã hết 5 lần retry mà Pancake vẫn lỗi, đơn sẽ kẹt vĩnh viễn với
 * pancakeOrderId=null mà không ai biết. Cron này quét định kỳ và re-enqueue.
 */
@Injectable()
export class PancakePushReconcileService {
  private readonly logger = new Logger(PancakePushReconcileService.name);
  static readonly STALE_MINUTES = 15;
  static readonly BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    private readonly pancakeOrder: PancakeOrderService,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — findMany lỗi (DB blip...) ném ra ngoài là
  // unhandledRejection, Node 20 mặc định crash cả process. Lỗi enqueuePush từng đơn đã được cô
  // lập ở try/catch trong vòng lặp bên dưới; lớp ngoài này bắt phần còn lại (query, v.v).
  @Cron('0 */15 * * * *') // mỗi 15 phút, lệch mốc với PancakeSyncService cho dễ đọc log
  async reconcile(): Promise<void> {
    try {
      if (!this.client.isConfigured()) return; // dev: Pancake chưa cấu hình, bỏ qua như pushOrder()
      const cutoff = new Date(Date.now() - PancakePushReconcileService.STALE_MINUTES * 60_000);
      const stale = await this.prisma.order.findMany({
        where: {
          pancakeOrderId: null,
          status: { notIn: ['CANCELLED'] }, // đơn đã hủy không cần đẩy — không tồn tại để giao
          createdAt: { lt: cutoff },
        },
        select: { id: true, code: true },
        take: PancakePushReconcileService.BATCH_SIZE,
      });
      if (stale.length === 0) return;
      this.logger.warn(`Phát hiện ${stale.length} đơn chưa đẩy Pancake sau ${PancakePushReconcileService.STALE_MINUTES} phút — re-enqueue.`);
      for (const order of stale) {
        try {
          await this.pancakeOrder.enqueuePush(order.id);
        } catch (err) {
          this.logger.error(`Re-enqueue lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      this.logger.error(`reconcile lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }
}
