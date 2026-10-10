import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_TZ } from '../../common/cron-tz';

interface RetentionResult {
  newBuyers: number;
  activeBuyers: number;
  ordersCount: number;
  ordersPerBuyerMtd: number;
  dauProxyRefreshToken: number;
}

type CustomerKeyKind = 'PROXY' | 'PHONE' | 'USER';

// TODO(dự án con 2, phase 2): CohortRepeatSnapshot (repeat 30/60/90 theo cohort) và
// FunnelDailySnapshot (phễu từng bước, join analytics_events) dùng CÙNG định nghĩa khách hàng
// (CUSTOMER_KEY_SQL) nhưng là 2 job riêng, phức tạp hơn nhiều (cohort cần quét lại mọi cohort chưa
// đủ tuổi; funnel cần join analytics_events). Ngoài phạm vi task 14 — xem task-14-brief.md.

/** Đơn tính vào retention: bán lẻ, chưa huỷ/trả. Lấy từ enum để trạng thái mới tự được tính và dùng được index (status, createdAt). */
const COUNTED_STATUSES = Object.values(OrderStatus).filter(
  (s) => s !== OrderStatus.CANCELLED && s !== OrderStatus.RETURNED,
);

const PHONE_DIGITS_SQL = `NULLIF(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), '')`;

/** Khách hàng = người nhận (đơn lên hộ) > SĐT chuẩn hoá > userId. Cùng thứ tự ưu tiên ở mọi truy vấn dưới đây. */
const CUSTOMER_KEY_SQL = `
  COALESCE(
    CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END,
    ${PHONE_DIGITS_SQL},
    o."userId"
  )
`;

/** Đơn lên hộ có endCustomerKey: khoá riêng, tách khỏi SĐT/userId của người đặt. */
const IS_PROXY_ORDER_SQL = `(o."placedForCustomer" AND o."endCustomerKey" IS NOT NULL)`;

// $1 = ngày VN 'YYYY-MM-DD', $2 = danh sách trạng thái tính vào retention.
const COUNTED_ORDER_SQL = `o.type = 'RETAIL' AND o.status = ANY($2::"OrderStatus"[])`;

/** Ngày VN $1 phủ [00:00 VN, 24:00 VN) = [$1 - 7h, $1 + 17h) theo UTC (createdAt lưu UTC, không kèm múi giờ). */
const DAY_START_SQL = `($1::date)::timestamp - interval '7 hours'`;
const DAY_END_SQL = `($1::date + 1)::timestamp - interval '7 hours'`;
const MONTH_START_SQL = `date_trunc('month', $1::date)::timestamp - interval '7 hours'`;

