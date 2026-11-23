import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatVnDateTime } from '../../common/vn-time';
import { formatVnd } from './refund-destination';
import { OrderStatusService } from './order-status.service';
import { PREPAID_METHODS } from './order-transition';
import { CRON_TZ } from '../../common/cron-tz';
import { readDealerPendingPaymentTtlHours, readPendingPaymentTtlHours } from './pending-payment-ttl';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { pendingPaymentCancelOpts } from './pending-payment-cancel';
import { paymentUnlinkedHoldOverWhere } from './pending-payment-hold';

export {
  DEALER_PENDING_PAYMENT_TTL_KEY,
  DEFAULT_DEALER_PENDING_PAYMENT_TTL_HOURS,
  DEFAULT_PENDING_PAYMENT_TTL_HOURS,
  MAX_TTL_HOURS,
  MIN_TTL_HOURS,
  PENDING_PAYMENT_TTL_KEY,
  readDealerPendingPaymentTtlHours,
  readPendingPaymentTtlHours,
} from './pending-payment-ttl';
import { runExclusive } from '../../common/cron-leader/run-exclusive';

export { PAYMENT_UNLINKED_HOLD_HOURS } from './pending-payment-hold';
const BATCH_SIZE = 200;
const LOCK_KEY = 'cron:orders.pending_payment_expiry';

/** Nhắc chuyển khoản khi đơn còn chừng này giờ trước hạn tự huỷ (một lần mỗi đơn). */
export const PAYMENT_REMINDER_LEAD_HOURS = 2;
/** Đơn đặt chưa tới chừng này giờ thì chưa nhắc: TTL ngắn (≤ 3 giờ) mà nhắc ngay thì trùng tin "đang chờ thanh toán" lúc đặt. */
export const PAYMENT_REMINDER_MIN_AGE_HOURS = 1;
/** Mẫu tin nhắc trước hạn. Có trong prisma/seed.ts, lên PROD qua `prisma:seed:reference` lúc deploy (không migration). */
export const ORDER_PAYMENT_REMINDER_TEMPLATE = 'ORDER_PAYMENT_REMINDER';
/** Khoá chống trùng: mỗi đơn một tin nhắc, dù cron 10 phút chạy lại hay nhiều instance. */
export const paymentReminderDedupeKey = (orderCode: string) => `pay_remind:${orderCode}`;

/** `reminded`: số tin nhắc trước hạn gửi không lỗi trong lượt (gồm cả tin đã gửi từ trước, trùng khoá); không có khi lượt không nhắc. */
export type ExpireResult = { skipped: 'RUNNING' | 'LOCKED' } | { scanned: number; cancelled: number; failed: number; reminded?: number };

/**
 * Tự huỷ đơn trả trước (khách lẻ + CTV lên đơn hộ) nằm ở PENDING_PAYMENT quá N giờ: không huỷ thì hàng
 * giữ kho, quota flash-sale và coupon dùng một lần bị khoá vĩnh viễn cho đơn không ai trả (C-024).
 *
 * Đơn đại lý "Ghi công nợ" không bao giờ bị quét: đơn đó CONFIRMED ngay và trả qua sổ công nợ. Đơn đại lý "Trả trước" nằm ở
 * PENDING_PAYMENT như khách lẻ nên cũng tự huỷ, với hạn riêng `orders.dealer_pending_payment_ttl_hours` (SELLER-7).
 * Huỷ qua OrderStatusService.setStatus (đường huỷ chuẩn: hoàn kho/flash/coupon, đảo điểm, báo khách) với
 * guard onlyIfUnpaid — tiền về chen giữa lượt quét thì lần huỷ trượt, đơn giữ nguyên PAID.
 */
