import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { UnrecoverableError, type Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GomdonClient } from './gomdon.client';
import type { GomdonCreateOrderBody, GomdonCreateOrderResponse } from './gomdon.types';
import { PancakeOrderService } from '../pancake/pancake-order.service';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { GomdonAlertService } from './gomdon-alert.service';
import { GomdonDuplicateOrderError, GomdonRejectedError } from './gomdon.errors';
import { enqueueGomdonCancel, enqueueGomdonPush } from './gomdon-queue';
import { recyclingWeight } from './gomdon-weight';
import {
  GOMDON_CANCEL,
  GOMDON_MANUAL_HANDLEABLE,
  GOMDON_STATE,
  gomdonStatusNumber,
  gomdonStatusText,
  isGomdonPayable,
  isGomdonPickedUp,
} from './gomdon-status';

interface ShippingSnapshot {
  recipient: string;
  phone: string;
  street: string;
  ward: string;
  district: string;
  province: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

const DEAD_STATUSES = ['CANCELLED', 'RETURNED'] as const;
const isDead = (status: string) => (DEAD_STATUSES as readonly string[]).includes(status);
/** Giá trị số/chuỗi từ response Gomdon → chuỗi đã trim; rỗng/null → null. */
const nonEmpty = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * Trạng thái "đã chốt, không tự tạo vận đơn nữa" — kho đã/ sẽ được báo tạo tay hoặc kiểm tra tay, hoặc
 * admin đã đánh dấu "Đã xử lý tay".
 */
const SETTLED_WITHOUT_WAYBILL = new Set<string>([
  GOMDON_STATE.FAILED,
  GOMDON_STATE.NOT_CONFIGURED,
  GOMDON_STATE.NEEDS_MANUAL_CHECK,
  GOMDON_STATE.MANUAL_HANDLED,
]);

/** Hàng đã rời kho — tạo vận đơn Gomdon mới lúc này là bưu tá giao lần 2. */
const SHIPPED_STATUSES = ['SHIPPING', 'DELIVERED'] as const;

/**
 * Vận đơn đổi hàng Gomdon (bưu tá giao hàng + thu lại vật liệu tái chế) cho đơn có hasRecyclingPickup.
 *
 * Luồng (xem gomdon-status.ts cho ý nghĩa từng trạng thái):
 *  1. Đơn chưa "thanh toán được" (chuyển khoản/ZaloPay chưa PAID) → AWAITING_PAYMENT, đẩy Pancake NGAY
 *     (đối soát chuyển khoản đi qua Pancake), CHƯA đặt bưu tá. Khi tiền về, zalopay.service /
 *     pancake.processor onPaymentReconcile enqueue lại → tạo vận đơn.
 *  2. Claim nguyên tử gomdonStatus → CREATING rồi mới gọi API tạo đơn (không idempotent phía Gomdon).
 *  3. Lỗi CHẮC CHẮN chưa tạo → nhả claim, BullMQ retry. Lỗi KHÔNG RÕ → NEEDS_MANUAL_CHECK, không bao giờ
 *     tạo lại (tránh 5 vận đơn cho 1 đơn), báo CSKH + đẩy Pancake với ghi chú "kiểm tra Gomdon".
 *  4. Tạo xong mà đơn đã bị huỷ giữa chừng → vẫn lưu mã + enqueue huỷ vận đơn.
 */
@Injectable()
export class GomdonOrderService {
  private readonly logger = new Logger(GomdonOrderService.name);
  /** Claim CREATING trẻ hơn mốc này = tiến trình khác đang gọi Gomdon (timeout client 15s × dư an toàn). */
  static readonly CREATING_LEASE_MS = 2 * 60_000;
  /** Độ trễ giữa các lần ghi lại mã vận đơn khi DB chập chờn (test đặt 0). */
  protected persistRetryDelayMs = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gomdonClient: GomdonClient,
    @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue: Queue,
    private readonly pancakeOrder: PancakeOrderService,
    private readonly alerts: GomdonAlertService,
  ) {}

  /** Xếp hàng tạo vận đơn (retry+backoff 5 lần). An toàn gọi lặp — pushOrder có claim. */
  async enqueuePush(orderId: string): Promise<void> {
    await enqueueGomdonPush(this.gomdonQueue, orderId);
  }

  async enqueueCancel(orderId: string): Promise<void> {
    await enqueueGomdonCancel(this.gomdonQueue, orderId);
  }

  /** Cờ tính năng checkout (đã cấu hình + admin bật). */
  isRecyclingEnabled(): Promise<boolean> {
    return this.gomdonClient.isRecyclingEnabled();
  }