@Injectable()
export class AnalyticsAggregationService {
  private readonly logger = new Logger(AnalyticsAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 3h sáng GIỜ VIỆT NAM (chốt cứng `timeZone`, không phụ thuộc giờ hệ điều hành host —
   * xem finding review Task 14: tính "hôm qua" bằng UTC-24h chỉ đúng nếu host cũng chạy UTC;
   * nếu host chạy giờ VN, kết quả lùi thêm 1 ngày).
   */
  @Cron('0 3 * * *', { timeZone: CRON_TZ })
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

  /**
   * `day` là chuỗi 'YYYY-MM-DD' (ngày VN) — KHÔNG nhận `Date` để tránh nhầm lẫn UTC/VN ở caller.
   *
   * Chi phí theo kích thước cửa sổ (ngày, tháng) chứ không theo tổng số đơn trong đời: đơn của ngày/tháng
   * đọc qua index (status, createdAt); "khách mới" kiểm tra bằng tra cứu đúng các khoá khách của ngày đó
   * trong lịch sử, thay vì đánh số thứ tự mọi đơn của mọi khách bằng window function.
   */
  async computeRetentionSnapshot(dateKey: string): Promise<RetentionResult> {
    const dayRows = await this.prisma.$queryRawUnsafe<
      Array<{ customer_key: string; kind: CustomerKeyKind; orders: bigint }>
    >(`
      SELECT ${CUSTOMER_KEY_SQL} AS customer_key,
             CASE WHEN ${IS_PROXY_ORDER_SQL} THEN 'PROXY'
                  WHEN ${PHONE_DIGITS_SQL} IS NOT NULL THEN 'PHONE'
                  ELSE 'USER' END AS kind,
             COUNT(*) AS orders
      FROM orders o JOIN users u ON u.id = o."userId"
      WHERE ${COUNTED_ORDER_SQL}
        AND o."createdAt" >= ${DAY_START_SQL} AND o."createdAt" < ${DAY_END_SQL}
      GROUP BY 1, 2
    `, dateKey, COUNTED_STATUSES);

    const activeKeys = new Set(dayRows.map((r) => r.customer_key));
    const ordersCount = dayRows.reduce((sum, r) => sum + Number(r.orders), 0);
    const returningKeys = await this.keysWithEarlierOrder(dateKey, dayRows);
    let newBuyers = 0;
    for (const key of activeKeys) if (!returningKeys.has(key)) newBuyers++;

    const mtdRows = await this.prisma.$queryRawUnsafe<
      Array<{ orders_count: bigint; distinct_buyers: bigint }>
    >(`
      SELECT COUNT(*) AS orders_count, COUNT(DISTINCT ${CUSTOMER_KEY_SQL}) AS distinct_buyers
      FROM orders o JOIN users u ON u.id = o."userId"
      WHERE ${COUNTED_ORDER_SQL}
        AND o."createdAt" >= ${MONTH_START_SQL} AND o."createdAt" < ${DAY_END_SQL}
    `, dateKey, COUNTED_STATUSES);
    const mtd = mtdRows[0] ?? { orders_count: 0n, distinct_buyers: 0n };

    const dauRows = await this.prisma.$queryRawUnsafe<Array<{ dau: bigint }>>(`
      SELECT COUNT(DISTINCT "userId") AS dau FROM refresh_tokens
      WHERE "createdAt" >= ${DAY_START_SQL} AND "createdAt" < ${DAY_END_SQL}
    `, dateKey);
    const dau = dauRows[0]?.dau ?? 0n;

    const result: RetentionResult = {
      newBuyers,
      activeBuyers: activeKeys.size,
      ordersCount,
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

  /**
   * Trong các khoá khách của ngày `dateKey`, khoá nào đã có đơn tính-retention TRƯỚC ngày đó (= khách cũ).
   * Mọi loại khoá chung MỘT không gian: endCustomerKey của đơn lên hộ là SĐT nội địa, cùng định dạng với SĐT
   * chuẩn hoá của tài khoản, nên khách tự mua và CTV lên hộ cho chính khách đó là một người. Vì vậy mọi khoá
   * đều được tra ở cả hai phía: đơn lên hộ theo endCustomerKey, và đơn thường qua mọi tài khoản có cùng SĐT
   * chuẩn hoá (khác định dạng vẫn là một khách) hoặc theo userId. Phía đơn thường đi qua index (userId, status)
   * bằng danh sách userId cụ thể để planner không chọn quét cả bảng orders.
   */
  private async keysWithEarlierOrder(
    dateKey: string,
    dayRows: Array<{ customer_key: string; kind: CustomerKeyKind }>,
  ): Promise<Set<string>> {
    const before = `o."createdAt" < ${DAY_START_SQL}`;
    const allKeys = dayRows.map((r) => r.customer_key);
    const userKeys = dayRows.filter((r) => r.kind === 'USER').map((r) => r.customer_key);
    const returning = new Set<string>();
    if (allKeys.length === 0) return returning;

    const proxyRows = await this.prisma.$queryRawUnsafe<Array<{ customer_key: string }>>(`
      SELECT DISTINCT o."endCustomerKey" AS customer_key FROM orders o
      WHERE ${IS_PROXY_ORDER_SQL} AND o."endCustomerKey" = ANY($3::text[]) AND ${COUNTED_ORDER_SQL} AND ${before}
    `, dateKey, COUNTED_STATUSES, allKeys);
    for (const r of proxyRows) returning.add(r.customer_key);

    const digitsByUserId = new Map<string, string>();
    const users = await this.prisma.$queryRawUnsafe<Array<{ id: string; customer_key: string }>>(`
      SELECT u.id, ${PHONE_DIGITS_SQL} AS customer_key FROM users u
      WHERE u.phone IS NOT NULL AND ${PHONE_DIGITS_SQL} = ANY($1::text[])
    `, allKeys);
    for (const u of users) digitsByUserId.set(u.id, u.customer_key);

    const userIds = [...digitsByUserId.keys(), ...userKeys];
    if (userIds.length > 0) {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ user_id: string }>>(`
        SELECT DISTINCT o."userId" AS user_id FROM orders o
        WHERE o."userId" = ANY($3::text[]) AND NOT ${IS_PROXY_ORDER_SQL} AND ${COUNTED_ORDER_SQL} AND ${before}
      `, dateKey, COUNTED_STATUSES, userIds);
      for (const r of rows) returning.add(digitsByUserId.get(r.user_id) ?? r.user_id);
    }
    return returning;
  }
}
