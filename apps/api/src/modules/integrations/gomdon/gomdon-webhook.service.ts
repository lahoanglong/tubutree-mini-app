import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import type { Order, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderStatusService, InvalidOrderTransitionError } from '../../orders/order-status.service';
import { QUEUE_GOMDON_EVENTS, QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import type { GomdonWebhookPayload } from './gomdon.types';
import { GomdonAlertService } from './gomdon-alert.service';
import { GOMDON_JOB_EVENT, addGomdonJob, enqueueGomdonCancel } from './gomdon-queue';
import {
  GOMDON_CANCEL,
  GOMDON_DELIVERED_STATUS,
  GOMDON_IN_TRANSIT_STATUSES,
  GOMDON_PROBLEM_STATUSES,
  GOMDON_STATE,
  GOMDON_STATUS_TEXT,
  gomdonRank,
  gomdonStatusText,
  isGomdonPayable,
  isGomdonTerminal,
} from './gomdon-status';

export const GOMDON_EVENT_STATUS = {
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  IGNORED: 'IGNORED',
  FAILED: 'FAILED',
} as const;

export interface ParsedGomdonEvent {
  gomdonOrderId: string | null;
  partnerCode: string | null;
  orderCode: string | null;
  status: number | null;
  eventTime: Date | null;
  rawCreatedTime: string | null;
  trackingLink: string | null;
}

interface Outcome {
  status: typeof GOMDON_EVENT_STATUS.PROCESSED | typeof GOMDON_EVENT_STATUS.IGNORED;
  orderId?: string;
  reason?: string;
}

const str = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/** created_time Gomdon: unix giây / mili-giây (số hoặc chuỗi số) hoặc chuỗi ngày. */
function parseEventTime(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const d = new Date(n > 1e12 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

export function parseGomdonPayload(body: GomdonWebhookPayload): ParsedGomdonEvent {
  const statusNum = Number(body.status);
  const link = str(body['tracking_link'] ?? body['tracking_url']);
  return {
    gomdonOrderId: str(body.order_id),
    partnerCode: str(body.order_code),
    orderCode: str(body.order_customer_id),
    status: body.status !== undefined && body.status !== null && Number.isInteger(statusNum) ? statusNum : null,
    eventTime: parseEventTime(body.created_time),
    rawCreatedTime: str(body.created_time),
    // Chỉ nhận link http(s) — không lưu chuỗi tuỳ ý vào nút "Tra cứu hành trình" của khách.
    trackingLink: link && /^https?:\/\//i.test(link) ? link : null,
  };
}

/**
 * Khoá chống xử lý trùng: định danh vận đơn + status + created_time. Thiếu created_time → băm
 * payload (redelivery y hệt thì trùng key, sự kiện khác nhau thì không gộp nhầm).
 */
export function gomdonDedupeKey(p: ParsedGomdonEvent, body: GomdonWebhookPayload): string {
  const who = p.gomdonOrderId ?? p.partnerCode ?? p.orderCode ?? 'unknown';
  const when =
    p.rawCreatedTime ?? `h${createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex').slice(0, 24)}`;
  return `${who}|${p.status ?? 'x'}|${when}`.slice(0, 255);
}

const isDead = (status: string) => status === 'CANCELLED' || status === 'RETURNED';

const PROBLEM_ADVICE: Record<number, string> = {
  2: 'Vận đơn bị huỷ phía Gomdon trong khi đơn vẫn hiệu lực — tạo lại vận đơn/hẹn thu gom với khách.',
  6: 'Hàng đang chuyển hoàn về kho — xử lý đơn với khách (KHÔNG tự hoàn tiền).',
  8: 'Hàng đã hoàn về kho — xử lý đơn với khách (KHÔNG tự hoàn tiền).',
  9: 'Hàng hỏng/mất — làm việc với Gomdon/BestExpress và liên hệ khách.',
  10: 'Bưu tá lấy hàng không thành công — kiểm tra kho và hẹn lấy lại.',
  11: 'Giao hàng thất bại — liên hệ khách hẹn giao lại/thu gom.',
  12: 'Hoàn hàng thất bại — liên hệ Gomdon/BestExpress.',
};

/**
 * Nhận + xử lý webhook Gomdon. Controller chỉ gọi receive() (lưu event + enqueue, trả 200 nhanh);
 * worker gomdon-events gọi processEvent() — lỗi thật NÉM TIẾP (event FAILED + BullMQ retry, cron
 * GomdonReconcileService chạy lại event kẹt) chứ không nuốt rồi trả 200 như bản WIP (mất vĩnh viễn
 * mốc DELIVERED → không cộng điểm/hoa hồng, không mở cửa sổ đổi trả).
 */
@Injectable()
export class GomdonWebhookService {
  private readonly logger = new Logger(GomdonWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatus: OrderStatusService,
    private readonly alerts: GomdonAlertService,
    @InjectQueue(QUEUE_GOMDON_EVENTS) private readonly eventsQueue: Queue,
    @InjectQueue(QUEUE_GOMDON_PUSH) private readonly pushQueue: Queue,
  ) {}

  /** Lưu event (dedupe) rồi enqueue xử lý. Ném lỗi chỉ khi KHÔNG lưu được (để Gomdon gửi lại). */
  async receive(body: GomdonWebhookPayload): Promise<{ result: true; duplicate?: true }> {
    const parsed = parseGomdonPayload(body ?? {});
    const dedupeKey = gomdonDedupeKey(parsed, body ?? {});
    // Chỉ log định danh + status — không log nguyên payload (địa chỉ/SĐT khách, phí...).
    this.logger.log(
      `Webhook Gomdon: order_id=${parsed.gomdonOrderId} order_code=${parsed.partnerCode} order_customer_id=${parsed.orderCode} status=${parsed.status}`,
    );

    let eventId: string;
    try {
      const event = await this.prisma.gomdonWebhookEvent.create({
        data: {
          dedupeKey,
          gomdonOrderId: parsed.gomdonOrderId,
          orderCode: parsed.orderCode,
          gomdonStatus: parsed.status,
          eventTime: parsed.eventTime,
          rawPayload: (body ?? {}) as Prisma.InputJsonValue,
          status: GOMDON_EVENT_STATUS.RECEIVED,
        },
      });
      eventId = event.id;
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      const existing = await this.prisma.gomdonWebhookEvent.findUnique({ where: { dedupeKey } });
      if (!existing) throw err;
      if (existing.status === GOMDON_EVENT_STATUS.PROCESSED || existing.status === GOMDON_EVENT_STATUS.IGNORED) {
        return { result: true, duplicate: true };
      }
      eventId = existing.id; // lần trước lỗi/chưa xử lý → đẩy lại
    }

    try {
      await addGomdonJob(this.eventsQueue, GOMDON_JOB_EVENT, { eventId }, eventId);
    } catch (err) {
      // Event đã lưu RECEIVED — cron cứu hộ sẽ enqueue lại, không cần Gomdon gửi lại.
      this.logger.error(`Enqueue event Gomdon ${eventId} lỗi: ${err instanceof Error ? err.message : err}`);
    }
    return { result: true };
  }

  async processEvent(eventId: string): Promise<void> {
    const event = await this.prisma.gomdonWebhookEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status === GOMDON_EVENT_STATUS.PROCESSED || event.status === GOMDON_EVENT_STATUS.IGNORED) return;

    try {
      const outcome = await this.apply(event.rawPayload as unknown as GomdonWebhookPayload);
      await this.prisma.gomdonWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: outcome.status,
          processedAt: new Date(),
          attempts: { increment: 1 },
          orderId: outcome.orderId ?? null,
          error: outcome.reason ?? null,
        },
      });
    } catch (err) {
      await this.prisma.gomdonWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: GOMDON_EVENT_STATUS.FAILED,
          attempts: { increment: 1 },
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err; // BullMQ retry
    }
  }

  private ignored(reason: string, orderId?: string): Outcome {
    this.logger.warn(`Bỏ qua webhook Gomdon: ${reason}`);
    return { status: GOMDON_EVENT_STATUS.IGNORED, reason, orderId };
  }

  private async findOrder(p: ParsedGomdonEvent): Promise<{ order: Order | null; backfill: boolean }> {
    // Chỉ khớp đơn CÓ thu gom tái chế, theo mã vận đơn đã lưu — không bao giờ khớp đơn bất kỳ theo
    // mã đơn (mã TUBU… đoán được; trước đây ai cũng đẩy được đơn bất kỳ sang DELIVERED).
    if (p.gomdonOrderId || p.partnerCode) {
      const or: Prisma.OrderWhereInput[] = [];
      if (p.gomdonOrderId) or.push({ gomdonOrderId: p.gomdonOrderId });
      if (p.partnerCode) or.push({ gomdonPartnerCode: p.partnerCode });
      const order = await this.prisma.order.findFirst({ where: { hasRecyclingPickup: true, OR: or } });
      if (order) return { order, backfill: false };
    }
    // Tự lành: lần tạo vận đơn bị timeout/mất response nhưng Gomdon ĐÃ tạo → đơn chưa có mã. Khớp theo
    // mã đơn (order_customer_id) CHỈ với đơn thu gom chưa gắn vận đơn nào, rồi điền mã.
    // Không nhận lại vận đơn ĐÃ HUỶ (status 2): webhook trễ của vận đơn cũ (admin huỷ → tạo lại) mà
    // được gắn vào đơn đang chờ tạo lại thì pushOrder thấy "đã có mã" và không bao giờ tạo vận đơn mới.
    if (p.orderCode && (p.gomdonOrderId || p.partnerCode) && p.status !== 2) {
      const order = await this.prisma.order.findFirst({
        where: { code: p.orderCode, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null },
      });
      if (order) return { order, backfill: true };
    }
    return { order: null, backfill: false };
  }

  private async apply(body: GomdonWebhookPayload): Promise<Outcome> {
    const p = parseGomdonPayload(body ?? {});
    if (p.status == null) return this.ignored('thiếu status');
    if (!GOMDON_STATUS_TEXT[p.status]) return this.ignored(`status không xác định: ${p.status}`);
    if (!p.gomdonOrderId && !p.partnerCode && !p.orderCode) return this.ignored('thiếu định danh đơn (order_id/order_code/order_customer_id)');

    const { order, backfill } = await this.findOrder(p);
    if (!order) {
      return this.ignored(
        `không khớp đơn thu gom nào (order_id=${p.gomdonOrderId}, order_code=${p.partnerCode}, order_customer_id=${p.orderCode})`,
      );
    }
    // Đối chiếu chéo: có order_customer_id thì phải trùng mã đơn đã khớp.
    if (p.orderCode && p.orderCode !== order.code) {
      return this.ignored(`order_customer_id ${p.orderCode} lệch mã đơn ${order.code}`, order.id);
    }
    if (order.gomdonOrderId && p.gomdonOrderId && order.gomdonOrderId !== p.gomdonOrderId) {
      return this.ignored(`vận đơn Gomdon ${p.gomdonOrderId} khác vận đơn đang gắn ${order.gomdonOrderId}`, order.id);
    }

    const newStatus = String(p.status);
    const cur = order.gomdonStatus;
    const statusChanged = cur !== newStatus;
    const partnerCode = order.gomdonPartnerCode ?? p.partnerCode ?? p.gomdonOrderId;

    // Không lùi trạng thái: webhook tới trễ/không theo thứ tự (Gomdon retry) bị bỏ qua.
    let stale = false;
    if (statusChanged) {
      const rCur = gomdonRank(cur);
      const rNew = gomdonRank(newStatus);
      if (isGomdonTerminal(cur) || rNew < rCur) stale = true;
      else if (rNew === rCur && rCur > 0 && p.eventTime && order.gomdonStatusAt && p.eventTime < order.gomdonStatusAt) {
        stale = true;
      }
    }
    if (stale) {
      if (backfill) {
        await this.prisma.order.updateMany({
          where: { id: order.id, gomdonOrderId: null, gomdonPartnerCode: null },
          data: { gomdonOrderId: p.gomdonOrderId, gomdonPartnerCode: partnerCode },
        });
      }
      return this.ignored(`status ${newStatus} cũ hơn trạng thái hiện tại ${cur} của đơn ${order.code}`, order.id);
    }

    const data: Prisma.OrderUpdateManyMutationInput = {};
    if (statusChanged) {
      const text = gomdonStatusText(p.status);
      const history = Array.isArray(order.shippingHistory) ? order.shippingHistory : [];
      data.gomdonStatus = newStatus;
      data.gomdonStatusAt = p.eventTime ?? new Date();
      data.shippingStatus = text;
      data.shippingHistory = [
        ...history,
        { at: (p.eventTime ?? new Date()).toISOString(), status: text, carrier: 'BestExpress', code: partnerCode },
      ] as Prisma.InputJsonValue;
    }
    if (backfill) {
      data.gomdonOrderId = p.gomdonOrderId;
      data.gomdonPartnerCode = partnerCode;
    }
    // Đơn có vận đơn Gomdon: Gomdon là nguồn DUY NHẤT của shippingCode/Partner/Status/History
    // (pancake.processor onShippingUpdated không ghi đè các field này — xem ở đó).
    if (partnerCode && order.shippingCode !== partnerCode) {
      data.shippingCode = partnerCode;
      data.shippingPartner = 'BestExpress';
    }
    if (p.trackingLink && p.trackingLink !== order.trackingLink) data.trackingLink = p.trackingLink;

    if (Object.keys(data).length > 0) {
      // Optimistic concurrency theo gomdonStatus: 2 webhook song song cho cùng đơn → bên thua retry
      // với dữ liệu mới (và bị chặn lùi trạng thái ở trên).
      const r = await this.prisma.order.updateMany({ where: { id: order.id, gomdonStatus: cur }, data });
      if (r.count === 0) throw new Error(`Trạng thái Gomdon của đơn ${order.code} vừa đổi — xử lý lại event`);
    }

    if (backfill && statusChanged) {
      if (cur === GOMDON_STATE.FAILED || cur === GOMDON_STATE.NOT_CONFIGURED) {
        await this.alerts.alert(
          order.code,
          `Gomdon CÓ vận đơn ${partnerCode} cho đơn đã được báo "tạo vận đơn tay" — kiểm tra ngay tránh giao trùng 2 vận đơn.`,
        );
      } else if (cur === GOMDON_STATE.NEEDS_MANUAL_CHECK) {
        await this.alerts.alert(order.code, `Đã tự khớp vận đơn Gomdon ${partnerCode} — KHÔNG tạo vận đơn tay.`);
      }
    }
    if (backfill && isDead(order.status)) {
      await enqueueGomdonCancel(this.pushQueue, order.id);
    }

    await this.applyOrderEffects(order, p.status, statusChanged);
    return { status: GOMDON_EVENT_STATUS.PROCESSED, orderId: order.id };
  }

  private async applyOrderEffects(order: Order, status: number, statusChanged: boolean): Promise<void> {
    const payable = isGomdonPayable(order);
    const text = gomdonStatusText(status);

    if (GOMDON_IN_TRANSIT_STATUSES.has(status)) {
      if (order.status === 'CONFIRMED' || order.status === 'PACKED') {
        if (payable) {
          await this.setStatusSafe(order, 'SHIPPING', `Gomdon webhook: ${text}`);
        } else if (statusChanged) {
          await this.alerts.alert(order.code, `Gomdon báo "${text}" nhưng đơn trả trước CHƯA thanh toán — kiểm tra, cân nhắc chặn giao.`);
        }
      }
      return;
    }

    if (status === GOMDON_DELIVERED_STATUS) {
      const deliverable = order.status === 'CONFIRMED' || order.status === 'PACKED' || order.status === 'SHIPPING';
      if (deliverable && payable) {
        this.logger.log(`Gomdon báo giao thành công đơn ${order.code} → DELIVERED.`);
        await this.setStatusSafe(order, 'DELIVERED', 'Gomdon webhook: Giao thành công (status 7)');
      } else if (order.status !== 'DELIVERED' && statusChanged) {
        // Không tự DELIVERED đơn chưa thanh toán / chưa xác nhận: DELIVERED cộng điểm, khoá hoa hồng CTV,
        // trao thưởng giới thiệu — chỉ làm khi chắc chắn đơn hợp lệ.
        await this.alerts.alert(
          order.code,
          `Gomdon báo giao thành công nhưng đơn đang ${order.status}${payable ? '' : ' và CHƯA thanh toán'} — không tự chuyển DELIVERED, cần kiểm tra.`,
        );
      }
      return;
    }

    if (GOMDON_PROBLEM_STATUSES.has(status) && statusChanged) {
      if (status === 2 && (isDead(order.status) || order.gomdonCancelStatus === GOMDON_CANCEL.CANCELLED)) {
        await this.prisma.order.updateMany({
          where: { id: order.id, OR: [{ gomdonCancelStatus: null }, { gomdonCancelStatus: GOMDON_CANCEL.FAILED }] },
          data: { gomdonCancelStatus: GOMDON_CANCEL.CANCELLED },
        });
        return;
      }
      // Ghi nhận + báo CSKH. KHÔNG tự huỷ/hoàn tiền/restock — người xử lý quyết định.
      await this.alerts.alert(order.code, `Gomdon báo "${text}". ${PROBLEM_ADVICE[status] ?? ''}`.trim());
    }
  }

  /** Chỉ nuốt lỗi chuyển trạng thái không hợp lệ (webhook trễ); lỗi khác ném tiếp để retry. */
  private async setStatusSafe(order: Order, target: 'SHIPPING' | 'DELIVERED', note: string): Promise<void> {
    try {
      await this.orderStatus.setStatus(order.id, target, { actorType: 'SYSTEM', note });
    } catch (err) {
      if (err instanceof InvalidOrderTransitionError) {
        this.logger.warn(`Bỏ qua chuyển ${target} cho đơn ${order.code}: ${err.message}`);
        return;
      }
      throw err;
    }
  }
}