  /**
   * Tạo vận đơn Gomdon cho đơn rồi đẩy tiếp Pancake. Chỉ ném lỗi khi RETRY AN TOÀN (Gomdon chắc chắn
   * chưa tạo, hoặc lỗi đọc DB trước khi claim); UnrecoverableError khi đã tạo mà không ghi được DB.
   */
  async pushOrder(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });

    // Chỉ những đơn có chọn thu gom vật liệu tái chế mới tạo đơn Gomdon
    if (!order.hasRecyclingPickup) {
      this.logger.debug(`Đơn ${order.code} không có thu gom tái chế — bỏ qua Gomdon, đẩy Pancake.`);
      await this.pancakeOrder.enqueuePush(order.id);
      return null;
    }

    // Idempotent: đã có vận đơn → chỉ đảm bảo Pancake đã nhận đơn.
    if (order.gomdonPartnerCode || order.gomdonOrderId) {
      if (!order.pancakeOrderId && !isDead(order.status)) {
        await this.pancakeOrder.enqueuePush(order.id);
      }
      return order.gomdonPartnerCode ?? order.gomdonOrderId;
    }

    // Đơn đã huỷ/trả: KHÔNG đặt bưu tá, không đẩy Pancake.
    if (isDead(order.status)) {
      // Kẹt CREATING quá lease (tiến trình chết giữa lúc gọi Gomdon) → Gomdon CÓ THỂ đã tạo vận đơn cho
      // đơn đã huỷ. Chốt NEEDS_MANUAL_CHECK + báo người huỷ tay — không để đơn nằm CREATING mãi (cron
      // cứu hộ không còn gì để làm với nó). Còn trong lease: tiến trình đang tạo tự enqueue huỷ sau khi có mã.
      if (order.gomdonStatus === GOMDON_STATE.CREATING && this.creatingLeaseExpired(order)) {
        await this.markDeadCreatingForManualCheck(order);
      }
      this.logger.log(`Đơn ${order.code} đã ${order.status} — không tạo vận đơn Gomdon.`);
      return null;
    }

    const status = order.gomdonStatus;
    if (status && (SETTLED_WITHOUT_WAYBILL.has(status) || gomdonStatusNumber(status) != null)) {
      // Đã chốt (tạo tay / kiểm tra tay / đã xử lý tay) hoặc webhook đã báo trạng thái — không tự tạo thêm.
      if (!order.pancakeOrderId) await this.pancakeOrder.enqueuePush(order.id);
      return null;
    }

    if (status === GOMDON_STATE.CREATING) {
      // Claim còn "tươi" → tiến trình khác (job chạy chồng do BullMQ stalled) đang gọi Gomdon; nó sẽ tự
      // ghi mã + đẩy Pancake. Bỏ qua lần này thay vì báo động nhầm. CREATING kẹt lâu do cron cứu hộ xử lý.
      if (!this.creatingLeaseExpired(order)) {
        this.logger.warn(`Đơn ${order.code}: đang có tiến trình khác tạo vận đơn Gomdon — bỏ qua lần chạy chồng.`);
        return null;
      }
      // Lần chạy trước đã claim nhưng chưa ghi được kết quả (crash/timeout giữa chừng) — Gomdon có thể
      // ĐÃ tạo vận đơn. Tạo lại = vận đơn trùng → chuyển kiểm tra tay.
      await this.markNeedsManualCheck(order, 'Lần tạo vận đơn trước bị gián đoạn, không rõ Gomdon đã tạo chưa');
      return null;
    }

    if (!isGomdonPayable(order)) {
      // Trả trước chưa thanh toán: chưa đặt bưu tá (không giao hàng cho đơn chưa trả tiền). Pancake
      // vẫn phải có đơn để đối soát chuyển khoản → đẩy ngay, ghi chú "chờ thanh toán".
      await this.prisma.order.updateMany({
        where: { id: order.id, gomdonStatus: null },
        data: { gomdonStatus: GOMDON_STATE.AWAITING_PAYMENT },
      });
      if (!order.pancakeOrderId) await this.pancakeOrder.enqueuePush(order.id);
      this.logger.log(`Đơn ${order.code} chưa thanh toán — chờ thanh toán mới tạo vận đơn Gomdon.`);
      return null;
    }

    if (!(await this.gomdonClient.isConfigured())) {
      this.logger.warn(`Gomdon chưa cấu hình — đơn ${order.code} đẩy Pancake với cờ tạo vận đơn tay.`);
      await this.prisma.order.updateMany({
        where: { id: order.id, gomdonOrderId: null, OR: [{ gomdonStatus: null }, { gomdonStatus: GOMDON_STATE.AWAITING_PAYMENT }] },
        data: { gomdonStatus: GOMDON_STATE.NOT_CONFIGURED },
      });
      if (!order.pancakeOrderId) {
        await this.pancakeOrder.enqueuePush(order.id);
      } else {
        await this.alerts.alert(order.code, 'Gomdon chưa cấu hình — đơn thu gom đã thanh toán cần TẠO VẬN ĐƠN TAY (Pancake đã có đơn).');
      }
      return null;
    }

    // Dựng body TRƯỚC khi claim — lỗi dựng body (dữ liệu hỏng) không được bị hiểu nhầm là "không rõ đã tạo".
    const body = await this.buildBody(order);

    // CLAIM nguyên tử: chỉ một worker được gọi API tạo đơn cho mỗi đơn.
    const claim = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        gomdonOrderId: null,
        gomdonPartnerCode: null,
        status: { notIn: [...DEAD_STATUSES] },
        OR: [{ gomdonStatus: null }, { gomdonStatus: GOMDON_STATE.AWAITING_PAYMENT }],
      },
      data: { gomdonStatus: GOMDON_STATE.CREATING },
    });
    if (claim.count === 0) {
      this.logger.warn(`Đơn ${order.code}: trạng thái Gomdon/đơn vừa đổi bởi tiến trình khác — bỏ qua lần tạo này.`);
      return null;
    }

    let res: GomdonCreateOrderResponse;
    try {
      res = await this.gomdonClient.createOrder(body);
    } catch (err) {
      if (err instanceof GomdonRejectedError) {
        // Chắc chắn chưa tạo → nhả claim để BullMQ retry.
        await this.prisma.order.updateMany({
          where: { id: order.id, gomdonStatus: GOMDON_STATE.CREATING },
          data: { gomdonStatus: null },
        });
        throw err;
      }
      if (err instanceof GomdonDuplicateOrderError) {
        // order_customer_id là khoá duy nhất bên Gomdon: bị từ chối vì trùng = Gomdon ĐÃ CÓ đơn cho mã này
        // (lần tạo trước mất response, hoặc vận đơn cũ đã huỷ vẫn giữ mã). Không retry, không báo "tạo tay".
        await this.markNeedsManualCheck(
          order,
          `Gomdon báo ĐÃ CÓ đơn mang mã ${order.code} (order_customer_id phải duy nhất): ${err.message}`,
          `Tra Gomdon theo mã đơn ${order.code}: vận đơn còn chạy thì KHÔNG tạo vận đơn tay (webhook Gomdon tự gắn mã vận đơn); ` +
            'vận đơn đó đã huỷ thì tạo vận đơn tay trên Gomdon rồi bấm "Đã xử lý tay".',
        );
        return null;
      }
      await this.markNeedsManualCheck(order, `Không rõ Gomdon đã tạo vận đơn chưa: ${err instanceof Error ? err.message : err}`);
      return null;
    }

    // Tài liệu Gomdon: data.id = mã số đơn Gomdon (API huỷ /order/cancel/{id} dùng số này), data.partner_code
    // = mã vận đơn của hãng (trùng order_code trong webhook). data.code là mã NỘI BỘ Gomdon dạng
    // "<id>-<user>-<tên>" — không phải vận đơn, không lưu (lưu vào gomdonPartnerCode thì webhook không bao
    // giờ khớp theo mã vận đơn, khách thấy sai mã).
    const gomdonId = nonEmpty(res.data?.id);
    // Thiếu partner_code mà có id → tạm dùng id: ghi chú Pancake vẫn là "ĐÃ CÓ VẬN ĐƠN" (không để kho tạo
    // thêm), webhook mang order_code sẽ thay bằng mã vận đơn thật.
    const partnerCode = nonEmpty(res.data?.partner_code) ?? gomdonId;
    if (!partnerCode) {
      await this.markNeedsManualCheck(order, 'Gomdon báo tạo thành công nhưng không trả id đơn/mã vận đơn');
      return null;
    }

    await this.persistCreated(order, gomdonId, partnerCode, res);
    this.logger.log(`Tạo đơn Gomdon thành công cho ${order.code} (Mã VĐ: ${partnerCode}).`);

    // Đơn bị huỷ TRONG LÚC đang tạo vận đơn → huỷ luôn vận đơn vừa tạo.
    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, pancakeOrderId: true },
    });
    if (!fresh || isDead(fresh.status)) {
      this.logger.warn(`Đơn ${order.code} đã bị huỷ trong lúc tạo vận đơn ${partnerCode} → enqueue huỷ vận đơn.`);
      await this.enqueueCancel(order.id);
      return partnerCode;
    }
    if (!fresh.pancakeOrderId) {
      // Thành công → đẩy tiếp sang Pancake với mã Gomdon trong note.
      await this.pancakeOrder.enqueuePush(order.id);
    } else {
      // Đơn trả trước: Pancake đã nhận đơn lúc chờ thanh toán (note "chờ thanh toán") — không có API sửa
      // note Pancake, báo CSKH/kho ghi mã vào Pancake để không ai tạo thêm vận đơn khác.
      await this.alerts.alert(
        order.code,
        `Đã tạo vận đơn Gomdon ${partnerCode} sau khi khách thanh toán. Đơn Pancake tạo trước đó chưa có mã này — ghi mã vào Pancake, KHÔNG tạo vận đơn khác.`,
      );
    }
    return partnerCode;
  }

  /**
   * Fail-safe khi hết lượt retry tạo vận đơn (gọi từ processor). Ném lỗi nếu chính bước này lỗi
   * (DB down) để job kết thúc 'failed' — cron cứu hộ chạy lại sau (không bị kẹt ở 'completed').
   */
  async markFinalPushFailure(orderId: string, lastError: unknown): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || !order.hasRecyclingPickup) return;
    const reason = lastError instanceof Error ? lastError.message : String(lastError);

    if (order.gomdonOrderId || order.gomdonPartnerCode) {
      if (!order.pancakeOrderId && !isDead(order.status)) await this.pancakeOrder.enqueuePush(order.id);
      return;
    }

    // CREATING lúc này = không rõ đã tạo chưa → kiểm tra tay; còn lại (chắc chắn chưa tạo) → tạo tay.
    const unclear = await this.prisma.order.updateMany({
      where: { id: order.id, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: GOMDON_STATE.CREATING },
      data: { gomdonStatus: GOMDON_STATE.NEEDS_MANUAL_CHECK },
    });
    const failed = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        gomdonOrderId: null,
        gomdonPartnerCode: null,
        OR: [{ gomdonStatus: null }, { gomdonStatus: GOMDON_STATE.AWAITING_PAYMENT }],
      },
      data: { gomdonStatus: GOMDON_STATE.FAILED },
    });
    if (unclear.count === 0 && failed.count === 0) return; // đã chốt ở nơi khác

    if (isDead(order.status)) {
      if (unclear.count > 0) {
        await this.alerts.alert(order.code, 'Đơn đã huỷ nhưng không rõ Gomdon đã tạo vận đơn chưa — kiểm tra và huỷ tay trên Gomdon.');
      }
      return;
    }
    if (!order.pancakeOrderId) await this.pancakeOrder.enqueuePush(order.id);
    await this.alerts.alert(
      order.code,
      unclear.count > 0
        ? `Không rõ Gomdon đã tạo vận đơn chưa (${reason}). KIỂM TRA GOMDON trước khi tạo vận đơn tay.`
        : `Tạo vận đơn Gomdon thất bại sau nhiều lần thử (${reason}). Cần TẠO VẬN ĐƠN TAY và hẹn thu gom với khách.`,
    );
  }

  /**
   * Huỷ vận đơn Gomdon của đơn đã CANCELLED (job 'cancel', retry). Không bao giờ hoàn tiền ở đây —
   * hoàn tiền/restock đã chạy trong OrderReversalService lúc huỷ đơn.
   */
  async cancelOnGomdon(orderId: string, isLastAttempt: boolean): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || !order.hasRecyclingPickup) return;
    if (order.status !== 'CANCELLED') {
      this.logger.warn(`Bỏ qua huỷ vận đơn Gomdon: đơn ${order.code} đang ${order.status}.`);
      return;
    }
    if (
      order.gomdonCancelStatus === GOMDON_CANCEL.CANCELLED ||
      order.gomdonCancelStatus === GOMDON_CANCEL.TOO_LATE ||
      order.gomdonCancelStatus === GOMDON_CANCEL.NOT_NEEDED
    ) {
      return; // đã chốt
    }

    // Lần chạy lại khi đã FAILED (job chồng / webhook xếp lại) không báo động trùng cho cùng một việc.
    const alreadyFailed = order.gomdonCancelStatus === GOMDON_CANCEL.FAILED;
    // CÓ vận đơn = có id số Gomdon HOẶC chỉ có mã BestExpress (Gomdon không trả id / webhook tự lành chỉ
    // có order_code). Vận đơn chỉ-có-mã vẫn là vận đơn SỐNG — coi là "không cần huỷ" thì bưu tá vẫn giao
    // và thu COD cho đơn đã huỷ.
    const hasWaybill = Boolean(order.gomdonOrderId || order.gomdonPartnerCode);

    try {
      if (order.gomdonStatus === GOMDON_STATE.MANUAL_HANDLED) {
        // Thu gom đã được người xử lý tay (có thể có vận đơn tạo tay / vận đơn Gomdon cũ) — hệ thống không
        // biết vận đơn nào còn sống → mở lại thành việc kiểm tra tay (vào lại hàng đợi "Cần xử lý thu gom").
        await this.prisma.order.updateMany({
          where: { id: order.id, gomdonStatus: GOMDON_STATE.MANUAL_HANDLED },
          data: { gomdonStatus: GOMDON_STATE.NEEDS_MANUAL_CHECK },
        });
        await this.setCancelStatus(order.id, GOMDON_CANCEL.FAILED);
        if (!alreadyFailed) {
          await this.alerts.alert(
            order.code,
            `Đơn đã huỷ sau khi thu gom được đánh dấu "Đã xử lý tay" — kiểm tra & huỷ tay mọi vận đơn thu gom còn chạy${
              order.gomdonPartnerCode ? ` (Gomdon ${order.gomdonPartnerCode})` : ''
            } và vận đơn tạo tay (nếu có).`,
          );
        }
        return;
      }
      if (!hasWaybill) {
        if (order.gomdonStatus === GOMDON_STATE.CREATING) {
          if (this.creatingLeaseExpired(order)) {
            // Tiến trình tạo vận đơn đã chết giữa chừng → không ai enqueue huỷ nữa: chốt kiểm tra tay.
            await this.markDeadCreatingForManualCheck(order);
            return;
          }
          // Vận đơn đang được tạo — pushOrder sẽ tự enqueue huỷ sau khi tạo xong; thử lại sau.
          throw new Error('Vận đơn Gomdon đang được tạo, chưa có mã để huỷ');
        }
        if (order.gomdonStatus === GOMDON_STATE.NEEDS_MANUAL_CHECK) {
          await this.setCancelStatus(order.id, GOMDON_CANCEL.FAILED);
          if (!alreadyFailed) {
            await this.alerts.alert(order.code, 'Đơn đã huỷ nhưng không rõ Gomdon đã tạo vận đơn chưa — kiểm tra và huỷ tay trên Gomdon.');
          }
          return;
        }
        await this.setCancelStatus(order.id, GOMDON_CANCEL.NOT_NEEDED);
        return;
      }
      if (order.gomdonStatus === '2') {
        await this.setCancelStatus(order.id, GOMDON_CANCEL.CANCELLED);
        return;
      }
      if (isGomdonPickedUp(order.gomdonStatus)) {
        await this.setCancelStatus(order.id, GOMDON_CANCEL.TOO_LATE);
        await this.alerts.alert(
          order.code,
          `Đơn đã huỷ nhưng bưu tá đã lấy hàng (Gomdon: ${gomdonStatusText(Number(order.gomdonStatus))}) — liên hệ Gomdon/BestExpress chặn giao và hoàn hàng về kho.`,
        );
        return;
      }
      if (!order.gomdonOrderId) {
        // API huỷ là /order/cancel/{id số} — chỉ có mã BestExpress thì không huỷ tự động được. KHÔNG
        // retry (vô ích); webhook Gomdon tới sau mang order_id sẽ điền id và xếp lại job huỷ.
        await this.setCancelStatus(order.id, GOMDON_CANCEL.FAILED);
        if (!alreadyFailed) {
          await this.alerts.alert(
            order.code,
            `Đơn đã huỷ nhưng vận đơn Gomdon ${order.gomdonPartnerCode} chưa có mã số Gomdon để huỷ qua API — HUỶ TAY trên Gomdon theo mã vận đơn ${order.gomdonPartnerCode} để bưu tá không tới giao hàng/thu COD.`,
          );
        }
        return;
      }

      const res = await this.gomdonClient.cancelOrder(order.gomdonOrderId);
      if (!res.ok) throw new Error(`Gomdon không huỷ được vận đơn: ${res.message ?? 'không rõ lý do'}`);
      await this.setCancelStatus(order.id, GOMDON_CANCEL.CANCELLED);
      this.logger.log(`Đã huỷ vận đơn Gomdon ${order.gomdonPartnerCode ?? order.gomdonOrderId} cho đơn ${order.code}.`);
    } catch (err) {
      if (!isLastAttempt) throw err; // BullMQ retry
      await this.setCancelStatus(order.id, GOMDON_CANCEL.FAILED);
      await this.alerts.alert(
        order.code,
        `Không huỷ được vận đơn Gomdon ${order.gomdonPartnerCode ?? order.gomdonOrderId ?? ''} cho đơn đã huỷ (${
          err instanceof Error ? err.message : err
        }) — huỷ tay trên Gomdon để bưu tá không tới lấy hàng.`,
      );
    }
  }

  // ── Thao tác admin (web admin gọi qua AdminModule — kiểm quyền + audit ở phía admin) ──────

  /**
   * Admin bấm "Thử lại tạo vận đơn". Chỉ cho phép khi CHẮC không có vận đơn sống nào:
   *  - null / AWAITING_PAYMENT đã PAID (job kẹt) → enqueue lại;
   *  - FAILED / NOT_CONFIGURED → nhả về null rồi enqueue (kho có thể đã tạo tay theo note Pancake —
   *    UI admin phải cảnh báo trước khi bấm);
   *  - NEEDS_MANUAL_CHECK → BẮT BUỘC confirmedNoWaybill=true (admin đã tra Gomdon theo mã đơn, không có);
   *  - '2' (vận đơn đã huỷ phía Gomdon, đơn vẫn hiệu lực) → gỡ mã cũ, tạo vận đơn mới.
   * Vận đơn đang sống (1,3..12 trừ 2) / đang CREATING → từ chối (tạo thêm = giao 2 lần).
   */
  async retryPush(orderId: string, opts: { confirmedNoWaybill?: boolean } = {}): Promise<{ queued: true; message: string }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (!order.hasRecyclingPickup) throw new BadRequestException('Đơn không chọn thu gom tái chế.');
    if (isDead(order.status)) throw new BadRequestException(`Đơn đã ${order.status} — không tạo vận đơn Gomdon.`);
    if ((SHIPPED_STATUSES as readonly string[]).includes(order.status)) {
      throw new BadRequestException(
        `Đơn ${order.status === 'SHIPPING' ? 'đang giao' : 'đã giao'} — hàng đã rời kho, không tạo vận đơn Gomdon mới (bưu tá sẽ giao lần 2). ` +
          'Nếu bưu tá chưa nhận vật liệu tái chế, hẹn thu gom riêng với khách rồi bấm "Đã xử lý tay".',
      );
    }
    if (!isGomdonPayable(order)) {
      throw new BadRequestException('Đơn trả trước chưa thanh toán — vận đơn sẽ tự tạo khi khách thanh toán.');
    }
    if (!(await this.gomdonClient.isConfigured())) {
      throw new BadRequestException('Gomdon chưa cấu hình (GOMDON_BASE_URL/GOMDON_PHONE/GOMDON_PASSWORD).');
    }

    const cur = order.gomdonStatus;
    const hasIds = Boolean(order.gomdonOrderId || order.gomdonPartnerCode);
    let reset: Prisma.OrderUpdateManyArgs | null = null;

    if (cur === GOMDON_STATE.CREATING) {
      throw new BadRequestException('Vận đơn đang được tạo — thử lại sau ít phút.');
    } else if (cur === GOMDON_STATE.MANUAL_HANDLED) {
      throw new BadRequestException('Đơn đã được đánh dấu "Đã xử lý tay" — hệ thống không tự tạo vận đơn Gomdon cho đơn này nữa.');
    } else if (cur === '2') {
      const history = Array.isArray(order.shippingHistory) ? order.shippingHistory : [];
      reset = {
        where: { id: order.id, gomdonStatus: '2', gomdonOrderId: order.gomdonOrderId, gomdonPartnerCode: order.gomdonPartnerCode },
        data: {
          gomdonOrderId: null,
          gomdonPartnerCode: null,
          gomdonStatus: null,
          gomdonStatusAt: null,
          gomdonCancelStatus: null,
          shippingCode: null,
          shippingStatus: null,
          shippingHistory: [
            ...history,
            {
              at: new Date().toISOString(),
              status: 'Tạo lại vận đơn thu gom',
              carrier: 'BestExpress',
              code: order.gomdonPartnerCode ?? order.gomdonOrderId,
              note: 'Vận đơn cũ đã huỷ',
            },
          ] as object,
        },
      };
    } else if (hasIds) {
      throw new BadRequestException(
        `Đơn đã có vận đơn Gomdon ${order.gomdonPartnerCode ?? order.gomdonOrderId} (${
          gomdonStatusNumber(cur) != null ? gomdonStatusText(Number(cur)) : cur ?? 'chưa rõ'
        }) — không tạo thêm.`,
      );
    } else if (cur === GOMDON_STATE.NEEDS_MANUAL_CHECK) {
      if (!opts.confirmedNoWaybill) {
        throw new BadRequestException(
          `Chưa rõ Gomdon đã tạo vận đơn chưa — tra Gomdon theo mã đơn ${order.code} và xác nhận KHÔNG có vận đơn trước khi tạo lại.`,
        );
      }
      reset = { where: { id: order.id, gomdonStatus: cur, gomdonOrderId: null, gomdonPartnerCode: null }, data: { gomdonStatus: null } };
    } else if (cur === GOMDON_STATE.FAILED || cur === GOMDON_STATE.NOT_CONFIGURED) {
      reset = { where: { id: order.id, gomdonStatus: cur, gomdonOrderId: null, gomdonPartnerCode: null }, data: { gomdonStatus: null } };
    } else if (cur != null && cur !== GOMDON_STATE.AWAITING_PAYMENT) {
      throw new BadRequestException(`Trạng thái Gomdon ${cur} không cho phép tạo lại vận đơn.`);
    }

    if (reset) {
      const r = await this.prisma.order.updateMany(reset);
      if (r.count === 0) throw new ConflictException('Trạng thái vận đơn vừa thay đổi — tải lại trang rồi thử lại.');
    }
    await this.enqueuePush(order.id);
    return {
      queued: true,
      message: order.pancakeOrderId
        ? 'Đã xếp hàng tạo vận đơn Gomdon. Đơn Pancake đã có từ trước — khi có mã vận đơn, ghi mã vào Pancake và KHÔNG tạo vận đơn khác.'
        : 'Đã xếp hàng tạo vận đơn Gomdon.',
    };
  }

  /**
   * Admin bấm "Huỷ vận đơn Gomdon".
   *  - Đơn đã CANCELLED → xếp job huỷ (có retry; chạy lại được cả khi lần trước FAILED).
   *  - Đơn còn hiệu lực (vd đổi sang hãng khác) → gọi huỷ NGAY, trả kết quả; thành công thì ghi
   *    gomdonStatus '2' + gomdonCancelStatus CANCELLED (webhook "Đơn hủy" tới sau không báo động nữa),
   *    sau đó admin có thể retryPush() để tạo vận đơn mới hoặc giao bằng hãng khác.
   * Bưu tá đã lấy hàng → từ chối (API Gomdon không huỷ được, cần liên hệ Gomdon/BestExpress).
   */
  async cancelWaybill(orderId: string): Promise<{ result: 'QUEUED' | 'CANCELLED'; message: string }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (!order.hasRecyclingPickup) throw new BadRequestException('Đơn không chọn thu gom tái chế.');

    if (order.status === 'CANCELLED') {
      if (order.gomdonCancelStatus === GOMDON_CANCEL.CANCELLED || order.gomdonCancelStatus === GOMDON_CANCEL.NOT_NEEDED) {
        throw new BadRequestException('Vận đơn Gomdon của đơn này đã được xử lý huỷ.');
      }
      if (order.gomdonCancelStatus === GOMDON_CANCEL.FAILED || order.gomdonCancelStatus === GOMDON_CANCEL.TOO_LATE) {
        await this.prisma.order.updateMany({
          where: { id: order.id, gomdonCancelStatus: order.gomdonCancelStatus },
          data: { gomdonCancelStatus: null },
        });
      }
      await this.enqueueCancel(order.id);
      return { result: 'QUEUED', message: 'Đã xếp hàng huỷ vận đơn Gomdon (tự thử lại nếu Gomdon lỗi).' };
    }

    if (!order.gomdonOrderId && !order.gomdonPartnerCode) {
      throw new BadRequestException(
        order.gomdonStatus === GOMDON_STATE.NEEDS_MANUAL_CHECK
          ? `Chưa có mã vận đơn Gomdon — tra Gomdon theo mã đơn ${order.code} và huỷ tay nếu có.`
          : 'Đơn chưa có vận đơn Gomdon để huỷ.',
      );
    }
    if (order.gomdonStatus === GOMDON_STATE.MANUAL_HANDLED) {
      throw new BadRequestException('Đơn đã được đánh dấu "Đã xử lý tay" — hệ thống không tự huỷ vận đơn; huỷ tay trên Gomdon nếu cần.');
    }
    if (order.gomdonStatus === '2') throw new BadRequestException('Vận đơn Gomdon đã bị huỷ trước đó.');
    if (isGomdonPickedUp(order.gomdonStatus)) {
      throw new BadRequestException(
        `Bưu tá đã lấy hàng (${gomdonStatusText(Number(order.gomdonStatus))}) — không huỷ qua API được, liên hệ Gomdon/BestExpress.`,
      );
    }
    if (!order.gomdonOrderId) {
      // Có vận đơn (mã BestExpress) nhưng thiếu id số — API /order/cancel/{id} không dùng được.
      throw new BadRequestException(
        `Vận đơn ${order.gomdonPartnerCode} chưa có mã số Gomdon nên không huỷ qua API được — huỷ tay trên Gomdon theo mã vận đơn ${order.gomdonPartnerCode}.`,
      );
    }

    let res: { ok: boolean; message?: string };
    try {
      res = await this.gomdonClient.cancelOrder(order.gomdonOrderId);
    } catch (err) {
      throw new ServiceUnavailableException(`Không gọi được Gomdon để huỷ vận đơn: ${err instanceof Error ? err.message : err}`);
    }
    if (!res.ok) throw new BadRequestException(`Gomdon không huỷ được vận đơn: ${res.message ?? 'không rõ lý do'}`);

    const now = new Date();
    const history = Array.isArray(order.shippingHistory) ? order.shippingHistory : [];
    await this.prisma.order.updateMany({
      where: { id: order.id, gomdonOrderId: order.gomdonOrderId },
      data: {
        gomdonStatus: '2',
        gomdonStatusAt: now,
        gomdonCancelStatus: GOMDON_CANCEL.CANCELLED,
        shippingStatus: gomdonStatusText(2),
        shippingHistory: [
          ...history,
          { at: now.toISOString(), status: gomdonStatusText(2), carrier: 'BestExpress', code: order.gomdonPartnerCode, note: 'Admin huỷ vận đơn' },
        ] as object,
      },
    });
    return {
      result: 'CANCELLED',
      message: `Đã huỷ vận đơn ${order.gomdonPartnerCode ?? order.gomdonOrderId}. Đơn vẫn hiệu lực — tạo lại vận đơn hoặc giao bằng hãng khác, nhớ cập nhật ghi chú Pancake.`,
    };
  }

  /**
   * Admin bấm "Đã xử lý tay": vận đơn thu gom đã được người xử lý ngoài hệ thống (tạo vận đơn tay, hẹn
   * thu gom riêng, báo khách...). Chỉ từ trạng thái cần người xử lý (GOMDON_MANUAL_HANDLEABLE) — vận đơn
   * đang chạy bình thường / đang tạo / chờ thanh toán thì từ chối. Ghi bằng updateMany có guard: webhook
   * vừa gắn vận đơn sống (vd NEEDS_MANUAL_CHECK → '1') thì count=0 → Conflict, không che mất vận đơn đó.
   * Sau đó pushOrder không tự tạo vận đơn (SETTLED_WITHOUT_WAYBILL), đơn rời hàng đợi "Cần xử lý thu gom".
   */
  async markHandled(orderId: string): Promise<{ result: 'MANUAL_HANDLED'; previousStatus: string; message: string }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (!order.hasRecyclingPickup) throw new BadRequestException('Đơn không chọn thu gom tái chế.');
    const cur = order.gomdonStatus;
    if (cur === GOMDON_STATE.MANUAL_HANDLED) throw new BadRequestException('Đơn đã được đánh dấu "Đã xử lý tay" trước đó.');
    if (!cur || !GOMDON_MANUAL_HANDLEABLE.includes(cur)) {
      const label = cur == null ? 'chưa tạo vận đơn' : gomdonStatusNumber(cur) != null ? gomdonStatusText(Number(cur)) : cur;
      throw new BadRequestException(`Vận đơn thu gom đang ở trạng thái "${label}" — không cần đánh dấu xử lý tay.`);
    }

    const r = await this.prisma.order.updateMany({
      where: { id: order.id, hasRecyclingPickup: true, gomdonStatus: { in: [...GOMDON_MANUAL_HANDLEABLE] } },
      data: { gomdonStatus: GOMDON_STATE.MANUAL_HANDLED },
    });
    if (r.count === 0) throw new ConflictException('Trạng thái vận đơn vừa thay đổi — tải lại trang rồi thử lại.');
    return {
      result: 'MANUAL_HANDLED',
      previousStatus: cur,
      message: 'Đã đánh dấu "Đã xử lý tay" — đơn rời hàng đợi "Cần xử lý thu gom", hệ thống không tự tạo vận đơn Gomdon cho đơn này nữa.',
    };
  }

  // ── Helpers ────────────────────────────────────────

  /** Claim CREATING đã quá lease (không còn tiến trình nào đang gọi Gomdon cho đơn này). */
  private creatingLeaseExpired(order: { updatedAt?: Date | null }): boolean {
    const ageMs = order.updatedAt ? Date.now() - order.updatedAt.getTime() : Number.POSITIVE_INFINITY;
    return ageMs >= GomdonOrderService.CREATING_LEASE_MS;
  }

  /**
   * Đơn đã huỷ/trả mà claim CREATING bị bỏ dở: không rõ Gomdon đã tạo vận đơn chưa → NEEDS_MANUAL_CHECK
   * (+ gomdonCancelStatus FAILED với đơn CANCELLED để nằm trong hàng đợi "Cần xử lý thu gom") + báo huỷ tay.
   */
  private async markDeadCreatingForManualCheck(order: Pick<OrderWithItems, 'id' | 'code' | 'status'>): Promise<void> {
    const r = await this.prisma.order.updateMany({
      where: { id: order.id, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: GOMDON_STATE.CREATING },
      data: { gomdonStatus: GOMDON_STATE.NEEDS_MANUAL_CHECK },
    });
    if (r.count === 0) return; // tiến trình khác vừa ghi kết quả — nó tự xử lý tiếp
    if (order.status === 'CANCELLED') await this.setCancelStatus(order.id, GOMDON_CANCEL.FAILED);
    await this.alerts.alert(
      order.code,
      `Lần tạo vận đơn trước bị gián đoạn: đơn đã ${order.status === 'RETURNED' ? 'trả' : 'huỷ'} nhưng có thể đã tạo vận đơn Gomdon — kiểm tra & huỷ tay trên Gomdon (tra theo mã đơn ${order.code}).`,
    );
  }

  private async setCancelStatus(orderId: string, value: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: {
        id: orderId,
        OR: [{ gomdonCancelStatus: null }, { gomdonCancelStatus: GOMDON_CANCEL.FAILED }],
      },
      data: { gomdonCancelStatus: value },
    });
  }

  /**
   * CREATING → NEEDS_MANUAL_CHECK + đẩy Pancake (ghi chú "kiểm tra Gomdon") + báo CSKH. `advice` thay câu
   * hướng dẫn mặc định ở cuối báo động (đơn còn hiệu lực).
   */
  private async markNeedsManualCheck(order: OrderWithItems, reason: string, advice?: string): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: { id: order.id, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: GOMDON_STATE.CREATING },
        data: { gomdonStatus: GOMDON_STATE.NEEDS_MANUAL_CHECK },
      });
    } catch (err) {
      // Không ghi được → để job 'failed' (KHÔNG retry: retry sẽ lại thấy CREATING, không tạo trùng,
      // nhưng cũng vô ích). Cron cứu hộ chuyển CREATING quá hạn sang NEEDS_MANUAL_CHECK sau.
      throw new UnrecoverableError(
        `Không ghi được NEEDS_MANUAL_CHECK cho đơn ${order.code} (${reason}): ${err instanceof Error ? err.message : err}`,
      );
    }
    if (isDead(order.status)) {
      await this.alerts.alert(order.code, `${reason}. Đơn đã huỷ — kiểm tra và huỷ tay vận đơn trên Gomdon nếu có.`);
      return;
    }
    if (!order.pancakeOrderId) await this.pancakeOrder.enqueuePush(order.id);
    await this.alerts.alert(order.code, `${reason}. ${advice ?? `KIỂM TRA GOMDON (mã đơn ${order.code}) trước khi tạo vận đơn tay.`}`);
  }

  /**
   * Ghi mã vận đơn — thử lại tại chỗ khi DB chập chờn: lỗi ở đây mà để BullMQ retry thì lần sau sẽ
   * thấy CREATING (không tạo trùng) nhưng MẤT mã vận đơn vừa tạo. Hết lượt → log đủ mã để vận hành
   * tự ghi tay + UnrecoverableError; webhook Gomdon tới sau vẫn tự điền lại mã (khớp theo mã đơn).
   */
  private async persistCreated(
    order: OrderWithItems,
    gomdonId: string | null,
    partnerCode: string,
    res: GomdonCreateOrderResponse,
  ): Promise<void> {
    const statusNum = Number(res.data?.status ?? 1) || 1;
    const history = Array.isArray(order.shippingHistory) ? order.shippingHistory : [];
    const now = new Date();
    const data = {
      gomdonOrderId: gomdonId,
      gomdonPartnerCode: partnerCode,
      gomdonStatus: String(statusNum),
      gomdonStatusAt: now,
      shippingCode: partnerCode,
      shippingPartner: 'BestExpress',
      shippingStatus: gomdonStatusText(statusNum),
      shippingHistory: [
        ...history,
        { at: now.toISOString(), status: gomdonStatusText(statusNum), carrier: 'BestExpress', code: partnerCode },
      ] as object,
    };

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await this.prisma.order.updateMany({
          where: { id: order.id, gomdonStatus: GOMDON_STATE.CREATING },
          data,
        });
        if (r.count === 0) {
          // Claim bị lần chạy chồng/cron chuyển NEEDS_MANUAL_CHECK trong lúc đang tạo → giờ đã biết chắc
          // vận đơn → ghi đủ trạng thái thật (CSKH thấy "đã đặt lịch" thay vì "cần kiểm tra").
          const recovered = await this.prisma.order.updateMany({
            where: {
              id: order.id,
              gomdonOrderId: null,
              gomdonPartnerCode: null,
              gomdonStatus: GOMDON_STATE.NEEDS_MANUAL_CHECK,
            },
            data,
          });
          if (recovered.count === 0) {
            // Claim đã bị đổi khác (webhook tới trước) — vẫn KHÔNG được làm mất mã vận đơn.
            await this.prisma.order.updateMany({
              where: { id: order.id, gomdonOrderId: null, gomdonPartnerCode: null },
              data: { gomdonOrderId: gomdonId, gomdonPartnerCode: partnerCode },
            });
          }
        }
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < 3 && this.persistRetryDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.persistRetryDelayMs * attempt));
        }
      }
    }
    this.logger.error(
      `ĐÃ TẠO vận đơn Gomdon cho đơn ${order.code} (id=${gomdonId}, mã=${partnerCode}) nhưng KHÔNG GHI ĐƯỢC DB: ${
        lastErr instanceof Error ? lastErr.message : lastErr
      }`,
    );
    throw new UnrecoverableError(`Không ghi được mã vận đơn Gomdon ${partnerCode} cho đơn ${order.code}`);
  }

  private async buildBody(order: OrderWithItems): Promise<GomdonCreateOrderBody> {
    const config = await this.gomdonClient.getConfig();
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: order.items.map((i) => i.variationId) } },
      select: { id: true, weight: true },
    });
    const { totalGrams, maxKg } = recyclingWeight(
      order.items,
      new Map(variations.map((v) => [v.id, v.weight])),
      config.defaultWeightFallback,
    );

    const addr = (order.shippingAddress as unknown as Partial<ShippingSnapshot>) ?? {};
    const wh = config.defaultWarehouse;
    // COD: bưu tá thu đúng tổng đơn; đã thanh toán (ví/xu/chuyển khoản/ZaloPay) → thu 0.
    const collectAmount = order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID' ? order.total : 0;

    const productName = order.items
      .map((it) => `${it.productName} (${it.variationName}) x${it.quantity}`)
      .join(', ')
      .slice(0, 250);
    const recyclingDetail = order.recyclingNote?.trim() ? ` - Ghi chú: ${order.recyclingNote.trim()}` : '';

    return {
      type: 3, // 3: Đơn đổi hàng (BestExpress)
      pickup_type: 2, // 2: Bưu tá tới lấy
      service_id: 12491, // 12491: Giao hàng tiết kiệm
      order_customer_id: order.code,
      product_name: productName || `Đơn hàng ${order.code}`,
      product_price: order.total,
      product_number: 1,
      collect_amount: collectAmount,
      weight: totalGrams,
      width: 0,
      height: 0,
      length: 0,
      note: `Đơn đổi hàng thu gom tái chế (Tối đa ${maxKg}kg)${recyclingDetail}`,
      source_name: wh.name,
      source_phone: wh.phone,
      source_address: wh.address,
      source_ward: wh.ward,
      source_district: wh.district,
      source_province: wh.province,
      dest_name: addr.recipient || `Khách hàng ${order.code}`,
      dest_phone: addr.phone || '',
      dest_address: addr.street || '',
      dest_ward: addr.ward || '',
      // Hệ địa chỉ 2 cấp không còn quận/huyện — Gomdon bắt buộc trường này nên dùng tạm phường.
      dest_district: addr.district || addr.ward || addr.province || '',
      dest_province: addr.province || wh.province,
    };
  }
}
