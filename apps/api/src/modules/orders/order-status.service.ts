import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { OrderStatus } from '@tubutree/shared-types';
import { QUEUE_GOMDON_PUSH } from '../../jobs/queues';
import { enqueueGomdonCancel, enqueueGomdonPush } from '../integrations/gomdon/gomdon-queue';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderReversalService } from './order-reversal.service';
import {
  assertPaidBeforeFulfilment,
  assertTransition,
  CancelAfterHandoverError,
  cancelHandover,
  canTransition,
  InvalidOrderTransitionError,
  isPrepaidMethod,
  requiresPaymentBefore,
  UnpaidPrepaidTransitionError,
} from './order-transition';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import {
  PancakeHandedOverError,
  PancakeSyncHooks,
  type PancakeCancelDecision,
} from '../integrations/pancake/pancake-sync-hooks';
import { resolvePancakeStatus } from '../integrations/pancake/pancake-status.map';
import { flagPancakeAttention } from '../integrations/pancake/pancake-attention';
import { notifyMerchantOwner } from './merchant-order-notify';

type StatusActor = 'ADMIN' | 'CUSTOMER' | 'MERCHANT' | 'PANCAKE' | 'SYSTEM';

export type OrderStatusPatch = Partial<
  Pick<Order, 'shippingPartner' | 'shippingCode' | 'trackingLink' | 'shippedAt' | 'merchantAcceptedAt'>
>;

/** Người bấm nhận 400 ngay trên màn hình; chỉ webhook/cron (bị nuốt lỗi êm) mới cần để lại dấu. */
function isHumanActor(actor: StatusActor | undefined): boolean {
  return actor === 'ADMIN' || actor === 'MERCHANT' || actor === 'CUSTOMER';
}

/**
 * PAID: lần gọi này lật thanh toán. ALREADY_PAID: đã PAID từ trước (bấm lặp / người khác thắng race).
 * CLOSED: đơn đã huỷ/trả khi CHƯA nhận tiền — tiền về muộn phải hoàn, không "hồi sinh" đơn. NOT_PAYABLE: đã
 * REFUNDED/FAILED (kể cả đơn đã huỷ/trả: khoản tiền đó đã đi theo luồng hoàn của đơn).
 */
