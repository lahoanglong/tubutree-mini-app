import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';

export const PERSONAL_COUPON_RETENTION_KEY = 'coupons.personal_expired_retention_days';
export const DEFAULT_PERSONAL_COUPON_RETENTION_DAYS = 90;
// Sàn 30 ngày: đặt 0 nhầm thì coupon vừa hết hạn bị xoá ngay, khách/CSKH không còn tra được lý do "mã hết hạn".
export const MIN_PERSONAL_COUPON_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_MAX_BATCHES = 50;
const LOCK_KEY = 'cron:coupons.cleanup_personal_expired';
const DAY_MS = 864e5;

export type CouponCleanupResult = { skipped: 'RUNNING' | 'LOCKED' } | { deleted: number; batches: number };

/**
 * Dọn coupon cá nhân (USER_GROUP có scopeMeta.userId: welcome/birthday/winback/game/group-buy/CS tặng) đã hết
 * hạn lâu: mỗi khách nhận nhiều mã sinh tự động nên bảng coupons phình (~35k dòng còn hạn trong dữ liệu đo)
 * và truy vấn /me/coupons phải bới qua chúng.
 *
 * Chỉ xoá mã CHƯA từng dùng (usedCount = 0 và không có CouponRedemption): coupon đã dùng giữ lại cho lịch sử
 * đối soát; CouponRedemption có khoá ngoại nên cũng không xoá được mã có redemption. Mã cấp theo `reason`
 * tất định (welcome/birthday/winback) không bị cấp lại sau khi xoá vì các cron cấp đều gắn với kỳ hiện tại.
 */
@Injectable()
export class CouponCleanupCron {
  private readonly logger = new Logger(CouponCleanupCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  // 04:30 giờ VN: sau các cron cấp voucher/tính hạng ban đêm, trước giờ khách vào app.
  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 30 4 * * *', { name: 'coupons.cleanup-personal-expired', timeZone: 'Asia/Ho_Chi_Minh' })
  @TrackCron()
  async handleCron(): Promise<void> {
    try {
      const res = await this.purgeExpiredPersonal();
      if ('deleted' in res && res.deleted > 0) {
        this.logger.log(`Dọn coupon cá nhân hết hạn: xoá ${res.deleted} mã trong ${res.batches} lô.`);
      }
    } catch (err) {
      this.logger.error(`Cron dọn coupon cá nhân lỗi: ${err instanceof Error ? err.stack ?? err.message : err}`);
    }
  }

  async purgeExpiredPersonal(
    now: Date = new Date(),
    opts: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<CouponCleanupResult> {
    if (this.running) { markCronSkipped('RUNNING'); return { skipped: 'RUNNING' }; }
    this.running = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt chạy (nhiều instance cùng lên lịch thì chỉ một chạy);
      // các lệnh xoá chạy trên kết nối khác nên từng lô commit riêng và lượt bị ngắt vẫn giữ kết quả đã xoá.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS "locked"`;
          if (!row?.locked) { markCronSkipped('LOCKED'); return { skipped: 'LOCKED' as const }; }
          return this.deleteInBatches(now, opts);
        },
        { maxWait: 10_000, timeout: 10 * 60_000 },
      );
    } finally {
      this.running = false;
    }
  }

  private async retentionDays(): Promise<number> {
    const raw = await this.config.get<unknown>(PERSONAL_COUPON_RETENTION_KEY, DEFAULT_PERSONAL_COUPON_RETENTION_DAYS);
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_PERSONAL_COUPON_RETENTION_DAYS;
    return Math.max(MIN_PERSONAL_COUPON_RETENTION_DAYS, Math.floor(n));
  }

  private async deleteInBatches(
    now: Date,
    opts: { batchSize?: number; maxBatches?: number },
  ): Promise<{ deleted: number; batches: number }> {
    const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    const maxBatches = opts.maxBatches ?? DEFAULT_MAX_BATCHES;
    const cutoff = new Date(now.getTime() - (await this.retentionDays()) * DAY_MS);
    let deleted = 0;
    let batches = 0;
    while (batches < maxBatches) {
      // SKIP LOCKED: coupon đang bị giao dịch khác giữ (vd vừa đổi mã) bỏ qua thay vì chờ.
      const n = await this.prisma.$executeRaw`
        DELETE FROM "coupons"
        WHERE "id" IN (
          SELECT c."id" FROM "coupons" c
          WHERE c."scope" = 'USER_GROUP'
            AND c."scopeMeta" ->> 'userId' IS NOT NULL
            AND c."endAt" < ${cutoff}
            AND c."usedCount" = 0
            AND NOT EXISTS (SELECT 1 FROM "coupon_redemptions" r WHERE r."couponId" = c."id")
          ORDER BY c."endAt"
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )`;
      if (n === 0) break;
      deleted += n;
      batches += 1;
      if (n < batchSize) break;
    }
    return { deleted, batches };
  }
}
