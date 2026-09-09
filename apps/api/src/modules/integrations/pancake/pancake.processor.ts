import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';
import { mapPancakeStatus } from './pancake-status.map';
import { isPancakeOrderPaid } from './pancake-payment.util';
import { OrderStatusService, InvalidOrderTransitionError } from '../../orders/order-status.service';

interface EventData {
  event?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Worker xử lý webhook Pancake async (Build Spec §8.4 bước 4).
 * Khớp đơn qua external_order_id / note chứa Order.code, hoặc pancakeOrderId.
 */
@Processor(QUEUE_PANCAKE_EVENTS)
export class PancakeProcessor extends WorkerHost {
  private readonly logger = new Logger(PancakeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly orderStatus: OrderStatusService,
  ) {
    super();
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
      await this.orderStatus.setStatus(order.id, status);
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

    // updateMany guard paymentStatus='UNPAID' → 2 webhook song song chỉ lật 1 lần.
    const flip = await this.prisma.order.updateMany({
      where: { id: order.id, paymentStatus: 'UNPAID' },
      data: {
        paymentStatus: 'PAID',
        ...(order.status === 'PENDING_PAYMENT' ? { status: 'CONFIRMED' } : {}),
      },
    });
    if (flip.count > 0) {
      this.logger.log(`Pancake xác nhận thanh toán đơn ${order.code} → PAID`);
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

  private async onCancelled(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order) return;
    // Ủy quyền cho OrderStatusService — trước đây chỉ đảo điểm/hoa hồng mà KHÔNG hoàn tiền/
    // restock/release flash quota khi POS hủy đơn (P0-4, docs/2026-09-08-review-progress.md).
    try {
      await this.orderStatus.setStatus(order.id, 'CANCELLED');
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
    await this.prisma.variation
      .updateMany({ where: { pancakeId: String(variationId) }, data: { stock: Number(stock) } })
      .catch(() => undefined);
  }
}
