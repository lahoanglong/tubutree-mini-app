import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import { PANCAKE_CANCEL, PANCAKE_PUSH, PANCAKE_PUSHABLE_STATUSES, PancakeOrderService } from './pancake-order.service';
import { ATTENTION_PUSH_FAILED, flagPancakeAttention } from './pancake-attention';
import { PREPAID_METHODS } from '../../orders/order-transition';
import { GOMDON_STATE, isGomdonPayable } from '../gomdon/gomdon-status';
import { GomdonAlertService } from '../gomdon/gomdon-alert.service';
import { CRON_TZ } from '../../../common/cron-tz';

/**
 * Lưới an toàn cuối cho P0-2 (docs/2026-09-08-review-progress.md): nếu enqueuePush() ở
 * checkout.service THẤT BẠI ngay lúc gọi (Redis blip khi add job — hiếm nhưng có thể),
 * hoặc job đã hết 5 lần retry mà Pancake vẫn lỗi, đơn sẽ kẹt vĩnh viễn với
 * pancakeOrderId=null mà không ai biết. Cron này quét định kỳ và re-enqueue.
 *
 * Đơn thu gom tái chế (hasRecyclingPickup) còn đang chờ Gomdon (gomdonStatus null/CREATING, chưa có
 * mã vận đơn): việc tạo vận đơn do GomdonReconcileService lo (không phụ thuộc Pancake). Cron này chỉ
 * BỎ CUỘC sau GOMDON_GIVE_UP_MINUTES: chốt trạng thái (null → FAILED "tạo tay", CREATING →
 * NEEDS_MANUAL_CHECK "kiểm tra Gomdon") bằng updateMany có guard RỒI mới đẩy Pancake + báo ADMIN — để
 * Gomdon không tự tạo thêm vận đơn sau khi kho đã được báo tạo tay. Nhờ vậy đơn luôn tới kho, kể cả
 * khi đường Gomdon/DB hỏng hẳn (fail-safe của worker cũng lỗi).
 * Ngoại lệ: đơn trả trước CHƯA thanh toán (null) → AWAITING_PAYMENT chứ không FAILED — tiền về sau
 * (lật PAID) vẫn tự đặt vận đơn; FAILED sẽ chặn vĩnh viễn việc đó.
 *
 * Chỉ tự đẩy đơn còn trong kho (PENDING_PAYMENT/CONFIRMED/PACKED) đặt trong MAX_AGE_HOURS: đơn đã giao/đã rời kho
 * hay đơn cũ (đặt lúc Pancake chưa cấu hình, sự cố kéo dài) mà đẩy lên thì kho giao lần hai. Đơn còn mở nhưng quá
 * cửa sổ → STALE + "Cần xử lý Pancake" để người kiểm tra rồi bấm "Đẩy lại Pancake".
 * Cùng nhịp: thử lại huỷ đơn Pancake (đơn huỷ ở Tubu) và báo "đã thanh toán" cho đơn đã lên Pancake lúc chưa trả.
 */
@Injectable()
export class PancakePushReconcileService {
  private readonly logger = new Logger(PancakePushReconcileService.name);
  static readonly STALE_MINUTES = 15;
  static readonly GOMDON_GIVE_UP_MINUTES = 60;
  static readonly BATCH_SIZE = 50;
  /** Quá mốc này mà đơn chưa lên Pancake thì không tự đẩy nữa (đối soát tay). */
  static readonly MAX_AGE_HOURS = 72;
  /** Cửa sổ tự thử lại huỷ / cập nhật thanh toán trên Pancake. */
  static readonly FOLLOW_UP_WINDOW_HOURS = 72;
  /** Huỷ trên Pancake: thử lại với đơn đặt trong chừng này ngày (đơn chưa giao có thể nằm kho lâu hơn 72 giờ). */
  static readonly CANCEL_FOLLOW_UP_DAYS = 14;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    private readonly pancakeOrder: PancakeOrderService,
    private readonly alerts: GomdonAlertService,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — findMany lỗi (DB blip...) ném ra ngoài là
  // unhandledRejection, Node 20 mặc định crash cả process. Lỗi enqueuePush từng đơn đã được cô
  // lập ở try/catch trong vòng lặp bên dưới; lớp ngoài này bắt phần còn lại (query, v.v).
  @Cron('0 */15 * * * *', { timeZone: CRON_TZ }) // mỗi 15 phút, lệch mốc với PancakeSyncService cho dễ đọc log
  async reconcile(): Promise<void> {
    try {
      if (!this.client.isConfigured()) return; // dev: Pancake chưa cấu hình, bỏ qua như pushOrder()
    } catch (err) {
      this.logger.error(`reconcile lỗi: ${err instanceof Error ? err.message : err}`);
      return;
    }
    await this.pushStale();
    await this.markOverdue();
    await this.retryCancels();
    await this.retryPayments();
  }

