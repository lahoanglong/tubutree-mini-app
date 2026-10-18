import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Prisma, type Order } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';
import { GomdonAlertService, PANCAKE_ALERT_TEMPLATE } from '../gomdon/gomdon-alert.service';
import { gomdonOwnsShipping } from '../gomdon/gomdon-status';
import { PANCAKE_RETURNING_PREFIX, resolvePancakeStatus, type PancakeStatusAction } from './pancake-status.map';
import {
  ATTENTION_CANCEL_AFTER_HANDOVER,
  ATTENTION_PARTIAL_RETURN_ACK,
  ATTENTION_RETURN_APPROVED,
  ATTENTION_TOTAL_MISMATCH,
  ATTENTION_UNDERPAID,
  clearPancakeAttention,
} from './pancake-attention';
import { isPancakeOrderPaid, pancakePaidAmount, pancakePaidAmountAfterPaid } from './pancake-payment.util';
import {
  PANCAKE_CLAIM_STALE_MINUTES,
  PANCAKE_EVENT_DONE,
  PANCAKE_EVENT_STATUS,
  pancakeEventData,
  pancakeEventOrderCode,
} from './pancake-webhook-dedupe';
import { isMerchantFulfilledOrder, isPancakeFulfilledLine } from './pancake-fulfilment';
import { pancakeStatusSkipsTotalCheck, pancakeTotalMismatch } from './pancake-total';
import { OrderStatusService, InvalidOrderTransitionError } from '../../orders/order-status.service';
import { CancelAfterHandoverError, UnpaidPrepaidTransitionError } from '../../orders/order-transition';
import { recordCumulativeLatePayment, recordCumulativeOverpayment } from '../../orders/refund-queue';
import { hasDealerCreditDebit } from '../../orders/dealer-credit-debit';
import { formatVnd } from '../../orders/refund-destination';
import { applyPancakeStock } from '../../catalog/variation-stock';

/** Số cặp (đơn, mã vận đơn lạ) nhớ để không báo trùng — Pancake gửi lại webhook mỗi lần đơn đổi. */
const WAYBILL_CONFLICT_MEMORY = 500;

/** Sự kiện gắn với một đơn — không khớp được đơn Tubu thì chờ đối chiếu lại thay vì coi như đã xử lý. */
const ORDER_EVENTS: ReadonlySet<string> = new Set([
  'orders', // Pancake POS: webhook đơn hàng (payload là nguyên object đơn)
  'order',
  'order.status_updated',
  'order.updated',
  'order.shipping_updated',
  'order.cancelled',
  'invoice.issued',
]);

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã huỷ',
  RETURNED: 'Đã trả hàng',
};

/** `ignored`: cố ý không áp — lý do ghi vào sự kiện để người vận hành đọc. */
type HandleOutcome = 'PROCESSED' | 'UNMATCHED' | { ignored: string };

/** Công tắc so tổng tiền Pancake với đơn Tubu (mặc định bật); tắt nếu hợp đồng field thật làm báo nhầm hàng loạt. */
export const PANCAKE_TOTAL_CHECK_KEY = 'pancake.total_mismatch_check';

const CLOSED_ORDER_STATUSES = ['CANCELLED', 'RETURNED'] as const;
const isClosedOrder = (status: string): boolean => (CLOSED_ORDER_STATUSES as readonly string[]).includes(status);

function isTerminalPancakeStatus(data: Record<string, unknown>): boolean {
  const action = resolvePancakeStatus(data['status'] ?? data['status_name']);
  return action?.kind === 'returned' || (action?.kind === 'status' && action.status === 'CANCELLED');
}

/**
 * Webhook trạng thái bị bảng chuyển chặn: phần lớn là sự kiện tới trễ/không theo thứ tự (lùi trong chuỗi giao
 * hàng, xác nhận cũ tới sau khi đã huỷ) — bỏ qua êm. Còn lại là hai nguồn sự thật mâu thuẫn mà không ai tự sửa:
 * Pancake huỷ/hoàn đơn đã giao, Pancake báo giao đơn đã huỷ (đã hoàn tiền), hàng rời kho khi đơn trả trước chưa
 * ghi nhận tiền.
 */
function blockedNeedsAttention(err: InvalidOrderTransitionError): boolean {
  const { from, to } = err;
  if (err instanceof UnpaidPrepaidTransitionError) return to === 'SHIPPING' || to === 'DELIVERED';
  if (from === 'CANCELLED' || from === 'RETURNED') return to === 'SHIPPING' || to === 'DELIVERED';
  return to === 'CANCELLED' || to === 'RETURNED';
}

/**
 * Worker xử lý webhook Pancake async (Build Spec §8.4 bước 4).
 * Khớp đơn theo pancakeOrderId; mã đơn (external_order_id / "Order code: …" trong note) chỉ dùng khi đơn Tubu
 * chưa gắn đơn Pancake nào hoặc gắn đúng đơn này — xem resolveOrder.
 */
/** Mã Pancake POS "Đã gửi hàng". */
const PANCAKE_STATUS_SHIPPED = 2;

/**
 * `updated_at` của Pancake. Chuỗi không mang múi giờ nên Node đọc theo múi giờ của tiến trình: chỉ so với mốc cũng đọc bằng
 * hàm này (Pancake với Pancake), không bao giờ so với đồng hồ máy chủ (R5-SYNC-3).
 */
