import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Order, OrderItem } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import type { PancakeOrderDTO } from './pancake.types';
import { QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';
import { SystemConfigService } from '../../system-config/system-config.service';
import { loadGomdonConfig, DEFAULT_GOMDON_WEIGHT_FALLBACK } from '../gomdon/gomdon-config';
import { recyclingWeight } from '../gomdon/gomdon-weight';
import { GOMDON_STATE } from '../gomdon/gomdon-status';
import { GomdonAlertService } from '../gomdon/gomdon-alert.service';
import { isPrepaidMethod } from '../../orders/order-transition';
import { resolveDealerRecipient } from '../../dealer/dealer-recipient';
import { DEALER_AWAITING_STOCK_WHERE, isDealerAwaitingStock } from '../../dealer/dealer-awaiting-stock';
import {
  ALL_LINES,
  buildPancakeOrderBody,
  isPancakePrepaid,
  pancakePaymentState,
  type PancakeLinePredicate,
  type PancakeRecipient,
} from './pancake-order-body';
import {
  extractPancakeOrderId,
  isPancakeCancelled,
  isPancakeHandedOver,
  PANCAKE_ORDER_STATUS,
  PancakeApiError,
  PancakeOrderDataError,
  pancakeErrorText,
  pancakeOrderHasCode,
} from './pancake-outbound';
import { enqueuePancakeCancel, enqueuePancakePayment, enqueuePancakePush } from './pancake-queue';
import {
  ATTENTION_CANCEL_PENDING,
  ATTENTION_PAYMENT_PENDING,
  ATTENTION_PUSH_FAILED,
  clearPancakeAttention,
  flagPancakeAttention,
} from './pancake-attention';

export { PANCAKE_TAG_GOMDON, PANCAKE_TAG_RECYCLING } from './pancake-order-body';

/** Trạng thái đẩy đơn (Order.pancakePushStatus). */
export const PANCAKE_PUSH = {
  WAITING_PAYMENT: 'WAITING_PAYMENT',
  WAITING_STOCK: 'WAITING_STOCK',
  PENDING: 'PENDING',
  PUSHING: 'PUSHING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  SKIPPED: 'SKIPPED',
  STALE: 'STALE',
} as const;

/** Kết quả huỷ bên Pancake (Order.pancakeCancelStatus). */
export const PANCAKE_CANCEL = {
  PENDING: 'PENDING',
  CANCELLED: 'CANCELLED',
  NOT_FOUND: 'NOT_FOUND',
  TOO_LATE: 'TOO_LATE',
  FAILED: 'FAILED',
} as const;

/** Trạng thái đơn Tubu còn được tự đẩy sang kho: chưa rời kho, chưa kết thúc. */
export const PANCAKE_PUSHABLE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] as const;

export type PancakePushGate = 'PUSH' | 'WAIT_PAYMENT' | 'WAIT_STOCK' | 'DEAD' | 'LEFT_WAREHOUSE';

/**
 * Đơn có được đẩy sang kho lúc này không. Trả trước qua cổng (ZaloPay/VNPay/Ví) chưa PAID thì chờ tiền — kho không
 * cần thấy đơn có thể bị bỏ dở. Chuyển khoản chưa PAID VẪN đẩy (kèm "CHỜ CHUYỂN KHOẢN"): Pancake đối soát tài
 * khoản ngân hàng theo nội dung CK = mã đơn, cần có đơn để khớp (bank-transfer.service.ts). Đơn đại lý còn hàng đặt
 * trước thì chờ đủ hàng dù đã thanh toán (dealer-awaiting-stock.ts).
 */
export function pancakePushGate(order: {
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  type: string;
  items: { backorderedQty?: number | null }[];
}): PancakePushGate {
  if (order.status === 'CANCELLED' || order.status === 'RETURNED') return 'DEAD';
  if (!(PANCAKE_PUSHABLE_STATUSES as readonly string[]).includes(order.status)) return 'LEFT_WAREHOUSE';
  if (isDealerAwaitingStock(order)) return 'WAIT_STOCK';
  if (order.paymentStatus !== 'PAID' && isPrepaidMethod(order.paymentMethod) && order.paymentMethod !== 'BANK_TRANSFER') {
    return 'WAIT_PAYMENT';
  }
  return 'PUSH';
}

