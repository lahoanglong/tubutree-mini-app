import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { formatPoints } from '../../common/format-points';
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
import { OrderReversalService, type ReversalResult } from './order-reversal.service';
import { partialReturnTotals } from './return-ledger';
import { recordCodReturnUnverified } from './refund-queue';
import { refundNote } from './order-returns.service';
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
  PANCAKE_UNREACHABLE_MESSAGE,
  PancakeHandedOverError,
  PancakeSyncHooks,
  PancakeUnreachableError,
  type PancakeCancelDecision,
} from '../integrations/pancake/pancake-sync-hooks';
import { PANCAKE_RETURNING_PREFIX, resolvePancakeStatus } from '../integrations/pancake/pancake-status.map';
import { PANCAKE_CANCEL } from '../integrations/pancake/pancake-order.service';
import {
  ATTENTION_CANCEL_AFTER_HANDOVER,
  ATTENTION_CANCELLED_ON_PANCAKE_ONLY,
  ATTENTION_COD_RETURN_UNVERIFIED,
  ATTENTION_UNDERPAID,
  appendAttentionReason,
  clearPancakeAttention,
  flagPancakeAttention,
  removeAttentionReasonsByPrefix,
} from '../integrations/pancake/pancake-attention';
import { GOMDON_ALERT_KIND, GomdonAlertService, resolveGomdonAlertKinds } from '../integrations/gomdon/gomdon-alert.service';
import { gomdonOwnsShipping } from '../integrations/gomdon/gomdon-status';
import { receivedRefundNote, recordedPancakeUnderpayment, refundReportedUnderpayment } from './refund-queue';
import { notifyMerchantOwner } from './merchant-order-notify';
import { sendReferralNotices } from '../wallet/referral-notify';
import { WastePickupHooks } from '../waste-exchange/pickup/waste-pickup-hooks.service';
import { markReversalEffectsDone } from './reversal-effects';

/** Mã lỗi (body.code) khi người bấm huỷ mà kho Pancake chưa trả lời — client có thể gợi ý thử lại. */
export const PANCAKE_UNREACHABLE = 'PANCAKE_UNREACHABLE';

type StatusActor = 'ADMIN' | 'CUSTOMER' | 'MERCHANT' | 'PANCAKE' | 'SYSTEM';

export type OrderStatusPatch = Partial<
  Pick<Order, 'shippingPartner' | 'shippingCode' | 'trackingLink' | 'shippedAt' | 'merchantAcceptedAt'>
>;

/** Người bấm nhận 400 ngay trên màn hình; chỉ webhook/cron (bị nuốt lỗi êm) mới cần để lại dấu. */
function isHumanActor(actor: StatusActor | undefined): boolean {
  return actor === 'ADMIN' || actor === 'MERCHANT' || actor === 'CUSTOMER';
}

/** Lý do huỷ chủ gian hàng đọc được — ghi chú nội bộ (cron/admin: gợi ý hoàn tay, đối chiếu cổng…) không bao giờ ra ngoài. */
const MERCHANT_CANCEL_REASON: Record<StatusActor, string> = {
  CUSTOMER: 'Khách huỷ đơn',
  ADMIN: 'Tubu Tree huỷ đơn',
  MERCHANT: 'Gian hàng huỷ đơn',
  PANCAKE: 'Kho Pancake báo huỷ đơn',
  SYSTEM: 'Hệ thống tự huỷ đơn quá hạn thanh toán',
};

/** Đơn trả trước chưa nhận tiền mà hàng đã đi: không còn huỷ được (D1), chỉ còn hai lối ra cho người vận hành. */
function unpaidExitHint(order: Pick<Order, 'paymentStatus'>): string {
  if (order.paymentStatus !== 'UNPAID') return '';
  return (
    ' Đơn CHƯA thanh toán — hệ thống thôi tự huỷ đơn này. Khách trả tiền (chuyển khoản, hoặc hãng thu hộ khi giao) thì bấm ' +
    '"Đã nhận tiền" để đơn đi tiếp; khách không nhận thì chặn giao với hãng, hàng về kho Pancake báo "Đã hoàn" thì đơn tự huỷ.'
  );
}

const GOMDON_HOLD_HINT =
  ' Đơn có vận đơn Gomdon đang chạy (thu gom tái chế) nên trạng thái đang giao/đã giao chỉ theo Gomdon — hệ thống KHÔNG tự chốt theo Pancake. ' +
  'Hỏi kho: hàng chưa được bưu tá lấy thì kho Pancake đã bấm gửi/hoàn thành nhầm.';

/** Ai hỏi huỷ khi Pancake báo đã bàn giao — mở đầu lý do "Cần xử lý Pancake". */
const HANDOVER_ASKER: Record<'CUSTOMER' | 'STAFF' | 'SYSTEM', string> = {
  SYSTEM: 'Hệ thống không tự huỷ được đơn:',
  CUSTOMER: 'Khách bấm huỷ nhưng',
  STAFF: 'Người vận hành bấm huỷ nhưng',
};

/**
 * PAID: lần gọi này lật thanh toán. ALREADY_PAID: đã PAID từ trước (bấm lặp / người khác thắng race).
 * CLOSED: đơn đã huỷ/trả khi CHƯA nhận tiền — tiền về muộn phải hoàn, không "hồi sinh" đơn. NOT_PAYABLE: đã
 * REFUNDED/FAILED (kể cả đơn đã huỷ/trả: khoản tiền đó đã đi theo luồng hoàn của đơn).
 */