@Injectable()
export class PendingPaymentExpiryCron {
  private readonly logger = new Logger(PendingPaymentExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
    private readonly orderStatus: OrderStatusService,
    // Không có (spec dựng tay) thì lượt chỉ huỷ, không nhắc.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 */10 * * * *', { name: 'orders.pending-payment-expiry', timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async handleCron(): Promise<void> {
    try {
      const res = await this.expireStale();
      if ('scanned' in res && res.scanned > 0) {
        this.logger.log(`Huỷ đơn quá hạn thanh toán: quét ${res.scanned}, huỷ ${res.cancelled}, lỗi ${res.failed}.`);
      }
      if ('scanned' in res && res.reminded) this.logger.log(`Nhắc chuyển khoản trước hạn: ${res.reminded} đơn.`);
    } catch (err) {
      this.logger.error(`Cron huỷ đơn quá hạn thanh toán lỗi: ${err instanceof Error ? err.stack ?? err.message : err}`);
    }
  }

  async expireStale(now: Date = new Date()): Promise<ExpireResult> {
    if (this.running) { markCronSkipped('RUNNING'); return { skipped: 'RUNNING' }; }
    this.running = true;
    try {
      // Khoá lượt chạy (cron_leases), không giữ kết nối DB: nhiều instance cùng lên lịch thì chỉ một chạy.
      const run = await runExclusive(this.prisma, LOCK_KEY, async () => {
        const res = await this.cancelExpired(now);
        if (!this.notifications) return res;
        // Nhắc là việc phụ: lỗi ở đây không được làm mất kết quả huỷ của lượt.
        const reminded = await this.remindBeforeExpiry(now).catch((err: unknown) => {
          this.logger.error(`Nhắc chuyển khoản trước hạn lỗi: ${err instanceof Error ? err.message : err}`);
          return 0;
        });
        return { ...res, reminded };
      });
      if (!run.acquired) { markCronSkipped('LOCKED'); return { skipped: 'LOCKED' as const }; }
      return run.value;
    } finally {
      this.running = false;
    }
  }