type OrderWithItems = Order & { items: OrderItem[] };

/** Đơn cũ trước cột trạng thái huỷ: có dấu vết đã (có thể) lên Pancake thì phải huỷ bên đó. */
export function mayExistOnPancake(order: Pick<Order, 'pancakeOrderId' | 'pancakePushClaimedAt'>): boolean {
  return Boolean(order.pancakeOrderId || order.pancakePushClaimedAt);
}

/**
 * Đẩy đơn local → Pancake (Build Spec §8.3) và các cập nhật sau đó (đã thanh toán, huỷ).
 *
 * Chống tạo đơn trùng ở kho: trước khi POST ghi `pancakePushClaimedAt`; nếu lần thử sau thấy mốc này mà chưa có
 * `pancakeOrderId` (timeout, mất response, lỗi lưu DB, worker bị kill khi deploy, job bị dọn) thì TRA Pancake theo
 * mã đơn trước, có thì nhận đơn đó, không thì mới tạo. Pancake từ chối dứt khoát (4xx) thì chắc chắn chưa tạo → gỡ
 * mốc. Vì vậy enqueue lại bao nhiêu lần cũng an toàn (không còn phải giữ job completed làm "chốt chặn").
 */
@Injectable()
export class PancakeOrderService {
  private readonly logger = new Logger(PancakeOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    @InjectQueue(QUEUE_PANCAKE_PUSH) private readonly pushQueue: Queue,
    // Optional: chỉ để đọc cân nặng mặc định của Gomdon cho ghi chú thu gom (cùng số với vận đơn).
    @Optional() private readonly systemConfig?: SystemConfigService,
    @Optional() private readonly alerts?: GomdonAlertService,
  ) {}

  /** Quá mốc này mà đơn vẫn PUSHING thì coi tiến trình đẩy trước đã chết. Dài hơn timeout gọi Pancake (15s). */
  static readonly PUSH_LEASE_MS = 60_000;

  /** Vị từ dòng do Tubu giao qua Pancake (D4: dòng nhà bán tự giao bị lọc ra). Mặc định mọi dòng. */
  protected isPancakeLine: PancakeLinePredicate = ALL_LINES;

  /** Xếp hàng đẩy đơn (retry + backoff — jobs/queue.module.ts). Gọi lặp an toàn, xem pancake-queue.ts. */
  enqueuePush(orderId: string): Promise<void> {
    return enqueuePancakePush(this.pushQueue, orderId);
  }

  enqueuePayment(orderId: string): Promise<void> {
    return enqueuePancakePayment(this.pushQueue, orderId);
  }

  enqueueCancel(orderId: string): Promise<void> {
    return enqueuePancakeCancel(this.pushQueue, orderId);
  }

  async pushOrder(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.pancakeOrderId) return order.pancakeOrderId; // đã đẩy

    const gate = pancakePushGate(order);
    if (gate === 'DEAD') {
      await this.setPushStatus(order.id, PANCAKE_PUSH.SKIPPED);
      // Lần tạo trước có thể đã thành công rồi đơn mới bị huỷ: huỷ luôn bên Pancake (job tra theo mã đơn).
      if (order.status === 'CANCELLED' && order.pancakePushClaimedAt) await this.requestCancel(order);
      return null;
    }
    if (gate === 'LEFT_WAREHOUSE') {
      await this.markStale(order, `đơn đã ở trạng thái ${order.status} mà chưa từng lên Pancake`);
      return null;
    }
    if (gate === 'WAIT_PAYMENT') {
      await this.setPushStatus(order.id, PANCAKE_PUSH.WAITING_PAYMENT);
      return null;
    }
    if (gate === 'WAIT_STOCK') {
      await this.setPushStatus(order.id, PANCAKE_PUSH.WAITING_STOCK);
      return null;
    }
    if (!this.client.isConfigured()) {
      this.logger.warn(`Pancake chưa cấu hình — đơn ${order.code} giữ trạng thái chờ đồng bộ.`);
      await this.prisma.order.updateMany({
        where: { id: order.id, pancakeOrderId: null },
        data: { pancakePushStatus: PANCAKE_PUSH.NOT_CONFIGURED, pancakeSyncError: 'Pancake chưa cấu hình (PANCAKE_API_KEY/SHOP_ID).' },
      });
      return null;
    }

