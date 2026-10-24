import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { CRON_TZ } from '../../../common/cron-tz';
import { ZalopayService } from './zalopay.service';
import { TrackCron } from '../../../common/cron-run/track-cron';

export type ZalopayReconcileResult =
  | { skipped: 'RUNNING' | 'NOT_CONFIGURED' }
  | { scanned: number; paid: number; failed: number; pending: number; errors: number };

/**
 * Callback ZaloPay có thể thất lạc (mạng, API đang deploy, từng bị 400 vì trường `type`). Khách đã bị trừ tiền mà đơn
 * vẫn "Chờ thanh toán", rồi cron hết hạn tự huỷ, hoặc khách bấm thanh toán lại và trả hai lần. Cron này hỏi ZaloPay trạng
 * thái các lần thử chưa có kết quả của mọi đơn ZaloPay (đang chờ; đã huỷ — tiền về thì thành khoản hoàn; đã nhận tiền bằng
 * lệnh khác — thành khoản hoàn tiền trả dư) và ghi nhận qua đúng đường của callback (ZalopayService.applyGatewayPayment).
 */
@Injectable()
export class ZalopayReconcileCron {
  private readonly logger = new Logger(ZalopayReconcileCron.name);
  private running = false;
  /** Lệnh mới tạo để callback tự về trước; lệnh quá cửa sổ thì ZaloPay đã hết hạn từ lâu. */
  static readonly MIN_AGE_MINUTES = 3;
  static readonly WINDOW_HOURS = 48;
  static readonly REQUERY_GAP_MINUTES = 4;
  static readonly BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly zalopay: ZalopayService,
  ) {}

  @Cron('20 */5 * * * *', { name: 'payments.zalopay-reconcile', timeZone: CRON_TZ })
  @TrackCron()
  async handleCron(): Promise<void> {
    try {
      const res = await this.reconcile();
      if ('scanned' in res && res.scanned > 0) {
        this.logger.log(
          `Đối soát ZaloPay: hỏi ${res.scanned} lệnh — đã trả ${res.paid}, thất bại ${res.failed}, chưa trả ${res.pending}, lỗi ${res.errors}.`,
        );
      }
    } catch (err) {
      this.logger.error(`Cron đối soát ZaloPay lỗi: ${err instanceof Error ? err.stack ?? err.message : err}`);
    }
  }

  async reconcile(now: Date = new Date()): Promise<ZalopayReconcileResult> {
    if (!this.zalopay.configured) return { skipped: 'NOT_CONFIGURED' };
    if (this.running) return { skipped: 'RUNNING' };
    this.running = true;
    try {
      const attempts = await this.prisma.paymentAttempt.findMany({
        where: {
          provider: 'ZALOPAY',
          resolvedAt: null,
          createdAt: {
            gte: new Date(now.getTime() - ZalopayReconcileCron.WINDOW_HOURS * 3_600_000),
            lte: new Date(now.getTime() - ZalopayReconcileCron.MIN_AGE_MINUTES * 60_000),
          },
          OR: [
            { lastQueriedAt: null },
            { lastQueriedAt: { lte: new Date(now.getTime() - ZalopayReconcileCron.REQUERY_GAP_MINUTES * 60_000) } },
          ],
          // Cả đơn đã nhận tiền: lệnh khác của đơn cũng thành công là khách trả hai lần (khoản hoàn tiền trả dư).
          order: { paymentMethod: 'ZALOPAY' },
        },
        select: { id: true, appTransId: true },
        orderBy: { createdAt: 'asc' },
        take: ZalopayReconcileCron.BATCH_SIZE,
      });
      const result = { scanned: attempts.length, paid: 0, failed: 0, pending: 0, errors: 0 };
      for (const a of attempts) {
        try {
          const res = await this.zalopay.queryOrderStatus(a.appTransId);
          if (res.return_code === 1) {
            await this.zalopay.applyGatewayPayment(a.appTransId, res.amount, 'query');
            result.paid += 1;
          } else if (res.return_code === 2) {
            await this.zalopay.resolveAttempt(a.id);
            result.failed += 1;
          } else {
            result.pending += 1;
          }
        } catch (err) {
          result.errors += 1;
          this.logger.warn(`Không tra được trạng thái ZaloPay ${a.appTransId}: ${err instanceof Error ? err.message : err}`);
        }
        await this.prisma.paymentAttempt.update({ where: { id: a.id }, data: { lastQueriedAt: now } });
      }
      return result;
    } finally {
      this.running = false;
    }
  }
}