  private async cancelExpired(now: Date): Promise<{ scanned: number; cancelled: number; failed: number }> {
    const [ttlHours, dealerTtlHours] = await Promise.all([
      this.ttlHours(),
      this.dealerTtlHours(),
    ]);
    const cutoff = new Date(now.getTime() - ttlHours * 3_600_000);
    const dealerCutoff = new Date(now.getTime() - dealerTtlHours * 3_600_000);
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paymentStatus: 'UNPAID',
        paymentMethod: { in: [...PREPAID_METHODS] },
        // Đã bàn giao vận chuyển (D1): lần thử đầu đã nhắc người xử lý, thử lại mỗi lượt chỉ lặp lỗi và nhắc lại (R4-SYNC-5).
        autoCancelBlockedAt: null,
        // Pancake báo đã thanh toán mà đơn chưa gắn đúng đơn Pancake: để Kế toán đối chiếu sao kê trong PAYMENT_UNLINKED_HOLD_HOURS, quá hạn thì huỷ như thường.
        AND: [paymentUnlinkedHoldOverWhere(now)],
        OR: [
          { type: 'RETAIL', createdAt: { lt: cutoff } },
          { type: 'DEALER', createdAt: { lt: dealerCutoff } },
        ],
      },
      select: { id: true, code: true, type: true, paymentMethod: true, _count: { select: { paymentAttempts: true } } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    let cancelled = 0;
    let failed = 0;
    for (const o of stale) {
      // ZaloPay có cron đối soát (ZalopayReconcileCron) hỏi cổng cả sau khi huỷ; cổng khác thì chưa — để lại dấu cho người đối soát.
      const gatewayAttempted = o.paymentMethod !== 'BANK_TRANSFER' && (o._count?.paymentAttempts ?? 0) > 0;
      try {
        const res = await this.orderStatus.setStatus(
          o.id,
          'CANCELLED',
          pendingPaymentCancelOpts(
            `Tự huỷ: quá ${o.type === 'DEALER' ? dealerTtlHours : ttlHours} giờ chưa thanh toán${
              gatewayAttempted ? ` — đã mở lệnh ${o.paymentMethod}: đối chiếu ${o.paymentMethod}, đã trừ tiền thì hoàn thủ công` : ''
            }`,
          ),
        );
        if (res.status === 'CANCELLED') {
          cancelled += 1;
          if (gatewayAttempted) {
            this.logger.warn(
              `Đã tự huỷ đơn ${o.code} (${o.paymentMethod}) có lệnh thanh toán nhưng không nhận callback — cần đối chiếu cổng, hoàn tiền thủ công nếu khách đã bị trừ.`,
            );
          }
        }
      } catch (err) {
        failed += 1;
        this.logger.error(`Không tự huỷ được đơn ${o.code} quá hạn thanh toán: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { scanned: stale.length, cancelled, failed };
  }

  /**
   * Nhắc MỘT lần đơn chuyển khoản của khách lẻ còn ≤ PAYMENT_REMINDER_LEAD_HOURS giờ trước khi tự huỷ: tin mở chi tiết đơn, nơi có mã VietQR
   * và nút đổi sang trả tiền khi nhận (khi đơn đổi được). Chỉ BANK_TRANSFER: ví/cổng đã có màn thanh toán riêng. Bỏ đơn có dấu tiền đang về
   * (Pancake báo trả, khoản chưa gắn đơn, đã bàn giao vận chuyển) để không giục khách trả hai lần, và đơn khách vãng lai (không có hộp tin
   * trong app). Hạn ghi trong tin cùng mốc với cron huỷ (createdAt + TTL). Chưa có mẫu tin thì bỏ lượt, không gửi câu trung tính.
   */
  async remindBeforeExpiry(now: Date): Promise<number> {
    if (!this.notifications) return 0;
    const ttlHours = await this.ttlHours();
    const hour = 3_600_000;
    const expiredBefore = new Date(now.getTime() - ttlHours * hour);
    const remindFrom = new Date(Math.min(expiredBefore.getTime() + PAYMENT_REMINDER_LEAD_HOURS * hour, now.getTime() - PAYMENT_REMINDER_MIN_AGE_HOURS * hour));
    const due = await this.prisma.order.findMany({
      where: {
        type: 'RETAIL',
        status: 'PENDING_PAYMENT',
        paymentStatus: 'UNPAID',
        paymentMethod: 'BANK_TRANSFER',
        autoCancelBlockedAt: null,
        paymentUnlinkedAt: null,
        guestTokenHash: null,
        OR: [{ pancakePaidReported: null }, { pancakePaidReported: 0 }],
        createdAt: { gt: expiredBefore, lte: remindFrom },
      },
      select: { userId: true, code: true, total: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    if (due.length === 0) return 0;
    const tpl = await this.prisma.notificationTemplate.findUnique({ where: { code: ORDER_PAYMENT_REMINDER_TEMPLATE }, select: { id: true } });
    if (!tpl) {
      this.logger.warn(`Thiếu mẫu ${ORDER_PAYMENT_REMINDER_TEMPLATE} (chưa chạy prisma:seed:reference): bỏ lượt nhắc chuyển khoản.`);
      return 0;
    }
    let sent = 0;
    for (const o of due) {
      const ok = await this.notifications.notifySafe(
        o.userId,
        ORDER_PAYMENT_REMINDER_TEMPLATE,
        {
          order_code: o.code,
          amount: formatVnd(o.total),
          deadline: formatVnDateTime(new Date(o.createdAt.getTime() + ttlHours * hour)),
        },
        { dedupeKey: paymentReminderDedupeKey(o.code) },
        `order=${o.code}`,
      );
      if (ok) sent += 1;
    }
    return sent;
  }

  private ttlHours(): Promise<number> {
    return readPendingPaymentTtlHours(this.systemConfig);
  }

  private dealerTtlHours(): Promise<number> {
    return readDealerPendingPaymentTtlHours(this.systemConfig);
  }
}