    const { body, paymentSynced } = buildPancakeOrderBody(order, {
      recipient: await this.recipientOf(order),
      variations: await this.variationsOf(order),
      onDealerCredit: await this.isOnDealerCredit(order),
      recyclingNote: await this.buildRecyclingNote(order),
      isPancakeLine: this.isPancakeLine,
    });

    // Giữ quyền đẩy (một tiến trình một lúc): job push, job thanh toán và cron có thể cùng chạm một đơn. Tiến trình
    // chết giữa chừng để lại PUSHING — quá PUSH_LEASE_MS thì lần sau được vào lại (và tra cứu trước khi tạo).
    const now = new Date();
    const claim = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        pancakeOrderId: null,
        status: { in: [...PANCAKE_PUSHABLE_STATUSES] },
        NOT: DEALER_AWAITING_STOCK_WHERE,
        OR: [
          { pancakePushStatus: null },
          { pancakePushStatus: { not: PANCAKE_PUSH.PUSHING } },
          { pancakeLastAttemptAt: { lt: new Date(now.getTime() - PancakeOrderService.PUSH_LEASE_MS) } },
        ],
      },
      data: {
        pancakePushStatus: PANCAKE_PUSH.PUSHING,
        pancakePushClaimedAt: now,
        pancakePushAttempts: { increment: 1 },
        pancakeLastAttemptAt: now,
      },
    });
    if (claim.count === 0) {
      const current = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      if (current.pancakeOrderId) return current.pancakeOrderId;
      if (pancakePushGate(current) !== 'PUSH') return this.pushOrder(order.id);
      throw new PancakeApiError(`Đơn ${order.code} đang được đẩy sang Pancake bởi tiến trình khác — thử lại sau.`, true);
    }

    let pancakeOrderId: string | null;
    try {
      // Lần trước đã gửi lệnh tạo mà không rõ kết quả → tra theo mã đơn, có thì nhận đơn đó thay vì tạo thêm.
      if (order.pancakePushClaimedAt) {
        const found = await this.findOnPancake(order);
        if (found) return await this.adopt(order, found);
      }
      pancakeOrderId = extractPancakeOrderId(await this.client.createOrder(body));
    } catch (err) {
      // Từ chối dứt khoát → Pancake chắc chắn chưa tạo: gỡ mốc để lần sau không phải tra cứu.
      const definite = err instanceof PancakeApiError && !err.transient;
      await this.prisma.order.updateMany({
        where: { id: order.id, pancakeOrderId: null },
        data: {
          pancakePushStatus: PANCAKE_PUSH.PENDING,
          pancakeSyncError: pancakeErrorText(err),
          ...(definite && !order.pancakePushClaimedAt ? { pancakePushClaimedAt: null } : {}),
        },
      });
      throw err;
    }
    if (!pancakeOrderId) {
      // Không rõ đơn đã tạo chưa — giữ mốc, lần thử sau tra theo mã đơn (không tạo mù thêm đơn).
      const err = new PancakeApiError(`Pancake không trả mã đơn khi tạo đơn ${order.code}.`, true);
      await this.prisma.order.updateMany({
        where: { id: order.id, pancakeOrderId: null },
        data: { pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeSyncError: pancakeErrorText(err) },
      });
      throw err;
    }
    await this.saveCreated(order, pancakeOrderId, paymentSynced);
    return pancakeOrderId;
  }

  /** Hết lượt thử của job push: chốt FAILED + đưa vào hàng đợi "Cần xử lý Pancake" (cron vẫn thử tiếp). */
  async markPushFailure(orderId: string, err: unknown, final: boolean): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, code: true, pancakeOrderId: true } });
    if (!order || order.pancakeOrderId) return;
    // Đang PUSHING = tiến trình khác giữ quyền đẩy (lần này thua tranh chấp): không ghi đè, kẻo mở khoá cho lần tạo thứ hai.
    await this.prisma.order.updateMany({
      where: { id: order.id, pancakeOrderId: null, OR: [{ pancakePushStatus: null }, { pancakePushStatus: { not: PANCAKE_PUSH.PUSHING } }] },
      data: { pancakeSyncError: pancakeErrorText(err), ...(final ? { pancakePushStatus: PANCAKE_PUSH.FAILED } : {}) },
    });
    if (final || err instanceof PancakeOrderDataError) {
      await flagPancakeAttention(
        this.prisma,
        this.alerts,
        order,
        `${ATTENTION_PUSH_FAILED} (kho chưa thấy đơn): ${pancakeErrorText(err)}. Hệ thống tự thử lại mỗi 15 phút; sửa nguyên nhân rồi bấm "Đẩy lại Pancake".`,
        this.logger,
      );
    }
  }

  /**
   * "Đẩy lại Pancake" của admin: đơn còn trong kho (chưa rời kho, chưa huỷ) và chưa lên Pancake — kể cả quá cửa sổ
   * tự đẩy. Đơn ĐÃ rời kho/đã giao thì không đẩy (kho sẽ giao lần hai).
   */
  async retryPushByAdmin(adminId: string, idOrCode: string): Promise<{ ok: true; message: string }> {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
      include: { items: { select: { backorderedQty: true } } },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.pancakeOrderId) throw new BadRequestException(`Đơn ${order.code} đã có trên Pancake (#${order.pancakeOrderId}).`);
    const gate = pancakePushGate(order);
    if (gate === 'DEAD') throw new BadRequestException(`Đơn ${order.code} đã huỷ/trả, không đẩy sang kho.`);
    if (gate === 'LEFT_WAREHOUSE') {
      throw new BadRequestException(`Đơn ${order.code} đã ở trạng thái ${order.status} — không đẩy để tránh kho giao lần hai.`);
    }
    if (gate === 'WAIT_PAYMENT') {
      throw new BadRequestException(`Đơn ${order.code} trả trước (${order.paymentMethod}) chưa thanh toán — sẽ tự đẩy khi khách trả tiền.`);
    }
    if (gate === 'WAIT_STOCK') {
      throw new BadRequestException(`Đơn ${order.code} còn hàng đặt trước chưa về đủ — hệ thống tự đẩy sang kho khi đủ hàng.`);
    }
    if (!this.client.isConfigured()) throw new BadRequestException('Pancake chưa được cấu hình (PANCAKE_API_KEY/SHOP_ID).');
    if (this.pushInFlight(order)) throw new BadRequestException(`Đơn ${order.code} đang được đẩy sang Pancake — chờ ít phút rồi tải lại.`);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 0 },
    });
    await this.enqueuePush(order.id);
    this.logger.warn(`Admin ${adminId} đẩy lại đơn ${order.code} sang Pancake.`);
    return { ok: true, message: `Đã xếp lệnh đẩy đơn ${order.code} sang Pancake.` };
  }

  /**
   * Đơn đã lên Pancake khi chưa thanh toán (chờ chuyển khoản) nay đã PAID: báo Pancake số đã trả để không thu COD.
   * Chưa lên Pancake thì đẩy luôn (body mới đã mang thông tin thanh toán).
   */
  async syncPayment(orderId: string, final = false): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.pancakePaymentSynced || order.status === 'CANCELLED' || order.status === 'RETURNED') return;
    if (!order.pancakeOrderId) {
      await this.pushOrder(order.id);
      return;
    }
    const onCredit = await this.isOnDealerCredit(order);
    const state = pancakePaymentState(order, onCredit);
    if (!isPancakePrepaid(state)) return;
    if (!this.client.isConfigured()) return;
    const { body, amountDue } = buildPancakeOrderBody(order, {
      recipient: await this.recipientOf(order),
      variations: await this.variationsOf(order),
      onDealerCredit: onCredit,
      recyclingNote: await this.buildRecyclingNote(order),
      isPancakeLine: this.isPancakeLine,
    });
    try {
      await this.client.updateOrder(order.pancakeOrderId, {
        transfer_money: body.transfer_money,
        cod: body.cod,
        tags: body.tags,
        note: body.note,
      });
    } catch (err) {
      await this.setPushError(order.id, err);
      if (final) {
        await flagPancakeAttention(
          this.prisma,
          this.alerts,
          order,
          `${ATTENTION_PAYMENT_PENDING} cho đơn Pancake #${order.pancakeOrderId} (đã thu ${amountDue.toLocaleString('vi-VN')}đ): ${pancakeErrorText(err)}. Sửa tay trên Pancake để shipper không thu tiền lần nữa.`,
          this.logger,
        );
      }
      throw err;
    }
    await this.prisma.order.update({ where: { id: order.id }, data: { pancakePaymentSynced: true, pancakeSyncError: null } });
    await clearPancakeAttention(this.prisma, order.id, ATTENTION_PAYMENT_PENDING);
  }

  /**
   * Huỷ đơn Pancake của đơn đã huỷ ở Tubu (job 'cancel', cron cứu hộ). Pancake đã gửi hàng → TOO_LATE + báo admin
   * chặn giao; không thấy đơn → NOT_FOUND. Lỗi kết nối → ném để retry; lần cuối → FAILED + báo admin huỷ tay.
   */
  async cancelOnPancake(orderId: string, final = false): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== 'CANCELLED') return;
    const settled: string[] = [PANCAKE_CANCEL.CANCELLED, PANCAKE_CANCEL.NOT_FOUND, PANCAKE_CANCEL.TOO_LATE];
    if (order.pancakeCancelStatus && settled.includes(order.pancakeCancelStatus)) return;
    if (!mayExistOnPancake(order)) {
      await this.setCancelStatus(order.id, PANCAKE_CANCEL.NOT_FOUND);
      return;
    }
    if (!this.client.isConfigured()) return; // giữ PENDING, cron thử lại khi có cấu hình
    try {
      let pancakeId = order.pancakeOrderId;
      if (!pancakeId) {
        // Lần đẩy đang chạy dở: tra lúc này có thể chưa thấy đơn sắp được tạo → đợi nó xong rồi thử lại.
        if (this.pushInFlight(order)) throw new PancakeApiError(`Đơn ${order.code} đang được đẩy sang Pancake — huỷ sau.`, true);
        const found = await this.findOnPancake(order);
        if (!found?.id) {
          const r = await this.prisma.order.updateMany({
            where: { id: order.id, pancakeOrderId: null },
            data: { pancakeCancelStatus: PANCAKE_CANCEL.NOT_FOUND, pancakePushClaimedAt: null, pancakeSyncError: null },
          });
          if (r.count === 0) throw new PancakeApiError(`Đơn ${order.code} vừa lên Pancake — huỷ lại theo mã đơn Pancake.`, true);
          return;
        }
        pancakeId = String(found.id);
        await this.prisma.order.updateMany({ where: { id: order.id, pancakeOrderId: null }, data: { pancakeOrderId: pancakeId } });
      }
      const outcome = await cancelPancakeOrder(this.client, pancakeId);
      if (outcome.kind === 'HANDED_OVER') {
        await this.setCancelStatus(order.id, PANCAKE_CANCEL.TOO_LATE);
        await flagPancakeAttention(
          this.prisma,
          this.alerts,
          order,
          `Đơn đã huỷ ở Tubu nhưng Pancake báo đã bàn giao vận chuyển (mã ${outcome.status}) — liên hệ đơn vị vận chuyển chặn giao/hoàn hàng và đối soát tiền.`,
          this.logger,
        );
        return;
      }
      await this.setCancelStatus(order.id, outcome.kind === 'NOT_FOUND' ? PANCAKE_CANCEL.NOT_FOUND : PANCAKE_CANCEL.CANCELLED);
      await clearPancakeAttention(this.prisma, order.id, ATTENTION_CANCEL_PENDING);
    } catch (err) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { pancakeSyncError: pancakeErrorText(err), ...(final ? { pancakeCancelStatus: PANCAKE_CANCEL.FAILED } : {}) },
      });
      if (final) {
        await flagPancakeAttention(
          this.prisma,
          this.alerts,
          order,
          `${ATTENTION_CANCEL_PENDING} (đơn Pancake #${order.pancakeOrderId ?? 'chưa rõ'}): ${pancakeErrorText(err)}. HUỶ TAY trên Pancake để kho không giao.`,
          this.logger,
        );
      }
      throw err;
    }
  }

  /** Đơn Pancake mang đúng mã đơn này (ưu tiên đơn còn sống, cũ nhất). Có nhiều đơn sống → báo admin đơn trùng. */
  private async findOnPancake(order: Pick<Order, 'id' | 'code'>): Promise<PancakeOrderDTO | null> {
    const matches = (await this.client.searchOrders(order.code)).filter((o) => o.id != null && pancakeOrderHasCode(o, order.code));
    if (matches.length === 0) return null;
    const alive = matches.filter((o) => !isPancakeCancelled(o.status));
    const pool = (alive.length > 0 ? alive : matches).sort((a, b) => String(a.inserted_at ?? '').localeCompare(String(b.inserted_at ?? '')));
    if (alive.length > 1) {
      await flagPancakeAttention(
        this.prisma,
        this.alerts,
        order,
        `Pancake có ${alive.length} đơn mang mã ${order.code} (${alive.map((o) => `#${o.id}`).join(', ')}). Đã gắn #${pool[0]!.id}; HUỶ các đơn trùng còn lại trên Pancake.`,
        this.logger,
      );
    }
    return pool[0]!;
  }

  private async adopt(order: OrderWithItems, found: PancakeOrderDTO): Promise<string> {
    const pancakeOrderId = String(found.id);
    this.logger.warn(`Đơn ${order.code} đã có trên Pancake (#${pancakeOrderId}) từ lần đẩy trước — gắn lại, không tạo đơn mới.`);
    // Đơn tìm thấy được tạo bởi lần thử trước, có thể trước khi khách trả tiền: để job thanh toán tự kiểm.
    await this.saveCreated(order, pancakeOrderId, false);
    return pancakeOrderId;
  }

  private async saveCreated(order: OrderWithItems, pancakeOrderId: string, paymentSynced: boolean): Promise<void> {
    const saved = await this.prisma.order.updateMany({
      where: { id: order.id, pancakeOrderId: null },
      data: {
        pancakeOrderId,
        pancakePushStatus: PANCAKE_PUSH.SYNCED,
        pancakePushClaimedAt: null,
        pancakeSyncError: null,
        pancakePaymentSynced: paymentSynced,
      },
    });
    if (saved.count === 0) return;
    await clearPancakeAttention(this.prisma, order.id, ATTENTION_PUSH_FAILED);
    // Đơn đổi trạng thái trong lúc đang tạo: huỷ ngay bên Pancake / báo đã thanh toán.
    const now = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    if (now.status === 'CANCELLED') {
      await this.requestCancel(now);
    } else if (now.paymentStatus === 'PAID' && !now.pancakePaymentSynced && isPrepaidMethod(now.paymentMethod)) {
      await this.enqueuePayment(now.id).catch((e) => this.logger.error(`Enqueue cập nhật thanh toán Pancake lỗi cho ${now.code}: ${pancakeErrorText(e)}`));
    }
  }

  private async requestCancel(order: Pick<Order, 'id' | 'code'>): Promise<void> {
    await this.setCancelStatus(order.id, PANCAKE_CANCEL.PENDING);
    await this.enqueueCancel(order.id).catch((e) =>
      this.logger.error(`Enqueue huỷ Pancake lỗi cho đơn ${order.code}: ${pancakeErrorText(e)} — cron cứu hộ thử lại.`),
    );
  }

  private async markStale(order: Pick<Order, 'id' | 'code' | 'status'>, why: string): Promise<void> {
    const r = await this.prisma.order.updateMany({
      where: { id: order.id, pancakeOrderId: null, NOT: { pancakePushStatus: PANCAKE_PUSH.STALE } },
      data: { pancakePushStatus: PANCAKE_PUSH.STALE },
    });
    if (r.count === 0) return;
    this.logger.warn(`Không tự đẩy đơn ${order.code} sang Pancake: ${why}.`);
  }

  private pushInFlight(order: Pick<Order, 'pancakePushStatus' | 'pancakeLastAttemptAt'>): boolean {
    return (
      order.pancakePushStatus === PANCAKE_PUSH.PUSHING &&
      order.pancakeLastAttemptAt != null &&
      Date.now() - order.pancakeLastAttemptAt.getTime() < PancakeOrderService.PUSH_LEASE_MS
    );
  }

  private setPushStatus(orderId: string, status: string) {
    return this.prisma.order.updateMany({ where: { id: orderId, pancakeOrderId: null }, data: { pancakePushStatus: status } });
  }

  private setPushError(orderId: string, err: unknown) {
    return this.prisma.order.update({ where: { id: orderId }, data: { pancakeSyncError: pancakeErrorText(err) } });
  }

  private setCancelStatus(orderId: string, status: string) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { pancakeCancelStatus: status, ...(status === PANCAKE_CANCEL.PENDING ? {} : { pancakeSyncError: null }) },
    });
  }

  /** Người nhận: snapshot địa chỉ của đơn; đơn đại lý cũ chỉ có ghi chú → lấy từ sổ địa chỉ / hồ sơ đại lý. */
  private async recipientOf(order: Pick<Order, 'code' | 'type' | 'userId' | 'shippingAddress'>): Promise<PancakeRecipient> {
    const snap = (order.shippingAddress ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof snap[k] === 'string' ? (snap[k] as string).trim() : '');
    let r: PancakeRecipient = {
      name: s('recipient'),
      phone: s('phone'),
      street: s('street'),
      ward: s('ward'),
      district: s('district'),
      province: s('province'),
      provinceCode: s('provinceCode'),
      districtCode: s('districtCode'),
      wardCode: s('wardCode'),
    };
    if ((!r.phone || !r.name) && order.type === 'DEALER') {
      const d = await resolveDealerRecipient(this.prisma, order.userId);
      if (d) r = { ...d, name: d.recipient };
    }
    if (!r.phone || !r.name || ![r.street, r.ward, r.province].some(Boolean)) {
      throw new PancakeOrderDataError(`Đơn ${order.code} thiếu tên, SĐT hoặc địa chỉ người nhận — bổ sung rồi đẩy lại.`);
    }
    return r;
  }

  private async variationsOf(order: OrderWithItems) {
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: order.items.map((i) => i.variationId) } },
      select: { id: true, pancakeId: true, retailPrice: true },
    });
    return new Map(variations.map((v) => [v.id, { pancakeId: v.pancakeId, retailPrice: v.retailPrice }]));
  }

  /** Đơn đại lý ghi công nợ — cùng điều kiện DealerService.confirmDealerOrderPayment dùng để nhận diện. */
  private async isOnDealerCredit(order: Pick<Order, 'id' | 'type'>): Promise<boolean> {
    if (order.type !== 'DEALER') return false;
    const debit = await this.prisma.dealerCreditLedger.findFirst({ where: { refType: 'ORDER', refId: order.id }, select: { id: true } });
    return debit !== null;
  }

  /**
   * Ghi chú thu gom cho kho (người đọc): tình trạng vận đơn Gomdon để kho biết có được tự đặt hãng vận chuyển hay
   * không — tag RECYCLING/GOMDON là bản máy đọc được của cùng thông tin.
   */
  private async buildRecyclingNote(order: OrderWithItems): Promise<string | null> {
    if (!order.hasRecyclingPickup) return null;
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: order.items.map((i) => i.variationId) } },
      select: { id: true, weight: true },
    });
    const fallback = await this.recyclingWeightFallback();
    const { maxKg } = recyclingWeight(order.items, new Map(variations.map((v) => [v.id, v.weight])), fallback);
    const noteDetail = order.recyclingNote?.trim() ? ` - Ghi chú: ${order.recyclingNote.trim()}` : '';
    const recyclingTag = `[ĐƠN ĐỔI HÀNG - THU GOM RÁC TÁI CHẾ TỐI ĐA ${maxKg}kg${noteDetail}]`;

    if (order.gomdonPartnerCode) {
      return `${recyclingTag} Mã VĐ Gomdon: ${order.gomdonPartnerCode} [ĐÃ CÓ VẬN ĐƠN - KHÔNG TẠO VẬN ĐƠN KHÁC]`;
    }
    if (order.gomdonStatus === GOMDON_STATE.AWAITING_PAYMENT) {
      return `${recyclingTag} [CHỜ THANH TOÁN - VẬN ĐƠN GOMDON TỰ TẠO SAU KHI KHÁCH THANH TOÁN, KHÔNG TẠO VẬN ĐƠN KHÁC]`;
    }
    if (
      order.gomdonStatus === GOMDON_STATE.NEEDS_MANUAL_CHECK ||
      order.gomdonStatus === GOMDON_STATE.CREATING ||
      order.gomdonStatus == null
    ) {
      return `${recyclingTag} [KIỂM TRA GOMDON (mã đơn ${order.code}) TRƯỚC KHI TẠO VẬN ĐƠN TAY]`;
    }
    return `${recyclingTag} [LỖI TẠO GOMDON - CẦN TẠO VẬN ĐƠN BẰNG TAY]`;
  }

  private async recyclingWeightFallback(): Promise<number> {
    if (!this.systemConfig) return DEFAULT_GOMDON_WEIGHT_FALLBACK;
    try {
      return (await loadGomdonConfig(this.systemConfig)).defaultWeightFallback;
    } catch {
      return DEFAULT_GOMDON_WEIGHT_FALLBACK;
    }
  }
}

