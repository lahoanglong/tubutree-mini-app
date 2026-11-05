import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Order, OrderItem, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import type { PancakeOrderDTO, PancakeOrderTagRef, PancakeUpdateOrderBody } from './pancake.types';
import { QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';
import { SystemConfigService } from '../../system-config/system-config.service';
import { loadGomdonConfig, DEFAULT_GOMDON_WEIGHT_FALLBACK } from '../gomdon/gomdon-config';
import { recyclingWeight } from '../gomdon/gomdon-weight';
import { GOMDON_STATE, isGomdonPayable } from '../gomdon/gomdon-status';
import { GOMDON_ALERT_KIND, GomdonAlertService } from '../gomdon/gomdon-alert.service';
import { isPrepaidMethod, orderStatusLabelVi } from '../../orders/order-transition';
import { resolveDealerRecipient } from '../../dealer/dealer-recipient';
import { DEALER_AWAITING_STOCK_WHERE, isDealerAwaitingStock } from '../../dealer/dealer-awaiting-stock';
import { isMerchantFulfilledOrder, isPancakeFulfilledLine, TUBU_FULFILLED_ORDER_WHERE } from './pancake-fulfilment';
import {
  buildPancakeOrderBody,
  isPancakePrepaid,
  PANCAKE_PAYMENT_TAG,
  pancakePaymentState,
  recyclingNoteDetail,
  type PancakeLinePredicate,
  type PancakeRecipient,
} from './pancake-order-body';
import {
  extractPancakeOrderId,
  isPancakeCancelled,
  isPancakeHandedOver,
  PANCAKE_ORDER_STATUS,
  PancakeApiError,
  PancakeCancelRefusedError,
  PancakeOrderDataError,
  PancakePushBusyError,
  pancakeErrorText,
  pancakeOrderHasCode,
} from './pancake-outbound';
import { enqueuePancakeCancel, enqueuePancakePayment, enqueuePancakePush, PANCAKE_JOB_PUSH, removeFailedPancakePush } from './pancake-queue';
import { classifyPushError, isPushFailureSettled, keepsPriorKind, kindAfterFailure, PUSH_ERROR_KIND, PUSH_RETRY, storedErrorText, type PushErrorKind } from './pancake-push-error';
import { withQueueTimeout } from '../../../jobs/queue-timeout';
import {
  ATTENTION_CANCEL_PENDING,
  ATTENTION_PAYMENT_PENDING,
  ATTENTION_PUSH_FAILED,
  ATTENTION_SETTLED_BY_CANCEL,
  clearPancakeAttention,
  flagPancakeAttention,
  writePancakeAttention,
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

/** Mở đầu pancakeSyncError khi Pancake trả lời và từ chối lệnh huỷ (khác mất kết nối): cron thử lại thưa hơn. */
export const PANCAKE_CANCEL_REFUSED_PREFIX = 'Pancake từ chối lệnh huỷ: ';

/** Trạng thái đơn Tubu còn được tự đẩy sang kho: chưa rời kho, chưa kết thúc. */
export const PANCAKE_PUSHABLE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] as const;

/**
 * Điều kiện ghi "đơn chưa STALE". STALE (quá cửa sổ tự đẩy, kho có thể đã giao tay) chỉ rời bằng hai đường: đẩy thành công
 * (`saveCreated` → SYNCED) và "Đẩy lại" của admin (`retryPushByAdmin` → PENDING). Mọi câu ghi `pancakePushStatus` khác phải mang điều kiện
 * này (hoặc bỏ trường trạng thái khi đơn STALE): đọc-rồi-ghi không đủ, vì markOverdue/markStale chen vào giữa lúc lượt đẩy đang bay.
 */
export const NOT_STALE_WHERE: Prisma.OrderWhereInput = {
  OR: [{ pancakePushStatus: null }, { pancakePushStatus: { not: PANCAKE_PUSH.STALE } }],
};

/**
 * Điều kiện "không lượt đẩy nào đang giữ quyền": không PUSHING, hoặc PUSHING đã quá `PUSH_LEASE_MS` (tiến trình đẩy đã chết). Một luật
 * cho claim, câu ghi lỗi của job và markOverdue.
 */
export function pushLeaseFreeWhere(now: Date = new Date()): Prisma.OrderWhereInput {
  return {
    OR: [
      { pancakePushStatus: null },
      { pancakePushStatus: { not: PANCAKE_PUSH.PUSHING } },
      { pancakeLastAttemptAt: null },
      { pancakeLastAttemptAt: { lt: new Date(now.getTime() - PancakeOrderService.PUSH_LEASE_MS) } },
    ],
  };
}

/**
 * MERCHANT = đơn gian hàng đối tác tự giao (D4): không thuộc kho Tubu, không bao giờ lên Pancake. WAIT_GOMDON = đơn
 * thu gom đang chờ vận đơn Gomdon (GomdonOrderService đẩy Pancake ngay khi có mã / chốt tạo tay).
 */
export type PancakePushGate = 'PUSH' | 'WAIT_PAYMENT' | 'WAIT_STOCK' | 'WAIT_GOMDON' | 'DEAD' | 'LEFT_WAREHOUSE' | 'MERCHANT';

/**
 * Đơn thu gom mà Gomdon sắp tạo vận đơn: chưa chạy (null), đang gọi Gomdon (CREATING), hay vừa thanh toán xong còn
 * AWAITING_PAYMENT (job tạo vận đơn đã xếp). Đẩy Pancake lúc này là ghi chú "kiểm tra Gomdon / chờ thanh toán"
 * không mã vận đơn, không tag GOMDON — kho dễ đặt vận đơn thứ hai. Chuyển khoản chưa trả thì không chờ: Pancake cần
 * đơn để đối soát, vận đơn chỉ tạo sau khi nhận tiền.
 */
export function awaitsGomdonWaybill(order: {
  hasRecyclingPickup?: boolean | null;
  gomdonOrderId?: string | null;
  gomdonPartnerCode?: string | null;
  gomdonStatus?: string | null;
  paymentMethod: string;
  paymentStatus: string;
}): boolean {
  if (!order.hasRecyclingPickup || order.gomdonOrderId || order.gomdonPartnerCode) return false;
  const status = order.gomdonStatus ?? null;
  if (status === null || status === GOMDON_STATE.CREATING) return true;
  return status === GOMDON_STATE.AWAITING_PAYMENT && isGomdonPayable(order);
}

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
  fulfiller?: string | null;
  hasRecyclingPickup?: boolean | null;
  gomdonOrderId?: string | null;
  gomdonPartnerCode?: string | null;
  gomdonStatus?: string | null;
  items: { backorderedQty?: number | null }[];
}): PancakePushGate {
  if (isMerchantFulfilledOrder(order)) return 'MERCHANT';
  if (order.status === 'CANCELLED' || order.status === 'RETURNED') return 'DEAD';
  if (!(PANCAKE_PUSHABLE_STATUSES as readonly string[]).includes(order.status)) return 'LEFT_WAREHOUSE';
  if (isDealerAwaitingStock(order)) return 'WAIT_STOCK';
  if (order.paymentStatus !== 'PAID' && isPrepaidMethod(order.paymentMethod) && order.paymentMethod !== 'BANK_TRANSFER') {
    return 'WAIT_PAYMENT';
  }
  if (awaitsGomdonWaybill(order)) return 'WAIT_GOMDON';
  return 'PUSH';
}

