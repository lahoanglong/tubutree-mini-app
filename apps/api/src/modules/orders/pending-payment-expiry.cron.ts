import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { OrderStatusService } from './order-status.service';
import { PREPAID_METHODS } from './order-transition';
import { CRON_TZ } from '../../common/cron-tz';

export const PENDING_PAYMENT_TTL_KEY = 'orders.pending_payment_ttl_hours';
export const DEFAULT_PENDING_PAYMENT_TTL_HOURS = 24;
/** Đơn đại lý "Trả trước" (chuyển khoản theo hợp đồng) được chờ lâu hơn khách lẻ: đơn sỉ, kế toán đại lý duyệt chi. */
export const DEALER_PENDING_PAYMENT_TTL_KEY = 'orders.dealer_pending_payment_ttl_hours';
export const DEFAULT_DEALER_PENDING_PAYMENT_TTL_HOURS = 72;
// Sàn 1 giờ: lỡ tay đặt 0 thì đơn khách vừa đặt (đang mở app ngân hàng chuyển khoản) bị huỷ ngay lượt sau.
export const MIN_TTL_HOURS = 1;
export const MAX_TTL_HOURS = 24 * 30;
const BATCH_SIZE = 200;
const LOCK_KEY = 'cron:orders.pending_payment_expiry';

export type ExpireResult = { skipped: 'RUNNING' | 'LOCKED' } | { scanned: number; cancelled: number; failed: number };

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
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 */10 * * * *', { name: 'orders.pending-payment-expiry', timeZone: CRON_TZ })
  async handleCron(): Promise<void> {
    try {
      const res = await this.expireStale();
      if ('scanned' in res && res.scanned > 0) {
        this.logger.log(`Huỷ đơn quá hạn thanh toán: quét ${res.scanned}, huỷ ${res.cancelled}, lỗi ${res.failed}.`);
      }
    } catch (err) {
      this.logger.error(`Cron huỷ đơn quá hạn thanh toán lỗi: ${err instanceof Error ? err.stack ?? err.message : err}`);
    }
  }

  async expireStale(now: Date = new Date()): Promise<ExpireResult> {
    if (this.running) return { skipped: 'RUNNING' };
    this.running = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt chạy: nhiều instance API cùng lên lịch thì chỉ một
      // instance quét. Từng lần huỷ chạy transaction riêng (kết nối khác) — tx này chỉ để giữ khoá.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS "locked"`;
          if (!row?.locked) return { skipped: 'LOCKED' as const };
          return this.cancelExpired(now);
        },
        { maxWait: 10_000, timeout: 15 * 60_000 },
      );
    } finally {
      this.running = false;
    }
  }

  private async cancelExpired(now: Date): Promise<{ scanned: number; cancelled: number; failed: number }> {
    const [ttlHours, dealerTtlHours] = await Promise.all([
      this.ttlHours(),
      this.ttlHours(DEALER_PENDING_PAYMENT_TTL_KEY, DEFAULT_DEALER_PENDING_PAYMENT_TTL_HOURS),
    ]);
    const cutoff = new Date(now.getTime() - ttlHours * 3_600_000);
    const dealerCutoff = new Date(now.getTime() - dealerTtlHours * 3_600_000);
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paymentStatus: 'UNPAID',
        paymentMethod: { in: [...PREPAID_METHODS] },
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
      // Chưa có API tra trạng thái cổng: khách đã mở lệnh thanh toán mà callback thất lạc thì có thể đã bị trừ tiền.
      const gatewayAttempted = o.paymentMethod !== 'BANK_TRANSFER' && (o._count?.paymentAttempts ?? 0) > 0;
      try {
        const res = await this.orderStatus.setStatus(o.id, 'CANCELLED', {
          actorType: 'SYSTEM',
          note: `Tự huỷ: quá ${o.type === 'DEALER' ? dealerTtlHours : ttlHours} giờ chưa thanh toán${
            gatewayAttempted ? ` — đã mở lệnh ${o.paymentMethod}: đối chiếu ${o.paymentMethod}, đã trừ tiền thì hoàn thủ công` : ''
          }`,
          onlyIfUnpaid: true,
          expectedStatus: 'PENDING_PAYMENT',
        });
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

  private async ttlHours(
    key: string = PENDING_PAYMENT_TTL_KEY,
    fallback: number = DEFAULT_PENDING_PAYMENT_TTL_HOURS,
  ): Promise<number> {
    const raw = await this.systemConfig.get<unknown>(key, fallback);
    const n = typeof raw === 'number' ? raw : Number.NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, n));
  }
}
