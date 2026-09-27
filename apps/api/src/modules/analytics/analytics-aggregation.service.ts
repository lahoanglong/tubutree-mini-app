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

  /** Chạy 3h sáng giờ hệ thống — tính lại snapshot của NGÀY HÔM QUA (VN time). */
  @Cron('0 3 * * *')
  async runNightly(): Promise<void> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    // Nuốt lỗi im lặng ở cron từng khiến hỏng mà không ai biết (xem catalog.service.ts
    // recomputeSoldCron) — bọc try/catch + log riêng, không dựa vào unhandledRejection global.
    try {
      await this.computeRetentionSnapshot(yesterday);
      this.logger.log(`Đã tính retention_daily_snapshot cho ${yesterday.toISOString().slice(0, 10)}`);
    } catch (err) {
      this.logger.error(`Tính retention_daily_snapshot lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  async computeRetentionSnapshot(day: Date): Promise<RetentionResult> {
    const dateKey = day.toISOString().slice(0, 10);

    const dailyRows = await this.prisma.$queryRawUnsafe<
      Array<{ new_buyers: bigint; active_buyers: bigint; orders_count: bigint }>
    >(`
      WITH v AS (
        SELECT ${CUSTOMER_KEY_SQL} AS customer_key,
               ((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d,
               ROW_NUMBER() OVER (PARTITION BY ${CUSTOMER_KEY_SQL} ORDER BY o."createdAt") AS n
        FROM orders o JOIN users u ON u.id = o."userId"
        WHERE o.type = 'RETAIL' AND o.status NOT IN ('CANCELLED', 'RETURNED')
      )
      SELECT
        COUNT(*) FILTER (WHERE d = $1 AND n = 1) AS new_buyers,
        COUNT(DISTINCT customer_key) FILTER (WHERE d = $1) AS active_buyers,
        COUNT(*) FILTER (WHERE d = $1) AS orders_count
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
      WHERE date_trunc('month', t) = date_trunc('month', $1::date)
    `, dateKey);
    const mtd = mtdRows[0] ?? { orders_count: 0n, distinct_buyers: 0n };

    const dauRows = await this.prisma.$queryRawUnsafe<Array<{ dau: bigint }>>(`
      SELECT COUNT(DISTINCT "userId") AS dau FROM refresh_tokens
      WHERE (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1
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
      update: { ...result },
    });

    return result;
  }
}
