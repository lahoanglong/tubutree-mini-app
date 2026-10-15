import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Order } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';
import { GomdonAlertService } from '../gomdon/gomdon-alert.service';
import { PancakeClient } from './pancake.client';
import { cancelPancakeOrder, mayExistOnPancake, PANCAKE_CANCEL } from './pancake-order.service';
import {
  PancakeApiError,
  PancakeCancelRefusedError,
  pancakeErrorText,
  pancakeOrderHasCode,
  isPancakeCancelled,
  isPancakeHandedOver,
} from './pancake-outbound';
import { enqueuePancakeCancel, enqueuePancakePayment } from './pancake-queue';
import { ATTENTION_CANCEL_PENDING, flagPancakeAttention } from './pancake-attention';
import { isMerchantFulfilledOrder } from './pancake-fulfilment';

/** Lời báo khách/admin khi Pancake đã bàn giao đơn cho đơn vị vận chuyển (D1). */
export const PANCAKE_HANDED_OVER_MESSAGE = 'Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ CSKH';

/** Pancake báo đơn đã bàn giao vận chuyển — KHÔNG huỷ ở Tubu, đồng bộ lại trạng thái. */
export class PancakeHandedOverError extends Error {
  constructor(readonly pancakeStatus: number | string) {
    super(PANCAKE_HANDED_OVER_MESSAGE);
    this.name = 'PancakeHandedOverError';
  }
}

/** Lời báo người bấm huỷ khi không hỏi được kho Pancake (đơn đã lên Pancake). */
export const PANCAKE_UNREACHABLE_MESSAGE = 'Kho chưa phản hồi, vui lòng thử lại sau ít phút';

/**
 * Người bấm huỷ đơn đã lên Pancake mà không hỏi được Pancake (timeout, lỗi mạng, chưa cấu hình): không huỷ — Pancake có
 * thể đã gửi hàng mà webhook chưa về (D1), huỷ + hoàn tiền lúc này là hoàn tiền cho hàng đang nằm ở hãng.
 */
export class PancakeUnreachableError extends Error {
  constructor(readonly reason: string) {
    super(PANCAKE_UNREACHABLE_MESSAGE);
    this.name = 'PancakeUnreachableError';
  }
}

export type PancakeCancelDecision =
  /** Không có gì bên Pancake (chưa từng đẩy). */
  | { kind: 'NONE' }
  /** Pancake đã huỷ / không có đơn. */
  | { kind: 'CONFIRMED'; cancelStatus: string; pancakeOrderId: string | null }
  /**
   * Huỷ ở Tubu, job huỷ thử lại. Người bấm: chỉ khi Pancake vừa trả lời và đơn CHƯA bàn giao (Pancake từ chối lệnh
   * huỷ, hay có nhiều đơn cùng mã). Cron/hệ thống: cả khi không hỏi được Pancake.
   */
  | { kind: 'DEFERRED'; reason: string };

/**
 * INTERACTIVE: có người bấm huỷ (khách, CSKH, admin) — hỏi Pancake mỗi lần, không hỏi được thì từ chối
 * (PancakeUnreachableError). BACKGROUND: cron huỷ hàng loạt — không hỏi được thì vẫn huỷ, Pancake vừa lỗi thì bỏ qua
 * không hỏi trong một khoảng (không treo cả mẻ).
 */
export type PancakeCancelMode = 'INTERACTIVE' | 'BACKGROUND';

type CancelSubject = Pick<Order, 'id' | 'code' | 'pancakeOrderId' | 'pancakePushClaimedAt'> & Partial<Pick<Order, 'fulfiller'>>;

