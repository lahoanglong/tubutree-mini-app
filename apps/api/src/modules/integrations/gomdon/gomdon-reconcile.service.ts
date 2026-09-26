import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_GOMDON_EVENTS } from '../../../jobs/queues';
import { GomdonOrderService } from './gomdon-order.service';
import { GOMDON_JOB_EVENT, addGomdonJob } from './gomdon-queue';
import { GOMDON_STATE } from './gomdon-status';
import { GOMDON_EVENT_STATUS } from './gomdon-webhook.service';

/**
 * Lưới an toàn cho tích hợp Gomdon — KHÔNG phụ thuộc Pancake đã cấu hình hay chưa (trước đây phần
 * cứu hộ Gomdon nằm sau `if (!pancake.isConfigured()) return` của PancakePushReconcileService).
 *
 *  1. Webhook event kẹt RECEIVED/FAILED (enqueue lỗi, hết lượt retry) → enqueue lại (giới hạn số lần).
 *  2. Đơn thu gom chưa từng tạo vận đơn (gomdonStatus null — enqueue lúc checkout lỗi), hoặc đã PAID mà
 *     còn AWAITING_PAYMENT (enqueue lúc xác nhận thanh toán lỗi) → enqueue tạo vận đơn (có claim, an toàn).
 *  3. CREATING quá lâu (tiến trình chết giữa lúc gọi Gomdon) của đơn còn hiệu lực → NEEDS_MANUAL_CHECK +
 *     đẩy Pancake + báo CSKH.
 *  4. Đơn đã huỷ còn vận đơn chưa xử lý huỷ (enqueue huỷ lỗi) → enqueue huỷ. Vận đơn chỉ có mã BestExpress
 *     (thiếu id số) cũng tính là có vận đơn.
 */
@Injectable()
export class GomdonReconcileService {
  private readonly logger = new Logger(GomdonReconcileService.name);
  static readonly EVENT_STALE_MINUTES = 5;
  static readonly MAX_EVENT_ATTEMPTS = 15;
  static readonly PUSH_STALE_MINUTES = 15;
  static readonly CREATING_STALE_MINUTES = 30;
  static readonly CANCEL_STALE_MINUTES = 10;
  static readonly BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gomdonOrder: GomdonOrderService,
    @InjectQueue(QUEUE_GOMDON_EVENTS) private readonly eventsQueue: Queue,
  ) {}

  // Mỗi bước bọc try/catch riêng: @Cron không tự bắt lỗi (unhandledRejection làm sập process), và
  // một bước lỗi không được chặn các bước còn lại.
  @Cron('30 */10 * * * *')
  async reconcile(): Promise<void> {
    for (const [name, step] of [
      ['events', () => this.redriveEvents()],
      ['push', () => this.redrivePushes()],
      ['creating', () => this.escalateStuckCreating()],
      ['cancel', () => this.redriveCancels()],
    ] as const) {
      try {
        await step();
      } catch (err) {
        this.logger.error(`Gomdon reconcile (${name}) lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private minutesAgo(m: number): Date {
    return new Date(Date.now() - m * 60_000);
  }

  async redriveEvents(): Promise<void> {
    const events = await this.prisma.gomdonWebhookEvent.findMany({
      where: {
        status: { in: [GOMDON_EVENT_STATUS.RECEIVED, GOMDON_EVENT_STATUS.FAILED] },
        receivedAt: { lt: this.minutesAgo(GomdonReconcileService.EVENT_STALE_MINUTES) },
        attempts: { lt: GomdonReconcileService.MAX_EVENT_ATTEMPTS },
      },
      select: { id: true },
      orderBy: { receivedAt: 'asc' },
      take: GomdonReconcileService.BATCH_SIZE,
    });
    for (const e of events) {
      try {
        await addGomdonJob(this.eventsQueue, GOMDON_JOB_EVENT, { eventId: e.id }, e.id);
      } catch (err) {
        this.logger.error(`Enqueue lại event Gomdon ${e.id} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (events.length > 0) this.logger.warn(`Enqueue lại ${events.length} webhook Gomdon kẹt.`);
  }

  async redrivePushes(): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        hasRecyclingPickup: true,
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        gomdonOrderId: null,
        gomdonPartnerCode: null,
        createdAt: { lt: this.minutesAgo(GomdonReconcileService.PUSH_STALE_MINUTES) },
        OR: [
          { gomdonStatus: null },
          { gomdonStatus: GOMDON_STATE.AWAITING_PAYMENT, paymentStatus: 'PAID' },
        ],
      },
      select: { id: true, code: true },
      orderBy: { createdAt: 'desc' },
      take: GomdonReconcileService.BATCH_SIZE,
    });
    for (const o of orders) {
      try {
        await this.gomdonOrder.enqueuePush(o.id);
      } catch (err) {
        this.logger.error(`Enqueue lại vận đơn Gomdon cho đơn ${o.code} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (orders.length > 0) this.logger.warn(`Enqueue lại tạo vận đơn Gomdon cho ${orders.length} đơn thu gom.`);
  }

  async escalateStuckCreating(): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        hasRecyclingPickup: true,
        // Đơn đã huỷ/trả kẹt CREATING do luồng huỷ lo (cancelOnGomdon hết lượt → FAILED + báo; pushOrder
        // chạy lại → NEEDS_MANUAL_CHECK + báo). Trước đây pushOrder bỏ qua đơn chết mà không đổi trạng thái
        // → đơn khớp cron này mãi mãi, chiếm lô của đơn còn hiệu lực.
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        gomdonStatus: GOMDON_STATE.CREATING,
        gomdonOrderId: null,
        gomdonPartnerCode: null,
        updatedAt: { lt: this.minutesAgo(GomdonReconcileService.CREATING_STALE_MINUTES) },
      },
      select: { id: true, code: true },
      // Cũ nhất trước — lô không bị vài đơn mới hơn chiếm chỗ.
      orderBy: { updatedAt: 'asc' },
      take: GomdonReconcileService.BATCH_SIZE,
    });
    for (const o of orders) {
      try {
        // pushOrder thấy CREATING → NEEDS_MANUAL_CHECK (không gọi tạo lại) + Pancake + báo CSKH.
        await this.gomdonOrder.enqueuePush(o.id);
      } catch (err) {
        this.logger.error(`Xử lý CREATING kẹt cho đơn ${o.code} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async redriveCancels(): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        hasRecyclingPickup: true,
        status: 'CANCELLED',
        gomdonCancelStatus: null,
        updatedAt: { lt: this.minutesAgo(GomdonReconcileService.CANCEL_STALE_MINUTES) },
        // CÓ vận đơn = id số HOẶC chỉ mã BestExpress (vận đơn chỉ-có-mã vẫn là vận đơn sống).
        OR: [
          { gomdonOrderId: { not: null } },
          { gomdonPartnerCode: { not: null } },
          { gomdonStatus: GOMDON_STATE.NEEDS_MANUAL_CHECK },
          { gomdonStatus: GOMDON_STATE.MANUAL_HANDLED },
          // Kẹt CREATING: cancelOnGomdon chốt NEEDS_MANUAL_CHECK + báo khi claim đã quá lease.
          { gomdonStatus: GOMDON_STATE.CREATING },
        ],
      },
      select: { id: true, code: true },
      take: GomdonReconcileService.BATCH_SIZE,
    });
    for (const o of orders) {
      try {
        await this.gomdonOrder.enqueueCancel(o.id);
      } catch (err) {
        this.logger.error(`Enqueue huỷ vận đơn Gomdon cho đơn ${o.code} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
