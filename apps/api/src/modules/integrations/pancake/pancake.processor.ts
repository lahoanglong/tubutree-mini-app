import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { AffiliateService } from '../../affiliate/affiliate.service';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';
import { mapPancakeStatus } from './pancake-status.map';

interface EventData {
  event: string;
  data: Record<string, unknown>;
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
    private readonly loyalty: LoyaltyService,
    private readonly affiliate: AffiliateService,
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
      await this.handle(payload.event, payload.data ?? {});
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
      case 'order.status_updated':
      case 'order.updated':
        await this.onStatusUpdated(data);
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
    if (!status || status === order.status) return;

    await this.prisma.order.update({ where: { id: order.id }, data: { status } });

    if (status === 'DELIVERED') {
      await this.loyalty.creditOrderPoints(order.id);
      await this.affiliate.lockCommissionsForOrder(order.id);
    } else if (status === 'CANCELLED' || status === 'RETURNED') {
      await this.loyalty.reverseOrderPoints(order.id);
      await this.affiliate.reverseCommissionsForOrder(order.id);
    }
    await this.notifications.notify(order.userId, `ORDER_${status}`, {
      order_code: order.code,
    });
  }

  private async onShippingUpdated(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order) return;
    const history = Array.isArray(order.shippingHistory) ? order.shippingHistory : [];
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        shippingStatus: data['shipping_status'] ? String(data['shipping_status']) : order.shippingStatus,
        shippingCode: data['tracking_number'] ? String(data['tracking_number']) : order.shippingCode,
        shippingHistory: [...history, { at: new Date().toISOString(), data }] as object,
      },
    });
  }

  private async onCancelled(data: Record<string, unknown>): Promise<void> {
    const order = await this.findOrder(data);
    if (!order || order.status === 'CANCELLED') return;
    await this.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await this.loyalty.reverseOrderPoints(order.id);
    await this.affiliate.reverseCommissionsForOrder(order.id);
    await this.notifications.notify(order.userId, 'ORDER_CANCELLED', { order_code: order.code });
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
