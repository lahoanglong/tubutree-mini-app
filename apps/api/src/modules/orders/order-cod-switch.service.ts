import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Order, Prisma } from '@prisma/client';
import type { CodSwitchResultDTO } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { orderConfirmedData } from '../notifications/order-confirmed-data';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { PancakeSyncHooks } from '../integrations/pancake/pancake-sync-hooks';
import { GOMDON_STATE } from '../integrations/gomdon/gomdon-status';
import { MssOrderEventRecorder } from '../integrations/mss/mss-order-event.recorder';
import { COD_MAX_PER_ORDER } from '../checkout/checkout-split';
import { OrderStatusService } from './order-status.service';
import {
  COD_SWITCH_HISTORY_NOTE,
  COD_SWITCH_REFUSED,
  codSwitchRefusal,
  codSwitchRefusalMessage,
  type CodSwitchRefusal,
} from './cod-switch';

export type CodSwitchResult = CodSwitchResultDTO;

export interface CodSwitchActor {
  actorType: 'CUSTOMER';
  /** Khách đăng nhập: id tài khoản; khách vãng lai: null (đơn nhận diện bằng khoá theo dõi). */
  actorId: string | null;
  /** Trần thu hộ cho người gọi (luôn ≤ COD_MAX_PER_ORDER). */
  codMax: number;
}

function refused(reason: CodSwitchRefusal, codMax: number): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code: COD_SWITCH_REFUSED, reason, message: codSwitchRefusalMessage(reason, codMax) });
}

/**
 * Khách đổi đơn chuyển khoản chưa trả sang trả tiền khi nhận (COD) bằng một chạm (PO duyệt 23/11, A5).
 *
 * Mọi điều kiện đọc lại dưới khoá dòng đơn (`SELECT … FOR UPDATE`) trong cùng transaction với câu đổi. Webhook Pancake báo tiền về (markPaid),
 * cron tự huỷ đơn quá hạn và MSS báo quá hạn đều lật đơn bằng câu `UPDATE … WHERE status = 'PENDING_PAYMENT' AND paymentStatus = 'UNPAID'`,
 * nên chạy chồng nhau thì một bên chờ khoá rồi thấy điều kiện không còn đúng: đúng một lần đổi PENDING_PAYMENT → CONFIRMED, không bao giờ hai.
 * Tiền chuyển khoản về SAU khi đã đổi vẫn được ghi nhận (webhook nhận đơn COD có dấu đổi), nên khách không bị thu COD lần nữa.
 */
@Injectable()
export class OrderCodSwitchService {
  private readonly logger = new Logger(OrderCodSwitchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatus: OrderStatusService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly analytics?: AnalyticsEventsService,
    @Optional() private readonly pancakeHooks?: PancakeSyncHooks,
    @Optional() private readonly mssOrderEvents?: MssOrderEventRecorder,
  ) {}

  /** Chủ đơn đăng nhập (Mini App, web). Đơn của người khác: cùng 404 như không có. */
  async switchForOwner(userId: string, code: string): Promise<CodSwitchResult> {
    const order = await this.prisma.order.findUnique({ where: { code }, select: { id: true, userId: true } });
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    return this.switchToCod(order.id, { actorType: 'CUSTOMER', actorId: userId, codMax: COD_MAX_PER_ORDER });
  }

  async switchToCod(orderId: string, actor: CodSwitchActor): Promise<CodSwitchResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
      const attempts = await tx.paymentAttempt.count({ where: { orderId } });
      const reason = codSwitchRefusal(order, { attempts, codMax: actor.codMax, now: new Date() });
      if (reason) return { reason, order };

      // Dưới khoá dòng điều kiện không đổi được nữa; vẫn giữ điều kiện trong câu ghi để một đường ghi không khoá (nếu có) cũng không chen được.
      const flip = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER' },
        // Đơn thu gom đang chờ tiền ở Gomdon (AWAITING_PAYMENT): COD đặt bưu tá được ngay. Về lại "chưa đặt" như đơn COD thường để lần enqueue lỗi
        // vẫn được cron dò lại (GomdonReconcileService chỉ dò AWAITING_PAYMENT khi đơn đã PAID).
        data: { paymentMethod: 'COD', status: 'CONFIRMED', ...(order.gomdonStatus === GOMDON_STATE.AWAITING_PAYMENT ? { gomdonStatus: null } : {}) },
      });
      if (flip.count !== 1) return { reason: 'NOT_PENDING' as const, order };
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'PENDING_PAYMENT',
          toStatus: 'CONFIRMED',
          actorType: actor.actorType,
          actorId: actor.actorId,
          note: COD_SWITCH_HISTORY_NOTE,
        },
      });
      // Hợp đồng sự kiện MSS v1.2 không có sự kiện cho PENDING_PAYMENT → CONFIRMED hay đổi cách trả: gọi đúng móc đổi trạng thái để khi hợp
      // đồng có thì tự phát. KHÔNG phát order.payment_confirmed: MSS gửi mẫu "đã nhận thanh toán" trong khi Tubu chưa nhận đồng nào.
      await this.mssOrderEvents?.onStatusChanged(tx, orderId, 'CONFIRMED', { from: 'PENDING_PAYMENT', actorType: actor.actorType, paidBefore: false });
      await this.recordAnalytics(tx, order);
      return { reason: null, order: { ...order, paymentMethod: 'COD' as const, status: 'CONFIRMED' as const } };
    });

    if (outcome.reason) {
      this.logger.log(`Không đổi đơn ${outcome.order.code} sang COD: ${outcome.reason}.`);
      throw refused(outcome.reason, actor.codMax);
    }
    const order = outcome.order;
    this.logger.log(`Đơn ${order.code}: khách đổi chuyển khoản → COD (${order.total}đ).`);
    await this.afterSwitch(order);
    return { code: order.code, status: order.status, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, total: order.total };
  }

  private async recordAnalytics(tx: Prisma.TransactionClient, order: Order): Promise<void> {
    if (!this.analytics) return;
    await this.analytics.record(tx, {
      eventName: 'order_status_changed',
      userId: order.userId,
      platform: 'system',
      props: { orderId: order.id, from: 'PENDING_PAYMENT', to: 'CONFIRMED', actorType: 'CUSTOMER', reason: 'cod_switch', guest: order.guestTokenHash !== null },
    });
  }

  /**
   * Sau commit, mỗi việc tự bắt lỗi (đơn đã đổi xong, khách không được thấy lỗi): báo kho Pancake bỏ dấu "chờ chuyển khoản" và thu COD, đơn thu gom
   * tái chế thì đặt bưu tá Gomdon (COD là điều kiện đủ như đã trả tiền), rồi báo khách đơn đã xác nhận.
   */
  private async afterSwitch(order: Order): Promise<void> {
    await this.pancakeHooks?.afterCodSwitch(order.id);
    await this.orderStatus.enqueueGomdonAfterPaid(order);
    await this.notifications.notifySafe(order.userId, 'ORDER_CONFIRMED', orderConfirmedData({ code: order.code, paymentStatus: 'UNPAID' }), undefined, `order=${order.code}`);
  }
}