function pancakeTime(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Mốc updated_at Pancake mới nhất đã ghi vào hành trình vận chuyển (null nếu chưa mốc nào có). */
function latestPancakeAt(history: unknown[]): Date | null {
  let latest: Date | null = null;
  for (const h of history) {
    const at = pancakeTime((h as { pancakeAt?: unknown } | null)?.pancakeAt);
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest;
}

@Processor(QUEUE_PANCAKE_EVENTS)
export class PancakeProcessor extends WorkerHost {
  private readonly logger = new Logger(PancakeProcessor.name);
  /** Báo động vận hành (in-app tới ADMIN) — dùng chung cơ chế với Gomdon. */
  private readonly alerts: GomdonAlertService;
  /** Chống spam best-effort trong 1 process (khởi động lại / nhiều instance có thể báo lại 1 lần). */
  private readonly waybillConflictAlerted = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly orderStatus: OrderStatusService,
    // PancakeModule tự provide GomdonAlertService (chỉ phụ thuộc Prisma + Notifications) — không import
    // GomdonModule nên không có vòng module. Call site dựng tay thiếu tham số → tự dựng, vẫn báo thật.
    @Optional() alerts?: GomdonAlertService,
    @Optional() private readonly systemConfig?: SystemConfigService,
  ) {
    super();
    this.alerts = alerts ?? new GomdonAlertService(prisma, notifications);
  }

  async process(job: Job<{ eventId: string }>): Promise<void> {
    const event = await this.prisma.pancakeWebhookEvent.findUnique({
      where: { id: job.data.eventId },
    });
    if (!event || PANCAKE_EVENT_DONE.includes(event.status) || event.dismissedAt) return;

    // Claim nguyên tử: cùng một sự kiện có thể tới worker từ nhiều đường (BullMQ retry/stalled, cron cứu,
    // Pancake gửi lại khi lần trước chưa xong) — chỉ một worker được chạy handler. Claim PROCESSING quá hạn
    // = worker trước đã chết giữa chừng, cho claim lại.
    const claimedAt = new Date();
    const claim = await this.prisma.pancakeWebhookEvent.updateMany({
      where: {
        id: event.id,
        // "Đã xử lý" sau khi job đã nằm trong hàng đợi (BullMQ retry, Pancake gửi lại) cũng phải chặn được.
        dismissedAt: null,
        OR: [
          { status: { notIn: [...PANCAKE_EVENT_DONE, PANCAKE_EVENT_STATUS.PROCESSING] } },
          {
            status: PANCAKE_EVENT_STATUS.PROCESSING,
            claimedAt: { lt: new Date(claimedAt.getTime() - PANCAKE_CLAIM_STALE_MINUTES * 60_000) },
          },
        ],
      },
      data: { status: PANCAKE_EVENT_STATUS.PROCESSING, claimedAt, attempts: { increment: 1 } },
    });
    if (claim.count === 0) return;

    try {
      const data = pancakeEventData(event.rawPayload);
      const outcome = await this.handle(event.eventType, data, event.receivedAt);
      await this.prisma.pancakeWebhookEvent.update({
        where: { id: event.id },
        data:
          outcome === 'UNMATCHED'
            ? // Webhook có thể tới trước khi pushOrder kịp lưu pancakeOrderId — cron cứu đối chiếu lại sau vài phút.
              { status: PANCAKE_EVENT_STATUS.UNMATCHED, processedAt: null, error: 'Chưa khớp được đơn Tubu.' }
            : typeof outcome === 'object'
              ? { status: PANCAKE_EVENT_STATUS.IGNORED, processedAt: new Date(), error: outcome.ignored }
              : { status: PANCAKE_EVENT_STATUS.PROCESSED, processedAt: new Date(), error: null },
      });
    } catch (err) {
      await this.prisma.pancakeWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: PANCAKE_EVENT_STATUS.FAILED,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err; // BullMQ retry
    }
  }

  private async handle(eventType: string, data: Record<string, unknown>, receivedAt: Date): Promise<HandleOutcome> {
    if (ORDER_EVENTS.has(eventType)) {
      const match = await this.resolveOrder(data);
      if (match.foreign) {
        await this.flagForeignPancakeOrder(match.foreign, match.pancakeId);
        return 'PROCESSED';
      }
      if (!match.order) return 'UNMATCHED';
      // D4: đơn gian hàng đối tác tự giao không bao giờ lên Pancake — đơn Pancake nào mang mã của nó là đơn lạ (nhân viên
      // tạo tay/đơn bù ghi nhầm mã), không được giao/huỷ/hoàn/cộng điểm hộ đối tác.
      if (isMerchantFulfilledOrder(match.order)) {
        return { ignored: await this.flagMerchantOrderOnPancake(match.order, match.pancakeId) };
      }
    }
    switch (eventType) {
      case 'orders':
      case 'order':
      case 'order.status_updated':
      case 'order.updated':
        await this.onOrderEvent(data);
        break;
      case 'order.shipping_updated':
        await this.onShippingUpdated(data);
        break;
      case 'order.cancelled':
        await this.onCancelled(data);
        break;
      case 'invoice.issued':
        await this.onInvoiceIssued(data);
        break;
      case 'variation.stock_changed': {
        const stale = await this.onStockChanged(data, receivedAt);
        if (stale) return { ignored: stale };
        break;
      }
      default:
        this.logger.debug(`Bỏ qua event chưa xử lý: ${eventType}`);
    }
    return 'PROCESSED';
  }

  private async onOrderEvent(data: Record<string, unknown>): Promise<void> {
    // Đối soát thanh toán (Pancake ghi nhận chuyển khoản → lật UNPAID→PAID) chạy TRƯỚC trạng thái: nhân viên
    // Pancake hay ghi nhận tiền và đổi trạng thái trong cùng một lần lưu, mà OrderStatusService chặn đơn trả
    // trước chưa PAID rời PENDING_PAYMENT/đi giao — chạy trạng thái trước thì đơn đã trả bị kẹt ở CONFIRMED
    // kèm dấu "đẩy tay" sai. Ngoại lệ huỷ/hoàn: giữ trạng thái trước để tiền về đơn đã huỷ vẫn đi đường cảnh
    // báo hoàn tiền thủ công, không bị lật PAID+CONFIRMED (kèm báo "đã xác nhận") rồi huỷ ngay sau đó.
    let paidNow: Order | null = null;
    try {
      if (isTerminalPancakeStatus(data)) {
        await this.onStatusUpdated(data);
        await this.onPaymentReconcile(data);
      } else {
        paidNow = await this.onPaymentReconcile(data, { deferGomdonPush: true });
        await this.onStatusUpdated(data);
      }
      // Đơn Pancake kèm thông tin vận chuyển → cập nhật luôn nếu có (field thật ở `partner`).
      if (data['partner'] || data['tracking_link'] || data['shipping_status'] || data['tracking_number']) {
        await this.onShippingUpdated(data);
      }
      await this.onTotalReconcile(data);
    } finally {
      // Đặt bưu tá thu gom SAU khi đã ghi trạng thái + vận đơn của cùng sự kiện: kho đã giao bằng hãng khác thì
      // job Gomdon thấy ngay và không tạo vận đơn thứ hai (GOMDON-3). Lần chạy lại sau lỗi không lật PAID nữa
      // nên vẫn phải xếp ở đây.
      if (paidNow) await this.orderStatus.enqueueGomdonAfterPaid(paidNow);
    }
  }

  /**
   * Nhân viên sửa đơn (thêm/bớt món, đổi giảm giá, phí ship) trên Pancake thì Tubu không hay: hoàn tiền, hoa hồng và đối
   * soát vẫn tính theo `order.total` cũ. Chỉ BÁO — không bao giờ sửa đơn Tubu theo số Pancake. Phần phụ: lỗi ở đây chỉ ghi log,
   * không được chặn việc ghi trạng thái/thanh toán/vận chuyển của cùng sự kiện.
   */
  private async onTotalReconcile(data: Record<string, unknown>): Promise<void> {
    try {
      await this.reconcileTotal(data);
    } catch (err) {
      this.logger.warn(`Không so được tổng tiền Pancake: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async reconcileTotal(data: Record<string, unknown>): Promise<void> {
    if (pancakeStatusSkipsTotalCheck(data)) return;
    const order = await this.findOrder(data);
    if (!order || isClosedOrder(order.status) || isMerchantFulfilledOrder(order)) return;
    if (!(await this.totalCheckEnabled())) return;

    const mismatch = pancakeTotalMismatch(data, order);
    const own = order.pancakeAttention?.startsWith(ATTENTION_TOTAL_MISMATCH) ?? false;
    if (!mismatch) {
      if (own) await clearPancakeAttention(this.prisma, order.id, ATTENTION_TOTAL_MISMATCH);
      return;
    }
    // Hàng đợi chỉ có một ô lý do: đang chờ việc khác (khách chuyển thiếu, huỷ chưa tới Pancake…) thì không ghi đè. Dòng này chỉ
    // bỏ sớm cho đỡ tốn truy vấn; việc chặn thật nằm trong điều kiện updateMany vì job khác có thể ghi chen sau lúc đọc đơn.
    if (order.pancakeAttention && !own) return;
    // Đơn có dòng do đối tác tự giao chỉ gửi phần dòng kho Tubu lên Pancake nên tổng Pancake thấp hơn là đúng thiết kế.
    if (await this.hasNonPancakeLines(order.id)) return;

    const sign = mismatch.diff > 0 ? '+' : '-';
    await this.flagAttention(
      order,
      `${ATTENTION_TOTAL_MISMATCH}: Pancake ghi ${formatVnd(mismatch.pancakeTotal)}, Tubu ghi ${formatVnd(order.total)}, ` +
        `lệch ${sign}${formatVnd(Math.abs(mismatch.diff))}. Có thể đơn đã bị sửa trên Pancake (món, giảm giá hoặc phí ship). ` +
        'Tubu KHÔNG tự sửa đơn, hoàn tiền/hoa hồng/đối soát vẫn tính theo số của Tubu. Cách xử lý: huỷ đơn rồi đặt lại, hoặc ' +
        'trả đơn Pancake về đúng nội dung đơn Tubu.',
      ATTENTION_TOTAL_MISMATCH,
    );
  }

  private async totalCheckEnabled(): Promise<boolean> {
    if (!this.systemConfig) return true;
    try {
      return (await this.systemConfig.get<boolean>(PANCAKE_TOTAL_CHECK_KEY, true)) !== false;
    } catch {
      return true;
    }
  }

  private async hasNonPancakeLines(orderId: string): Promise<boolean> {
    const items = await this.prisma.orderItem.findMany({ where: { orderId }, select: { variationId: true } });
    const ids = items.map((i) => i.variationId);
    if (ids.length === 0) return false;
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: ids } },
      select: { id: true, pancakeId: true, product: { select: { fulfilment: true } } },
    });
    const byId = new Map(variations.map((v) => [v.id, v]));
    return ids.some((id) => {
      const v = byId.get(id);
      return !v || !isPancakeFulfilledLine({ pancakeId: v.pancakeId, fulfilment: v.product?.fulfilment ?? null });
    });
  }

  /**
   * Khớp đơn Pancake → đơn Tubu. `id` của đơn Pancake là khoá chính xác (đơn Tubu lưu pancakeOrderId khi đẩy).
   * Mã đơn trong extension/note chỉ là khoá phụ: nhân viên tạo đơn trùng/đơn bù/đổi hàng trên Pancake mang cùng
   * mã TUBU, hoặc push retry sinh đơn trùng cùng external_order_id. Đơn Tubu đã gắn đơn Pancake KHÁC thì sự kiện
   * đó là của đơn lạ (`foreign`) — không được đổi trạng thái/hoàn tiền đơn thật.
   */
  private async resolveOrder(
    data: Record<string, unknown>,
  ): Promise<{ order: Order | null; foreign?: Order; pancakeId: string | null }> {
    const rawId = data['id'] ?? data['order_id'];
    const pancakeId = rawId === null || rawId === undefined || rawId === '' ? null : String(rawId);
    if (pancakeId) {
      const byId = await this.prisma.order.findFirst({ where: { pancakeOrderId: pancakeId } });
      if (byId) return { order: byId, pancakeId };
    }
    const code = this.extractOrderCode(data);
    if (!code) return { order: null, pancakeId };
    const byCode = await this.prisma.order.findFirst({ where: { code } });
    if (!byCode) return { order: null, pancakeId };
    if (pancakeId && byCode.pancakeOrderId && byCode.pancakeOrderId !== pancakeId) {
      return { order: null, foreign: byCode, pancakeId };
    }
    return { order: byCode, pancakeId };
  }

  private async findOrder(data: Record<string, unknown>): Promise<Order | null> {
    return (await this.resolveOrder(data)).order;
  }

  private extractOrderCode(data: Record<string, unknown>): string | null {
    return pancakeEventOrderCode(data);
  }

  /**
   * Hàng đợi "Cần xử lý Pancake": ghi lý do lên đơn + báo ADMIN in-app. Cùng lý do đang chờ thì không ghi/báo
   * lại (Pancake gửi lại webhook mỗi lần đơn đổi). Best-effort về báo động; lỗi ghi DB ném tiếp để retry.
   */
  /** Trả true khi vừa gắn (lời nhắc khác lời đang gắn); cùng lời thì không báo lại. */
  private async flagAttention(
    order: Pick<Order, 'id' | 'code'>,
    reason: string,
    onlyReplacingPrefix?: string,
  ): Promise<boolean> {
    const changed = { OR: [{ pancakeAttention: null }, { pancakeAttention: { not: reason } }] };
    const r = await this.prisma.order.updateMany({
      where: onlyReplacingPrefix
        ? {
            id: order.id,
            AND: [changed, { OR: [{ pancakeAttention: null }, { pancakeAttention: { startsWith: onlyReplacingPrefix } }] }],
          }
        : { id: order.id, ...changed },
      data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
    });
    if (r.count === 0) return false;
    this.logger.warn(`Đơn ${order.code} cần xử lý (Pancake): ${reason}`);
    await this.alerts.alert(order.code, reason, PANCAKE_ALERT_TEMPLATE);
    return true;
  }

  private async flagForeignPancakeOrder(order: Order, pancakeId: string | null): Promise<void> {
    await this.flagAttention(
      order,
      `Pancake gửi cập nhật của đơn Pancake #${pancakeId ?? '?'} mang mã ${order.code}, nhưng đơn này đã gắn đơn Pancake #${order.pancakeOrderId}. Đã BỎ QUA cập nhật đó (không đổi trạng thái, không hoàn tiền). Kiểm tra đơn trùng/đơn bù trên Pancake.`,
    );
  }

  /** Trả lý do ghi lên sự kiện IGNORED. */
  private async flagMerchantOrderOnPancake(order: Order, pancakeId: string | null): Promise<string> {
    await this.flagAttention(
      order,
      `Pancake gửi cập nhật của đơn Pancake #${pancakeId ?? '?'} mang mã ${order.code}, nhưng ${order.code} là đơn gian hàng đối tác tự giao ` +
        '(không có trên Pancake). Đã BỎ QUA cập nhật đó (không đổi trạng thái, không cộng điểm, không hoàn tiền). Kiểm tra đơn tạo tay/đơn bù ' +
        'trên Pancake đang ghi nhầm mã này.',
    );
    return `Mã ${order.code} là đơn gian hàng đối tác tự giao (không có trên Pancake) — bỏ qua cập nhật của đơn Pancake #${pancakeId ?? '?'}.`;
  }

  private async onStatusUpdated(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order) return;
    const action = resolvePancakeStatus(data['status'] ?? data['status_name']);
    if (!action) return;
    if (action.kind === 'attention') {
      // Sự kiện tới trễ sau khi đơn đã huỷ/trả: việc "đang hoàn"/"bị xoá" đã có kết cục, ghim thêm là banner cũ vĩnh viễn.
      if (!isClosedOrder(order.status)) await this.flagAttention(order, action.reason);
      return;
    }
    if (action.kind === 'partialReturned') {
      await this.onPartialReturned(order, action.reason);
      return;
    }
    const target = this.targetStatus(order, action);
    if (!target) return;
    if (action.kind === 'returned' && target.status === 'RETURNED' && (await this.blockedByPartialReturn(order))) return;
    const returned = action.kind === 'returned';

    // Hai nguồn trạng thái giao hàng không được cãi nhau: đơn có vận đơn Gomdon sống thì mốc đang giao/đã giao
    // chỉ theo Gomdon (DELIVERED cộng điểm, khoá hoa hồng — kho bấm "hoàn thành" hàng loạt trên Pancake không
    // được chốt hộ). Huỷ/hoàn/thanh toán từ Pancake vẫn nhận.
    if ((target.status === 'SHIPPING' || target.status === 'DELIVERED') && gomdonOwnsShipping(order)) {
      if (target.status === 'DELIVERED' && order.status !== 'DELIVERED') {
        await this.flagAttention(
          order,
          'Pancake báo đã giao nhưng vận đơn Gomdon (thu gom tái chế) chưa báo giao thành công — không tự chốt "Đã giao". Kiểm tra với hãng vận chuyển.',
        );
      }
      return;
    }

    // Ủy quyền cho OrderStatusService — nguồn ghi status DUY NHẤT, dùng chung với admin/
    // merchant. Tự guard no-op (status===order.status), atomic race (updateMany), VÀ side-
    // effect đầy đủ (credit/reverse điểm+hoa hồng, restock+refund khi CANCELLED/RETURNED).
    // Queue KHÔNG đảm bảo thứ tự per-order (BullMQ retry/backoff) — assertTransition của
    // OrderStatusService tự chặn DELIVERED sau khi đã ở CANCELLED/RETURNED (trạng thái cuối).
    // CHỈ nuốt lỗi transition không hợp lệ; lỗi khác (DB down, loyalty/affiliate throw thật) phải NÉM TIẾP
    // để process() đánh dấu FAILED + BullMQ retry — nuốt hết ở đây sẽ mất event vĩnh viễn.
    await this.setStatusFromPancake(order, target.status, target.note, returned);
  }

  /** "Đã hoàn" (hàng về kho): đơn chưa giao → huỷ (hoàn tiền, hoàn kho, đảo điểm); đã giao → trả hàng. */
  private targetStatus(order: Order, action: Extract<PancakeStatusAction, { kind: 'status' | 'returned' }>): { status: OrderStatus; note?: string } | null {
    if (action.kind === 'status') return { status: action.status };
    if (order.status === 'CANCELLED' || order.status === 'RETURNED') return null;
    return order.status === 'DELIVERED'
      ? { status: 'RETURNED', note: 'Pancake: hàng đã hoàn về kho' }
      : { status: 'CANCELLED', note: 'Pancake: giao không thành, hàng đã hoàn về kho' };
  }

  /**
   * Pancake "Đã hoàn" (5) nghĩa là cả đơn về kho. Đơn đã duyệt trả một phần (hoặc đang có yêu cầu trả chờ duyệt) mà nhận
   * 5 thì thường là kho làm phiếu trả sai loại — tự lật RETURNED sẽ hoàn tiền và cộng kho cả món khách vẫn giữ. Đưa vào
   * hàng cần xử lý thay vì tự đổi.
   */
  private async blockedByPartialReturn(order: Order): Promise<boolean> {
    const open = await this.prisma.returnRequest.findFirst({
      where: { orderId: order.id, OR: [{ status: 'APPROVED', fullReturn: false }, { status: 'REQUESTED' }] },
      select: { status: true },
    });
    if (!open) return false;
    await this.flagAttention(
      order,
      open.status === 'REQUESTED'
        ? 'Pancake báo "Đã hoàn" (cả đơn) trong khi khách đang có yêu cầu đổi/trả chờ duyệt — hệ thống KHÔNG tự hoàn tiền. Duyệt yêu cầu trả trên Tubu trước; trả một phần thì dùng "Hoàn một phần" trên Pancake.'
        : 'Pancake báo "Đã hoàn" (cả đơn) cho đơn đã duyệt trả một phần — hệ thống KHÔNG tự hoàn phần còn lại. Kiểm tra phiếu trả trên Pancake (trả một phần phải dùng "Hoàn một phần"); nếu khách thật sự trả nốt, duyệt yêu cầu trả các món còn lại trên Tubu.',
    );
    return true;
  }

  /**
   * Pancake "Hoàn một phần" (15). Quy trình chuẩn: admin duyệt trả một phần trên Tubu (tiền đã hoàn ngay lúc duyệt) →
   * hệ thống nhắc tạo phiếu "Hoàn một phần" trên Pancake → kho làm → Pancake báo 15. Lúc này KHÔNG được bảo hoàn tay
   * (hoàn hai lần); chỉ ghi nhận và giữ nhắc "Đã nhận hàng về" (cộng kho) tới khi bấm. Lời "hoàn tay" chỉ dùng khi Tubu
   * không có yêu cầu trả nào.
   */
  private async onPartialReturned(order: Order, manualReason: string): Promise<void> {
    const requests = await this.prisma.returnRequest.findMany({
      where: { orderId: order.id, status: { in: ['APPROVED', 'REQUESTED'] } },
      select: { id: true, status: true, receivedAt: true },
    });
    const approved = requests.filter((r) => r.status === 'APPROVED');
    if (approved.length === 0) {
      await this.flagAttention(
        order,
        requests.length > 0
          ? 'Pancake báo HOÀN MỘT PHẦN trong khi khách đang có yêu cầu đổi/trả chờ duyệt — duyệt yêu cầu trả trên Tubu (hệ thống tự hoàn tiền/điểm), KHÔNG hoàn tay.'
          : manualReason,
      );
      return;
    }
    const waiting = approved.filter((r) => !r.receivedAt).length;
    if (waiting > 0) {
      const reason = `${ATTENTION_PARTIAL_RETURN_ACK}, KHÔNG hoàn tay. Khi hàng về kho, bấm "Đã nhận hàng về" ở yêu cầu trả (${waiting} yêu cầu) để cộng kho.`;
      // Kiểm "còn yêu cầu chưa nhận" ngay trong câu ghi: admin bấm "Đã nhận hàng về" chen giữa (đã gỡ nhắc sau commit)
      // thì không ghi lại lời nhắc cũ.
      await this.prisma.$executeRaw`
        UPDATE "orders" SET "pancakeAttention" = ${reason}, "pancakeAttentionAt" = NOW()
        WHERE "id" = ${order.id}
          AND ("pancakeAttention" IS NULL OR "pancakeAttention" <> ${reason})
          AND EXISTS (SELECT 1 FROM "return_requests" rr WHERE rr."orderId" = ${order.id} AND rr."status" = 'APPROVED' AND rr."receivedAt" IS NULL)`;
    } else {
      await clearPancakeAttention(this.prisma, order.id, [...ATTENTION_RETURN_APPROVED, ATTENTION_PARTIAL_RETURN_ACK]);
    }
    const note = `${ATTENTION_PARTIAL_RETURN_ACK} (Pancake #${order.pancakeOrderId ?? '?'})`;
    const logged = await this.prisma.orderStatusHistory.findFirst({ where: { orderId: order.id, actorType: 'PANCAKE', note }, select: { id: true } });
    if (!logged) {
      await this.prisma.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus: order.status, toStatus: order.status, actorType: 'PANCAKE', note },
      });
    }
  }

  /** `returnedToSender`: Pancake "Đã hoàn" — hàng đã về kho, được huỷ/hoàn tiền dù đơn đã bàn giao vận chuyển (D1). */
  private async setStatusFromPancake(order: Order, status: OrderStatus, note?: string, returnedToSender = false): Promise<void> {
    try {
      const after = await this.orderStatus.setStatus(order.id, status, { actorType: 'PANCAKE', note, returnedToSender });
      // Hàng đã về và đơn đã huỷ/trả: việc "ĐANG HOÀN" trong hàng đợi đã tự xong.
      if (order.status !== status && after.status === status && (status === 'CANCELLED' || status === 'RETURNED')) {
        await clearPancakeAttention(this.prisma, order.id, PANCAKE_RETURNING_PREFIX);
      }
    } catch (err) {
      if (!(err instanceof InvalidOrderTransitionError)) throw err;
      if (err instanceof CancelAfterHandoverError) {
        // D1: sau bàn giao chỉ còn luồng hoàn/trả — lệnh huỷ từ Pancake là việc cho người, không phải lệnh hoàn tiền.
        await this.flagAttention(
          order,
          `${ATTENTION_CANCEL_AFTER_HANDOVER} (${err.handover.detail}) — KHÔNG tự huỷ/hoàn tiền. Kiểm tra với kho/hãng ` +
            'vận chuyển: chặn giao và chờ Pancake báo "Đã hoàn" (đơn tự huỷ, hoàn tiền), hoặc khách đã nhận thì xử lý ở Đổi/Trả.',
        );
        return;
      }
      if (blockedNeedsAttention(err)) {
        await this.flagAttention(
          order,
          err instanceof UnpaidPrepaidTransitionError
            ? `Pancake báo "${STATUS_LABEL[status]}" nhưng đơn trả trước (${order.paymentMethod}) chưa ghi nhận thanh toán — kiểm tra tiền trước khi đẩy tiếp.`
            : `Pancake báo "${STATUS_LABEL[status]}" nhưng đơn đang "${STATUS_LABEL[err.from]}" — hệ thống không tự đổi được, cần kiểm tra và xử lý tay.`,
        );
        return;
      }
      this.logger.warn(`Bỏ qua webhook status=${status} cho đơn ${order.code}: ${err.message}`);
    }
  }

  /**
   * Đối soát thanh toán chuyển khoản: chỉ lật đơn BANK_TRANSFER còn UNPAID → PAID (idempotent). Dùng chung
   * OrderStatusService.markPaid với nút "Đã nhận tiền" của admin: guard nguyên tử, ghi lịch sử trạng thái
   * (ai/lúc nào xác nhận tiền) và event order_paid cùng transaction, đặt vận đơn thu gom đang chờ tiền, báo khách.
   * Đơn đã huỷ/trả: mọi khoản Pancake báo đã nhận (kể cả chuyển thiếu) thành yêu cầu hoàn, tính theo phần tăng thêm.
   * Đơn còn sống mà chuyển thiếu: vào hàng cần xử lý và báo khách số còn thiếu.
   */
  /** Trả đơn vừa lật PAID (null nếu không lật) — để người gọi đặt bưu tá thu gom khi đã `deferGomdonPush`. */
  private async onPaymentReconcile(data: Record<string, unknown>, opts: { deferGomdonPush?: boolean } = {}): Promise<Order | null> {
    const order = await this.findOrder(data);
    if (!order) return null;
    if (order.paymentMethod !== 'BANK_TRANSFER') return null;
    if (order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUNDED') {
      // Đơn đã nhận đủ: Pancake báo vượt tổng đơn có thể là khách chuyển dư (chuyển hai lần) — R3-MONEY-1.
      await this.recordOverpayment(order, pancakePaidAmountAfterPaid(data));
      return null;
    }
    if (order.paymentStatus !== 'UNPAID') return null;
    // Đơn đại lý ghi công nợ: tiền đi qua sổ công nợ. Tubu tự ghi transfer_money = tổng đơn lên Pancake (có thể phản ánh lại
    // thành `prepaid`), nên "Pancake báo đã trả đủ" không phải khách vừa chuyển tiền — lật PAID/ghi tiền về muộn ở đây là
    // trả đại lý hai lần (công nợ + Ví) khi đơn bị huỷ.
    if (await hasDealerCreditDebit(this.prisma, order)) return null;
    const flaggedPaid = isPancakeOrderPaid(data, order.total);
    const reported = pancakePaidAmount(data) || (flaggedPaid ? order.total : 0);
    if (order.status === 'CANCELLED' || order.status === 'RETURNED') {
      await this.recordLatePancakePayment(order, reported);
      return null;
    }
    if (!flaggedPaid) {
      if (reported > 0) await this.flagUnderpaid(order, reported);
      return null;
    }

    const { outcome, order: current } = await this.orderStatus.markPaid(order.id, {
      actorType: 'PANCAKE',
      note: 'Pancake ghi nhận chuyển khoản',
      deferGomdonPush: opts.deferGomdonPush,
    });
    // Vừa lật PAID bằng chính webhook này thì Tubu chưa ghi gì lên Pancake: hai ô đều là tiền nhân viên ghi nhận.
    if (outcome === 'PAID') await this.recordOverpayment(current ?? order, pancakePaidAmount(data));
    if (outcome === 'ALREADY_PAID') await this.recordOverpayment(current ?? order, pancakePaidAmountAfterPaid(data));
    if (outcome === 'PAID') {
      this.logger.log(`Pancake xác nhận thanh toán đơn ${order.code} → PAID`);
      return current;
    } else if (outcome === 'CLOSED') {
      // Tiền về sau khi đơn đã huỷ/trả: không "hồi sinh" đơn — tạo yêu cầu hoàn tiền, khách chọn Ví hay ngân hàng.
      await this.recordLatePancakePayment(current ?? order, reported);
    }
    return null;
  }

  private async recordLatePancakePayment(order: Order, reported: number): Promise<void> {
    await recordCumulativeLatePayment(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      order,
      { reportedTotal: reported, source: 'PANCAKE' },
    );
  }

  private async recordOverpayment(order: Order, reported: number): Promise<void> {
    if (!(reported > order.total)) return;
    await recordCumulativeOverpayment(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      order,
      { reportedTotal: reported, source: 'PANCAKE' },
    );
  }

  private async flagUnderpaid(order: Order, paid: number): Promise<void> {
    // Đơn bị huỷ sau đó thì hoàn đúng số này ngay lúc huỷ (refundReportedUnderpayment).
    await this.prisma.order.updateMany({ where: { id: order.id, paymentStatus: 'UNPAID' }, data: { pancakePaidReported: paid } });
    const missing = order.total - paid;
    const flagged = await this.flagAttention(
      order,
      `${ATTENTION_UNDERPAID}: Pancake ghi nhận ${formatVnd(paid)}/${formatVnd(order.total)}, còn thiếu ${formatVnd(missing)} — chưa xác nhận thanh toán. Liên hệ khách chuyển thêm, hoặc huỷ đơn để hoàn số đã nhận.`,
    );
    if (!flagged) return;
    await this.notifications
      .notify(order.userId, 'ORDER_UNDERPAID', {
        order_code: order.code,
        paid: formatVnd(paid),
        missing: formatVnd(missing),
        total: formatVnd(order.total),
      })
      .catch((err) => this.logger.warn(`Không báo được khách chuyển thiếu đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
  }

  private async onShippingUpdated(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order) return;
    // Field vận chuyển THẬT của Pancake nằm trong `partner`; giữ fallback field phẳng.
    const partner = (data['partner'] as Record<string, unknown> | undefined) ?? {};
    const carrier = partner['partner_name'] ?? data['partner_name'];
    const waybill = partner['extend_code'] ?? data['tracking_number'];
    const shipStatus = partner['partner_status'] ?? data['shipping_status'];
    const trackingLink = data['tracking_link'] ?? partner['printed_form'];

    const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
    const carrierS = str(carrier);
    const waybillS = str(waybill);
    const shipStatusS = str(shipStatus);
    const linkS = str(trackingLink);

    // Đơn có vận đơn Gomdon ĐANG SỐNG: Gomdon là nguồn DUY NHẤT của shippingCode/Partner/Status/History
    // (webhook Gomdon ghi, kèm chặn lùi trạng thái). Pancake không ghi đè — trước đây "ai ghi sau thắng":
    // khách thấy mã vận đơn hãng này với trạng thái của hãng kia. Pancake báo MỘT mã vận đơn KHÁC → nhiều
    // khả năng kho đã đặt thêm hãng vận chuyển (giao/thu COD 2 lần) → báo động. Gomdon hết sở hữu (huỷ / xử lý
    // tay) thì kho giao bằng hãng khác, cập nhật Pancake phải ghi được (không thì khách mãi thấy "Đơn hủy").
    if (gomdonOwnsShipping(order)) {
      if (
        waybillS &&
        waybillS !== order.gomdonPartnerCode &&
        waybillS !== order.gomdonOrderId &&
        waybillS !== order.shippingCode
      ) {
        await this.alertWaybillConflict(order, waybillS, carrierS);
      }
      return;
    }

    // Đơn đã huỷ/trả (đã hoàn tiền) mà Pancake gắn vận đơn MỚI: hàng có thể đang đi tới khách — việc cho người, không ghi
    // mã vận đơn lên đơn đã đóng (khách thấy vận đơn trên đơn đã huỷ). Cùng mã đã có (vd "Đã hoàn" kèm hãng) thì vẫn ghi.
    const newWaybill = Boolean(waybillS) && waybillS !== order.shippingCode;
    if (newWaybill && isClosedOrder(order.status)) {
      await this.flagWaybillOnClosedOrder(order, carrierS, waybillS!);
      return;
    }

    const history = Array.isArray(order.shippingHistory) ? order.shippingHistory : [];
    // Webhook tới trễ / sai thứ tự (Pancake gửi lại, cron chạy lại UNMATCHED): không lùi dòng vận chuyển. So theo
    // updated_at của Pancake với mốc mới nhất đã ghi; không có mốc giờ thì ít nhất không đưa đơn đã giao về "đang giao".
    const eventAt = pancakeTime(data['updated_at']);
    const lastAt = latestPancakeAt(history);
    if (eventAt && lastAt && eventAt.getTime() < lastAt.getTime()) {
      this.logger.warn(`Bỏ qua cập nhật vận chuyển cũ (${data['updated_at']}) cho đơn ${order.code}.`);
      return;
    }
    if (order.status === 'DELIVERED' && Number(data['status']) === PANCAKE_STATUS_SHIPPED) {
      this.logger.warn(`Bỏ qua "Đã gửi hàng" tới sau khi đơn ${order.code} đã giao.`);
      return;
    }
    // Ghi mốc khi TRẠNG THÁI hoặc MÃ VẬN ĐƠN đổi (gán waybill cũng là 1 mốc) — tránh ghi trùng.
    const last = history[history.length - 1] as { status?: string | null; code?: string | null } | undefined;
    const changed =
      (!!shipStatusS && shipStatusS !== (last?.status ?? null)) ||
      (!!waybillS && waybillS !== (last?.code ?? null));
    const nextHistory = changed
      ? [
          ...history,
          {
            at: new Date().toISOString(),
            status: shipStatusS,
            carrier: carrierS,
            code: waybillS,
            ...(eventAt ? { pancakeAt: eventAt.toISOString() } : {}),
          },
        ]
      : history;

    try {
      await this.prisma.order.update({
        // Vận đơn mới chỉ ghi khi đơn chưa bị huỷ/trả chen giữa lúc đọc và lúc ghi.
        where: newWaybill ? { id: order.id, status: { notIn: [...CLOSED_ORDER_STATUSES] } } : { id: order.id },
        data: {
          shippingPartner: carrierS ?? order.shippingPartner,
          shippingCode: waybillS ?? order.shippingCode,
          shippingStatus: shipStatusS ?? order.shippingStatus,
          trackingLink: linkS ?? order.trackingLink,
          shippingHistory: nextHistory as object,
        },
      });
    } catch (err) {
      if (!(newWaybill && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')) throw err;
      const now = await this.prisma.order.findUnique({ where: { id: order.id } });
      if (now && isClosedOrder(now.status)) await this.flagWaybillOnClosedOrder(now, carrierS, waybillS!);
    }
  }

  private async flagWaybillOnClosedOrder(order: Pick<Order, 'id' | 'code' | 'status'>, carrier: string | null, waybill: string): Promise<void> {
    await this.flagAttention(
      order,
      `Pancake báo vận đơn ${carrier ?? 'hãng vận chuyển'} ${waybill} cho đơn đã "${STATUS_LABEL[order.status as OrderStatus] ?? order.status}" ` +
        '(đã hoàn tiền) — KHÔNG ghi lên đơn. Kiểm tra với kho/hãng: chặn giao và hoàn hàng về kho; khách đã nhận hàng thì xử lý thu hồi tiền/hàng.',
    );
  }

  /** Báo ADMIN (OPS_GOMDON_ALERT) khi Pancake gắn vận đơn khác cho đơn còn vận đơn Gomdon sống. */
  private async alertWaybillConflict(
    order: { id: string; code: string; gomdonPartnerCode: string | null; gomdonOrderId: string | null },
    waybill: string,
    carrier: string | null,
  ): Promise<void> {
    const key = `${order.id}|${waybill}`;
    if (this.waybillConflictAlerted.has(key)) return;
    if (this.waybillConflictAlerted.size >= WAYBILL_CONFLICT_MEMORY) this.waybillConflictAlerted.clear();
    this.waybillConflictAlerted.add(key);
    // GomdonAlertService tự nuốt lỗi gửi (best-effort) — không làm hỏng event Pancake.
    await this.alerts.alert(
      order.code,
      `Đã có vận đơn Gomdon ${order.gomdonPartnerCode ?? order.gomdonOrderId} nhưng Pancake báo vận đơn khác ${waybill} (${carrier ?? '?'}) — KIỂM TRA TRÙNG VẬN ĐƠN, huỷ bớt 1 vận đơn để không giao/thu COD 2 lần.`,
    );
  }

  private async onCancelled(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order) return;
    // Ủy quyền cho OrderStatusService — trước đây chỉ đảo điểm/hoa hồng mà KHÔNG hoàn tiền/
    // restock/release flash quota khi POS hủy đơn (P0-4, docs/2026-09-08-review-progress.md).
    await this.setStatusFromPancake(order, 'CANCELLED');
  }

  private async onInvoiceIssued(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order) return;
    // Guard idempotent: Pancake có thể redeliver cùng 1 webhook invoice.issued (retry hạ tầng
    // phía Pancake) — không có guard này thì mỗi lần redeliver lại notify() thêm 1 lần, khách
    // nhận thông báo "đã xuất hoá đơn" trùng lặp dù order đã ISSUED từ trước.
    if (order.invoiceStatus === 'ISSUED') return;
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        invoiceStatus: 'ISSUED',
        invoiceUrl: data['invoice_url'] ? String(data['invoice_url']) : order.invoiceUrl,
      },
    });
    await this.notifications.notify(order.userId, 'INVOICE_ISSUED', { order_code: order.code });
  }

  /**
   * Trả lý do khi bỏ qua sự kiện cũ hơn số đã áp (để ghi IGNORED); undefined = đã áp hoặc không có gì để áp.
   * `receivedAt` = lúc Tubu nhận webhook (giờ máy chủ) — mốc duy nhất được so với lượt đồng bộ danh mục.
   */
  private async onStockChanged(data: Record<string, unknown>, receivedAt: Date): Promise<string | undefined> {
    const variationId = data['variation_id'] ?? data['id'];
    const stock = data['remain_quantity'];
    if (variationId == null || stock == null) return;
    const n = Number(stock);
    if (!Number.isFinite(n) || n < 0) return;
    // KHÔNG nuốt lỗi: process() đánh dấu event PROCESSED sau khi handler trả về, nên nuốt ở đây
    // là mất hẳn một lần cập nhật tồn kho — BullMQ không retry, không có log, và tồn kho lệch
    // với kho thật cho tới lần đồng bộ sau. Mọi handler khác trong file này đều để lỗi nổi lên.
    //
    // Cùng lớp lỗi với sync định kỳ (P0-3): webhook cũng từng ghi `stock` TUYỆT ĐỐI, nên một sự
    // kiện mang số cũ hơn đơn vừa đặt là hồi sinh hàng đã bán. Dùng chung công thức chênh lệch +
    // giữ chỗ với sync — xem catalog/variation-stock.ts.
    //
    // Pancake không đảm bảo thứ tự giao webhook (và BullMQ thử lại làm lệch thêm): mang updated_at thì chỉ áp khi không cũ
    // hơn sự kiện đã áp (R4-SYNC-2). Nhận trước lúc lượt đồng bộ danh mục đã áp bắt đầu đọc Pancake thì số đồng bộ mới hơn
    // (R5-SYNC-3).
    const pancakeVariationId = String(variationId);
    const eventAt = pancakeTime(data['updated_at']) ?? undefined;
    const applied = await applyPancakeStock(this.prisma, pancakeVariationId, n, { kind: 'webhook', eventAt, receivedAt });
    if (applied) return;
    const current = await this.prisma.variation.findUnique({
      where: { pancakeId: pancakeVariationId },
      select: { pancakeStockEventAt: true, pancakeStockSyncReadAt: true },
    });
    if (current?.pancakeStockSyncReadAt && current.pancakeStockSyncReadAt >= receivedAt) {
      this.logger.warn(`Bỏ qua tồn kho của biến thể Pancake ${pancakeVariationId}: ${n}, nhận trước lượt đồng bộ danh mục.`);
      return (
        `Webhook tồn kho (${n}) nhận lúc ${receivedAt.toISOString()}, không sau lúc lượt đồng bộ danh mục bắt đầu đọc số Pancake (` +
        `${current.pancakeStockSyncReadAt.toISOString()}) — số đồng bộ mới hơn, không áp để tồn kho không lùi.`
      );
    }
    if (!eventAt || !current?.pancakeStockEventAt) return;
    this.logger.warn(`Bỏ qua tồn kho cũ của biến thể Pancake ${pancakeVariationId}: ${n} lúc ${data['updated_at']}.`);
    return (
      `Sự kiện tồn kho cũ hơn số đã áp (${n} lúc ${eventAt.toISOString()}, đã áp sự kiện lúc ` +
      `${current.pancakeStockEventAt.toISOString()}) — không áp để tồn kho không lùi.`
    );
  }
}