export type PushRetryDecision =
  | { kind: 'NOW' }
  /** Chưa nhận vì đơn đang chờ việc khác; `waitingFor` là việc đó. Đủ điều kiện thì nhận. */
  | { kind: 'WAIT'; refusal: string; waitingFor: string }
  | { kind: 'NEVER'; refusal: string };

/**
 * "Đẩy lại Pancake" của admin có nhận đơn này không, chỉ theo trạng thái của chính đơn. MỘT nguồn cho `retryPushByAdmin` (lời từ chối),
 * lời nhắc đơn STALE vừa thanh toán (`syncPayment`) và cờ `pancakeRetry` trên danh sách đơn của admin (web không tự suy lại từ cột).
 *  - NOW: nhận.
 *  - WAIT: đơn đang chờ khách trả tiền / đủ hàng đặt trước / vận đơn Gomdon; hệ thống hoặc người làm xong việc đó thì nhận.
 *  - NEVER: đã có trên Pancake, đối tác tự giao, đã huỷ/trả, đã rời kho (đẩy là kho giao lần hai).
 */
export function pushRetryGateDecision(
  order: Parameters<typeof pancakePushGate>[0] & { code: string; pancakeOrderId?: string | null },
): PushRetryDecision {
  if (order.pancakeOrderId) return { kind: 'NEVER', refusal: `Đơn ${order.code} đã có trên Pancake (#${order.pancakeOrderId}).` };
  const gate = pancakePushGate(order);
  switch (gate) {
    case 'PUSH':
      return { kind: 'NOW' };
    case 'MERCHANT':
      return { kind: 'NEVER', refusal: `Đơn ${order.code} do gian hàng đối tác tự giao — không đẩy sang kho Pancake.` };
    case 'DEAD':
      return { kind: 'NEVER', refusal: `Đơn ${order.code} đã huỷ/trả, không đẩy sang kho.` };
    case 'LEFT_WAREHOUSE':
      return {
        kind: 'NEVER',
        refusal: `Đơn ${order.code} đã ở trạng thái «${orderStatusLabelVi(order.status)}» — không đẩy để tránh kho giao lần hai.`,
      };
    case 'WAIT_PAYMENT':
      return {
        kind: 'WAIT',
        waitingFor: 'khách thanh toán',
        refusal: `Đơn ${order.code} trả trước (${PAYMENT_METHOD_LABEL_VI[order.paymentMethod as PaymentMethod] ?? order.paymentMethod}) chưa thanh toán — sẽ tự đẩy khi khách trả tiền.`,
      };
    case 'WAIT_STOCK':
      return {
        kind: 'WAIT',
        waitingFor: 'đủ hàng đặt trước',
        refusal: `Đơn ${order.code} còn hàng đặt trước chưa về đủ — hệ thống tự đẩy sang kho khi đủ hàng.`,
      };
    case 'WAIT_GOMDON':
      return {
        kind: 'WAIT',
        waitingFor: 'vận đơn Gomdon',
        refusal: `Đơn thu gom ${order.code} đang chờ tạo vận đơn Gomdon — hệ thống tự đẩy sang kho kèm mã vận đơn (quá 60 phút thì đẩy kèm cảnh báo tạo tay).`,
      };
  }
}

type OrderWithItems = Order & { items: OrderItem[] };

/** Đơn cũ trước cột trạng thái huỷ: có dấu vết đã (có thể) lên Pancake thì phải huỷ bên đó. */
export function mayExistOnPancake(order: Pick<Order, 'pancakeOrderId' | 'pancakePushClaimedAt'>): boolean {
  return Boolean(order.pancakeOrderId || order.pancakePushClaimedAt);
}

/** Nhãn phương thức thanh toán trong lời báo lỗi admin; Record đầy đủ theo enum để thêm phương thức mới thì tsc buộc điền. */
const PAYMENT_METHOD_LABEL_VI: Record<PaymentMethod, string> = {
  COD: 'COD',
  ZALOPAY: 'ZaloPay',
  VNPAY: 'VNPAY',
  BANK_TRANSFER: 'chuyển khoản',
  WALLET: 'ví Tubu',
  XU: 'Xu',
};

