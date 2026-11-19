import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { MSS_PAYMENT_RESCUE_CANCEL_KEY } from '../integrations/mss/mss-flag-keys';
import { OrderStatusService, type SetStatusOutcome } from './order-status.service';
import { CancelAfterHandoverError } from './order-transition';
import { pendingPaymentCancelOpts } from './pending-payment-cancel';
import { pendingPaymentDeadline } from './pending-payment-ttl';

/** Lý do không huỷ một đơn MSS báo quá hạn; trả về cho MSS (200) và ghi log, không đổi gì trên đơn. */
export type PaymentRescueSkipReason =
  | 'not_bank_transfer'
  | 'paid'
  | 'not_pending'
  | 'payment_unlinked'
  | 'partially_paid'
  | 'auto_cancel_blocked'
  | 'handover'
  | 'raced';

export type PaymentRescueResult =
  | { outcome: 'disabled' | 'unknown_order' | 'cancelled' | 'already_cancelled' }
  | { outcome: 'not_due'; deadline: string }
  | { outcome: 'skipped'; reason: PaymentRescueSkipReason };

/** Lý do huỷ chuẩn (PO duyệt 19/11, A7); số giờ là hạn thanh toán Tubu đang hứa với khách, mặc định 24. */
export function overdueCancelNote(hours: number): string {
  return `Tự động hủy do quá hạn chuyển khoản ${hours}h`;
}

const skipped = (reason: PaymentRescueSkipReason): PaymentRescueResult => ({ outcome: 'skipped', reason });

/**
 * MSS báo đơn chuyển khoản đã QUÁ HẠN (hợp đồng W4-02, khối `payment_rescue` trên webhook `order-status`). MSS không huỷ đơn: Tubu tự
 * quyết. Chỉ huỷ khi đơn đúng là BANK_TRANSFER đang PENDING_PAYMENT + UNPAID, chưa có khoản tiền nào Pancake báo về (đủ, thiếu, hay
 * chưa gắn đơn), và đã qua đúng hạn thanh toán Tubu ghi cho khách ở trang QR: MSS chỉnh được mốc quá hạn từ 6 giờ, nên báo sớm hơn hạn
 * đó thì để cron tự huỷ làm đúng giờ, không huỷ đơn khách vẫn đang được phép chuyển.
 *
 * Huỷ đi đúng đường của cron (OrderStatusService.setStatus với onlyIfUnpaid + expectedStatus): câu lật có điều kiện trong transaction,
 * nên tiền về hay cron chen giữa thì lần này trượt; hoàn kho, flash, mã giảm giá, Điểm Xanh, ghi lịch sử đơn, sự kiện `order.cancelled`
 * cho MSS và tin báo khách chỉ chạy ở lần thắng. Gọi lại cùng đơn thì thấy đơn đã huỷ và không làm gì nữa.
 */
@Injectable()
export class MssPaymentRescueService {
  private readonly logger = new Logger(MssPaymentRescueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly orderStatus: OrderStatusService,
  ) {}