export type MarkPaidOutcome = 'PAID' | 'ALREADY_PAID' | 'CLOSED' | 'NOT_PAYABLE';

/** Kết quả chạy việc sau giao: pointsCredited/commissionsLocked = lần chạy này có làm gì (false/0 khi đã làm từ trước). */
export type DeliveredEffectsResult =
  | { outcome: 'NOT_DELIVERED' | 'ALREADY_DONE' }
  | { outcome: 'DONE'; pointsCredited: boolean; commissionsLocked: number }
  | { outcome: 'INCOMPLETE'; pointsCredited: boolean; commissionsLocked: number; error: string };

export type ReversalEffectsResult =
  | { outcome: 'NOT_CLOSED' | 'ALREADY_DONE' }
  | { outcome: 'DONE' }
  | { outcome: 'INCOMPLETE'; error: string };

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
  private alerts?: GomdonAlertService;

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
    // Optional như các tham số trên: call site dựng tay không truyền thì bỏ qua hook thu kèm rác.
    @Optional() private readonly wastePickupHooks?: WastePickupHooks,
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
      /**
       * Trả hàng đơn COD mà DELIVERED chưa phải bằng chứng đã thu tiền (Pancake báo hàng hoàn về, kho có thể đã bấm "Đã nhận"
       * nhầm): đảo kho/điểm/hoa hồng như thường nhưng KHÔNG tự hoàn Ví; cùng tx ghi khoản chờ Kế toán đối soát (RETURN, UNVERIFIED)
       * và đưa đơn vào "Cần xử lý Pancake". Chỉ có tác dụng với COD đang DELIVERED → RETURNED.
       */
      withholdCodRefund?: boolean;
      /** Lý do người vận hành nhập khi huỷ/trả — khách đọc nguyên văn trong tin báo (ghi chú nội bộ ở `note`). */
      customerReason?: string;
    } = {},
  ) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { code: orderId }] },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');

    if (order.status === targetStatus) {
      // no-op idempotent (webhook lặp lại). DELIVERED lặp mà việc sau giao chưa xong (lần trước lỗi/chết sau commit) thì làm
      // nốt — best-effort như lần gọi lặp vẫn luôn êm; còn sót thì DeliveredEffectsResyncCron làm.
      if (targetStatus === 'DELIVERED' && !order.deliveredEffectsAt) {
        await this.runDeliveredEffects(order).catch((err: unknown) =>
          this.logger.warn(`Gọi lại DELIVERED cho đơn ${order.code}: việc sau giao vẫn lỗi (${err instanceof Error ? err.message : err}) — cron sẽ chạy lại.`),
        );
      }
      // Huỷ/trả lặp lại: lần trước có thể đã commit nhưng đảo điểm/hoa hồng lỗi (người gọi nhận lỗi và gọi lại). Hai việc này
      // idempotent nên chạy lại là đủ; xếp lệnh huỷ Pancake và báo khách đã đi ở lần đầu, không làm lại. Vẫn lỗi thì ném tiếp
      // để webhook được thử lại thay vì coi như xong.
      if (targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') {
        const { failure } = await this.reverseClosedOrderEffects(order);
        if (failure !== null) throw failure;
      }
      return order;
    }
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
        // Đơn đã có mốc thôi tự huỷ thì lần nhắc đầu đã nói "hàng đã đi, chưa nhận tiền" — "Đã gửi hàng" báo lại không phải
        // việc mới, không đưa đơn admin đã xử lý về hàng đợi (R5-SYNC-1). Trạng thái sau đó (đã giao…) vẫn nhắc.
        const alreadyFlagged = targetStatus === 'SHIPPING' && !!order.autoCancelBlockedAt;
        if (err instanceof UnpaidPrepaidTransitionError && !isHumanActor(opts.actorType) && !alreadyFlagged) {
          await this.flagDroppedStatus(order.id, order.code, targetStatus);
        }
        throw err;
      }
    }

    const handoverOpts = { pancakeReportedCancel: opts.actorType === 'PANCAKE' };
    if (targetStatus === 'CANCELLED' && !opts.returnedToSender) {
      const handover = cancelHandover(order, handoverOpts);
      if (handover) {
        const err = new CancelAfterHandoverError(order.code, from, handover);
        // Webhook Pancake tự đưa vào "Cần xử lý" (có báo động); cron/hệ thống không có ai đọc lỗi nên ghi dấu ở đây.
        if (opts.actorType === 'SYSTEM' || opts.actorType === undefined) {
          await this.blockAutoCancel(order, `Hệ thống: ${err.message}${unpaidExitHint(order)}`);
        }
        throw err;
      }
    }

    const pancakeDecision =
      targetStatus === 'CANCELLED' && opts.actorType !== 'PANCAKE' && (opts.pancakeGate ?? isHumanActor(opts.actorType))
        ? await this.precheckPancakeCancel(order, opts.actorType === 'CUSTOMER' ? 'CUSTOMER' : isHumanActor(opts.actorType) ? 'STAFF' : 'SYSTEM')
        : undefined;

    // D1 trong cùng câu lật: webhook gán mã vận đơn / Gomdon báo đã lấy hàng / nhà bán báo đã gửi chen giữa lúc đọc
    // và lúc lật thì lần huỷ này trượt (rồi báo lỗi bàn giao ở dưới), không hoàn tiền cho hàng đang nằm ở hãng. Pancake tự
    // báo huỷ thì mã vận đơn không phải mốc bàn giao (xem cancelHandover) nên không ràng cột đó.
    const handoverGuard =
      targetStatus === 'CANCELLED' && !opts.returnedToSender
        ? Object.fromEntries(
            Object.entries({
              shippedAt: order.shippedAt,
              ...(handoverOpts.pancakeReportedCancel ? {} : { shippingCode: order.shippingCode }),
              gomdonStatus: order.gomdonStatus,
            }).filter(([, v]) => v !== undefined),
          )
        : {};

    // Hạn của điểm thường hoàn lại đọc NGOÀI tx (không giữ kết nối tx trong lúc chờ cấu hình); đơn không dùng điểm thường thì bỏ qua.
    const standardPointsExpiresAt =
      (targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') && order.pointsUsed > order.pointsUsedConverted
        ? await this.loyalty.pointsExpiresAt(new Date())
        : undefined;

    // Atomic flip guard theo status hiện tại — 2 caller song song (vd admin + webhook)
    // chỉ 1 bên thắng (count===1), bên thua bail êm để không chạy side-effect 2 lần.
    let reversed: ReversalResult | null = null;
    // Pancake đã nhận lệnh huỷ trước lần lật này: lỗi/thua ở đây để đơn Tubu còn sống mà kho không còn đơn.
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
      // Gộp phiên khách đổi orders.userId mà không đổi trạng thái, nên có thể commit giữa lúc đọc đơn (ngoài tx) và lúc lật:
      // đọc lại chủ đơn dưới khoá dòng vừa lấy để hoàn ví/điểm và thu hồi giới thiệu theo chủ hiện tại, không theo khách đã gộp.
      order.userId = (await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { userId: true } })).userId;

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
        const withholdCod = opts.withholdCodRefund === true && order.paymentMethod === 'COD' && from === 'DELIVERED' && targetStatus === 'RETURNED';
        const reversalOpts = {
          ...(withholdCod ? { withholdCodRefund: true } : {}),
          ...(standardPointsExpiresAt ? { standardPointsExpiresAt } : {}),
        };
        reversed =
          Object.keys(reversalOpts).length > 0
            ? await this.reversal.reverseFinancials(tx, order, reversalOpts)
            : await this.reversal.reverseFinancials(tx, order);
        // Cùng tx: ghi sau commit mà chết giữa chừng thì đơn đã RETURNED, không tiền hoàn, và không ai biết phải kiểm.
        if (withholdCod) {
          const prior = await partialReturnTotals(tx, order.id);
          const unverified = Math.max(0, order.total - prior.money);
          // Đã trả đủ bằng các lần trả một phần thì không còn gì để hoàn, không cần kiểm.
          if (unverified > 0) {
            await recordCodReturnUnverified(tx, order, unverified);
            // Lý do "ĐANG HOÀN" tự xong khi hàng đã về; mọi lý do khác (vd lệch tổng tiền) còn cần cho người quyết số hoàn.
            const kept = order.pancakeAttention?.startsWith(PANCAKE_RETURNING_PREFIX) ? null : order.pancakeAttention;
            await tx.order.updateMany({
              where: { id: order.id },
              data: { pancakeAttention: appendAttentionReason(kept, ATTENTION_COD_RETURN_UNVERIFIED), pancakeAttentionAt: new Date() },
            });
          }
        }
      }
      return true;
    }).catch(async (err: unknown) => {
      await this.flagPancakeCancelDivergence(order.id, pancakeDecision, `lần huỷ ở Tubu lỗi: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    });
    if (!won) {
      this.logger.warn(`setStatus thua race: đơn ${order.code} đã đổi trạng thái bởi request khác.`);
      const current = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      await this.flagPancakeCancelDivergence(order.id, pancakeDecision, `đơn đổi trạng thái/thanh toán/vận đơn trong lúc huỷ, nay ${current.status} + ${current.paymentStatus}`);
      const handover = targetStatus === 'CANCELLED' && !opts.returnedToSender && current.status !== 'CANCELLED' ? cancelHandover(current, handoverOpts) : null;
      if (handover) throw new CancelAfterHandoverError(order.code, current.status as OrderStatus, handover);
      // Đơn vừa bị huỷ/trả chen giữa mà nguồn khác báo đang giao/đã giao: đúng lỗi như lúc đọc tuần tự, để webhook đưa
      // vào "Cần xử lý" (hàng có thể đang đi tới khách trong khi tiền đã hoàn) thay vì coi là xong.
      const closed = current.status === 'CANCELLED' || current.status === 'RETURNED';
      if (closed && (targetStatus === 'SHIPPING' || targetStatus === 'DELIVERED')) {
        throw new InvalidOrderTransitionError(current.status as OrderStatus, targetStatus);
      }
      return current;
    }
    if (targetStatus === 'CANCELLED') {
      await this.wastePickupHooks?.onOrderCancelled(order.id).catch((err: unknown) => this.logger.error(`Hook thu kèm rác (huỷ) lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
    }
    if (targetStatus === 'DELIVERED') {
      await this.wastePickupHooks?.onOrderDelivered(order.id).catch((err: unknown) => this.logger.error(`Hook thu kèm rác (giao) lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
    }
    await sendReferralNotices(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      (reversed as ReversalResult | null)?.referralNotices ?? [],
    );

    // Side-effect điểm/hoa hồng — idempotent qua unique index riêng, an toàn để NGOÀI tx. Crash/lỗi giữa chừng sau commit
    // (retry thấy status đã bằng targetStatus) không còn mất việc: DELIVERED chỉ có mốc deliveredEffectsAt khi mọi việc sau
    // giao xong, thiếu mốc thì lần gọi DELIVERED lặp hoặc DeliveredEffectsResyncCron chạy lại (resyncDeliveredEffects). Phần
    // tiền trả trước và điểm đã dùng (Điểm Xanh lô quy đổi và lô thường) vẫn KHÔNG nằm ở đây mà hoàn trong tx ở reverseFinancials.
    if (targetStatus === 'DELIVERED') {
      await this.runDeliveredEffects(order);
    }
    let standardPointsBack = 0;
    let receivedBack = 0;
    // Lỗi đảo điểm/hoa hồng không được chặn xếp lệnh huỷ Pancake, báo merchant, báo khách ở dưới (đơn đã CANCELLED, lần gọi lại
    // không còn đi đường này): ghi nhận rồi ném SAU CÙNG để người gọi biết mà thử lại (nhánh idempotent ở đầu hàm).
    let closedEffectsFailure: unknown = null;
    // Hai bước sau commit mà lỗi bị nuốt (không được làm hỏng lần huỷ đã commit) nhưng cũng không được coi là xong: ghi mốc thì cron
    // không còn thấy đơn, khoản hoàn số tiền chuyển thiếu hay lệnh huỷ Pancake mất luôn.
    let swallowedFailure = false;
    if (targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') {
      const done = await this.reverseClosedOrderEffects(order);
      standardPointsBack = done.standardPointsBack;
      closedEffectsFailure = done.failure;
      await this.settleClosedOrderAlerts(order);
    }
    // Tin huỷ mặc định (ORDER_CANCELLED) mang refund_note nên nói luôn khoản hoàn số tiền khách chuyển thiếu; mẫu tin khác
    // (tự huỷ quá hạn) không có chỗ đó nên khoản hoàn tự báo khách bằng tin riêng.
    const noteCarriesRefund = !opts.notifyEvent && opts.notifyData?.refund_note === undefined;
    if (targetStatus === 'CANCELLED') {
      receivedBack = await refundReportedUnderpayment(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        order.id,
        { notifyCustomer: !noteCarriesRefund },
      ).catch((err: unknown) => {
        swallowedFailure = true;
        this.logger.error(`Chưa ghi được khoản hoàn số tiền khách chuyển thiếu của đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
        return 0;
      });
      await this.enqueueGomdonCancel(order);
      if (opts.actorType !== 'PANCAKE' && (await this.pancakeHooks?.afterLocalCancel(order.id, pancakeDecision)) === false) swallowedFailure = true;
      if (opts.actorType !== 'MERCHANT') {
        await notifyMerchantOwner(this.prisma, this.notifications, this.logger, order.id, 'MERCHANT_ORDER_CANCELLED', {
          order_code: order.code,
          reason: MERCHANT_CANCEL_REASON[opts.actorType ?? 'SYSTEM'],
        });
      }
    }

    // Điểm Xanh chỉ được cộng khi đơn có pointsEarned > 0 (đơn XU cũ, đơn CTV lên hộ thì không): lời tin
    // ORDER_DELIVERED chỉ nhắc điểm khi thật sự có, qua {{points_note}}.
    const notifyData: Record<string, string> = { ...opts.notifyData, order_code: order.code };
    if (targetStatus === 'DELIVERED' && order.pointsEarned > 0) {
      notifyData.points_note = ` Bạn được cộng ${formatPoints(order.pointsEarned)} Điểm Xanh.`;
    }
    // Admin/hệ thống/Pancake huỷ hoặc trả đơn đã trả tiền: khách được báo số tiền hoàn và nơi tiền về (R2-LIFECYCLE-5).
    if ((targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') && notifyData.refund_note === undefined) {
      const r = reversed as ReversalResult | null;
      const reason = opts.customerReason?.trim();
      notifyData.refund_note =
        (reason ? ` Lý do: ${reason.replace(/[.\s]+$/, '')}.` : '') +
        refundNote(r?.refund ?? null, null, (r?.pointsRefunded ?? 0) + standardPointsBack) +
        (noteCarriesRefund ? receivedRefundNote(receivedBack, order.placedForCustomer) : '');
    }
    await this.notifications
      .notify(order.userId, opts.notifyEvent ?? `ORDER_${targetStatus}`, notifyData)
      .catch(() => undefined);

    if (closedEffectsFailure !== null) throw closedEffectsFailure;
    // Mọi việc sau commit đã chạy: cron chạy lại (ReversalEffectsResyncCron) chỉ còn thấy đơn mà tiến trình chết trước dòng này.
    if (swallowedFailure) {
      this.logger.warn(`Đơn ${order.code}: hoàn số tiền chuyển thiếu hoặc xếp lệnh huỷ Pancake chưa xong, chưa ghi mốc để cron chạy lại.`);
    } else if (targetStatus === 'CANCELLED' || targetStatus === 'RETURNED') {
      await markReversalEffectsDone(this.prisma, order.id, this.logger);
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  }

  /**
   * Đảo điểm tích + điểm thường còn lại và hoa hồng của đơn đã huỷ/trả. Hai việc độc lập (mỗi việc idempotent theo dòng sổ riêng) nên
   * việc này lỗi không bỏ việc kia; lỗi đầu tiên trả về cho người gọi quyết định ném, kèm log để lộ ra ngay.
   */
  private async reverseClosedOrderEffects(order: Pick<Order, 'id' | 'code'>): Promise<{ standardPointsBack: number; failure: unknown }> {
    let standardPointsBack = 0;
    let failure: unknown = null;
    try {
      standardPointsBack = (await this.loyalty.reverseOrderPoints(order.id)) || 0;
    } catch (err) {
      failure ??= err;
      this.logger.error(`Đảo điểm của đơn ${order.code} sau khi huỷ/trả lỗi: ${err instanceof Error ? err.message : err} — gọi lại setStatus cùng trạng thái để làm nốt.`);
    }
    try {
      await this.affiliate.reverseCommissionsForOrder(order.id);
    } catch (err) {
      failure ??= err;
      this.logger.error(`Thu hồi hoa hồng của đơn ${order.code} sau khi huỷ/trả lỗi: ${err instanceof Error ? err.message : err} — gọi lại setStatus cùng trạng thái để làm nốt.`);
    }
    return { standardPointsBack, failure };
  }

  /**
   * Chạy lại việc sau giao của một đơn DELIVERED chưa có mốc deliveredEffectsAt (cron gọi; gọi tay cũng an toàn). Đơn không còn
   * DELIVERED (đã trả/huỷ: lần đảo đã lo) hoặc đã có mốc thì không làm gì. Lỗi cộng điểm/khoá hoa hồng ném ra cho người gọi.
   */
  async resyncDeliveredEffects(orderIdOrCode: string): Promise<DeliveredEffectsResult> {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderIdOrCode }, { code: orderIdOrCode }] },
      select: { id: true, code: true, status: true, deliveredEffectsAt: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.status !== 'DELIVERED') return { outcome: 'NOT_DELIVERED' };
    if (order.deliveredEffectsAt) return { outcome: 'ALREADY_DONE' };
    return this.runDeliveredEffects(order);
  }

  /**
   * Chạy lại phần đảo sau commit của đơn CANCELLED/RETURNED chưa có mốc reversalEffectsAt (cron gọi): lần huỷ/trả commit rồi tiến
   * trình chết (SIGTERM lúc deploy, mất kết nối) trước khi đảo điểm tích, thu hồi hoa hồng, xếp lệnh huỷ Pancake/Gomdon và báo —
   * gọi lại setStatus không làm gì vì trạng thái đã đặt. Mỗi việc idempotent (dòng sổ điểm unique, hoa hồng chỉ đảo PENDING/LOCKED,
   * lệnh huỷ Pancake chỉ xếp khi chưa có kết quả, tin chỉ gửi khi log chưa có tin của đơn) nên chạy song song hay chạy lại vẫn chỉ
   * làm một lần. Mốc chỉ ghi khi mọi việc xong; việc đảo điểm/hoa hồng lỗi thì chưa báo khách (lần sau xong rồi mới báo).
   */
  async resyncReversalEffects(orderIdOrCode: string): Promise<ReversalEffectsResult> {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderIdOrCode }, { code: orderIdOrCode }] },
      select: {
        id: true,
        code: true,
        userId: true,
        status: true,
        updatedAt: true,
        reversalEffectsAt: true,
        hasRecyclingPickup: true,
        placedForCustomer: true,
        pancakeCancelStatus: true,
        fulfiller: true,
        fulfillerStorefront: { select: { ownerUserId: true } },
      },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.status !== 'CANCELLED' && order.status !== 'RETURNED') return { outcome: 'NOT_CLOSED' };
    if (order.reversalEffectsAt) return { outcome: 'ALREADY_DONE' };

    const closure = await this.prisma.orderStatusHistory.findFirst({
      where: { orderId: order.id, toStatus: order.status },
      orderBy: { createdAt: 'desc' },
      select: { actorType: true, createdAt: true },
    });
    const actor = (closure?.actorType ?? 'SYSTEM') as StatusActor;
    const cancelled = order.status === 'CANCELLED';

    const { standardPointsBack, failure: reverseFailure } = await this.reverseClosedOrderEffects(order);
    let failure: unknown = reverseFailure;
    let receivedBack = 0;
    const since = closure?.createdAt ?? order.updatedAt;
    if (cancelled) {
      // Tin huỷ đã đi (lần đầu ghi khoản hoàn lỗi nên tin thiếu dòng "đã nhận…") thì tin huỷ bù ở dưới không còn gửi: khoản hoàn tự báo
      // khách, nếu không khách không bao giờ biết có tiền chờ chọn nơi nhận. Chưa có tin thì tin huỷ bù mang dòng đó, không báo riêng.
      const noticeAlreadySent = await this.closureNoticeSent(order.userId, order.code, since);
      receivedBack = await refundReportedUnderpayment({ prisma: this.prisma, notifications: this.notifications, logger: this.logger }, order.id, {
        notifyCustomer: noticeAlreadySent,
      }).catch((err: unknown) => {
        failure ??= err;
        this.logger.error(`Chưa ghi được khoản hoàn số tiền khách chuyển thiếu của đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
        return 0;
      });
      await this.enqueueGomdonCancel(order);
      // Pancake tự báo huỷ thì đơn Pancake đã huỷ; đã có kết quả huỷ (kể cả đang chờ thử lại) thì cron huỷ Pancake lo.
      if (actor !== 'PANCAKE' && order.pancakeCancelStatus === null && (await this.pancakeHooks?.afterLocalCancel(order.id, undefined)) === false) {
        failure ??= new Error('Chưa xếp được lệnh huỷ Pancake');
      }
    }
    await this.settleClosedOrderAlerts(order);
    if (failure !== null) {
      const error = failure instanceof Error ? failure.message : String(failure);
      this.logger.warn(`Đơn ${order.code}: chạy lại phần đảo sau huỷ/trả chưa xong — ${error}`);
      return { outcome: 'INCOMPLETE', error };
    }

    if (!(await this.closureNoticeSent(order.userId, order.code, since))) {
      // Lần chạy trước có thể đã ghi khoản hoàn rồi hỏng ở bước sau (lần này ghi được 0): lấy tổng đã ghi để tin huỷ vẫn có dòng đó.
      if (cancelled) {
        receivedBack = Math.max(receivedBack, await recordedPancakeUnderpayment(this.prisma, order.id).catch(() => 0));
      }
      await this.notifications
        .notify(order.userId, `ORDER_${order.status}`, {
          order_code: order.code,
          refund_note: refundNote(null, null, standardPointsBack) + receivedRefundNote(receivedBack, order.placedForCustomer),
        })
        .catch(() => undefined);
    }
    const ownerId = order.fulfiller === 'MERCHANT' ? order.fulfillerStorefront?.ownerUserId : null;
    if (cancelled && actor !== 'MERCHANT' && ownerId && !(await this.closureNoticeSent(ownerId, order.code, since))) {
      await this.notifications
        .notify(ownerId, 'MERCHANT_ORDER_CANCELLED', { order_code: order.code, reason: MERCHANT_CANCEL_REASON[actor] ?? MERCHANT_CANCEL_REASON.SYSTEM })
        .catch(() => undefined);
    }
    await markReversalEffectsDone(this.prisma, order.id, this.logger);
    return { outcome: 'DONE' };
  }

  /** Người nhận đã có tin về đơn này kể từ lúc đóng đơn (tin huỷ/trả/hoàn tiền, đường nào gửi cũng tính) thì không gửi bù thêm. */
  private async closureNoticeSent(userId: string, orderCode: string, since: Date): Promise<boolean> {
    const sent = await this.prisma.notificationLog.findFirst({
      where: { userId, sentAt: { gte: since }, payload: { path: ['data', 'order_code'], equals: orderCode } },
      select: { id: true },
    });
    return sent !== null;
  }

  /**
   * Cộng Điểm Xanh (kèm tính lại hạng), khoá hoa hồng CTV, xét thưởng giới thiệu (kèm mốc thưởng) — mỗi việc idempotent và chịu
   * được chạy song song (xem DeliveredEffectsResyncCron). Mốc chỉ ghi khi cả ba xong. Lỗi xét thưởng không làm hỏng lần giao
   * (đơn đã commit) — chỉ để lại đơn chưa có mốc cho lần chạy lại.
   */
  private async runDeliveredEffects(order: Pick<Order, 'id' | 'code'>): Promise<DeliveredEffectsResult> {
    const pointsCredited = await this.loyalty.creditOrderPoints(order.id);
    const commissionsLocked = (await this.affiliate.lockCommissionsForOrder(order.id)) ?? 0;
    const referralError = await this.affiliate.grantReferralReward(order.id).then(
      () => null,
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Xét thưởng giới thiệu cho đơn ${order.code} lỗi: ${msg}`);
        return msg;
      },
    );
    const effects = { pointsCredited: pointsCredited === true, commissionsLocked };
    if (referralError !== null) return { outcome: 'INCOMPLETE', ...effects, error: `Xét thưởng giới thiệu lỗi: ${referralError}` };
    try {
      await this.prisma.order.updateMany({ where: { id: order.id, deliveredEffectsAt: null }, data: { deliveredEffectsAt: new Date() } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Không ghi được mốc xong việc sau giao cho đơn ${order.code}: ${msg} — cron sẽ chạy lại (idempotent).`);
      return { outcome: 'INCOMPLETE', ...effects, error: `Ghi mốc lỗi: ${msg}` };
    }
    return { outcome: 'DONE', ...effects };
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
    opts: {
      actorType: StatusActor;
      actorId?: string;
      note?: string;
      /**
       * Người gọi tự xếp tạo vận đơn Gomdon sau (enqueueGomdonAfterPaid): webhook Pancake mang cả tiền lẫn "đã gửi
       * hàng" + vận đơn hãng khác phải ghi xong vận chuyển trước, kẻo job Gomdon thấy đơn còn trong kho và đặt bưu
       * tá thứ hai (GOMDON-3).
       */
      deferGomdonPush?: boolean;
    },
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

      await clearPancakeAttention(this.prisma, order.id, ATTENTION_UNDERPAID);
      if (!opts.deferGomdonPush) await this.enqueueGomdonAfterPaid(order);
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

  /** Đơn thu gom vừa trả tiền: lúc này mới đặt bưu tá Gomdon. */
  async enqueueGomdonAfterPaid(order: Pick<Order, 'id' | 'code' | 'hasRecyclingPickup'>): Promise<void> {
    if (!order.hasRecyclingPickup || !this.gomdonQueue) return;
    // Lỗi enqueue không được làm hỏng việc đã lật PAID — GomdonReconcileService quét AWAITING_PAYMENT + PAID và
    // enqueue lại.
    await enqueueGomdonPush(this.gomdonQueue, order.id).catch((err) =>
      this.logger.error(`Enqueue vận đơn Gomdon sau thanh toán lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Webhook (Pancake/Gomdon) báo trạng thái vận đơn cho đơn trả trước chưa PAID bị chặn và nuốt êm, không phát lại
   * sau khi tiền về — đơn sẽ đứng yên ở trạng thái cũ. Để lại dấu trong hàng đợi "Cần xử lý Pancake" (mỗi trạng thái
   * một lần, webhook retry không nhân bản; giữ lý do đang chờ khác) để sau khi xác nhận "Đã nhận tiền" admin biết cần
   * đẩy tiếp tay. Không ghi vào Order.note: đó là lời dặn của khách, khách đọc lại và kho nhận qua Pancake.
   * Best-effort: lỗi ghi dấu không được thay lỗi chuyển trạng thái gốc (webhook dựa vào loại lỗi đó để bỏ qua êm).
   */
  private async flagDroppedStatus(orderId: string, code: string, target: OrderStatus): Promise<void> {
    const marker = `[Chờ thanh toán: vận chuyển đã báo ${target} — đẩy tay sau khi nhận tiền]`;
    try {
      await this.prisma.$executeRaw`
        UPDATE "orders"
        SET "pancakeAttention" = CASE WHEN "pancakeAttention" IS NULL OR "pancakeAttention" = '' THEN ${marker}
                                      ELSE "pancakeAttention" || ' | ' || ${marker} END,
            "pancakeAttentionAt" = COALESCE("pancakeAttentionAt", NOW())
        WHERE "id" = ${orderId} AND ("pancakeAttention" IS NULL OR position(${marker} in "pancakeAttention") = 0)`;
      this.logger.warn(`Đơn ${code} chưa thanh toán nhưng vận chuyển báo ${target} — đã đưa vào hàng đợi để admin đẩy tay sau khi nhận tiền.`);
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
      return await this.pancakeHooks.precheckCancel(order, asker === 'SYSTEM' ? 'BACKGROUND' : 'INTERACTIVE');
    } catch (err) {
      if (err instanceof PancakeUnreachableError) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: PANCAKE_UNREACHABLE,
          message:
            asker === 'STAFF'
              ? `${PANCAKE_UNREACHABLE_MESSAGE} — đơn ${order.code} đã lên kho Pancake nhưng chưa hỏi được Pancake (${err.reason}), CHƯA huỷ, ` +
                'chưa hoàn tiền. Kiểm tra trạng thái đơn trên Pancake: đã gửi hàng thì xử lý bằng hoàn/trả.'
              : PANCAKE_UNREACHABLE_MESSAGE,
        });
      }
      if (!(err instanceof PancakeHandedOverError)) throw err;
      const gomdonHold = this.heldByGomdon(order, err.pancakeStatus);
      const synced = await this.resyncFromPancake(order, err.pancakeStatus);
      // Đồng bộ được (đơn đã trả tiền → Đang giao) thì chính trạng thái chặn lần huỷ sau. Không đồng bộ được (đơn trả trước chưa
      // nhận tiền không được đi tiếp) thì ghi mốc bàn giao: lần huỷ sau bị từ chối ngay mà không hỏi lại Pancake, cron thôi tự
      // huỷ, và chỉ lần ghi mốc đầu nhắc "Cần xử lý Pancake" (R5-SYNC-1).
      if (asker === 'SYSTEM' || !synced) {
        await this.blockAutoCancel(
          order,
          `${HANDOVER_ASKER[asker]} Pancake báo đã bàn giao vận chuyển (mã ${err.pancakeStatus}). Kiểm tra thanh toán và giao hàng.` +
            unpaidExitHint(order) +
            (gomdonHold ? GOMDON_HOLD_HINT : ''),
        );
      }
      if (asker === 'STAFF') {
        throw new BadRequestException(
          `Pancake báo đã gửi hàng (mã ${err.pancakeStatus}) — đơn ${order.code} không huỷ được nữa, ` +
            (gomdonHold ? 'chưa đổi trạng thái đơn (vận đơn Gomdon đang chạy, trạng thái giao theo Gomdon). ' : 'đã đồng bộ về trạng thái theo Pancake. ') +
            'Liên hệ đơn vị vận chuyển để chặn giao/hoàn hàng; hàng hoàn về kho thì đơn tự huỷ và hoàn tiền, khách đã nhận thì xử lý bằng trả hàng/hoàn tiền.',
        );
      }
      throw new BadRequestException(err.message);
    }
  }

  /**
   * Hệ thống tự huỷ (hết hạn thanh toán) gặp đơn đã bàn giao: ghi mốc để cron thôi thử lại đơn này, và chỉ lần ghi mốc đầu
   * tiên mới nhắc "Cần xử lý Pancake" + báo admin in-app — admin bấm "Đã xử lý" thì đơn không quay lại hàng đợi mỗi 10 phút.
   */
  private async blockAutoCancel(order: Pick<Order, 'id' | 'code'>, reason: string): Promise<void> {
    const first = await this.prisma.order.updateMany({
      where: { id: order.id, autoCancelBlockedAt: null },
      data: { autoCancelBlockedAt: new Date() },
    });
    if (first.count === 0) return;
    await flagPancakeAttention(this.prisma, this.opsAlerts(), order, reason, this.logger);
  }

  /** Báo động in-app tới ADMIN/kho (cùng kênh webhook Pancake dùng) — chỉ cần Prisma + Notifications nên tự dựng, không vòng module. */
  private opsAlerts(): GomdonAlertService {
    return (this.alerts ??= new GomdonAlertService(this.prisma, this.notifications));
  }

  /**
   * Đơn vừa huỷ/trả: việc "hàng đang/đã hoàn về kho — xử lý đơn với khách" (Gomdon) và "Pancake báo huỷ sau bàn giao /
   * đang hoàn" (Pancake) đã có kết cục — đóng để hàng đợi chỉ còn việc thật. Best-effort: đơn đã đổi trạng thái xong.
   */
  private async settleClosedOrderAlerts(order: Pick<Order, 'id' | 'code'>): Promise<void> {
    try {
      await resolveGomdonAlertKinds(this.prisma, order.id, [GOMDON_ALERT_KIND.GOODS_RETURNED]);
      // Chỉ gỡ đúng các lý do đã có kết cục: hàng còn ghi thêm lý do khác (vd COD chờ Kế toán đối soát, vừa ghi cùng tx lật
      // trạng thái) thì phải ở lại.
      await removeAttentionReasonsByPrefix(this.prisma, order.id, [
        ATTENTION_CANCEL_AFTER_HANDOVER,
        ATTENTION_CANCELLED_ON_PANCAKE_ONLY,
        PANCAKE_RETURNING_PREFIX,
      ]);
    } catch (err) {
      this.logger.warn(`Không đóng được việc tồn của đơn ${order.code} sau khi huỷ/trả: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Sau khi đơn đã huỷ ở Tubu bằng đường riêng (khách tự huỷ): ghi kết quả huỷ Pancake / xếp job huỷ. */
  async afterPancakeCancel(orderId: string, decision?: PancakeCancelDecision): Promise<boolean> {
    const settled = (await this.pancakeHooks?.afterLocalCancel(orderId, decision)) !== false;
    // Lần huỷ trước của khách có thể đã để dấu lệch Pancake–Tubu (xem flagPancakeCancelDivergence); lần này huỷ xong thì hết lệch.
    await clearPancakeAttention(this.prisma, orderId, ATTENTION_CANCELLED_ON_PANCAKE_ONLY).catch((err: unknown) =>
      this.logger.warn(`Không đóng dấu lệch huỷ Pancake của đơn ${orderId}: ${err instanceof Error ? err.message : err}`),
    );
    return settled;
  }

  /**
   * Pancake đã huỷ đơn (precheckPancakeCancel) nhưng lần huỷ ở Tubu không lật được (tiền về, vận đơn gán, khách không còn
   * được tự huỷ, hay lỗi DB): đơn Tubu còn hiệu lực mà kho không còn đơn để giao. Ghi kết quả huỷ Pancake lên đơn và đưa vào
   * "Cần xử lý Pancake" — im lặng ở đây là đơn đã trả tiền mà không bao giờ được giao. Best-effort: lỗi ghi dấu không được thay
   * lỗi/kết quả gốc của người gọi. Đơn đã huỷ/trả (webhook Pancake hay request khác huỷ xong) thì không còn lệch.
   */
  async flagPancakeCancelDivergence(orderId: string, decision: PancakeCancelDecision | undefined, why: string): Promise<void> {
    if (decision?.kind !== 'CONFIRMED' || decision.cancelStatus !== PANCAKE_CANCEL.CANCELLED) return;
    try {
      const current = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, code: true, status: true, pancakeOrderId: true } });
      if (!current || current.status === 'CANCELLED' || current.status === 'RETURNED') return;
      const pancakeId = decision.pancakeOrderId ?? current.pancakeOrderId;
      await this.prisma.order.updateMany({
        where: {
          id: orderId,
          OR: [{ pancakeOrderId: null }, ...(decision.pancakeOrderId ? [{ pancakeOrderId: decision.pancakeOrderId }] : [])],
        },
        data: { pancakeCancelStatus: decision.cancelStatus, ...(decision.pancakeOrderId ? { pancakeOrderId: decision.pancakeOrderId } : {}) },
      });
      await flagPancakeAttention(
        this.prisma,
        this.opsAlerts(),
        current,
        `${ATTENTION_CANCELLED_ON_PANCAKE_ONLY} (đơn Pancake #${pancakeId ?? '?'}; ${why.slice(0, 200)}) — kho sẽ KHÔNG giao. ` +
          'Huỷ đơn Tubu (hoàn tiền nếu đã thu); khách còn cần hàng thì đặt đơn mới cho khách, đừng tạo lại đơn Pancake cùng mã.',
        this.logger,
      );
    } catch (err) {
      this.logger.error(`Không ghi được dấu lệch huỷ Pancake cho đơn ${orderId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Áp trạng thái Pancake đang báo (vd Đã gửi hàng → SHIPPING) — best-effort, lỗi chuyển trạng thái chỉ log. false = đơn chưa
   * theo được Pancake (đơn trả trước chưa nhận tiền không được đi tiếp, mã Pancake không phải trạng thái đơn…).
   */
  private async resyncFromPancake(order: Order, pancakeStatus: number | string): Promise<boolean> {
    const action = resolvePancakeStatus(pancakeStatus);
    if (action?.kind !== 'status') return false;
    if (action.status === order.status) return true;
    if (this.heldByGomdon(order, pancakeStatus)) return false;
    try {
      await this.setStatus(order.id, action.status, { actorType: 'PANCAKE', note: 'Đồng bộ trạng thái Pancake khi yêu cầu huỷ' });
      return true;
    } catch (err) {
      this.logger.warn(`Không đồng bộ được trạng thái Pancake ${pancakeStatus} cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /**
   * Cùng luật với webhook Pancake (PancakeProcessor.onStatusUpdated): đơn có vận đơn Gomdon sống thì mốc đang giao/đã giao
   * chỉ theo Gomdon — kho bấm "hoàn thành" hàng loạt trên Pancake không được chốt hộ (DELIVERED cộng điểm, khoá hoa hồng,
   * mở hạn trả) khi hàng chưa rời tay bưu tá.
   */
  private heldByGomdon(order: Order, pancakeStatus: number | string): boolean {
    const action = resolvePancakeStatus(pancakeStatus);
    return (
      action?.kind === 'status' &&
      (action.status === 'SHIPPING' || action.status === 'DELIVERED') &&
      action.status !== order.status &&
      gomdonOwnsShipping(order)
    );
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