function isTagsRejection(err: unknown): boolean {
  return err instanceof PancakeApiError && !err.transient && /Pancake (?:trả 4\d\d\b|từ chối\b).*\btags\b/is.test(err.message);
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

  /** Xếp hàng đẩy đơn (retry + backoff — jobs/queue.module.ts). Gọi lặp an toàn, xem pancake-queue.ts. */
  enqueuePush(orderId: string): Promise<void> {
    return enqueuePancakePush(this.pushQueue, orderId);
  }

  enqueuePayment(orderId: string): Promise<void> {
    return enqueuePancakePayment(this.pushQueue, orderId);
  }

  async enqueueCancel(orderId: string): Promise<void> {
    // Lệnh huỷ được xếp lại (cron, job): gỡ dấu "đẩy lỗi" còn sót của đơn đã huỷ. Đường huỷ thật gỡ ở PancakeSyncHooks.afterLocalCancel.
    await removeFailedPancakePush(this.pushQueue, orderId);
    return enqueuePancakeCancel(this.pushQueue, orderId);
  }

  async pushOrder(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.pancakeOrderId) return order.pancakeOrderId; // đã đẩy

    const gate = pancakePushGate(order);
    if (gate === 'MERCHANT') return null; // D4: gian hàng đối tác tự giao, không ghi gì lên cột đồng bộ Pancake
    if (gate === 'DEAD') {
      await this.setPushStatus(order.id, PANCAKE_PUSH.SKIPPED);
      // Lần tạo trước có thể đã thành công rồi đơn mới bị huỷ: huỷ luôn bên Pancake (job tra theo mã đơn).
      if (order.status === 'CANCELLED' && order.pancakePushClaimedAt) await this.requestCancel(order);
      await removeFailedPancakePush(this.pushQueue, order.id);
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
    if (gate === 'WAIT_GOMDON') {
      this.logger.log(`Đơn thu gom ${order.code} chờ vận đơn Gomdon — Gomdon đẩy sang Pancake khi có mã.`);
      return null;
    }
    // Quá cửa sổ tự đẩy (markOverdue): không đường tự động nào được đẩy nữa (job thanh toán, Gomdon, cron, hook), vì kho có thể đã giao tay
    // và đẩy tiếp là hai đơn kho. Chỉ "Đẩy lại" của admin (đặt PENDING trước khi xếp job) đưa đơn lên lại.
    if (order.pancakePushStatus === PANCAKE_PUSH.STALE) {
      this.logger.warn(`Đơn ${order.code} đã quá hạn tự đẩy Pancake (STALE): không tự đẩy, chờ admin bấm "Đẩy lại Pancake".`);
      return null;
    }
    if (!this.client.isConfigured()) {
      this.logger.warn(`Pancake chưa cấu hình — đơn ${order.code} giữ trạng thái chờ đồng bộ.`);
      await this.prisma.order.updateMany({
        where: { id: order.id, pancakeOrderId: null, AND: [NOT_STALE_WHERE] },
        data: { pancakePushStatus: PANCAKE_PUSH.NOT_CONFIGURED, pancakeSyncError: 'Pancake chưa cấu hình (PANCAKE_API_KEY/SHOP_ID).' },
      });
      return null;
    }

    // D4: chỉ dòng isPancakeFulfilledLine tới kho; mã giả MCH_ / id nội bộ không bao giờ thay mã biến thể Pancake.
    const variations = await this.variationsOf(order);
    const isPancakeLine = this.pancakeLinesOf(variations);
    const pancakeLineCount = order.items.filter(isPancakeLine).length;
    const skipped = order.items.length - pancakeLineCount;
    if (skipped > 0) await this.flagUnpushableLines(order.id, order.code, skipped, pancakeLineCount === 0);
    if (pancakeLineCount === 0) return null;

    const { body, paymentSynced, tagNames } = buildPancakeOrderBody(order, {
      recipient: await this.recipientOf(order),
      variations,
      onDealerCredit: await this.isOnDealerCredit(order),
      recyclingNote: await this.buildRecyclingNote(order),
      isPancakeLine,
    });
    const tags = await this.client.resolveOrderTags(tagNames);
    if (tags.length > 0) body.tags = tags;

    // Giữ quyền đẩy (một tiến trình một lúc): job push, job thanh toán và cron có thể cùng chạm một đơn. Tiến trình
    // chết giữa chừng để lại PUSHING — quá PUSH_LEASE_MS thì lần sau được vào lại (và tra cứu trước khi tạo).
    const now = new Date();
    const claim = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        pancakeOrderId: null,
        ...TUBU_FULFILLED_ORDER_WHERE,
        status: { in: [...PANCAKE_PUSHABLE_STATUSES] },
        NOT: DEALER_AWAITING_STOCK_WHERE,
        // Cùng luật với chặn STALE ở trên, nhưng nguyên tử: đơn vừa bị markOverdue giữa lúc đọc và claim không được claim.
        AND: [pushLeaseFreeWhere(now), NOT_STALE_WHERE],
      },
      data: {
        pancakePushStatus: PANCAKE_PUSH.PUSHING,
        pancakePushAttempts: { increment: 1 },
        pancakeLastAttemptAt: now,
      },
    });
    if (claim.count === 0) {
      const current = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      if (current.pancakeOrderId) return current.pancakeOrderId;
      if (current.pancakePushStatus === PANCAKE_PUSH.STALE) return null;
      if (pancakePushGate(current) !== 'PUSH') return this.pushOrder(order.id);
      throw new PancakePushBusyError(`Đơn ${order.code} đang được đẩy sang Pancake bởi tiến trình khác — thử lại sau.`);
    }

    // Đặt mốc "đã gửi lệnh tạo" bằng cập nhật có điều kiện: mốc cũ chỉ đọc được từ chính câu lệnh này. Lần đọc đơn đầu
    // hàm có thể cũ (tiến trình khác vừa đẩy xong và gặp lỗi tạm sau khi ta đọc), nên không dùng nó để quyết định tra đơn.
    const marked = await this.prisma.order.updateMany({
      where: { id: order.id, pancakeOrderId: null, pancakePushClaimedAt: null },
      data: { pancakePushClaimedAt: now },
    });
    const sentBefore = marked.count === 0;

    let pancakeOrderId: string | null;
    try {
      // Lần trước đã gửi lệnh tạo mà không rõ kết quả → tra theo mã đơn, có thì nhận đơn đó thay vì tạo thêm.
      if (sentBefore) {
        const found = await this.findOnPancake(order);
        if (found) {
          const adopted = await this.adopt(order, found);
          await this.refreshNoteIfWaybillChanged(order);
          return adopted;
        }
      }
      pancakeOrderId = extractPancakeOrderId(await this.withTagFallback(body, (b) => this.client.createOrder(b)));
    } catch (err) {
      // Từ chối dứt khoát → Pancake chắc chắn chưa tạo: gỡ mốc để lần sau không phải tra cứu.
      const definite = err instanceof PancakeApiError && !err.transient;
      await this.writeAttemptError(order.id, err, { pancakePushStatus: PANCAKE_PUSH.PENDING, ...(definite && !sentBefore ? { pancakePushClaimedAt: null } : {}) });
      throw err;
    }
    if (!pancakeOrderId) {
      // Không rõ đơn đã tạo chưa — giữ mốc, lần thử sau tra theo mã đơn (không tạo mù thêm đơn).
      const err = new PancakeApiError(`Pancake không trả mã đơn khi tạo đơn ${order.code}.`, true);
      await this.writeAttemptError(order.id, err, { pancakePushStatus: PANCAKE_PUSH.PENDING });
      throw err;
    }
    await this.saveCreated(order, pancakeOrderId, paymentSynced);
    await this.refreshNoteIfWaybillChanged(order);
    return pancakeOrderId;
  }

  /**
   * Lỗi tạm (mạng/5xx/429) trong chừng này phút kể từ lúc đơn được phép lên kho (đặt COD / nhận tiền) chưa đưa vào
   * "Cần xử lý Pancake": cron 15 phút tự đẩy lại, còn chập kéo dài thì báo động tổng pancake.stuck (30 phút) lo.
   * Không có ân hạn này thì Pancake chập nửa phút sinh một thông báo cho mỗi đơn × mỗi admin.
   */
  static readonly PUSH_ATTENTION_GRACE_MINUTES = 60;

  /**
   * Ghi kết cục một lần đẩy lỗi, gọi từ job push (hết lượt hoặc lỗi dứt khoát) và từ `syncPayment` khi job thanh toán đẩy hộ đơn
   * gặp 401/403. `final` chốt FAILED. Lỗi tạm hoặc dứt khoát: đưa vào hàng đợi "Cần xử lý Pancake" (cron vẫn thử tiếp, lỗi tạm
   * có ân hạn). Lỗi CONFIG: hoàn lượt đã đốt, không báo từng đơn. 401/403 của đơn đã được thả khỏi nhóm CONFIG
   * (CONFIG_RECHECK) hay đã REJECTED tính là REJECTED (`kindAfterFailure`): khoá đã đẩy được đơn khác thì lỗi là của riêng đơn.
   */
  async markPushFailure(orderId: string, err: unknown, final: boolean): Promise<void> {
    // Thua tranh chấp quyền đẩy: kết cục do tiến trình kia ghi, ghi TRANSIENT lúc này sẽ đè loại lỗi nó vừa đặt (vd REJECTED).
    if (err instanceof PancakePushBusyError) return;
    const order = await this.recordFailure(orderId, err, final ? { pancakePushStatus: PANCAKE_PUSH.FAILED } : {}, true);
    // Đơn đã lên Pancake giữa chừng, hoặc câu ghi bị chặn (tiến trình khác đang PUSHING): không còn gì để báo hay hoàn/đốt lượt.
    if (!order || !order.written) return;
    const { kind } = order;
    if (order.kept) {
      this.logger.warn(`Đơn ${order.code}: lỗi tạm khi đẩy Pancake, giữ loại lỗi ${kind} và lời lỗi cũ: ${pancakeErrorText(err)}`);
      // CONFIG và REJECTED đã được báo (hoặc cố ý không báo từng đơn) khi định loại: không báo lại.
      if (kind !== PUSH_ERROR_KIND.CONFIG_RECHECK) return;
    } else if (kind === PUSH_ERROR_KIND.CONFIG) {
      return; // báo động tổng `pancake.config` (ops-alerts) lo việc báo một lần, không báo từng đơn
    }
    // CONFIG_RECHECK coi như lỗi tạm: khoá đã đẩy được đơn khác, cron thử lại bình thường.
    const transientLike = kind === PUSH_ERROR_KIND.TRANSIENT || kind === PUSH_ERROR_KIND.CONFIG_RECHECK;
    if (!transientLike || (final && !this.inTransientGrace(order, err))) {
      const hint = transientLike
        ? 'Hệ thống tự thử lại mỗi 15 phút; sửa nguyên nhân rồi bấm "Đẩy lại Pancake".'
        : `Thử lại không tự hết lỗi: sửa nguyên nhân rồi bấm "Đẩy lại Pancake" (hệ thống chỉ hỏi lại mỗi ${PUSH_RETRY.SLOW_MINUTES} phút). Không tạo tay đơn này trên Pancake: hệ thống vẫn tự hỏi lại, làm vậy sẽ thành hai đơn kho.`;
      await flagPancakeAttention(this.prisma, this.alerts, order, `${ATTENTION_PUSH_FAILED} (kho chưa thấy đơn): ${pancakeErrorText(err)}. ${hint}`, this.logger);
    }
  }

  /** Ghi lỗi của một lượt đẩy ngay trong pushOrder (trạng thái PENDING, lời lỗi, loại lỗi). */
  private async writeAttemptError(orderId: string, err: unknown, extra: Record<string, unknown>): Promise<void> {
    await this.recordFailure(orderId, err, extra, false);
  }

  /**
   * Ghi lời lỗi + loại lỗi cho một đơn chưa lên Pancake. Loại ghi ra phụ thuộc loại lỗi TRƯỚC của đơn (`kindAfterFailure`), nên đọc ngay
   * trước khi ghi và ghi có điều kiện `pancakeErrorKind` còn nguyên: một đơn vừa được thả sang CONFIG_RECHECK (đơn khác lên Pancake giữa
   * chừng) không bị ghi đè bằng loại tính từ bản đọc cũ. Điều kiện hụt thì đọc lại (kể cả `pancakeOrderId`) và tính lại (tối đa 3 vòng).
   * `fromJob` (markPushFailure): chỉ ghi khi không có tiến trình nào đang PUSHING, và lỗi CONFIG hoàn lượt đã đốt trong CÙNG câu ghi
   * (không có trạng thái trung gian FAILED mà lượt thử chưa hoàn). Gọi từ pushOrder (đang giữ quyền đẩy, trạng thái PUSHING của chính
   * mình) thì không áp hai điều đó.
   * `kept`: lỗi tạm gặp loại cũ cần giữ (`keepsPriorKind`): KHÔNG ghi lời lỗi/loại, từ job thì không ghi gì (không đổi trạng thái, không
   * đốt/hoàn lượt), từ pushOrder chỉ ghi `extra` (rời trạng thái PUSHING).
   * `written` false: không ghi được (tiến trình khác đang PUSHING): người gọi không báo hay hoàn/đốt lượt.
   * Trả null khi đơn không còn hoặc đã lên Pancake.
   */
  private async recordFailure(
    orderId: string,
    err: unknown,
    extra: Record<string, unknown>,
    fromJob: boolean,
  ): Promise<{ id: string; code: string; createdAt: Date; paidAt: Date | null; kind: PushErrorKind; kept: boolean; written: boolean } | null> {
    for (let attempt = 0; ; attempt++) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, code: true, pancakeOrderId: true, createdAt: true, paidAt: true, pancakeErrorKind: true, pancakeSyncError: true },
      });
      if (!order || order.pancakeOrderId) return null;
      const kind = kindAfterFailure(err, order);
      const kept = keepsPriorKind(err, order);
      if (kept && fromJob) return { ...order, kind, kept, written: true };
      // Đang PUSHING trong hạn thuê = tiến trình khác giữ quyền đẩy (lần này thua tranh chấp): không ghi đè, kẻo mở khoá cho lần tạo thứ
      // hai. PUSHING quá hạn thuê là tiến trình đã chết: ghi được, cùng luật với claim (không thì lỗi DATA ném trước claim kẹt PUSHING mãi).
      const where: Prisma.OrderWhereInput = {
        id: order.id,
        pancakeOrderId: null,
        pancakeErrorKind: order.pancakeErrorKind,
        ...(fromJob ? pushLeaseFreeWhere() : {}),
      };
      const data = kept ? extra : { ...extra, pancakeSyncError: storedErrorText(err, kind), pancakeErrorKind: kind };
      // Khoá API sai làm hỏng mọi đơn như nhau: không đốt lượt từng đơn (cron chỉ dò bằng một đơn mỗi giờ).
      const refunded =
        fromJob && kind === PUSH_ERROR_KIND.CONFIG
          ? await this.updateManyKeepingStale({ ...where, pancakePushAttempts: { gt: 0 } }, { ...data, pancakePushAttempts: { increment: -1 } })
          : { count: 0 };
      const done = refunded.count > 0 ? refunded : await this.updateManyKeepingStale(where, data);
      if (done.count > 0) return { ...order, kind, kept, written: true };
      const again = await this.prisma.order.findUnique({ where: { id: orderId }, select: { pancakeOrderId: true, pancakeErrorKind: true } });
      if (!again || again.pancakeOrderId) return null;
      if (again.pancakeErrorKind === order.pancakeErrorKind || attempt >= 2) return { ...order, kind, kept, written: false };
    }
  }

  /**
   * Gỡ job push lỗi của những đơn đã có kết cục (lên Pancake, huỷ, giao): lệnh đẩy chạy lại thành công qua đường khác (job thanh
   * toán, cron, admin) hay đơn bị huỷ giữa chừng đều để lại dấu lỗi. Trả số job đã gỡ.
   */
  async sweepSettledFailedJobs(limit = 100): Promise<number> {
    const failed = await withQueueTimeout(this.pushQueue.getFailed(0, limit - 1), `${QUEUE_PANCAKE_PUSH} liệt kê job lỗi`);
    const pushJobs = failed.filter((j) => j.name === PANCAKE_JOB_PUSH && typeof j.data?.orderId === 'string');
    if (pushJobs.length === 0) return 0;
    const rows = await this.prisma.order.findMany({
      where: { id: { in: pushJobs.map((j) => j.data.orderId as string) } },
      select: { id: true, status: true, pancakeOrderId: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    let removed = 0;
    for (const job of pushJobs) {
      if (!isPushFailureSettled(byId.get(job.data.orderId as string))) continue;
      await job.remove().then(() => (removed += 1)).catch(() => undefined);
    }
    return removed;
  }

  private inTransientGrace(order: { createdAt?: Date | null; paidAt?: Date | null }, err: unknown): boolean {
    if (!(err instanceof PancakeApiError) || !err.transient) return false;
    const since = Math.max(order.createdAt?.getTime() ?? 0, order.paidAt?.getTime() ?? 0);
    return Date.now() - since < PancakeOrderService.PUSH_ATTENTION_GRACE_MINUTES * 60_000;
  }

  /** `pushRetryGateDecision` cộng điều kiện môi trường lúc này (đã cấu hình Pancake, không có lượt đẩy đang bay): "nhận ngay bây giờ". */
  private retryDecision(order: Parameters<typeof pushRetryGateDecision>[0] & Pick<Order, 'pancakePushStatus' | 'pancakeLastAttemptAt'>): PushRetryDecision {
    const byOrder = pushRetryGateDecision(order);
    if (byOrder.kind !== 'NOW') return byOrder;
    if (!this.client.isConfigured()) {
      return { kind: 'WAIT', waitingFor: 'cấu hình Pancake (PANCAKE_API_KEY/SHOP_ID)', refusal: 'Pancake chưa được cấu hình (PANCAKE_API_KEY/SHOP_ID).' };
    }
    if (this.pushInFlight(order)) {
      return { kind: 'WAIT', waitingFor: 'lượt đẩy đang chạy xong', refusal: `Đơn ${order.code} đang được đẩy sang Pancake — chờ ít phút rồi tải lại.` };
    }
    return byOrder;
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
    const decision = this.retryDecision(order);
    if (decision.kind !== 'NOW') throw new BadRequestException(decision.refusal);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 0 },
    });
    // enqueuePush gỡ job push đã lỗi cùng jobId trước khi add: BullMQ bỏ qua `add` khi jobId còn nằm ở tập failed.
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
    if (isMerchantFulfilledOrder(order)) return;
    if (!order.pancakeOrderId && order.pancakePushStatus === PANCAKE_PUSH.STALE) {
      // Chỉ bảo "bấm Đẩy lại" khi retryPushByAdmin nhận đơn NGAY lúc này (cùng quyết định). Đơn đang chờ việc khác thì nói rõ chờ gì, chưa bấm;
      // đơn đã huỷ/rời kho/đối tác tự giao thì không nhắc (admin không đẩy lại được, đẩy là kho giao lần hai).
      const decision = this.retryDecision(order);
      if (decision.kind === 'NEVER') return;
      // Mở đầu bằng ATTENTION_PUSH_FAILED để đẩy thành công và đường huỷ (ATTENTION_SETTLED_BY_CANCEL) tự gỡ nhắc, như lời đẩy lỗi khác.
      const head = `${ATTENTION_PUSH_FAILED} (quá hạn tự đẩy) — khách vừa thanh toán`;
      const reason =
        decision.kind === 'NOW'
          ? `${head}: kiểm tra kho đã giao tay chưa; chưa thì bấm "Đẩy lại Pancake".`
          : `${head}, nhưng đơn đang chờ ${decision.waitingFor} nên CHƯA bấm "Đẩy lại Pancake" lúc này. Khi đủ điều kiện: kiểm tra kho đã giao tay chưa; chưa thì bấm "Đẩy lại Pancake".`;
      await flagPancakeAttention(this.prisma, this.alerts, order, reason, this.logger);
      return;
    }
    if (!order.pancakeOrderId) {
      try {
        await this.pushOrder(order.id);
      } catch (err) {
        // Job thanh toán không qua markPushFailure của job push: khoá API sai (401/403) cũng không được đốt lượt đơn này.
        if (classifyPushError(err) === PUSH_ERROR_KIND.CONFIG) {
          await this.markPushFailure(order.id, err, true).catch((e) => this.logger.error(`Không ghi được lỗi đẩy Pancake cho đơn ${order.code}: ${pancakeErrorText(e)}`));
        }
        throw err;
      }
      return;
    }
    const onCredit = await this.isOnDealerCredit(order);
    const state = pancakePaymentState(order, onCredit);
    if (!isPancakePrepaid(state)) return;
    if (!this.client.isConfigured()) return;
    const { payload, amountDue } = await this.orderUpdate(order, onCredit);
    try {
      await this.putOrder(order.pancakeOrderId, payload);
    } catch (err) {
      await this.setPushError(order.id, err);
      // 401/403 là lỗi cấu hình: job thanh toán dừng ngay (không còn lượt cuối để báo), mà đơn đã lên kho có thể bị thu COD lần nữa.
      if (final || classifyPushError(err) === PUSH_ERROR_KIND.CONFIG) {
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
    await this.refreshNoteIfWaybillChanged(order);
  }

  /**
   * Vận đơn Gomdon vừa gắn cho đơn đã có trên Pancake: PUT lại ghi chú + tag (mã vận đơn, "KHÔNG TẠO VẬN ĐƠN KHÁC",
   * tag GOMDON, lời dặn khách, dấu thanh toán) — cùng đường với job thanh toán. Đơn đã trả trước thì kèm luôn số đã
   * trả (cod 0). Ném lỗi khi Pancake từ chối để người gọi báo "ghi mã vào Pancake".
   */
  async syncWaybillNote(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (!order.pancakeOrderId || isMerchantFulfilledOrder(order) || order.status === 'CANCELLED' || order.status === 'RETURNED') return;
    if (!this.client.isConfigured()) throw new PancakeApiError('Pancake chưa cấu hình (PANCAKE_API_KEY/SHOP_ID).', false);
    const onCredit = await this.isOnDealerCredit(order);
    await this.putOrder(order.pancakeOrderId, (await this.orderUpdate(order, onCredit)).payload);
    if (isPancakePrepaid(pancakePaymentState(order, onCredit)) && !order.pancakePaymentSynced) {
      await this.prisma.order.update({ where: { id: order.id }, data: { pancakePaymentSynced: true, pancakeSyncError: null } });
      await clearPancakeAttention(this.prisma, order.id, ATTENTION_PAYMENT_PENDING);
    }
    await this.alerts?.resolveKinds(order.id, [GOMDON_ALERT_KIND.WAYBILL_NOTE]);
    this.logger.log(`Đã ghi mã vận đơn Gomdon ${order.gomdonPartnerCode ?? '(chưa có)'} vào đơn Pancake #${order.pancakeOrderId} (${order.code}).`);
  }

  /** Nội dung PUT: note/tag (và số đã trả khi trả trước) dựng từ đơn hiện tại; amountDue = phần giao qua Pancake. */
  private async orderUpdate(order: OrderWithItems, onCredit: boolean) {
    const variations = await this.variationsOf(order);
    const { body, amountDue, paymentState, tagNames } = buildPancakeOrderBody(order, {
      recipient: await this.recipientOf(order),
      variations,
      onDealerCredit: onCredit,
      recyclingNote: await this.buildRecyclingNote(order),
      isPancakeLine: this.pancakeLinesOf(variations),
    });
    const tags = await this.mergedTags(order, tagNames);
    const payload = {
      ...(isPancakePrepaid(paymentState) ? { transfer_money: body.transfer_money, cod: body.cod } : {}),
      ...(tags ? { tags } : {}),
      note: body.note,
    };
    return { payload, amountDue };
  }

  /**
   * Thẻ cho PUT: PUT thay cả danh sách nên giữ thẻ nhân viên gắn tay trên Pancake (đọc đơn hiện tại), chỉ gỡ thẻ
   * trạng thái thanh toán của ta khi không còn đúng. Không đọc được đơn thì bỏ hẳn `tags` — thà không đổi thẻ còn hơn xoá thẻ tay.
   */
  private async mergedTags(order: OrderWithItems, tagNames: string[]): Promise<PancakeOrderTagRef[] | undefined> {
    // Một lần gọi cho cả hai nhóm: hai lần gọi có thể cho kết quả lệch nhau khi lần đọc danh sách thẻ đầu lỗi (trả [] không cache).
    const paymentNames = Object.values(PANCAKE_PAYMENT_TAG);
    const resolved = await this.client.resolveOrderTags([...new Set([...tagNames, ...paymentNames])]);
    const norm = (n: string | undefined) => (n ?? '').trim().toLowerCase();
    const wantedKeys = new Set(tagNames.map(norm));
    const paymentKeys = new Set(paymentNames.map(norm));
    const wanted = resolved.filter((t) => wantedKeys.has(norm(t.name)));
    const ownPaymentIds = new Set(resolved.filter((t) => paymentKeys.has(norm(t.name))).map((t) => t.id));
    if (wanted.length === 0 && ownPaymentIds.size === 0) return undefined;
    let current: PancakeOrderDTO | null;
    try {
      current = await this.client.getOrder(order.pancakeOrderId!);
    } catch {
      return undefined;
    }
    if (!current) return undefined;
    const existing = current.tags ?? [];
    if (!Array.isArray(existing)) return undefined;
    // Thẻ không đọc được dạng {id: số} thì không dựng lại danh sách được: PUT sẽ xoá nhầm thẻ tay.
    if (!existing.every((t): t is PancakeOrderTagRef => typeof t === 'object' && t !== null && typeof t.id === 'number')) return undefined;
    const wantedIds = new Set(wanted.map((t) => t.id));
    const kept = existing.filter((t) => !ownPaymentIds.has(t.id) || wantedIds.has(t.id));
    if (wanted.length === 0 && kept.length === existing.length) return undefined;
    const merged = new Map<number, PancakeOrderTagRef>();
    for (const t of [...kept, ...wanted]) merged.set(t.id, { id: t.id, ...(t.name ? { name: t.name } : {}) });
    return [...merged.values()];
  }

  /**
   * Thẻ lấy từ cache có thể đã bị xoá trên Pancake: 4xx nhắc tới `tags` thì bỏ cache và gửi lại MỘT lần không kèm thẻ,
   * để thẻ không làm hỏng đẩy đơn / ghi nhận thanh toán.
   */
  private async withTagFallback<T extends { tags?: PancakeOrderTagRef[] }, R>(payload: T, send: (p: T) => Promise<R>): Promise<R> {
    try {
      return await send(payload);
    } catch (err) {
      if (!payload.tags || !isTagsRejection(err)) throw err;
      this.client.invalidateOrderTags();
      this.logger.warn(`Pancake từ chối thẻ đơn, gửi lại không kèm thẻ: ${pancakeErrorText(err)}`);
      const { tags: _dropped, ...rest } = payload;
      return send(rest as T);
    }
  }

  private putOrder(pancakeOrderId: string, payload: PancakeUpdateOrderBody): Promise<PancakeOrderDTO | null> {
    return this.withTagFallback(payload, (p) => this.client.updateOrder(pancakeOrderId, p));
  }

  /**
   * Ghi chú vừa gửi Pancake dựng từ ảnh chụp `sent`; Gomdon gắn vận đơn chen giữa (job thanh toán và job vận đơn chạy
   * song song) thì Pancake đang giữ ghi chú cũ — PUT lại theo đơn mới nhất. Lỗi → báo "ghi mã vào Pancake".
   */
  private async refreshNoteIfWaybillChanged(sent: Pick<Order, 'id' | 'code' | 'hasRecyclingPickup' | 'gomdonPartnerCode'>): Promise<void> {
    if (!sent.hasRecyclingPickup) return;
    const now = await this.prisma.order.findUnique({
      where: { id: sent.id },
      select: { gomdonPartnerCode: true, pancakeOrderId: true },
    });
    if (!now?.pancakeOrderId || !now.gomdonPartnerCode || now.gomdonPartnerCode === sent.gomdonPartnerCode) return;
    try {
      await this.syncWaybillNote(sent.id);
    } catch (err) {
      await this.alerts?.alert(
        sent.code,
        waybillNoteAlert(now.gomdonPartnerCode, now.pancakeOrderId, err),
        undefined,
        GOMDON_ALERT_KIND.WAYBILL_NOTE,
      );
    }
  }

  /**
   * Huỷ đơn Pancake của đơn đã huỷ ở Tubu (job 'cancel', cron cứu hộ). Pancake đã gửi hàng → TOO_LATE + báo admin
   * chặn giao; không thấy đơn → NOT_FOUND. Lỗi kết nối → ném để retry; lần cuối → FAILED + báo admin huỷ tay.
   */
  async cancelOnPancake(orderId: string, final = false): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== 'CANCELLED') return;
    if (isMerchantFulfilledOrder(order)) return; // D4: chưa từng lên Pancake, không gọi Pancake
    const settled: string[] = [PANCAKE_CANCEL.CANCELLED, PANCAKE_CANCEL.NOT_FOUND, PANCAKE_CANCEL.TOO_LATE];
    if (order.pancakeCancelStatus && settled.includes(order.pancakeCancelStatus)) return;
    if (!mayExistOnPancake(order)) {
      await this.setCancelStatus(order.id, PANCAKE_CANCEL.NOT_FOUND);
      await clearPancakeAttention(this.prisma, order.id, ATTENTION_SETTLED_BY_CANCEL);
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
          await clearPancakeAttention(this.prisma, order.id, ATTENTION_SETTLED_BY_CANCEL);
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
      await clearPancakeAttention(this.prisma, order.id, ATTENTION_SETTLED_BY_CANCEL);
    } catch (err) {
      // Pancake đã trả lời và từ chối lệnh huỷ đơn chưa bàn giao: thử lại ngay không đổi được kết quả → chốt luôn, báo huỷ tay.
      const refused = err instanceof PancakeCancelRefusedError;
      const terminal = final || refused;
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          pancakeSyncError: refused ? `${PANCAKE_CANCEL_REFUSED_PREFIX}${pancakeErrorText(err)}` : pancakeErrorText(err),
          ...(terminal ? { pancakeCancelStatus: PANCAKE_CANCEL.FAILED } : {}),
        },
      });
      if (terminal) {
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
        pancakeErrorKind: null,
        pancakePaymentSynced: paymentSynced,
      },
    });
    if (saved.count === 0) return;
    await clearPancakeAttention(this.prisma, order.id, ATTENTION_PUSH_FAILED);
    await removeFailedPancakePush(this.pushQueue, order.id);
    // Một lần đẩy thành công (đơn nào cũng được) nghĩa là khoá API đã đúng lại: cả nhóm CONFIG quay lại lô thử lại của cron, đánh dấu
    // CONFIG_RECHECK để lần thử kế tiếp mà vẫn 401/403 thì biết đó là lỗi riêng của đơn (kindAfterFailure), không rơi lại nhóm CONFIG mãi.
    await this.prisma.order.updateMany({ where: { pancakeOrderId: null, pancakeErrorKind: PUSH_ERROR_KIND.CONFIG }, data: { pancakeErrorKind: PUSH_ERROR_KIND.CONFIG_RECHECK } });
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
    return this.prisma.order.updateMany({ where: { id: orderId, pancakeOrderId: null, AND: [NOT_STALE_WHERE] }, data: { pancakePushStatus: status } });
  }

  /**
   * `updateMany` không bao giờ ghi `pancakePushStatus` lên đơn STALE (xem NOT_STALE_WHERE). Câu ghi đầu mang điều kiện "chưa STALE"; hụt
   * thì ghi lại BỎ trường trạng thái, nên loại lỗi, lời lỗi, mốc và hoàn lượt vẫn được ghi. Dữ liệu không có trạng thái thì ghi thẳng.
   */
  private async updateManyKeepingStale(where: Prisma.OrderWhereInput, data: Record<string, unknown>): Promise<{ count: number }> {
    if (!('pancakePushStatus' in data)) return this.prisma.order.updateMany({ where, data });
    const withStatus = await this.prisma.order.updateMany({ where: { AND: [where, NOT_STALE_WHERE] }, data });
    if (withStatus.count > 0) return withStatus;
    const rest = { ...data };
    delete rest.pancakePushStatus;
    return this.prisma.order.updateMany({ where, data: rest });
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
      select: { id: true, pancakeId: true, retailPrice: true, product: { select: { fulfilment: true } } },
    });
    return new Map(
      variations.map((v) => [v.id, { pancakeId: v.pancakeId, retailPrice: v.retailPrice, fulfilment: v.product?.fulfilment ?? null }]),
    );
  }

  /** Dòng do kho Tubu giao (isPancakeFulfilledLine): có mã biến thể Pancake thật, sản phẩm không phải đối tác tự giao. */
  private pancakeLinesOf(variations: Map<string, { pancakeId: string | null; fulfilment: string | null }>): PancakeLinePredicate {
    return (line) => {
      const v = variations.get(line.variationId);
      return v != null && isPancakeFulfilledLine(v);
    };
  }

  /** Dòng không có mã Pancake trên đơn kho Tubu (đơn cũ lẫn hàng đối tác, dữ liệu lỗi): admin xử lý tay qua hàng đợi Pancake. */
  private async flagUnpushableLines(orderId: string, code: string, count: number, none: boolean): Promise<void> {
    const reason = none
      ? `Đơn không có dòng nào có mã Pancake hợp lệ (${count} dòng) — chưa gửi kho, cần xử lý tay.`
      : `${count} dòng không có mã Pancake (hàng đối tác tự giao hoặc dữ liệu lỗi) — chỉ gửi kho phần còn lại, xử lý tay phần này.`;
    this.logger.warn(`Đơn ${code}: ${reason}`);
    await writePancakeAttention(this.prisma, orderId, reason);
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
    const noteDetail = recyclingNoteDetail(order.recyclingNote);
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

/** Báo động khi chưa ghi được mã vận đơn Gomdon vào đơn Pancake (cả đơn COD lẫn trả trước). */
export function waybillNoteAlert(partnerCode: string, pancakeOrderId: string, err: unknown): string {
  return (
    `Đã có vận đơn Gomdon ${partnerCode} nhưng chưa ghi được mã vào đơn Pancake #${pancakeOrderId} (${pancakeErrorText(err)}) — ` +
    'ghi mã vào ghi chú Pancake, KHÔNG tạo vận đơn khác.'
  );
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
      throw new PancakeCancelRefusedError(err.message, after.status ?? null);
    }
    throw err;
  }
}
