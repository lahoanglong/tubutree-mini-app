import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_TZ } from '../../common/cron-tz';
import { TrackCron } from '../../common/cron-run/track-cron';

interface RetentionResult {
  newBuyers: number;
  activeBuyers: number;
  ordersCount: number;
  ordersPerBuyerMtd: number;
  dauProxyRefreshToken: number;
  /** NS-1 của cohort ngày (date − 30); null khi truy vấn NS-1 lỗi (snapshot vẫn ghi, giữ giá trị NS-1 cũ nếu có). */
  ns1CohortSize: number | null;
  ns1RepeatCount: number | null;
}

type CustomerKeyKind = 'PROXY' | 'PHONE' | 'USER';

interface DayCustomer {
  customer_key: string;
  kind: CustomerKeyKind;
  orders: bigint;
  first_at: Date;
}

// TODO(dự án con 2, phase 2): CohortRepeatSnapshot (repeat 30/60/90 theo cohort tháng) và
// FunnelDailySnapshot (phễu từng bước, join analytics_events) dùng CÙNG định nghĩa khách hàng
// (CUSTOMER_KEY_SQL) nhưng là 2 job riêng, phức tạp hơn nhiều (cohort cần quét lại mọi cohort chưa
// đủ tuổi; funnel cần join analytics_events). Ngoài phạm vi task 14 — xem task-14-brief.md.
// NS-1 (đơn thứ 2 trong 30 ngày) đã nằm ngay trong RetentionDailySnapshot, tính theo cohort MỘT ngày.

/** NS-1: khách có đơn thứ 2 trong vòng ngần ấy ngày kể từ đơn đầu. */
const NS1_WINDOW_DAYS = 30;

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
/** Cửa sổ quét đơn của cohort ngày VN $1: từ 00:00 VN tới +31 ngày (phủ đơn cuối ngày cohort cộng đủ 30 ngày). */
const COHORT_WINDOW_SQL = `o."createdAt" >= ${DAY_START_SQL} AND o."createdAt" < (${DAY_START_SQL}) + interval '${NS1_WINDOW_DAYS + 1} days'`;

/**
 * `customersOfDay` nhóm theo (khoá, loại) nên cùng một SĐT vừa tự mua (PHONE) vừa được CTV lên hộ (PROXY, khoá là
 * SĐT nội địa) cho ra hai dòng cùng khoá. Gộp về một dòng mỗi khách, lấy đơn đầu sớm nhất, để cohort và đơn lặp
 * không đếm đôi.
 */
function mergeByCustomerKey(rows: DayCustomer[]): DayCustomer[] {
  const merged = new Map<string, DayCustomer>();
  for (const r of rows) {
    const cur = merged.get(r.customer_key);
    if (!cur) {
      merged.set(r.customer_key, { ...r });
      continue;
    }
    cur.orders += r.orders;
    if (new Date(r.first_at).getTime() < new Date(cur.first_at).getTime()) cur.first_at = r.first_at;
    if (r.kind === 'USER') cur.kind = 'USER';
  }
  return [...merged.values()];
}