export type MarkPaidOutcome = 'PAID' | 'ALREADY_PAID' | 'CLOSED' | 'NOT_PAYABLE';

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
    // Optional: test/call site cũ dựng tay 5 tham số vẫn chạy. Huỷ đơn thu gom tái chế → huỷ luôn
    // vận đơn Gomdon (queue gomdon-push job 'cancel', retry) — không import GomdonModule để tránh vòng.
    @Optional() @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue?: Queue,
    // Optional (như gomdonQueue ở trên): giữ nguyên các test/call site dựng tay constructor
    // bằng positional args không truyền analytics vẫn chạy được (undefined → bỏ qua ghi event).
    @Optional() private readonly analytics?: AnalyticsEventsService,
    // Optional như trên. Huỷ đơn đã lên Pancake phải huỷ cả bên Pancake (D1); tiền về thì báo Pancake không thu COD.
    @Optional() private readonly pancakeHooks?: PancakeSyncHooks,
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
    opts: {
      note?: string;
      notifyEvent?: string;
      /** Ai đổi — để lại vết trong order_status_history (mặc định SYSTEM). */
      actorType?: StatusActor;
      actorId?: string;
      /**
       * Chỉ đổi khi đơn vẫn UNPAID — guard nằm trong cùng câu lật trạng thái, nên tiền về (markPaid,
       * callback ZaloPay/Pancake) chen giữa lúc đọc và lúc lật thì lần đổi này trượt thay vì huỷ đơn
       * khách vừa trả.
       */
      onlyIfUnpaid?: boolean;
      /**
       * Chỉ đổi khi đơn vẫn ở trạng thái này. Caller quét danh sách rồi xử lý dần (cron) dùng để không tác động
       * lên đơn mà người khác vừa đẩy sang trạng thái khác sau lúc quét — setStatus tự đọc lại nên không tự biết.
       */
      expectedStatus?: OrderStatus;
      /**
       * Huỷ: hỏi Pancake trước (D1) — Pancake đã gửi hàng thì từ chối. Mặc định bật cho người bấm (admin/nhà bán/khách);
       * cron tự huỷ bật tường minh. Pancake báo huỷ (actor PANCAKE) không bao giờ hỏi lại Pancake.
       */
      pancakeGate?: boolean;
      /** Cột ghi cùng câu lật trạng thái (đối tác gửi hàng: hãng + mã vận đơn), không có cửa sổ ghi nửa chừng. */
      patch?: OrderStatusPatch;
      /** Biến thêm cho mẫu tin `notifyEvent` (ví dụ lý do đối tác huỷ). */
      notifyData?: Record<string, string>;
      /**
       * Huỷ vì hàng đã HOÀN VỀ người gửi (Pancake "Đã hoàn", gian hàng báo giao không thành công): đây là luồng hoàn
       * của D1 nên được huỷ dù đơn đã bàn giao vận chuyển. Mọi đường huỷ khác bị chặn sau mốc bàn giao.
       */
      returnedToSender?: boolean;
    } = {},
  ) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { code: orderId }] },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');

    if (order.status === targetStatus) return order; // no-op idempotent (webhook lặp lại)
    if (opts.onlyIfUnpaid && order.paymentStatus !== 'UNPAID') return order;
    if (opts.expectedStatus && order.status !== opts.expectedStatus) return order;
    const from = order.status as OrderStatus;
    assertTransition(from, targetStatus);
    const paymentGated =
      requiresPaymentBefore(from, targetStatus) && isPrepaidMethod(order.paymentMethod) && order.paymentStatus !== 'PAID';
    if (paymentGated) {
      try {
        assertPaidBeforeFulfilment({ ...order, onCredit: await this.isOnDealerCredit(order.id) }, from, targetStatus);
      } catch (err) {
        if (err instanceof UnpaidPrepaidTransitionError && !isHumanActor(opts.actorType)) {
          await this.flagDroppedStatus(order.id, order.code, targetStatus);
        }
        throw err;
      }
    }

    if (targetStatus === 'CANCELLED' && !opts.returnedToSender) {
      const handover = cancelHandover(order);
      if (handover) {
        const err = new CancelAfterHandoverError(order.code, from, handover);
        // Webhook Pancake tự đưa vào "Cần xử lý" (có báo động); cron/hệ thống không có ai đọc lỗi nên ghi dấu ở đây.
        if (opts.actorType === 'SYSTEM' || opts.actorType === undefined) {
          await flagPancakeAttention(this.prisma, undefined, order, `Hệ thống: ${err.message}`, this.logger);
        }
        throw err;
      }
    }

    const pancakeDecision =
      targetStatus === 'CANCELLED' && opts.actorType !== 'PANCAKE' && (opts.pancakeGate ?? isHumanActor(opts.actorType))
        ? await this.precheckPancakeCancel(order, opts.actorType === 'CUSTOMER' ? 'CUSTOMER' : isHumanActor(opts.actorType) ? 'STAFF' : 'SYSTEM')
        : undefined;

    // D1 trong cùng câu lật: webhook gán mã vận đơn / Gomdon báo đã lấy hàng / nhà bán báo đã gửi chen giữa lúc đọc
    // và lúc lật thì lần huỷ này trượt (rồi báo lỗi bàn giao ở dưới), không hoàn tiền cho hàng đang nằm ở hãng.
    const handoverGuard =
      targetStatus === 'CANCELLED' && !opts.returnedToSender
        ? Object.fromEntries(
            Object.entries({ shippedAt: order.shippedAt, shippingCode: order.shippingCode, gomdonStatus: order.gomdonStatus }).filter(
              ([, v]) => v !== undefined,
            ),
          )
        : {};

    // Atomic flip guard theo status hiện tại — 2 caller song song (vd admin + webhook)
    // chỉ 1 bên thắng (count===1), bên thua bail êm để không chạy side-effect 2 lần.
    const won = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.order.updateMany({
        // Đã PAID lúc đọc mà bị hoàn/huỷ thanh toán chen giữa thì không được giao tiếp trên ảnh chụp cũ.
        where: {
          id: order.id,
          status: order.status,
          ...handoverGuard,
          ...(requiresPaymentBefore(from, targetStatus) && order.paymentStatus === 'PAID' ? { paymentStatus: 'PAID' as const } : {}),
          ...(opts.onlyIfUnpaid ? { paymentStatus: 'UNPAID' as const } : {}),
        },
        data: {
          status: targetStatus,
          // Mốc giao thật — hạn đổi/trả tính từ đây (không dùng updatedAt: ghi gì sau đó cũng đổi nó).
          ...(targetStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
          ...(opts.patch ?? {}),
          // opts.note chỉ ghi vào order_status_history (dưới): Order.note là ghi chú khách tự viết lúc đặt và
          // hiện nguyên văn trên trang đơn của khách.
        },
      });
      if (flip.count === 0) return false;

      // Ghi vết TRONG cùng transaction với lần lật trạng thái: đổi trạng thái trước đây chỉ để
      // lại một dòng log ứng dụng (xoay vòng theo container) và một chuỗi note nối thêm, không
      // có actor. Một tài khoản admin bị chiếm chuyển 50 đơn đã giao sang CANCELLED là mỗi đơn
      // tự động hoàn tổng tiền vào ví khách, mà sau đó không truy được ai làm gì.
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: targetStatus,
          actorType: opts.actorType ?? 'SYSTEM',
          actorId: opts.actorId ?? null,
          note: opts.note ?? null,
        },
      });

      if (this.analytics) {
        await this.analytics.record(tx, {
          eventName: 'order_status_changed',
          userId: order.userId,
          platform: 'system',
          props: {
            orderId: order.id,
            from: order.status,
            to: targetStatus,
            actorType: opts.actorType ?? 'SYSTEM',
            reason: opts.note ?? null,
          },
        });
      } else {
        // Không nên xảy ra trong app thật (AnalyticsModule @Global() luôn cấp được) — chỉ
        // rơi vào nhánh này khi test/call site dựng constructor bằng tay không truyền.
        // Cảnh báo để lộ ra ngay nếu một ngày DI thật sự thiếu, thay vì no-op câm lặng.
        this.logger.warn(
          `AnalyticsEventsService không được inject — bỏ qua ghi event order_status_changed cho đơn ${order.code}.`,
        );
      }

      if (targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') {
        await this.reversal.reverseFinancials(tx, order);
      }
      return true;
    });
    if (!won) {
      this.logger.warn(`setStatus thua race: đơn ${order.code} đã đổi trạng thái bởi request khác.`);
      const current = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      const handover = targetStatus === 'CANCELLED' && !opts.returnedToSender && current.status !== 'CANCELLED' ? cancelHandover(current) : null;
      if (handover) throw new CancelAfterHandoverError(order.code, current.status as OrderStatus, handover);
      return current;
    }

    // Side-effect điểm/hoa hồng — idempotent qua unique index riêng, an toàn để NGOÀI tx
    // (nếu crash giữa chừng, retry sẽ thấy status đã bằng targetStatus → bail ở no-op phía
    // trên NHƯNG side-effect chưa chạy — đây là đánh đổi đã biết; các hàm credit/reverse tự kiểm tra
    // lại nên gọi lại là an toàn, nhưng hiện CHƯA có endpoint resync nào để gọi). Vì vậy phần tiền trả
    // trước (Điểm Xanh lô quy đổi) KHÔNG nằm ở đây mà hoàn trong tx ở reverseFinancials.
    if (targetStatus === 'DELIVERED') {
      await this.loyalty.creditOrderPoints(order.id);
      await this.affiliate.lockCommissionsForOrder(order.id);
      // Đơn đã giao (commit ở trên) nên lỗi khoá/deadlock khi xét thưởng không được làm hỏng
      // setStatus: retry Pancake sẽ thấy no-op và bỏ qua notify. Thưởng tự xét lại từ DB ở lần giao
      // đơn kế tiếp của người được mời.
      await this.affiliate.grantReferralReward(order.id).catch((e: unknown) => {
        this.logger.error(
          `Xét thưởng giới thiệu cho đơn ${order.code} lỗi: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    } else if (targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') {
      await this.loyalty.reverseOrderPoints(order.id);
      await this.affiliate.reverseCommissionsForOrder(order.id);
    }
    if (targetStatus === 'CANCELLED') {
      await this.enqueueGomdonCancel(order);
      if (opts.actorType !== 'PANCAKE') await this.pancakeHooks?.afterLocalCancel(order.id, pancakeDecision);
      if (opts.actorType !== 'MERCHANT') {
        await notifyMerchantOwner(this.prisma, this.notifications, this.logger, order.id, 'MERCHANT_ORDER_CANCELLED', {
          order_code: order.code,
          reason: opts.note ?? 'Không có lý do',
        });
      }
    }

    // Điểm Xanh chỉ được cộng khi đơn có pointsEarned > 0 (đơn XU cũ, đơn CTV lên hộ thì không): lời tin
    // ORDER_DELIVERED chỉ nhắc điểm khi thật sự có, qua {{points_note}}.
    const notifyData: Record<string, string> = { ...opts.notifyData, order_code: order.code };
    if (targetStatus === 'DELIVERED' && order.pointsEarned > 0) {
      notifyData.points_note = ` Bạn được cộng ${order.pointsEarned} Điểm Xanh.`;
    }
    await this.notifications
      .notify(order.userId, opts.notifyEvent ?? `ORDER_${targetStatus}`, notifyData)
      .catch(() => undefined);

    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  }

  /**
   * Ghi nhận ĐÃ NHẬN TIỀN cho đơn trả trước: UNPAID → PAID (+ paidAt), PENDING_PAYMENT → CONFIRMED; ghi
   * lịch sử (ai/lúc nào) + event `order_paid` trong cùng transaction; sau commit đặt bưu tá thu gom
   * (đơn thu gom chờ tiền mới đặt) và báo khách. Không cộng điểm/hoa hồng — đó là việc của DELIVERED.
   *
   * Guard atomic theo (paymentStatus=UNPAID, status vừa đọc): hai admin bấm cùng lúc, hay admin và
   * webhook, chỉ một bên lật và chạy hệ quả. Bên thua đọc lại để trả đúng kết quả (đã PAID / đơn vừa
   * bị huỷ) thay vì báo lỗi; trạng thái vừa đổi do bên khác (vd PENDING_PAYMENT → CONFIRMED mà chưa
   * trả) thì thử lại với ảnh chụp mới.
   */
  async markPaid(
    orderIdOrCode: string,
    opts: { actorType: StatusActor; actorId?: string; note?: string },
  ): Promise<{ outcome: MarkPaidOutcome; order: Order }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const order = await this.prisma.order.findFirst({ where: { OR: [{ id: orderIdOrCode }, { code: orderIdOrCode }] } });
      if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
      if (order.paymentStatus === 'PAID') return { outcome: 'ALREADY_PAID', order };
      if (order.paymentStatus !== 'UNPAID') return { outcome: 'NOT_PAYABLE', order };
      if (order.status === 'CANCELLED' || order.status === 'RETURNED') return { outcome: 'CLOSED', order };

      const toStatus = order.status === 'PENDING_PAYMENT' ? 'CONFIRMED' : order.status;
      const won = await this.prisma.$transaction(async (tx) => {
        // paidAt (cột) và occurredAt (event) dùng chung một mốc.
        const paidAt = new Date();
        const flip = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: 'UNPAID', status: order.status },
          data: { paymentStatus: 'PAID', paidAt, ...(toStatus !== order.status ? { status: toStatus } : {}) },
        });
        if (flip.count === 0) return false;
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus,
            actorType: opts.actorType,
            actorId: opts.actorId ?? null,
            note: ['Đã nhận tiền (UNPAID → PAID)', opts.note].filter(Boolean).join(' · '),
          },
        });
        if (this.analytics) {
          await this.analytics.record(tx, {
            eventName: 'order_paid',
            userId: order.userId,
            platform: order.platform === 'web' ? 'web' : 'miniapp',
            occurredAt: paidAt,
            props: { orderId: order.id, method: order.paymentMethod, amount: order.total },
          });
        }
        return true;
      });
      if (!won) continue;

      if (order.hasRecyclingPickup && this.gomdonQueue) {
        // Lỗi enqueue không được làm hỏng việc đã lật PAID — GomdonReconcileService quét
        // AWAITING_PAYMENT + PAID và enqueue lại.
        await enqueueGomdonPush(this.gomdonQueue, order.id).catch((err) =>
          this.logger.error(
            `Enqueue vận đơn Gomdon sau thanh toán lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`,
          ),
        );
      }
      await this.pancakeHooks?.afterPaid(order.id);
      await this.notifications
        .notify(order.userId, 'ORDER_CONFIRMED', { order_code: order.code })
        .catch(() => undefined);
      return {
        outcome: 'PAID',
        order: await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      };
    }
    throw new ConflictException('Đơn đang thay đổi trạng thái liên tục — vui lòng tải lại rồi thử lại.');
  }

  /**
   * Webhook (Pancake/Gomdon) báo trạng thái vận đơn cho đơn trả trước chưa PAID bị chặn và nuốt êm, không phát lại
   * sau khi tiền về — đơn sẽ đứng yên ở trạng thái cũ. Để lại dấu trên ghi chú đơn (mỗi trạng thái một lần, webhook
   * retry không nhân bản) để sau khi xác nhận "Đã nhận tiền" admin biết cần đẩy tiếp tay. Best-effort: lỗi ghi dấu
   * không được thay lỗi chuyển trạng thái gốc (webhook dựa vào loại lỗi đó để bỏ qua êm).
   */
  private async flagDroppedStatus(orderId: string, code: string, target: OrderStatus): Promise<void> {
    const marker = `[Chờ thanh toán: vận chuyển đã báo ${target} — đẩy tay sau khi nhận tiền]`;
    try {
      await this.prisma.$executeRaw`
        UPDATE "orders"
        SET "note" = CASE WHEN "note" IS NULL OR "note" = '' THEN ${marker} ELSE "note" || ' | ' || ${marker} END
        WHERE "id" = ${orderId} AND ("note" IS NULL OR position(${marker} in "note") = 0)`;
      this.logger.warn(`Đơn ${code} chưa thanh toán nhưng vận chuyển báo ${target} — đã ghi chú để admin đẩy tay sau khi nhận tiền.`);
    } catch (err) {
      this.logger.error(`Không ghi được dấu trạng thái bị chặn cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Hỏi Pancake trước khi huỷ (D1). Pancake đã gửi hàng → đồng bộ lại trạng thái theo Pancake rồi từ chối huỷ; cron
   * (không có người đọc lỗi) thì đưa đơn vào "Cần xử lý Pancake". Khách và người vận hành nhận lời báo khác nhau: khách
   * được bảo liên hệ CSKH, còn CSKH/kho cần biết phải làm gì với hãng vận chuyển.
   */
  async precheckPancakeCancel(order: Order, asker: 'CUSTOMER' | 'STAFF' | 'SYSTEM'): Promise<PancakeCancelDecision | undefined> {
    if (!this.pancakeHooks) return undefined;
    try {
      return await this.pancakeHooks.precheckCancel(order);
    } catch (err) {
      if (!(err instanceof PancakeHandedOverError)) throw err;
      await this.resyncFromPancake(order, err.pancakeStatus);
      if (asker === 'STAFF') {
        throw new BadRequestException(
          `Pancake báo đã gửi hàng (mã ${err.pancakeStatus}) — đơn ${order.code} không huỷ được nữa, đã đồng bộ về trạng thái theo Pancake. ` +
            'Liên hệ đơn vị vận chuyển để chặn giao/hoàn hàng; hàng hoàn về kho thì đơn tự huỷ và hoàn tiền.',
        );
      }
      if (asker === 'SYSTEM') {
        await flagPancakeAttention(
          this.prisma,
          undefined,
          order,
          `Hệ thống không tự huỷ được đơn: Pancake báo đã bàn giao vận chuyển (mã ${err.pancakeStatus}). Kiểm tra thanh toán và giao hàng.`,
          this.logger,
        );
      }
      throw new BadRequestException(err.message);
    }
  }

  /** Sau khi đơn đã huỷ ở Tubu bằng đường riêng (khách tự huỷ): ghi kết quả huỷ Pancake / xếp job huỷ. */
  async afterPancakeCancel(orderId: string, decision?: PancakeCancelDecision): Promise<void> {
    await this.pancakeHooks?.afterLocalCancel(orderId, decision);
  }

  /** Áp trạng thái Pancake đang báo (vd Đã gửi hàng → SHIPPING) — best-effort, lỗi chuyển trạng thái chỉ log. */
  private async resyncFromPancake(order: Order, pancakeStatus: number | string): Promise<void> {
    const action = resolvePancakeStatus(pancakeStatus);
    if (action?.kind !== 'status' || action.status === order.status) return;
    try {
      await this.setStatus(order.id, action.status, { actorType: 'PANCAKE', note: 'Đồng bộ trạng thái Pancake khi yêu cầu huỷ' });
    } catch (err) {
      this.logger.warn(`Không đồng bộ được trạng thái Pancake ${pancakeStatus} cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Đơn đại lý ghi công nợ — cùng điều kiện DealerService.confirmDealerOrderPayment dùng để nhận diện. */
  private async isOnDealerCredit(orderId: string): Promise<boolean> {
    const debit = await this.prisma.dealerCreditLedger.findFirst({
      where: { refType: 'ORDER', refId: orderId },
      select: { id: true },
    });
    return debit !== null;
  }

  /**
   * Đơn có chọn thu gom tái chế bị huỷ (admin/merchant/Pancake onCancelled...) → enqueue huỷ vận đơn
   * Gomdon. Best-effort: đơn đã CANCELLED + hoàn tiền xong, lỗi enqueue chỉ log — cron
   * GomdonReconcileService quét đơn CANCELLED còn vận đơn chưa huỷ và enqueue lại.
   */
  private async enqueueGomdonCancel(order: { id: string; code: string; hasRecyclingPickup?: boolean | null }) {
    if (!order.hasRecyclingPickup || !this.gomdonQueue) return;
    try {
      await enqueueGomdonCancel(this.gomdonQueue, order.id);
    } catch (err) {
      this.logger.error(`Enqueue huỷ vận đơn Gomdon lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

export { InvalidOrderTransitionError };

/** Chuyển InvalidOrderTransitionError → 400 cho HTTP caller (admin/merchant controller). */
export function toHttpBadRequest(err: unknown): never {
  if (err instanceof InvalidOrderTransitionError) throw new BadRequestException(err.message);
  throw err;
}
