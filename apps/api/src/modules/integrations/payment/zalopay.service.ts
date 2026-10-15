import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import axios from 'axios';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import type { Env } from '../../../config/env.validation';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { enqueueGomdonPush } from '../gomdon/gomdon-queue';
import { AnalyticsEventsService } from '../../analytics/analytics-events.service';
import { vnDateKey } from '../../../common/vn-time';
import { PancakeSyncHooks } from '../pancake/pancake-sync-hooks';
import { OPS_PAYMENT_TEMPLATE, flagRefundAttention, recordLatePaymentRefund, recordOverpaymentRefund } from '../../orders/refund-queue';
import { formatVnd } from '../../orders/refund-destination';
import { notifyAdmins } from '../../../common/notify-admins';
import type { Order } from '@prisma/client';

interface ZalopayCreateResponse {
  return_code?: number;
  return_message?: string;
  sub_return_code?: number;
  sub_return_message?: string;
  order_url?: string;
  zp_trans_token?: string;
}

export interface ZalopayQueryResponse {
  return_code?: number;
  return_message?: string;
  sub_return_code?: number;
  sub_return_message?: string;
  is_processing?: boolean;
  amount?: number;
  zp_trans_id?: number;
}

/**
 * ZaloPay v2 (Build Spec §10.1). Tạo đơn → trả order_url + zp_trans_token cho SDK mini app.
 * Webhook (callback) verify MAC bằng key2 → set Order PAID.
 * Gate bằng ZALOPAY_APP_ID; chưa cấu hình → 503 (dev dùng COD).
 */
