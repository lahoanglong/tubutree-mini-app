import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { QUEUE_GOMDON_PUSH, QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';
import { enqueueGomdonPush } from '../gomdon/gomdon-queue';
import { GomdonAlertService } from '../gomdon/gomdon-alert.service';
import { GOMDON_CANCEL, GOMDON_STATE } from '../gomdon/gomdon-status';
import { mapPancakeStatus } from './pancake-status.map';
import { isPancakeOrderPaid } from './pancake-payment.util';
import { OrderStatusService, InvalidOrderTransitionError } from '../../orders/order-status.service';
import { applyPancakeStock } from '../../catalog/variation-stock';
import { AnalyticsEventsService } from '../../analytics/analytics-events.service';

interface EventData {
  event?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Worker xử lý webhook Pancake async (Build Spec §8.4 bước 4).
 * Khớp đơn qua external_order_id / note chứa Order.code, hoặc pancakeOrderId.
 */
/** Số cặp (đơn, mã vận đơn lạ) nhớ để không báo trùng — Pancake gửi lại webhook mỗi lần đơn đổi. */
const WAYBILL_CONFLICT_MEMORY = 500;

@Processor(QUEUE_PANCAKE_EVENTS)
export class PancakeProcessor extends WorkerHost {
  private readonly logger = new Logger(PancakeProcessor.name);
  /** Báo động vận hành (in-app tới ADMIN, template OPS_GOMDON_ALERT) — dùng chung cơ chế với Gomdon. */
  private readonly alerts: GomdonAlertService;
  /** Chống spam best-effort trong 1 process (khởi động lại / nhiều instance có thể báo lại 1 lần). */
  private readonly waybillConflictAlerted = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly orderStatus: OrderStatusService,
    // Optional để test/call site cũ dựng tay 3 tham số vẫn chạy. Đơn thu gom tái chế chuyển khoản:
    // tiền về (lật PAID) mới được đặt vận đơn Gomdon — enqueue ở onPaymentReconcile.
    @Optional() @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue?: Queue,
    // PancakeModule tự provide GomdonAlertService (chỉ phụ thuộc Prisma + Notifications) — không import
    // GomdonModule nên không có vòng module. Call site dựng tay thiếu tham số → tự dựng, vẫn báo thật.
    @Optional() alerts?: GomdonAlertService,
    // @Optional cùng lý do gomdonQueue/alerts ở trên: nhiều test dựng PancakeProcessor tay không
    // truyền tham số này — AnalyticsModule là @Global() nên app thật luôn wiring được.
    @Optional() private readonly analytics?: AnalyticsEventsService,
  ) {
    super();
    this.alerts = alerts ?? new GomdonAlertService(prisma, notifications);
  }

  async process(job: Job<{ eventId: string }>): Promise<void> {
    const event = await this.prisma.pancakeWebhookEvent.findUnique({
      where: { id: job.data.eventId },
    });
    if (!event || event.status === 'PROCESSED') return;

    try {
      const payload = event.rawPayload as unknown as EventData;
      // Pancake POS gửi nguyên object đơn ở top-level; luồng cũ dùng {event,data}.
      const data = (payload.data as Record<string, unknown>) ?? (payload as Record<string, unknown>);
      await this.handle(event.eventType, data);
      await this.prisma.pancakeWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 } },
      });
    } catch (err) {
      await this.prisma.pancakeWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err; // BullMQ retry
    }
  }

  private async handle(eventType: string, data: Record<string, unknown>): Promise<void> {
    switch (eventType) {
      case 'orders': // Pancake POS: webhook đơn hàng (payload là nguyên object đơn)
      case 'order':
      case 'order.status_updated':
      case 'order.updated':
        await this.onStatusUpdated(data);
        // Đối soát thanh toán: Pancake ghi nhận chuyển khoản (QR) → lật đơn UNPAID→PAID.
        await this.onPaymentReconcile(data);
        // Đơn Pancake kèm thông tin vận chuyển → cập nhật luôn nếu có (field thật ở `partner`).
        if (data['partner'] || data['tracking_link'] || data['shipping_status'] || data['tracking_number']) {
          await this.onShippingUpdated(data);
        }
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
      case 'variation.stock_changed':
        await this.onStockChanged(data);
        break;
      default:
        this.logger.debug(`Bỏ qua event chưa xử lý: ${eventType}`);
    }
  }

  private async findOrder(data: Record<string, unknown>) {
    const code = this.extractOrderCode(data);
    const pancakeId = data['id'] ?? data['order_id'];
    return this.prisma.order.findFirst({
      where: {
        OR: [
          code ? { code } : undefined,
          pancakeId ? { pancakeOrderId: String(pancakeId) } : undefined,
        ].filter(Boolean) as object[],
      },
    });
  }

  private extractOrderCode(data: Record<string, unknown>): string | null {
    const ext = data['extension'] as { external_order_id?: string } | undefined;
    if (ext?.external_order_id) return ext.external_order_id;
    const note = typeof data['note'] === 'string' ? (data['note'] as string) : '';
    const m = note.match(/TUBU\w+/);
    return m ? m[0] : null;
  }

  private async onStatusUpdated(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order) return;
    const status = mapPancakeStatus(data['status'] ?? data['status_name']);
    if (!status) return;

    // Ủy quyền cho OrderStatusService — nguồn ghi status DUY NHẤT, dùng chung với admin/
    // merchant. Tự guard no-op (status===order.status), atomic race (updateMany), VÀ side-
    // effect đầy đủ (credit/reverse điểm+hoa hồng, restock+refund khi CANCELLED/RETURNED —
    // trước đây webhook hủy KHÔNG hoàn tiền/restock, P0-4 trong docs/2026-09-08-review-progress.md).
    // Queue KHÔNG đảm bảo thứ tự per-order (BullMQ retry/backoff) — webhook CANCELLED có thể
    // chạy TRƯỚC rồi webhook DELIVERED cũ hơn (redelivery) chạy SAU; assertTransition của
    // OrderStatusService tự chặn DELIVERED sau khi đã ở CANCELLED/RETURNED (trạng thái cuối) —
    // không cần tự kiểm tra ở đây nữa.
    // CHỈ nuốt lỗi transition không hợp lệ (webhook trễ/không theo thứ tự — bỏ qua êm,
    // KHÔNG phải lỗi thật). Lỗi khác (DB down, loyalty/affiliate throw thật) phải NÉM TIẾP
    // để process() đánh dấu FAILED + BullMQ retry — nuốt hết ở đây sẽ mất event vĩnh viễn.
    try {
      await this.orderStatus.setStatus(order.id, status, { actorType: 'PANCAKE' });
    } catch (err) {
      if (err instanceof InvalidOrderTransitionError) {
        this.logger.warn(`Bỏ qua webhook status=${status} cho đơn ${order.code}: ${err.message}`);
        return;
      }
      throw err;
    }
  }

  /** Đối soát thanh toán chuyển khoản: chỉ lật đơn BANK_TRANSFER còn UNPAID → PAID (idempotent). */
  private async onPaymentReconcile(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order) return;
    if (order.paymentMethod !== 'BANK_TRANSFER' || order.paymentStatus !== 'UNPAID') return;
    if (!isPancakeOrderPaid(data, order.total)) return;

    // P1-3 (docs/2026-09-08-review-progress.md): đơn đã hủy/trả trước khi tiền chuyển khoản
    // tới nơi (khách hủy xong tiền mới về, hoặc trả hàng) trước đây vẫn bị lật paymentStatus→
    // PAID êm ru — order đứng CANCELLED/RETURNED + PAID, không cơ chế nào tự phát hiện cần
    // hoàn tiền thật cho khách. Chặn lật + cảnh báo rõ để vận hành xử lý tay.
    if (order.status === 'CANCELLED' || order.status === 'RETURNED') {
      this.logger.warn(
        `Nhận tiền chuyển khoản cho đơn ${order.code} đã ${order.status} — CẦN HOÀN TIỀN THỦ CÔNG cho khách, không tự lật PAID.`,
      );
      return;
    }

    // Guard theo trạng thái HIỆN TẠI trong DB (không theo ảnh chụp `order` đọc ở trên): khách huỷ
    // chen giữa lúc đọc và lúc lật (đơn đã hoàn kho) thì KHÔNG được "hồi sinh" thành PAID+CONFIRMED.
    // paymentStatus='UNPAID' trong where → 2 webhook song song chỉ lật 1 lần.
    // order_paid phải ghi ATOMIC cùng lần lật PAID (Task 5, docs analytics-foundation): bọc từng
    // updateMany trong $transaction, chỉ ghi event khi count>0 (guard where thật sự khớp).
    let flip = await this.prisma.$transaction(async (tx) => {
      const r = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' },
        data: { paymentStatus: 'PAID', status: 'CONFIRMED', paidAt: new Date() },
      });
      if (r.count > 0 && this.analytics) {
        await this.analytics.record(tx, {
          eventName: 'order_paid',
          userId: order.userId,
          platform: order.platform === 'web' ? 'web' : 'miniapp',
          props: { orderId: order.id, method: order.paymentMethod, amount: order.total },
        });
      }
      return r;
    });
    if (flip.count === 0) {
      // Đơn đã xác nhận trước khi tiền về (vd admin/merchant CONFIRMED) → chỉ lật thanh toán.
      flip = await this.prisma.$transaction(async (tx) => {
        const r = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: 'UNPAID', status: { notIn: ['CANCELLED', 'RETURNED', 'PENDING_PAYMENT'] } },
          data: { paymentStatus: 'PAID', paidAt: new Date() },
        });
        if (r.count > 0 && this.analytics) {
          await this.analytics.record(tx, {
            eventName: 'order_paid',
            userId: order.userId,
            platform: order.platform === 'web' ? 'web' : 'miniapp',
            props: { orderId: order.id, method: order.paymentMethod, amount: order.total },
          });
        }
        return r;
      });
    }
    if (flip.count === 0) {
      const now = await this.prisma.order.findUnique({ where: { id: order.id }, select: { status: true, paymentStatus: true } });
      if (now && (now.status === 'CANCELLED' || now.status === 'RETURNED') && now.paymentStatus === 'UNPAID') {
        this.logger.warn(
          `Nhận tiền chuyển khoản cho đơn ${order.code} vừa ${now.status} — CẦN HOÀN TIỀN THỦ CÔNG cho khách, không tự lật PAID.`,
        );
      }
      return;
    }
    {
      this.logger.log(`Pancake xác nhận thanh toán đơn ${order.code} → PAID`);
      if (order.hasRecyclingPickup && this.gomdonQueue) {
        // Đơn thu gom đang AWAITING_PAYMENT → giờ mới đặt bưu tá. Lỗi enqueue không được làm hỏng
        // event (đã lật PAID) — GomdonReconcileService quét AWAITING_PAYMENT+PAID và enqueue lại.
        await enqueueGomdonPush(this.gomdonQueue, order.id).catch((err) =>
          this.logger.error(`Enqueue vận đơn Gomdon sau thanh toán lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`),
        );
      }
      await this.notifications.notify(order.userId, 'ORDER_CONFIRMED', { order_code: order.code });
    }
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

    // Đơn có vận đơn Gomdon ĐANG SỐNG (thu gom tái chế): Gomdon là nguồn DUY NHẤT của shippingCode/
    // Partner/Status/History (webhook Gomdon ghi, kèm chặn lùi trạng thái). Pancake không ghi đè — trước
    // đây "ai ghi sau thắng": khách thấy mã vận đơn hãng này với trạng thái của hãng kia. Pancake báo MỘT
    // mã vận đơn KHÁC → nhiều khả năng kho đã đặt thêm hãng vận chuyển (giao/thu COD 2 lần) → báo động.
    // Vận đơn Gomdon đã huỷ ('2' / huỷ xong) hoặc admin đã "Đã xử lý tay" → Gomdon hết sở hữu, kho giao
    // bằng hãng khác thì cập nhật Pancake phải ghi được (không thì khách mãi thấy "Đơn hủy").
    const gomdonOwnsShipping =
      Boolean(order.gomdonOrderId || order.gomdonPartnerCode) &&
      order.gomdonStatus !== '2' &&
      order.gomdonStatus !== GOMDON_STATE.MANUAL_HANDLED &&
      order.gomdonCancelStatus !== GOMDON_CANCEL.CANCELLED;
    if (gomdonOwnsShipping) {
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

    const history = Array.isArray(order.shippingHistory) ? order.shippingHistory : [];
    // Ghi mốc khi TRẠNG THÁI hoặc MÃ VẬN ĐƠN đổi (gán waybill cũng là 1 mốc) — tránh ghi trùng.
    const last = history[history.length - 1] as { status?: string | null; code?: string | null } | undefined;
    const changed =
      (!!shipStatusS && shipStatusS !== (last?.status ?? null)) ||
      (!!waybillS && waybillS !== (last?.code ?? null));
    const nextHistory = changed
      ? [...history, { at: new Date().toISOString(), status: shipStatusS, carrier: carrierS, code: waybillS }]
      : history;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        shippingPartner: carrierS ?? order.shippingPartner,
        shippingCode: waybillS ?? order.shippingCode,
        shippingStatus: shipStatusS ?? order.shippingStatus,
        trackingLink: linkS ?? order.trackingLink,
        shippingHistory: nextHistory as object,
      },
    });
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
    try {
      await this.orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'PANCAKE' });
    } catch (err) {
      if (err instanceof InvalidOrderTransitionError) {
        this.logger.warn(`Bỏ qua webhook cancelled cho đơn ${order.code}: ${err.message}`);
        return;
      }
      throw err;
    }
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

  private async onStockChanged(data: Record<string, unknown>): Promise<void> {
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
    await applyPancakeStock(this.prisma, String(variationId), n);
  }
}
