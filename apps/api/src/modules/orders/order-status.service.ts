import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderReversalService } from './order-reversal.service';
import { assertTransition, canTransition, InvalidOrderTransitionError } from './order-transition';

/**
 * Nguồn ghi Order.status DUY NHẤT cho mọi nơi KHÔNG PHẢI là luồng khách tự hủy
 * (orders.service.cancel) hay khách tự yêu cầu trả hàng (admin.reviewReturn) —
 * hai luồng đó có quy tắc "from" hẹp hơn riêng và tiếp tục tự quản lý, nhưng CẢ HAI
 * cũng gọi OrderReversalService (không lặp lại khối restock/refund).
 *
 * Trước khi có class này, 4 nơi ghi status riêng rẽ (admin generic update, merchant
 * update, pancake webhook) không có bảng chuyển trạng thái chung → DELIVERED có thể
 * bị lùi về CONFIRMED rồi bị "hủy" lại lần 2 (P0-1), và không nơi nào trong số đó
 * restock/hoàn tiền khi hủy (P0-4), và merchant có thể đổi trạng thái mà không cộng/
 * đảo điểm-hoa hồng (P1-1). Xem docs/2026-09-08-review-progress.md.
 */
@Injectable()
export class OrderStatusService {
  private readonly logger = new Logger(OrderStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly affiliate: AffiliateService,
    private readonly notifications: NotificationsService,
    private readonly reversal: OrderReversalService,
  ) {}

  /** true nếu transition hợp lệ — dùng để webhook/cron bỏ qua êm thay vì throw. */
  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return canTransition(from, to);
  }

  /**
   * Đặt trạng thái đơn hàng, atomic + guard transition + side-effect đầy đủ.
   * Idempotent: gọi lại với status hiện tại là no-op (trả về đơn không đổi).
   * Ném InvalidOrderTransitionError nếu transition không hợp lệ (vd DELIVERED→CONFIRMED).
   */
  async setStatus(
    orderId: string,
    targetStatus: OrderStatus,
    opts: { note?: string; notifyEvent?: string } = {},
  ) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { code: orderId }] },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');

    if (order.status === targetStatus) return order; // no-op idempotent (webhook lặp lại)
    assertTransition(order.status as OrderStatus, targetStatus);

    // Atomic flip guard theo status hiện tại — 2 caller song song (vd admin + webhook)
    // chỉ 1 bên thắng (count===1), bên thua bail êm để không chạy side-effect 2 lần.
    const won = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: {
          status: targetStatus,
          ...(opts.note
            ? { note: order.note ? `${order.note} | ${opts.note}` : opts.note }
            : {}),
        },
      });
      if (flip.count === 0) return false;

      if (targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') {
        await this.reversal.reverseFinancials(tx, order);
      }
      return true;
    });
    if (!won) {
      this.logger.warn(`setStatus thua race: đơn ${order.code} đã đổi trạng thái bởi request khác.`);
      return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    }

    // Side-effect điểm/hoa hồng — idempotent qua unique index riêng, an toàn để NGOÀI tx
    // (nếu crash giữa chừng, retry sẽ thấy status đã bằng targetStatus → bail ở no-op phía
    // trên NHƯNG side-effect chưa chạy — đây là đánh đổi đã biết, các hàm credit/reverse
    // đều tự kiểm tra lại nên gọi lại qua endpoint admin "resync" là an toàn nếu cần).
    if (targetStatus === 'DELIVERED') {
      await this.loyalty.creditOrderPoints(order.id);
      await this.affiliate.lockCommissionsForOrder(order.id);
      await this.affiliate.grantReferralReward(order.id);
    } else if (targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') {
      await this.loyalty.reverseOrderPoints(order.id);
      await this.affiliate.reverseCommissionsForOrder(order.id);
    }

    await this.notifications
      .notify(order.userId, opts.notifyEvent ?? `ORDER_${targetStatus}`, { order_code: order.code })
      .catch(() => undefined);

    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  }
}

export { InvalidOrderTransitionError };

/** Chuyển InvalidOrderTransitionError → 400 cho HTTP caller (admin/merchant controller). */
export function toHttpBadRequest(err: unknown): never {
  if (err instanceof InvalidOrderTransitionError) throw new BadRequestException(err.message);
  throw err;
}