export type PancakeCancelOutcome =
  | { kind: 'CANCELLED'; status: number | string | null }
  | { kind: 'NOT_FOUND' }
  | { kind: 'HANDED_OVER'; status: number | string };

/**
 * Huỷ một đơn Pancake theo D1: đọc trạng thái trước — đã bàn giao vận chuyển (Đã gửi hàng trở đi) thì KHÔNG huỷ;
 * đã huỷ/xoá thì coi như xong; còn lại PUT status=6. Pancake từ chối lệnh huỷ thì đọc lại trạng thái một lần: đã
 * bàn giao → HANDED_OVER, không thì ném để người gọi thử lại / báo huỷ tay.
 */
export async function cancelPancakeOrder(
  client: PancakeClient,
  pancakeOrderId: string,
  opts: { timeoutMs?: number } = {},
): Promise<PancakeCancelOutcome> {
  const current = await client.getOrder(pancakeOrderId, opts);
  if (!current) return { kind: 'NOT_FOUND' };
  if (isPancakeHandedOver(current.status)) return { kind: 'HANDED_OVER', status: current.status! };
  if (isPancakeCancelled(current.status)) return { kind: 'CANCELLED', status: current.status ?? null };
  try {
    const res = await client.updateOrder(pancakeOrderId, { status: PANCAKE_ORDER_STATUS.CANCELLED }, opts);
    return { kind: 'CANCELLED', status: res?.status ?? PANCAKE_ORDER_STATUS.CANCELLED };
  } catch (err) {
    if (err instanceof PancakeApiError && err.notFound) return { kind: 'NOT_FOUND' };
    if (err instanceof PancakeApiError && !err.transient) {
      const after = await client.getOrder(pancakeOrderId, opts);
      if (!after) return { kind: 'NOT_FOUND' };
      if (isPancakeHandedOver(after.status)) return { kind: 'HANDED_OVER', status: after.status! };
      if (isPancakeCancelled(after.status)) return { kind: 'CANCELLED', status: after.status ?? null };
    }
    throw err;
  }
}