  private async pushStale(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - PancakePushReconcileService.STALE_MINUTES * 60_000);
      const maxAge = new Date(Date.now() - PancakePushReconcileService.MAX_AGE_HOURS * 3_600_000);
      const giveUpCutoff = new Date(Date.now() - PancakePushReconcileService.GOMDON_GIVE_UP_MINUTES * 60_000);
      const stale = await this.prisma.order.findMany({
        where: {
          pancakeOrderId: null,
          // Chỉ đơn còn trong kho: đơn đã huỷ/trả không tồn tại để giao, đơn đã rời kho/đã giao mà đẩy thì giao 2 lần.
          status: { in: [...PANCAKE_PUSHABLE_STATUSES] },
          createdAt: { lt: cutoff, gte: maxAge },
          AND: [
            // Đơn đại lý còn hàng đặt trước (chưa đủ 100%) chỉ được đẩy khi DealerBackorderService lấp đủ
            // (thiết kế duyệt 12/09): lọc ngay trong query để chúng không chiếm lô BATCH_SIZE của đơn khác.
            { NOT: { type: 'DEALER', items: { some: { backorderedQty: { gt: 0 } } } } },
            // Trả trước qua cổng chưa có tiền: chờ thanh toán (lật PAID tự xếp đẩy), không chiếm lô.
            { NOT: { paymentStatus: { not: 'PAID' }, paymentMethod: { in: GATEWAY_METHODS } } },
          ],
        },
        select: {
          id: true,
          code: true,
          type: true,
          items: { select: { backorderedQty: true } },
          createdAt: true,
          hasRecyclingPickup: true,
          gomdonOrderId: true,
          gomdonPartnerCode: true,
          gomdonStatus: true,
          paymentMethod: true,
          paymentStatus: true,
        },
        // Lâu chưa thử nhất trước (chưa thử bao giờ đứng đầu): đơn bị Pancake từ chối mãi không chiếm hết lô.
        orderBy: { pancakeLastAttemptAt: { sort: 'asc', nulls: 'first' } },
        take: PancakePushReconcileService.BATCH_SIZE,
      });
      if (stale.length === 0) return;
      this.logger.warn(`Phát hiện ${stale.length} đơn chưa đẩy Pancake sau ${PancakePushReconcileService.STALE_MINUTES} phút — re-enqueue.`);
      for (const order of stale) {
        try {
          if (order.type === 'DEALER' && order.items?.some((i) => i.backorderedQty > 0)) continue;
          const waitingGomdon =
            order.hasRecyclingPickup &&
            !order.gomdonOrderId &&
            !order.gomdonPartnerCode &&
            (order.gomdonStatus == null || order.gomdonStatus === GOMDON_STATE.CREATING);
          let giveUpAlert: string | null = null;
          if (waitingGomdon) {
            if (order.createdAt >= giveUpCutoff) continue; // GomdonReconcileService đang lo
            const noWaybill = { id: order.id, gomdonOrderId: null, gomdonPartnerCode: null };
            if (order.gomdonStatus === GOMDON_STATE.CREATING) {
              const r = await this.prisma.order.updateMany({
                where: { ...noWaybill, gomdonStatus: GOMDON_STATE.CREATING },
                data: { gomdonStatus: GOMDON_STATE.NEEDS_MANUAL_CHECK },
              });
              if (r.count > 0) {
                giveUpAlert = `Quá ${PancakePushReconcileService.GOMDON_GIVE_UP_MINUTES} phút vẫn đang tạo vận đơn Gomdon (không rõ đã tạo chưa) — KIỂM TRA GOMDON theo mã đơn ${order.code} trước khi tạo vận đơn tay.`;
              }
            } else if (!isGomdonPayable(order)) {
              // Trả trước chưa thanh toán: chưa được đặt bưu tá. Chờ thanh toán (không phải lỗi) — lật PAID
              // sau đó enqueue lại tạo vận đơn, GomdonReconcileService quét AWAITING_PAYMENT+PAID.
              await this.prisma.order.updateMany({
                where: { ...noWaybill, gomdonStatus: null },
                data: { gomdonStatus: GOMDON_STATE.AWAITING_PAYMENT },
              });
            } else {
              const r = await this.prisma.order.updateMany({
                where: { ...noWaybill, gomdonStatus: null },
                data: { gomdonStatus: GOMDON_STATE.FAILED },
              });
              if (r.count > 0) {
                giveUpAlert = `Quá ${PancakePushReconcileService.GOMDON_GIVE_UP_MINUTES} phút chưa tạo được vận đơn Gomdon — cần TẠO VẬN ĐƠN TAY và hẹn thu gom với khách (đơn đã đẩy Pancake kèm ghi chú tạo tay).`;
              }
            }
            this.logger.error(
              `Đơn thu gom ${order.code} quá ${PancakePushReconcileService.GOMDON_GIVE_UP_MINUTES} phút chưa có vận đơn Gomdon — đẩy Pancake với cảnh báo tạo/kiểm tra vận đơn tay.`,
            );
          }
          await this.pancakeOrder.enqueuePush(order.id);
          // Báo SAU khi đã đẩy Pancake (kho có đơn để tạo tay); lỗi gửi báo động tự nuốt trong alert().
          if (giveUpAlert) await this.alerts.alert(order.code, giveUpAlert);
        } catch (err) {
          this.logger.error(`Re-enqueue lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      this.logger.error(`reconcile lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Đơn còn mở quá cửa sổ tự đẩy mà chưa lên Pancake: STALE (một lần) + "Cần xử lý Pancake". */
  private async markOverdue(): Promise<void> {
    try {
      const maxAge = new Date(Date.now() - PancakePushReconcileService.MAX_AGE_HOURS * 3_600_000);
      const overdue = await this.prisma.order.findMany({
        where: {
          pancakeOrderId: null,
          status: { in: [...PANCAKE_PUSHABLE_STATUSES] },
          createdAt: { lt: maxAge },
          OR: [{ pancakePushStatus: null }, { pancakePushStatus: { notIn: [PANCAKE_PUSH.STALE] } }],
          AND: [
            { NOT: { type: 'DEALER', items: { some: { backorderedQty: { gt: 0 } } } } },
            { NOT: { paymentStatus: { not: 'PAID' }, paymentMethod: { in: GATEWAY_METHODS } } },
          ],
        },
        select: { id: true, code: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: PancakePushReconcileService.BATCH_SIZE,
      });
      for (const order of overdue) {
        const r = await this.prisma.order.updateMany({
          where: { id: order.id, pancakeOrderId: null },
          data: { pancakePushStatus: PANCAKE_PUSH.STALE },
        });
        if (r.count === 0) continue;
        await flagPancakeAttention(
          this.prisma,
          this.alerts,
          order,
          `${ATTENTION_PUSH_FAILED} sau ${PancakePushReconcileService.MAX_AGE_HOURS} giờ nên hệ thống KHÔNG tự đẩy nữa (tránh kho giao đơn cũ). Kiểm tra kho đã giao tay chưa; chưa thì bấm "Đẩy lại Pancake".`,
          this.logger,
        );
      }
    } catch (err) {
      this.logger.error(`Đánh dấu đơn quá hạn đẩy Pancake lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Huỷ trên Pancake chưa xong (mất kết nối lúc huỷ, job hết lượt) → thử lại trong cửa sổ. */
  private async retryCancels(): Promise<void> {
    try {
      const now = Date.now();
      const due = await this.prisma.order.findMany({
        where: {
          status: 'CANCELLED',
          pancakeCancelStatus: { in: [PANCAKE_CANCEL.PENDING, PANCAKE_CANCEL.FAILED] },
          // updatedAt đổi theo mỗi lần thử (ghi lỗi) nên chỉ dùng để chừa job đang chạy; cửa sổ tính từ ngày đặt.
          updatedAt: { lt: new Date(now - PancakePushReconcileService.STALE_MINUTES * 60_000) },
          createdAt: { gte: new Date(now - PancakePushReconcileService.CANCEL_FOLLOW_UP_DAYS * 86_400_000) },
        },
        select: { id: true, code: true },
        take: PancakePushReconcileService.BATCH_SIZE,
      });
      for (const o of due) {
        await this.pancakeOrder
          .enqueueCancel(o.id)
          .catch((err) => this.logger.error(`Re-enqueue huỷ Pancake lỗi cho đơn ${o.code}: ${err instanceof Error ? err.message : err}`));
      }
    } catch (err) {
      this.logger.error(`Thử lại huỷ Pancake lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Đơn đã lên Pancake lúc chưa trả tiền, nay PAID mà Pancake chưa biết → cập nhật để không thu COD. */
  private async retryPayments(): Promise<void> {
    try {
      const now = Date.now();
      const due = await this.prisma.order.findMany({
        where: {
          pancakeOrderId: { not: null },
          pancakePaymentSynced: false,
          paymentStatus: 'PAID',
          paymentMethod: { in: [...PREPAID_METHODS] },
          status: { in: ['CONFIRMED', 'PACKED'] },
          paidAt: {
            lt: new Date(now - PancakePushReconcileService.STALE_MINUTES * 60_000),
            gte: new Date(now - PancakePushReconcileService.FOLLOW_UP_WINDOW_HOURS * 3_600_000),
          },
        },
        select: { id: true, code: true },
        take: PancakePushReconcileService.BATCH_SIZE,
      });
      for (const o of due) {
        await this.pancakeOrder
          .enqueuePayment(o.id)
          .catch((err) => this.logger.error(`Re-enqueue cập nhật thanh toán Pancake lỗi cho đơn ${o.code}: ${err instanceof Error ? err.message : err}`));
      }
    } catch (err) {
      this.logger.error(`Thử lại cập nhật thanh toán Pancake lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** Trả trước qua cổng/ví: chưa PAID thì chưa đẩy kho (xem pancakePushGate). */
const GATEWAY_METHODS = PREPAID_METHODS.filter((m) => m !== 'BANK_TRANSFER');
