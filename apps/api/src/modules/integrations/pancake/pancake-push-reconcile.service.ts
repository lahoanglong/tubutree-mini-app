import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import { PancakeOrderService } from './pancake-order.service';
import { GOMDON_STATE } from '../gomdon/gomdon-status';

/**
 * Lưới an toàn cuối cho P0-2 (docs/2026-09-08-review-progress.md): nếu enqueuePush() ở
 * checkout.service THẤT BẠI ngay lúc gọi (Redis blip khi add job — hiếm nhưng có thể),
 * hoặc job đã hết 5 lần retry mà Pancake vẫn lỗi, đơn sẽ kẹt vĩnh viễn với
 * pancakeOrderId=null mà không ai biết. Cron này quét định kỳ và re-enqueue.
 *
 * Đơn thu gom tái chế (hasRecyclingPickup) còn đang chờ Gomdon (gomdonStatus null/CREATING, chưa có
 * mã vận đơn): việc tạo vận đơn do GomdonReconcileService lo (không phụ thuộc Pancake). Cron này chỉ
 * BỎ CUỘC sau GOMDON_GIVE_UP_MINUTES: chốt trạng thái (null → FAILED "tạo tay", CREATING →
 * NEEDS_MANUAL_CHECK "kiểm tra Gomdon") bằng updateMany có guard RỒI mới đẩy Pancake — để Gomdon
 * không tự tạo thêm vận đơn sau khi kho đã được báo tạo tay. Nhờ vậy đơn luôn tới kho, kể cả khi
 * đường Gomdon/DB hỏng hẳn (fail-safe của worker cũng lỗi).
 */
@Injectable()
export class PancakePushReconcileService {
  private readonly logger = new Logger(PancakePushReconcileService.name);
  static readonly STALE_MINUTES = 15;
  static readonly GOMDON_GIVE_UP_MINUTES = 60;
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
      const giveUpCutoff = new Date(Date.now() - PancakePushReconcileService.GOMDON_GIVE_UP_MINUTES * 60_000);
      const stale = await this.prisma.order.findMany({
        where: {
          pancakeOrderId: null,
          status: { notIn: ['CANCELLED'] }, // đơn đã hủy không cần đẩy — không tồn tại để giao
          createdAt: { lt: cutoff },
        },
        select: {
          id: true,
          code: true,
          createdAt: true,
          hasRecyclingPickup: true,
          gomdonOrderId: true,
          gomdonPartnerCode: true,
          gomdonStatus: true,
        },
        // Mới nhất trước: đơn kẹt vĩnh viễn (Pancake từ chối mãi) không chiếm hết lô của đơn mới kẹt.
        orderBy: { createdAt: 'desc' },
        take: PancakePushReconcileService.BATCH_SIZE,
      });
      if (stale.length === 0) return;
      this.logger.warn(`Phát hiện ${stale.length} đơn chưa đẩy Pancake sau ${PancakePushReconcileService.STALE_MINUTES} phút — re-enqueue.`);
      for (const order of stale) {
        try {
          const waitingGomdon =
            order.hasRecyclingPickup &&
            !order.gomdonOrderId &&
            !order.gomdonPartnerCode &&
            (order.gomdonStatus == null || order.gomdonStatus === GOMDON_STATE.CREATING);
          if (waitingGomdon) {
            if (order.createdAt >= giveUpCutoff) continue; // GomdonReconcileService đang lo
            await this.prisma.order.updateMany({
              where: { id: order.id, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
              data: { gomdonStatus: GOMDON_STATE.FAILED },
            });
            await this.prisma.order.updateMany({
              where: { id: order.id, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: GOMDON_STATE.CREATING },
              data: { gomdonStatus: GOMDON_STATE.NEEDS_MANUAL_CHECK },
            });
            this.logger.error(
              `Đơn thu gom ${order.code} quá ${PancakePushReconcileService.GOMDON_GIVE_UP_MINUTES} phút chưa có vận đơn Gomdon — đẩy Pancake với cảnh báo tạo/kiểm tra vận đơn tay.`,
            );
          }
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