function shiftDayKey(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

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
  @TrackCron()
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
    const dayRows = await this.customersOfDay(dateKey);

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

    // NS-1 là truy vấn phụ: lỗi ở đây không được làm mất cả snapshot ngày (khách mới, DAU...).
    let ns1: { cohortSize: number; repeatCount: number } | null = null;
    try {
      ns1 = await this.computeNs1(dateKey);
    } catch (err) {
      this.logger.error(`Tính NS-1 cho ${dateKey} thất bại: ${err instanceof Error ? err.stack : err}`);
    }

    const result: RetentionResult = {
      newBuyers,
      activeBuyers: activeKeys.size,
      ordersCount,
      ordersPerBuyerMtd: Number(mtd.distinct_buyers) > 0 ? Number(mtd.orders_count) / Number(mtd.distinct_buyers) : 0,
      dauProxyRefreshToken: Number(dau),
      ns1CohortSize: ns1?.cohortSize ?? null,
      ns1RepeatCount: ns1?.repeatCount ?? null,
    };
    // NS-1 lỗi (null) thì bỏ hai cột khỏi câu ghi để không xoá giá trị NS-1 đã tính ở lần chạy trước.
    const { ns1CohortSize, ns1RepeatCount, ...rest } = result;
    const ns1Columns = ns1 ? { ns1CohortSize, ns1RepeatCount } : {};

    await this.prisma.retentionDailySnapshot.upsert({
      where: { date: new Date(dateKey) },
      create: { date: new Date(dateKey), ...rest, ...ns1Columns, dauEventBased: null },
      update: { ...rest, ...ns1Columns, computedAt: new Date() },
    });

    return result;
  }

  /**
   * Điền NS-1 cho snapshot ĐÃ CÓ mà chưa có NS-1 (dòng tính trước khi có cột này), chỉ ghi hai cột ns1. Không tạo
   * dòng mới: retention job chỉ xoá analytics_events thô của ngày đã có snapshot, dòng giả sẽ làm ngày đó bị coi là
   * đã chốt. Trả false khi không có dòng nào cần điền.
   */
  async backfillNs1(dateKey: string): Promise<boolean> {
    const pending = await this.prisma.retentionDailySnapshot.findFirst({
      where: { date: new Date(dateKey), ns1CohortSize: null },
      select: { date: true },
    });
    if (!pending) return false;
    const ns1 = await this.computeNs1(dateKey);
    const res = await this.prisma.retentionDailySnapshot.updateMany({
      where: { date: new Date(dateKey), ns1CohortSize: null },
      data: { ns1CohortSize: ns1.cohortSize, ns1RepeatCount: ns1.repeatCount },
    });
    return res.count > 0;
  }

  /** Khách của một ngày VN (đơn tính-retention) kèm thời điểm đơn đầu tiên của khách trong ngày đó. */
  private customersOfDay(dateKey: string): Promise<DayCustomer[]> {
    return this.prisma.$queryRawUnsafe<DayCustomer[]>(`
      SELECT ${CUSTOMER_KEY_SQL} AS customer_key,
             CASE WHEN ${IS_PROXY_ORDER_SQL} THEN 'PROXY'
                  WHEN ${PHONE_DIGITS_SQL} IS NOT NULL THEN 'PHONE'
                  ELSE 'USER' END AS kind,
             COUNT(*) AS orders,
             MIN(o."createdAt") AS first_at
      FROM orders o JOIN users u ON u.id = o."userId"
      WHERE ${COUNTED_ORDER_SQL}
        AND o."createdAt" >= ${DAY_START_SQL} AND o."createdAt" < ${DAY_END_SQL}
      GROUP BY 1, 2
    `, dateKey, COUNTED_STATUSES);
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
    phoneUsers?: Map<string, string>,
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

    const digitsByUserId = phoneUsers ?? (await this.userIdsByPhoneKey(allKeys));

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

  /** Tài khoản có SĐT chuẩn hoá trùng một trong các khoá khách: userId → khoá (nhiều tài khoản cùng SĐT là một khách). */
  private async userIdsByPhoneKey(keys: string[]): Promise<Map<string, string>> {
    const digitsByUserId = new Map<string, string>();
    if (keys.length === 0) return digitsByUserId;
    const users = await this.prisma.$queryRawUnsafe<Array<{ id: string; customer_key: string }>>(`
      SELECT u.id, ${PHONE_DIGITS_SQL} AS customer_key FROM users u
      WHERE u.phone IS NOT NULL AND ${PHONE_DIGITS_SQL} = ANY($1::text[])
    `, keys);
    for (const u of users) digitsByUserId.set(u.id, u.customer_key);
    return digitsByUserId;
  }

  /**
   * NS-1 cho ngày tính `dateKey`: cohort là khách có đơn hợp lệ ĐẦU TIÊN rơi vào ngày VN (dateKey − 30), tới hết
   * dateKey thì mọi khách trong cohort đã đủ 30 ngày để xét. Chỉ quét đúng ngày cohort và cửa sổ 31 ngày của
   * những khách mới đó (theo index createdAt/userId/endCustomerKey), không đụng lịch sử toàn bảng orders.
   */
  private async computeNs1(dateKey: string): Promise<{ cohortSize: number; repeatCount: number }> {
    const cohortKey = shiftDayKey(dateKey, -NS1_WINDOW_DAYS);
    const cohort = mergeByCustomerKey(await this.customersOfDay(cohortKey));
    if (cohort.length === 0) return { cohortSize: 0, repeatCount: 0 };

    const phoneUsers = await this.userIdsByPhoneKey(cohort.map((r) => r.customer_key));
    const returning = await this.keysWithEarlierOrder(cohortKey, cohort, phoneUsers);
    const newBuyers = cohort.filter((r) => !returning.has(r.customer_key));
    if (newBuyers.length === 0) return { cohortSize: 0, repeatCount: 0 };

    const repeatCount = await this.countRepeatWithinWindow(cohortKey, newBuyers, phoneUsers);
    return { cohortSize: newBuyers.length, repeatCount };
  }

  /**
   * Trong các khách mới của ngày cohort, đếm khách có ít nhất 2 đơn hợp lệ trong [đơn đầu, đơn đầu + 30 ngày].
   * Cùng không gian khoá với keysWithEarlierOrder: đơn lên hộ theo endCustomerKey, đơn thường qua mọi tài khoản
   * có cùng SĐT chuẩn hoá (hoặc theo userId khi khách không có SĐT).
   */
  private async countRepeatWithinWindow(
    cohortKey: string,
    newBuyers: DayCustomer[],
    phoneUsers: Map<string, string>,
  ): Promise<number> {
    const allKeys = newBuyers.map((r) => r.customer_key);
    const keySet = new Set(allKeys);
    const digitsByUserId = new Map([...phoneUsers].filter(([, key]) => keySet.has(key)));
    const userIds = [...digitsByUserId.keys(), ...newBuyers.filter((r) => r.kind === 'USER').map((r) => r.customer_key)];

    const times = new Map<string, number[]>();
    const add = (key: string, at: Date) => {
      const list = times.get(key);
      if (list) list.push(new Date(at).getTime());
      else times.set(key, [new Date(at).getTime()]);
    };

    const proxyRows = await this.prisma.$queryRawUnsafe<Array<{ customer_key: string; created_at: Date }>>(`
      SELECT o."endCustomerKey" AS customer_key, o."createdAt" AS created_at FROM orders o
      WHERE ${IS_PROXY_ORDER_SQL} AND o."endCustomerKey" = ANY($3::text[]) AND ${COUNTED_ORDER_SQL} AND ${COHORT_WINDOW_SQL}
    `, cohortKey, COUNTED_STATUSES, allKeys);
    for (const r of proxyRows) add(r.customer_key, r.created_at);

    if (userIds.length > 0) {
      const userRows = await this.prisma.$queryRawUnsafe<Array<{ user_id: string; created_at: Date }>>(`
        SELECT o."userId" AS user_id, o."createdAt" AS created_at FROM orders o
        WHERE o."userId" = ANY($3::text[]) AND NOT ${IS_PROXY_ORDER_SQL} AND ${COUNTED_ORDER_SQL} AND ${COHORT_WINDOW_SQL}
      `, cohortKey, COUNTED_STATUSES, userIds);
      for (const r of userRows) add(digitsByUserId.get(r.user_id) ?? r.user_id, r.created_at);
    }

    const windowMs = NS1_WINDOW_DAYS * 86_400_000;
    let repeat = 0;
    for (const buyer of newBuyers) {
      const first = new Date(buyer.first_at).getTime();
      const inWindow = (times.get(buyer.customer_key) ?? []).filter((t) => t >= first && t <= first + windowMs);
      if (inWindow.length >= 2) repeat++;
    }
    return repeat;
  }
}
