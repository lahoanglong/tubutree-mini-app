import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

interface RetentionResult {
  newBuyers: number;
  activeBuyers: number;
  ordersCount: number;
  ordersPerBuyerMtd: number;
  dauProxyRefreshToken: number;
}

// TODO(dự án con 2, phase 2): CohortRepeatSnapshot (repeat 30/60/90 theo cohort) và
// FunnelDailySnapshot (phễu từng bước, join analytics_events) dùng CÙNG customer_key SQL ở dưới
// nhưng là 2 job riêng, phức tạp hơn nhiều (cohort cần quét lại mọi cohort chưa đủ tuổi; funnel
// cần join analytics_events). Ngoài phạm vi task 14 — xem task-14-brief.md phần "Ghi chú phạm vi".
const CUSTOMER_KEY_SQL = `
  COALESCE(
    CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END,
    NULLIF(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), ''),
    o."userId"
  )
`;

@Injectable()
export class AnalyticsAggregationService {
  private readonly logger = new Logger(AnalyticsAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 3h sáng GIỜ VIỆT NAM (chốt cứng `timeZone`, không phụ thuộc giờ hệ điều hành host —
   * xem finding review Task 14: tính "hôm qua" bằng UTC-24h chỉ đúng nếu host cũng chạy UTC;
   * nếu host chạy giờ VN, kết quả lùi thêm 1 ngày).
   */
  @Cron('0 3 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async runNightly(): Promise<void> {
    // Ngày VN hôm qua, tính TƯỜNG MINH bằng offset +7h thay vì phụ thuộc giờ host (cùng cách
    // game-economy.service.ts/loyalty.service.ts đã dùng cho "ngày VN" ở nơi khác).
    const dateKey = new Date(Date.now() + 7 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
    try {
      await this.computeRetentionSnapshot(dateKey);
      this.logger.log(`Đã tính retention_daily_snapshot cho ${dateKey}`);
    } catch (err) {
      this.logger.error(`Tính retention_daily_snapshot cho ${dateKey} thất bại: ${err instanceof Error ? err.stack : err}`);
    }
  }

  /** `day` là chuỗi 'YYYY-MM-DD' (ngày VN) — KHÔNG nhận `Date` để tránh nhầm lẫn UTC/VN ở caller. */
  async computeRetentionSnapshot(dateKey: string): Promise<RetentionResult> {
    const dailyRows = await this.prisma.$queryRawUnsafe<
      Array<{ new_buyers: bigint; active_buyers: bigint; orders_count: bigint }>
    >(`
      WITH v AS (
        SELECT ${CUSTOMER_KEY_SQL} AS customer_key,
               ((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d,
               ROW_NUMBER() OVER (PARTITION BY ${CUSTOMER_KEY_SQL} ORDER BY o."createdAt", o.id) AS n
        FROM orders o JOIN users u ON u.id = o."userId"
        WHERE o.type = 'RETAIL' AND o.status NOT IN ('CANCELLED', 'RETURNED')
      )
      SELECT
        COUNT(*) FILTER (WHERE d = $1::date AND n = 1) AS new_buyers,
        COUNT(DISTINCT customer_key) FILTER (WHERE d = $1::date) AS active_buyers,
        COUNT(*) FILTER (WHERE d = $1::date) AS orders_count
      FROM v
    `, dateKey);
    const daily = dailyRows[0] ?? { new_buyers: 0n, active_buyers: 0n, orders_count: 0n };

    const mtdRows = await this.prisma.$queryRawUnsafe<
      Array<{ orders_count: bigint; distinct_buyers: bigint }>
    >(`
      WITH v AS (
        SELECT ${CUSTOMER_KEY_SQL} AS customer_key,
               ((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS t
        FROM orders o JOIN users u ON u.id = o."userId"
        WHERE o.type = 'RETAIL' AND o.status NOT IN ('CANCELLED', 'RETURNED')
      )
      SELECT COUNT(*) AS orders_count, COUNT(DISTINCT customer_key) AS distinct_buyers
      FROM v
      WHERE date_trunc('month', t) = date_trunc('month', $1::date) AND t::date <= $1::date
    `, dateKey);
    const mtd = mtdRows[0] ?? { orders_count: 0n, distinct_buyers: 0n };

    const dauRows = await this.prisma.$queryRawUnsafe<Array<{ dau: bigint }>>(`
      SELECT COUNT(DISTINCT "userId") AS dau FROM refresh_tokens
      WHERE (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date
    `, dateKey);
    const dau = dauRows[0]?.dau ?? 0n;

    const result: RetentionResult = {
      newBuyers: Number(daily.new_buyers),
      activeBuyers: Number(daily.active_buyers),
      ordersCount: Number(daily.orders_count),
      ordersPerBuyerMtd: Number(mtd.distinct_buyers) > 0 ? Number(mtd.orders_count) / Number(mtd.distinct_buyers) : 0,
      dauProxyRefreshToken: Number(dau),
    };

    await this.prisma.retentionDailySnapshot.upsert({
      where: { date: new Date(dateKey) },
      create: { date: new Date(dateKey), ...result, dauEventBased: null },
      update: { ...result, computedAt: new Date() },
    });

    return result;
  }
}