/**
 * Móc nối chiều Tubu → Pancake cho các đường đổi trạng thái đơn ở OrdersModule (huỷ, nhận tiền) — tách khỏi
 * PancakeModule để OrdersModule dùng được mà không vòng phụ thuộc (PancakeModule import OrdersModule).
 *
 * Huỷ đơn theo D1: đơn đã (có thể) lên Pancake thì hỏi Pancake TRƯỚC với timeout ngắn. Pancake huỷ được / không
 * có đơn → huỷ ở Tubu. Pancake đã gửi hàng → từ chối (PancakeHandedOverError). Không hỏi được → người bấm nhận lời
 * "thử lại sau" (PancakeUnreachableError); cron vẫn huỷ ở Tubu, xếp job huỷ có retry và đưa đơn vào "Cần xử lý
 * Pancake" tới khi Pancake xác nhận.
 */
@Injectable()
export class PancakeSyncHooks {
  private readonly logger = new Logger(PancakeSyncHooks.name);
  /** Huỷ nằm trên đường request của khách: chờ Pancake tối đa chừng này. */
  static readonly CANCEL_TIMEOUT_MS = 5_000;
  /** Pancake vừa không trả lời: các lần huỷ của cron trong khoảng này đi thẳng đường hoãn (cron huỷ hàng loạt không treo). */
  static readonly UNREACHABLE_BACKOFF_MS = 60_000;
  private unreachableUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    @InjectQueue(QUEUE_PANCAKE_PUSH) private readonly queue: Queue,
    @Optional() private readonly alerts?: GomdonAlertService,
  ) {}

  async precheckCancel(order: CancelSubject, mode: PancakeCancelMode): Promise<PancakeCancelDecision> {
    // D4: đơn gian hàng đối tác tự giao không có trên Pancake — mốc huỷ là lúc đối tác báo đã gửi hàng (MerchantFulfilment).
    if (isMerchantFulfilledOrder(order) || !mayExistOnPancake(order)) return { kind: 'NONE' };
    const interactive = mode === 'INTERACTIVE';
    const unreachable = (reason: string): PancakeCancelDecision => {
      if (interactive) throw new PancakeUnreachableError(reason);
      return { kind: 'DEFERRED', reason };
    };
    if (!this.client.isConfigured()) return unreachable('Pancake chưa được cấu hình');
    if (!interactive && Date.now() < this.unreachableUntil) return { kind: 'DEFERRED', reason: 'Pancake vừa không phản hồi' };
    const opts = { timeoutMs: PancakeSyncHooks.CANCEL_TIMEOUT_MS };
    try {
      let pancakeOrderId = order.pancakeOrderId;
      if (!pancakeOrderId) {
        const found = (await this.client.searchOrders(order.code, opts)).filter(
          (o) => o.id != null && pancakeOrderHasCode(o, order.code) && !isPancakeCancelled(o.status),
        );
        if (found.length === 0) return { kind: 'CONFIRMED', cancelStatus: PANCAKE_CANCEL.NOT_FOUND, pancakeOrderId: null };
        // Nhiều đơn sống cùng mã (đẩy trùng): một đơn đã gửi hàng là đủ để chặn; còn lại để job huỷ từng đơn và báo admin.
        if (found.length > 1) {
          const shipped = found.find((o) => isPancakeHandedOver(o.status));
          if (shipped) throw new PancakeHandedOverError(shipped.status!);
          return { kind: 'DEFERRED', reason: `Pancake có ${found.length} đơn mang mã ${order.code}` };
        }
        pancakeOrderId = String(found[0]!.id);
      }
      const outcome = await cancelPancakeOrder(this.client, pancakeOrderId, opts);
      if (outcome.kind === 'HANDED_OVER') throw new PancakeHandedOverError(outcome.status);
      return {
        kind: 'CONFIRMED',
        cancelStatus: outcome.kind === 'NOT_FOUND' ? PANCAKE_CANCEL.NOT_FOUND : PANCAKE_CANCEL.CANCELLED,
        pancakeOrderId,
      };
    } catch (err) {
      if (err instanceof PancakeHandedOverError) throw err;
      if (!(err instanceof PancakeApiError) || err.transient) {
        this.unreachableUntil = Date.now() + PancakeSyncHooks.UNREACHABLE_BACKOFF_MS;
      }
      // Pancake trả lời, đơn chưa bàn giao nhưng không nhận lệnh huỷ: trạng thái đã biết chắc → huỷ ở Tubu, job thử lại.
      if (err instanceof PancakeCancelRefusedError) {
        this.logger.warn(`Pancake từ chối lệnh huỷ đơn ${order.code} (trạng thái ${err.pancakeStatus ?? '?'}): ${pancakeErrorText(err)} — huỷ ở Tubu và thử lại sau.`);
        return { kind: 'DEFERRED', reason: pancakeErrorText(err) };
      }
      this.logger.warn(
        `Không hỏi được Pancake khi huỷ đơn ${order.code}: ${pancakeErrorText(err)} — ${interactive ? 'từ chối huỷ, người bấm thử lại sau' : 'huỷ ở Tubu và thử lại sau'}.`,
      );
      return unreachable(pancakeErrorText(err));
    }
  }

  /**
   * Sau khi đơn đã CANCELLED ở Tubu (đã commit). `decision` undefined = đường huỷ không hỏi Pancake trước (Gomdon,
   * hệ thống) → có dấu vết trên Pancake thì xếp job huỷ. Best-effort: lỗi chỉ log, cron cứu hộ quét PENDING.
   */
  async afterLocalCancel(orderId: string, decision?: PancakeCancelDecision): Promise<void> {
    try {
      // NONE vẫn đọc lại bên dưới: lần đẩy chạy song song có thể đã tạo đơn Pancake sau lúc hỏi.
      if (decision?.kind === 'CONFIRMED') {
        // Kết quả chỉ đúng cho đơn Pancake đã hỏi. Lần đẩy đang chạy dở có thể vừa lưu một đơn KHÁC (tra theo mã
        // lúc nó chưa tạo xong) → không ghi đè, rơi xuống đường xếp job huỷ.
        const settled = await this.prisma.order.updateMany({
          where: {
            id: orderId,
            OR: [{ pancakeOrderId: null }, ...(decision.pancakeOrderId ? [{ pancakeOrderId: decision.pancakeOrderId }] : [])],
          },
          data: {
            pancakeCancelStatus: decision.cancelStatus,
            ...(decision.pancakeOrderId ? { pancakeOrderId: decision.pancakeOrderId, pancakePushClaimedAt: null } : {}),
          },
        });
        if (settled.count > 0) return;
      }
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, code: true, fulfiller: true, pancakeOrderId: true, pancakePushClaimedAt: true, pancakeCancelStatus: true },
      });
      if (!order || isMerchantFulfilledOrder(order) || !mayExistOnPancake(order)) return;
      await this.prisma.order.update({ where: { id: orderId }, data: { pancakeCancelStatus: PANCAKE_CANCEL.PENDING } });
      if (decision?.kind === 'DEFERRED') {
        await flagPancakeAttention(
          this.prisma,
          this.alerts,
          order,
          `${ATTENTION_CANCEL_PENDING} (${decision.reason}) — hệ thống đang tự thử lại; nếu kéo dài, HUỶ TAY đơn Pancake #${order.pancakeOrderId ?? `mã ${order.code}`} để kho không giao.`,
          this.logger,
        );
      }
      await enqueuePancakeCancel(this.queue, orderId);
    } catch (err) {
      this.logger.error(`Xếp lệnh huỷ Pancake lỗi cho đơn ${orderId}: ${pancakeErrorText(err)} — cron cứu hộ thử lại.`);
    }
  }

  /** Đơn vừa PAID: đã lên Pancake thì báo "đã thanh toán, không thu COD"; chưa lên (chờ tiền) thì đẩy. */
  async afterPaid(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { fulfiller: true } }).catch(() => null);
    if (order && isMerchantFulfilledOrder(order)) return; // D4: gian hàng tự giao, kho Tubu không có đơn này
    await enqueuePancakePayment(this.queue, orderId).catch((err) =>
      this.logger.error(`Xếp lệnh cập nhật thanh toán Pancake lỗi cho đơn ${orderId}: ${pancakeErrorText(err)} — cron cứu hộ thử lại.`),
    );
  }
}