@Injectable()
export class ZalopayService {
  private readonly logger = new Logger(ZalopayService.name);
  private readonly appId: string;
  private readonly key1: string;
  private readonly key2: string;
  private readonly endpoint: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
    // Optional: test dựng tay 3 tham số vẫn chạy. Đơn thu gom tái chế trả ZaloPay: chỉ đặt vận đơn
    // Gomdon (bưu tá tới lấy hàng) SAU khi tiền về.
    @Optional() @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue?: Queue,
    // @Optional cùng lý do notifications/gomdonQueue ở trên: nhiều test dựng ZalopayService tay
    // không truyền tham số này — AnalyticsModule là @Global() nên app thật luôn wiring được.
    @Optional() private readonly analytics?: AnalyticsEventsService,
    // Optional như trên: tiền về thì đơn mới được đẩy kho (hoặc báo Pancake "đã thanh toán, không thu COD").
    @Optional() private readonly pancakeHooks?: PancakeSyncHooks,
  ) {
    this.appId = config.get('ZALOPAY_APP_ID', { infer: true });
    this.key1 = config.get('ZALOPAY_KEY1', { infer: true });
    this.key2 = config.get('ZALOPAY_KEY2', { infer: true });
    this.endpoint = config.get('ZALOPAY_ENDPOINT', { infer: true });
  }

  private isConfigured(): boolean {
    return Boolean(this.appId && this.key1 && this.key2);
  }

  get configured(): boolean {
    return this.isConfigured();
  }

  async createPayment(userId: string, orderCode: string) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('ZaloPay chưa được cấu hình.');
    }
    const order = await this.prisma.order.findUnique({ where: { code: orderCode } });
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.paymentStatus === 'PAID') throw new BadRequestException('Đơn đã thanh toán.');
    // Đơn COD/chuyển khoản hay đơn đã huỷ mà vẫn tạo được lệnh thì khách trả tiền xong, luồng hoàn tiền
    // (order-reversal) không coi đó là đơn trả trước nên không hoàn, shipper vẫn thu COD (MONEY-11).
    if (order.paymentMethod !== 'ZALOPAY') {
      throw new BadRequestException('Đơn này không chọn thanh toán qua ZaloPay.');
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('Đơn không còn ở trạng thái chờ thanh toán.');
    }
    await this.settleOpenAttempts(order.id);

    const appTime = Date.now();
    // Hậu tố ngẫu nhiên phân biệt LẦN THỬ: appTransId chỉ phân giải theo NGÀY (yymmdd_code) nên
    // khách thoát/hủy giữa chừng rồi thanh toán lại TRONG CÙNG NGÀY cho cùng đơn sẽ sinh
    // appTransId trùng hệt lần trước → PaymentAttempt.create() (appTransId @unique) ném P2002
    // không được catch → 500 chặn đứng thanh toán lại (Bug 2, docs/2026-09-16).
    const appTransId = `${this.yymmdd()}_${order.code}_${randomBytes(3).toString('hex')}`;
    const embedData = JSON.stringify({ orderCode: order.code });
    const items = JSON.stringify([{ itemid: order.code, itemprice: order.total, itemquantity: 1 }]);
    const appUser = userId;

    // mac = HMAC-SHA256(key1, app_id|app_trans_id|app_user|amount|app_time|embed_data|item)
    const dataStr = [this.appId, appTransId, appUser, order.total, appTime, embedData, items].join('|');
    const mac = createHmac('sha256', this.key1).update(dataStr).digest('hex');

    const payload = {
      app_id: Number(this.appId),
      app_trans_id: appTransId,
      app_user: appUser,
      app_time: appTime,
      amount: order.total,
      item: items,
      embed_data: embedData,
      description: `Tubu Tree - Thanh toán đơn ${order.code}`,
      bank_code: '',
      mac,
    };

    const { data } = await axios.post<ZalopayCreateResponse>(`${this.endpoint}/create`, null, {
      params: payload,
      timeout: 12000,
    });
    // return_code 1 = tạo lệnh thành công; còn lại ZaloPay không có giao dịch nào để callback về.
    if (data?.return_code !== 1) {
      this.logger.warn(
        `ZaloPay từ chối tạo lệnh cho đơn ${order.code}: return_code=${data?.return_code} sub_return_code=${data?.sub_return_code} ${data?.sub_return_message ?? data?.return_message ?? ''}`,
      );
      throw new BadGatewayException('ZaloPay chưa tạo được lệnh thanh toán, vui lòng thử lại sau.');
    }
    // Ghi TỪNG lần thử: app_trans_id có tiền tố ngày nên bấm thanh toán lại hôm sau sinh mã
    // khác. Nếu chỉ giữ mã mới nhất ở orders.paymentTxnId thì callback của lần thử cũ (khách
    // hoàn tất giao dịch hôm qua) sẽ không khớp đơn nào → tiền thu rồi mà đơn vẫn UNPAID
    // (P2, docs/2026-09-08-review-progress.md).
    await this.prisma.paymentAttempt.create({
      data: { orderId: order.id, provider: 'ZALOPAY', appTransId, amount: order.total },
    });
    // Vẫn cập nhật paymentTxnId để chỗ hiển thị/đối soát cũ thấy lần thử gần nhất.
    await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentTxnId: appTransId },
    });
    return data;
  }

  /**
   * Trước khi mở lệnh mới: hỏi ZaloPay các lệnh cũ chưa có kết quả của đơn (callback có thể đã thất lạc). Lệnh cũ đã trả thì
   * ghi nhận luôn và không mở lệnh mới — khách khỏi trả lần hai; lệnh cũ còn đang xử lý thì bảo khách chờ. Không hỏi được
   * ZaloPay thì vẫn cho mở lệnh: nếu cả hai cùng thành công, lần sau thành khoản hoàn tiền trả dư.
   */
  private async settleOpenAttempts(orderId: string): Promise<void> {
    const open = await this.prisma.paymentAttempt.findMany({
      where: { orderId, provider: 'ZALOPAY', resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, appTransId: true },
    });
    let processing = false;
    for (const a of open) {
      let res: ZalopayQueryResponse;
      try {
        res = await this.queryOrderStatus(a.appTransId);
      } catch (err) {
        this.logger.warn(`Không tra được lệnh ZaloPay cũ ${a.appTransId} trước khi mở lệnh mới: ${err instanceof Error ? err.message : err}`);
        continue;
      }
      if (res.return_code === 1) {
        await this.applyGatewayPayment(a.appTransId, res.amount, 'query');
      } else if (res.return_code === 2) {
        await this.resolveAttempt(a.id);
      } else if (res.is_processing) {
        processing = true;
      }
    }
    const now = await this.prisma.order.findUnique({ where: { id: orderId }, select: { paymentStatus: true, status: true } });
    if (now?.paymentStatus === 'PAID') throw new BadRequestException('Đơn đã thanh toán.');
    if (now && now.status !== 'PENDING_PAYMENT') throw new BadRequestException('Đơn không còn ở trạng thái chờ thanh toán.');
    if (processing) {
      throw new BadRequestException('Lần thanh toán ZaloPay trước của đơn đang được xử lý — vui lòng chờ vài phút rồi xem lại đơn.');
    }
  }

  /**
   * Webhook ZaloPay: verify MAC key2 → set PAID. `type` 1 = thanh toán đơn, 2 = liên kết (agreement) — Tubu không dùng
   * liên kết nên chỉ ghi nhận cho ZaloPay khỏi gửi lại.
   */
  async handleCallback(rawData: string, reqMac: string, type?: number) {
    if (!this.isConfigured()) return { return_code: 2, return_message: 'not configured' };
    const mac = createHmac('sha256', this.key2).update(rawData).digest('hex');
    if (!this.safeEqual(mac, reqMac)) {
      this.logger.warn('ZaloPay callback MAC mismatch.');
      return { return_code: -1, return_message: 'mac not equal' };
    }
    if (type !== undefined && type !== 1) {
      this.logger.warn(`Callback ZaloPay type=${type} (không phải thanh toán đơn) — bỏ qua.`);
      return { return_code: 1, return_message: 'success' };
    }
    let data: { app_trans_id?: unknown; amount?: unknown };
    try {
      data = JSON.parse(rawData) as typeof data;
    } catch {
      this.logger.error('Callback ZaloPay có MAC đúng nhưng data không phải JSON — bỏ qua.');
      return { return_code: 1, return_message: 'success' };
    }
    if (typeof data.app_trans_id !== 'string' || !data.app_trans_id) {
      this.logger.error('Callback ZaloPay thiếu app_trans_id — bỏ qua.');
      return { return_code: 1, return_message: 'success' };
    }
    await this.applyGatewayPayment(data.app_trans_id, data.amount, 'callback');
    return { return_code: 1, return_message: 'success' };
  }

  /**
   * Ghi nhận một giao dịch ZaloPay đã thành công (callback, hoặc cron đối soát tra trạng thái khi callback thất lạc). Một
   * đường duy nhất cho cả hai nguồn nên cùng guard: số tiền phải khớp, đơn đã huỷ/trả thì tạo khoản hoàn thay vì lật PAID.
   */
  async applyGatewayPayment(appTransId: string, rawAmount: unknown, source: 'callback' | 'query'): Promise<void> {
    // Tra theo sổ lần-thử trước (khớp được CẢ lần thử cũ); đơn tạo TRƯỚC bản vá chưa có dòng
    // attempt nào nên fallback về cách cũ (orders.paymentTxnId).
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { appTransId },
      include: { order: true },
    });
    const order =
      attempt?.order ??
      (await this.prisma.order.findFirst({
        where: { paymentTxnId: appTransId },
      }));
    if (!order) {
      this.logger.error(`ZaloPay (${source}) báo đã thanh toán ${appTransId} nhưng không khớp đơn nào — cần đối soát tay.`);
      return;
    }
    // MAC chỉ chứng minh callback đến từ ZaloPay, KHÔNG chứng minh số tiền khớp đơn. Thiếu, sai kiểu hay lệch số tiền
    // → không ghi nhận gì (không PAID, không khoản hoàn), đưa đơn vào hàng cần xử lý để người đối soát xử lý tay.
    const expected = attempt?.amount ?? order.total;
    if (typeof rawAmount !== 'number' || !Number.isInteger(rawAmount) || rawAmount !== expected) {
      await this.flagAmountMismatch(order, appTransId, rawAmount, expected, source);
      await this.resolveAttempt(attempt?.id);
      return;
    }
    const paidAmount = rawAmount;
    // P1-3 (docs/2026-09-08-review-progress.md): trước đây chỉ check paymentStatus, không
    // check status — callback tới sau khi đơn đã hủy/trả vẫn bị lật PAID êm, đơn đứng
    // CANCELLED/RETURNED + PAID mà không cơ chế nào tự phát hiện cần hoàn tiền thật cho
    // khách. Vẫn trả return_code=1 (ZaloPay coi là đã nhận, không cần retry) — chỉ không
    // ghi nhận PAID vào đơn đã chết.
    if (order.status === 'CANCELLED' || order.status === 'RETURNED') {
      await this.recordUnappliedPayment(order.id, paidAmount, appTransId, attempt?.id);
      await this.resolveAttempt(attempt?.id);
      return;
    }
    // Bug 1 (Critical, docs/2026-09-16): đọc rồi update() thẳng không atomic — 2 webhook (retry)
    // tới gần nhau có thể cùng đọc order còn UNPAID rồi cùng ghi đè, hoặc tệ hơn "hồi sinh" đơn
    // đã bị hủy ở giữa 2 lần đọc/ghi thành CONFIRMED+PAID sau khi kho đã nhả bán chỗ đó cho đơn
    // khác. Mirror pattern onPaymentReconcile (pancake.processor.ts): updateMany guard cả
    // paymentStatus:'UNPAID' lẫn status not-in CANCELLED/RETURNED, chỉ notify khi count>0.
    // order_paid phải ghi ATOMIC cùng lần lật PAID (Task 5, docs analytics-foundation): bọc
    // updateMany trong $transaction, chỉ ghi event khi count>0 (guard where thật sự khớp).
    const flip = await this.prisma.$transaction(async (tx) => {
      // paidAt (cột DB) và occurredAt (event) phải là CÙNG một mốc thời gian — 1 `new Date()`
      // duy nhất, không phải 2 lời gọi riêng có thể lệch vài mili-giây.
      const paidAt = new Date();
      const r = await tx.order.updateMany({
        where: {
          id: order.id,
          paymentStatus: 'UNPAID',
          status: { notIn: ['CANCELLED', 'RETURNED'] },
        },
        data: {
          paymentStatus: 'PAID',
          paidAt,
          ...(order.status === 'PENDING_PAYMENT' ? { status: 'CONFIRMED' } : {}),
        },
      });
      if (r.count > 0 && attempt) {
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { succeededAt: paidAt } });
      }
      if (r.count > 0 && this.analytics) {
        await this.analytics.record(tx, {
          eventName: 'order_paid',
          userId: order.userId,
          platform: order.platform === 'web' ? 'web' : 'miniapp',
          occurredAt: paidAt,
          props: { orderId: order.id, method: 'ZALOPAY', amount: order.total },
        });
      }
      return r;
    });
    await this.resolveAttempt(attempt?.id);
    if (flip.count > 0) {
      this.logger.log(`ZaloPay (${source}) xác nhận thanh toán đơn ${order.code} → PAID`);
      if (order.hasRecyclingPickup && this.gomdonQueue) {
        // Lỗi enqueue không được làm ZaloPay gửi lại callback (đã lật PAID) — GomdonReconcileService
        // quét đơn AWAITING_PAYMENT đã PAID và enqueue lại.
        await enqueueGomdonPush(this.gomdonQueue, order.id).catch((err) =>
          this.logger.error(`Enqueue vận đơn Gomdon sau thanh toán lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`),
        );
      }
      await this.pancakeHooks?.afterPaid(order.id);
      await this.notifications.notify(order.userId, 'ORDER_CONFIRMED', { order_code: order.code });
    } else {
      // Guard thua: callback trùng, lệnh khác của cùng đơn đã trả trước (khách trả hai lần), hoặc khách/cron vừa huỷ đơn
      // giữa lần đọc và lần lật.
      await this.recordUnappliedPayment(order.id, paidAmount, appTransId, attempt?.id);
    }
  }

  /**
   * Tra trạng thái một lần thử ở ZaloPay (POST {endpoint}/query, mac = HMAC-SHA256(key1, app_id|app_trans_id|key1)).
   * return_code 1 = đã thanh toán (kèm amount), 2 = thất bại/hết hạn, 3 = chưa thanh toán hoặc đang xử lý.
   */
  async queryOrderStatus(appTransId: string): Promise<ZalopayQueryResponse> {
    if (!this.isConfigured()) throw new ServiceUnavailableException('ZaloPay chưa được cấu hình.');
    const mac = createHmac('sha256', this.key1).update(`${this.appId}|${appTransId}|${this.key1}`).digest('hex');
    const body = new URLSearchParams({ app_id: this.appId, app_trans_id: appTransId, mac });
    const { data } = await axios.post<ZalopayQueryResponse>(`${this.endpoint}/query`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 12000,
    });
    return data ?? {};
  }

  /** Lần thử đã có kết quả cuối — cron đối soát thôi hỏi ZaloPay. */
  async resolveAttempt(attemptId: string | undefined): Promise<void> {
    if (!attemptId) return;
    await this.prisma.paymentAttempt.updateMany({ where: { id: attemptId, resolvedAt: null }, data: { resolvedAt: new Date() } });
  }

  private async flagAmountMismatch(
    order: Pick<Order, 'id' | 'code'>,
    appTransId: string,
    rawAmount: unknown,
    expected: number,
    source: 'callback' | 'query',
  ): Promise<void> {
    const got = rawAmount === undefined ? 'không có số tiền' : JSON.stringify(rawAmount);
    this.logger.error(
      `ZaloPay (${source}) báo thanh toán ${appTransId} lệch số tiền cho đơn ${order.code}: nhận ${got}, kỳ vọng ${expected} — KHÔNG lật PAID.`,
    );
    const reason = `ZaloPay báo đã thanh toán lần ${appTransId} nhưng số tiền (${got}) không khớp ${formatVnd(expected)} — chưa ghi nhận tiền. Đối soát với ZaloPay rồi xử lý tay.`;
    const r = await this.prisma.order.updateMany({
      where: { id: order.id, OR: [{ pancakeAttention: null }, { pancakeAttention: { not: reason } }] },
      data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
    });
    if (r.count === 0) return;
    await notifyAdmins(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      { template: OPS_PAYMENT_TEMPLATE, subject: `lệch tiền ZaloPay đơn ${order.code}`, data: () => ({ order_code: order.code, message: reason }) },
    ).catch((err) => this.logger.warn(`Không báo được admin lệch tiền ZaloPay đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
  }

  /**
   * Một giao dịch ZaloPay đã thành công nhưng không lật được đơn sang PAID:
   * - đơn chưa nhận tiền mà đã huỷ/trả → khoản hoàn LATE_PAYMENT (khách chọn Ví hay ngân hàng);
   * - đơn đã nhận tiền (PAID/REFUNDED) và chính lệnh này là lệnh đã lật PAID → ZaloPay gửi lại, bỏ qua;
   * - đơn đã nhận tiền bằng một lệnh KHÁC → khách trả hai lần: khoản hoàn OVERPAYMENT cho lần này (R3-MONEY-1);
   * - đơn cũ nhiều lệnh, không biết lệnh nào đã lật PAID → "Cần xử lý" để đối soát tay, không tự tạo khoản hoàn.
   */
  private async recordUnappliedPayment(orderId: string, amount: number, appTransId: string, attemptId: string | undefined): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    const ctx = { prisma: this.prisma, notifications: this.notifications, logger: this.logger };
    if (order.paymentStatus === 'UNPAID') {
      if (order.status !== 'CANCELLED' && order.status !== 'RETURNED') return;
      await recordLatePaymentRefund(ctx, order, { amount, source: 'ZALOPAY', refKey: appTransId });
      return;
    }
    if (!attemptId) {
      this.logger.warn(`Callback ZaloPay ${appTransId} cho đơn ${order.code} (${order.status}, ${order.paymentStatus}) — đơn cũ chưa có sổ lần thử, coi là gửi lại.`);
      return;
    }
    const succeeded = await this.prisma.paymentAttempt.findMany({
      where: { orderId: order.id, succeededAt: { not: null } },
      select: { id: true, appTransId: true },
    });
    if (succeeded.some((a) => a.id === attemptId)) {
      this.logger.log(`Callback ZaloPay ${appTransId} cho đơn ${order.code} là bản gửi lại của lần đã ghi nhận — bỏ qua.`);
      return;
    }
    if (succeeded.length > 0) {
      await recordOverpaymentRefund(ctx, order, { amount, source: 'ZALOPAY', refKey: appTransId });
      return;
    }
    await flagRefundAttention(
      ctx,
      order,
      `ZaloPay báo lệnh ${appTransId} (${formatVnd(amount)}) đã thanh toán cho đơn đã nhận tiền, nhưng không xác định được lệnh nào đã được ghi nhận — có thể khách trả hai lần. Đối soát giao dịch trên ZaloPay; khách trả hai lần thì hoàn tay phần dư.`,
      `tiền ZaloPay đơn ${order.code}`,
    );
  }

  /** So sánh MAC chống timing-attack (độ dài khác → false ngay, không ném). */
  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  /** ZaloPay yêu cầu tiền tố app_trans_id là ngày theo GMT+7; theo UTC thì 00:00–06:59 mang ngày hôm trước. */
  private yymmdd(): string {
    return vnDateKey().slice(2).replace(/-/g, '');
  }
}