  /**
   * Ghi số tin MSS đã nhắc chuyển khoản và lúc nhắc gần nhất lên đơn để màn admin Đơn hàng hiện cạnh trạng thái quá hạn. Ghi cả khi cờ huỷ
   * tắt (chỉ là số liệu hiển thị), chỉ cho đơn chuyển khoản. Số nhắc và mốc nhắc mỗi thứ chỉ tiến, không lùi khi tin tới trễ; hai lệnh ghi riêng để tin
   * thiếu hay hỏng một trường vẫn không kéo lùi trường kia. Lỗi ghi chỉ log: việc huỷ phía sau vẫn chạy.
   */
  async recordReminders(orderCode: string, r: { sent: number | null; lastAt: Date | null }): Promise<void> {
    const order = { code: orderCode, paymentMethod: 'BANK_TRANSFER' as const };
    try {
      if (r.sent !== null) {
        await this.prisma.order.updateMany({
          where: { ...order, OR: [{ paymentRemindersSent: null }, { paymentRemindersSent: { lte: r.sent } }] },
          data: { paymentRemindersSent: r.sent },
        });
      }
      if (r.lastAt !== null) {
        await this.prisma.order.updateMany({
          where: { ...order, OR: [{ paymentLastRemindedAt: null }, { paymentLastRemindedAt: { lte: r.lastAt } }] },
          data: { paymentLastRemindedAt: r.lastAt },
        });
      }
    } catch (err) {
      this.logger.warn(`Không ghi được số lần MSS nhắc chuyển khoản đơn ${orderCode}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleOverdue(orderCode: string, now: Date = new Date()): Promise<PaymentRescueResult> {
    const result = await this.decide(orderCode, now);
    if (result.outcome !== 'disabled') {
      const detail = result.outcome === 'skipped' ? ` (${result.reason})` : result.outcome === 'not_due' ? ` (hạn ${result.deadline})` : '';
      this.logger.log(`MSS báo quá hạn chuyển khoản đơn ${orderCode}: ${result.outcome}${detail}.`);
    }
    return result;
  }

  private async decide(orderCode: string, now: Date): Promise<PaymentRescueResult> {
    if ((await this.config.get<unknown>(MSS_PAYMENT_RESCUE_CANCEL_KEY, false)) !== true) return { outcome: 'disabled' };
    const order = await this.prisma.order.findUnique({
      where: { code: orderCode },
      select: {
        id: true,
        type: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        createdAt: true,
        autoCancelBlockedAt: true,
        paymentUnlinkedAt: true,
        pancakePaidReported: true,
      },
    });
    if (!order) return { outcome: 'unknown_order' };
    if (order.paymentMethod !== 'BANK_TRANSFER') return skipped('not_bank_transfer');
    if (order.status === 'CANCELLED') return { outcome: 'already_cancelled' };
    if (order.paymentStatus !== 'UNPAID') return skipped('paid');
    if (order.status !== 'PENDING_PAYMENT') return skipped('not_pending');
    // Pancake đã báo một khoản về mà chưa gắn được đơn: Kế toán đang đối chiếu sao kê, cron giữ đơn thêm PAYMENT_UNLINKED_HOLD_HOURS.
    if (order.paymentUnlinkedAt) return skipped('payment_unlinked');
    // Khách đã chuyển một phần: cần người liên hệ khách chuyển thêm hay hoàn, không tự huỷ theo tin của MSS.
    if ((order.pancakePaidReported ?? 0) > 0) return skipped('partially_paid');
    const deadline = await pendingPaymentDeadline(order, this.config);
    if (!deadline) return skipped('auto_cancel_blocked');
    if (now.getTime() < new Date(deadline).getTime()) return { outcome: 'not_due', deadline };

    const hours = Math.round((new Date(deadline).getTime() - order.createdAt.getTime()) / 3_600_000);
    const outcome: SetStatusOutcome = { flipped: false, heldReasons: [] };
    try {
      const after = await this.orderStatus.setStatus(order.id, 'CANCELLED', { ...pendingPaymentCancelOpts(overdueCancelNote(hours)), outcome });
      if (outcome.flipped) return { outcome: 'cancelled' };
      return after.status === 'CANCELLED' ? { outcome: 'already_cancelled' } : skipped('raced');
    } catch (err) {
      // Hàng đã bàn giao vận chuyển: setStatus đã ghi mốc thôi tự huỷ và đưa đơn cho người xử lý, MSS không cần gửi lại.
      if (err instanceof CancelAfterHandoverError) return skipped('handover');
      // Hợp đồng: 4xx chỉ khi thân sai. Chưa hỏi được Pancake, hay đơn đang đổi trạng thái liên tục, là lỗi tạm: 503 để MSS gửi lại
      // (cron vẫn huỷ đúng hạn nếu MSS thôi gửi).
      if (err instanceof ConflictException) throw new ServiceUnavailableException('order_busy');
      // Pancake báo đã bàn giao (setStatus đã ghi mốc thôi tự huỷ), hay đơn vừa sang trạng thái không huỷ được: đọc lại đơn để trả 200.
      if (err instanceof BadRequestException) return this.afterRefusedCancel(order.id);
      throw err;
    }
  }

  private async afterRefusedCancel(orderId: string): Promise<PaymentRescueResult> {
    const now = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true, autoCancelBlockedAt: true } });
    if (now?.status === 'CANCELLED') return { outcome: 'already_cancelled' };
    return skipped(now?.autoCancelBlockedAt ? 'handover' : 'raced');
  }
}
