import { Injectable } from '@nestjs/common';
import {
  GIFT_ATTACH_MIN_NET_GOODS_VND,
  LAUNCH_WATCH_WINDOWS,
  RECYCLE_FUNNEL_STEPS,
  type LaunchWatchDTO,
  type LaunchWatchFraud,
  type LaunchWatchFunnel,
  type LaunchWatchFunnelRow,
  type LaunchWatchSecondOrder,
  type LaunchWatchWindow,
  type LaunchWatchWindowDTO,
} from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Độ dài mỗi cửa sổ trượt tính từ lúc gọi. */
const WINDOW_MS: Record<LaunchWatchWindow, number> = { h72: 72 * HOUR_MS, d7: 7 * DAY_MS, d30: 30 * DAY_MS };

/** Đơn đầu cách đây 14 đến 44 ngày thì đã đủ 14 ngày để kết luận khách có đặt đơn thứ hai hay không (chặn trên 44 giữ cỡ nhóm là 30 ngày gần nhất). */
const SECOND_ORDER_DAYS = 14;
const MATURED_OLDEST_DAYS = 44;

/**
 * Mốc luật chống gian lận W179 lên PROD (2026-11-16 15:17 +07:00). Trước mốc này checkout gắn mọi quà đang chờ vào đơn và không có sàn tiền hàng,
 * nên đơn cũ nhiều quà hoặc dưới sàn là hợp lệ: chỉ đếm quà 0đ từ đơn tạo sau mốc để không báo đỏ oan.
 */
export const ZERO_GIFT_RULES_SINCE = new Date('2026-11-16T08:17:00.000Z');

/** Bảng chỉ ADMIN mở, chạy theo lệnh: giữ kết quả 60 giây để F5 liên tục không dồn truy vấn quét bảng đơn vào DB. */
const CACHE_TTL_MS = 60_000;

type Count = number | bigint;

interface FunnelQueryRow {
  step: string;
  platform: string | null;
  actors: Count;
}
interface ConfirmedQueryRow {
  requests: Count;
  users: Count;
}
interface UnverifiedPhoneQueryRow {
  totalRequests: Count;
  requests: Count;
  users: Count;
  pointsAwarded: Count;
}
interface ZeroGiftQueryRow {
  attached: Count;
  accounts: Count;
  maxPerAccount: Count;
  ordersOverOne: Count;
  ordersBelowMin: Count;
}
interface FreeShipQueryRow {
  totalOrders: Count;
  orders: Count;
  users: Count;
  withConfirmedWaste: Count;
}
interface SecondOrderQueryRow {
  maturedCustomers: Count;
  maturedWithSecond: Count;
  pendingCustomers: Count;
  pendingWithSecond: Count;
}

// Postgres trả count()/sum() là bigint; JSON không serialize được bigint nên ép về number ở đây.
const num = (v: Count | null | undefined): number => (v == null ? 0 : Number(v));

/**
 * Ép về cùng kiểu `timestamp` (UTC, không múi giờ) như cột Prisma: truyền Date trần thì driver gắn nhãn múi giờ và phụ thuộc
 * TimeZone của phiên DB. Cùng cách với brand.service.
 */
const ts = (d: Date): string => d.toISOString();

@Injectable()
export class LaunchWatchService {
  private cache: { at: number; value: Promise<LaunchWatchDTO> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  getSnapshot(now: Date = new Date(), rulesSince: Date = ZERO_GIFT_RULES_SINCE): Promise<LaunchWatchDTO> {
    const age = this.cache ? now.getTime() - this.cache.at : -1;
    if (this.cache && age >= 0 && age < CACHE_TTL_MS) return this.cache.value;

    const value = this.compute(now, rulesSince);
    const entry = { at: now.getTime(), value };
    this.cache = entry;
    // Lần tính lỗi không được giữ trong cache: lần gọi sau phải thử lại ngay.
    value.catch(() => {
      if (this.cache === entry) this.cache = null;
    });
    return value;
  }

  /** Chạy tuần tự từng truy vấn: mỗi lần hết cache chỉ chiếm một kết nối, không tranh pool với request của khách. */
  private async compute(now: Date, rulesSince: Date): Promise<LaunchWatchDTO> {
    const windows: LaunchWatchWindowDTO[] = [];
    for (const w of LAUNCH_WATCH_WINDOWS) {
      windows.push(await this.windowSnapshot(new Date(now.getTime() - WINDOW_MS[w]), rulesSince));
    }
    const secondOrder = await this.secondOrder(now);
    return {
      generatedAt: now.toISOString(),
      windows: Object.fromEntries(LAUNCH_WATCH_WINDOWS.map((w, i) => [w, windows[i]])) as Record<LaunchWatchWindow, LaunchWatchWindowDTO>,
      secondOrder,
    };
  }

  private async windowSnapshot(since: Date, rulesSince: Date): Promise<LaunchWatchWindowDTO> {
    const funnelRows = await this.funnelRows(since);
    const confirmed = await this.confirmed(since);
    const unverified = await this.unverifiedPhone(since);
    const zeroGift = await this.zeroGift(since.getTime() > rulesSince.getTime() ? since : rulesSince);
    const freeShip = await this.freeShipRecycle(since);
    const funnel: LaunchWatchFunnel = {
      rows: funnelRows,
      confirmedRequests: num(confirmed.requests),
      confirmedUsers: num(confirmed.users),
    };
    const fraud: LaunchWatchFraud = {
      unverifiedPhone: {
        totalRequests: num(unverified.totalRequests),
        requests: num(unverified.requests),
        users: num(unverified.users),
        pointsAwarded: num(unverified.pointsAwarded),
      },
      zeroGift: {
        attached: num(zeroGift.attached),
        accounts: num(zeroGift.accounts),
        maxPerAccount: num(zeroGift.maxPerAccount),
        ordersOverOne: num(zeroGift.ordersOverOne),
        ordersBelowMin: num(zeroGift.ordersBelowMin),
        countedSince: (since.getTime() > rulesSince.getTime() ? since : rulesSince).toISOString(),
      },
      freeShipRecycle: this.freeShipDto(freeShip),
    };
    return { funnel, fraud };
  }

  private freeShipDto(r: FreeShipQueryRow): LaunchWatchFraud['freeShipRecycle'] {
    const totalOrders = num(r.totalOrders);
    const orders = num(r.orders);
    return {
      orders,
      users: num(r.users),
      totalOrders,
      shareOfOrdersPct: totalOrders === 0 ? null : Math.round((1000 * orders) / totalOrders) / 10,
      withConfirmedWaste: num(r.withConfirmedWaste),
    };
  }

  /** Đếm khách khác nhau theo bước và nền tảng; dòng platform NULL là tổng khách khác nhau trên cả hai nền tảng (không bằng web + miniapp vì một khách có thể dùng cả hai). */
  private async funnelRows(since: Date): Promise<LaunchWatchFunnelRow[]> {
    const raw = await this.prisma.$queryRaw<FunnelQueryRow[]>`
      SELECT e.props->>'step' AS step,
             e.platform AS platform,
             count(DISTINCT COALESCE(e."userId", e."anonymousId", e."sessionId")) AS actors
        FROM "analytics_events" e
       WHERE e."eventName" = 'recycle_funnel_step'
         AND e."receivedAt" >= ${ts(since)}::timestamp
         AND e.platform IN ('web', 'miniapp')
       GROUP BY GROUPING SETS ((e.props->>'step', e.platform), (e.props->>'step'))`;
    const bySlot = new Map<string, number>();
    for (const r of raw) bySlot.set(`${r.step}|${r.platform ?? '*'}`, num(r.actors));
    return RECYCLE_FUNNEL_STEPS.map((step) => ({
      step,
      web: bySlot.get(`${step}|web`) ?? 0,
      miniapp: bySlot.get(`${step}|miniapp`) ?? 0,
      total: bySlot.get(`${step}|*`) ?? 0,
    }));
  }

  /** Sự kiện máy chủ (platform 'system'), nên không lọc theo nền tảng. */
  private async confirmed(since: Date): Promise<ConfirmedQueryRow> {
    const rows = await this.prisma.$queryRaw<ConfirmedQueryRow[]>`
      SELECT count(*) AS requests,
             count(DISTINCT e."userId") AS users
        FROM "analytics_events" e
       WHERE e."eventName" = 'recycle_confirmed'
         AND e."receivedAt" >= ${ts(since)}::timestamp`;
    return rows[0] ?? { requests: 0, users: 0 };
  }

  /** Mở Đổi rác chỉ cần có số điện thoại, không cần đã xác thực, nên tài khoản chưa xác thực tạo yêu cầu được và nhận điểm khi kho xác nhận: `pointsAwarded` chỉ để tham khảo, không phải bất biến. */
  private async unverifiedPhone(since: Date): Promise<UnverifiedPhoneQueryRow> {
    const rows = await this.prisma.$queryRaw<UnverifiedPhoneQueryRow[]>`
      SELECT count(*) AS "totalRequests",
             count(*) FILTER (WHERE u."phoneVerifiedAt" IS NULL) AS requests,
             count(DISTINCT w."userId") FILTER (WHERE u."phoneVerifiedAt" IS NULL) AS users,
             COALESCE(sum(COALESCE(w."pointsAwarded", 0)) FILTER (WHERE u."phoneVerifiedAt" IS NULL), 0)::bigint AS "pointsAwarded"
        FROM "waste_requests" w
        JOIN "users" u ON u.id = w."userId"
       WHERE w."createdAt" >= ${ts(since)}::timestamp`;
    return rows[0] ?? { totalRequests: 0, requests: 0, users: 0, pointsAwarded: 0 };
  }

  /** Quà 0đ gắn vào đơn tạo trong cửa sổ (trừ đơn huỷ). Đơn dưới sàn tính theo tiền hàng sau giảm, đúng luật gắn quà ở checkout. */
  private async zeroGift(since: Date): Promise<ZeroGiftQueryRow> {
    const rows = await this.prisma.$queryRaw<ZeroGiftQueryRow[]>`
      WITH att AS (
        SELECT r."userId" AS user_id, r."attachedOrderId" AS order_id, (o.subtotal - o.discount) AS net
          FROM "waste_gift_redemptions" r
          JOIN "orders" o ON o.id = r."attachedOrderId"
         WHERE r."attachedOrderId" IS NOT NULL
           AND o."createdAt" >= ${ts(since)}::timestamp
           AND o.status <> 'CANCELLED'
      ),
      per_user AS (SELECT user_id, count(*) AS n FROM att GROUP BY user_id),
      per_order AS (SELECT order_id, count(*) AS n, min(net) AS net FROM att GROUP BY order_id)
      SELECT (SELECT count(*) FROM att) AS attached,
             (SELECT count(*) FROM per_user) AS accounts,
             COALESCE((SELECT max(n) FROM per_user), 0) AS "maxPerAccount",
             (SELECT count(*) FROM per_order WHERE n > 1) AS "ordersOverOne",
             (SELECT count(*) FROM per_order WHERE net < ${GIFT_ATTACH_MIN_NET_GOODS_VND}::int) AS "ordersBelowMin"`;
    return rows[0] ?? { attached: 0, accounts: 0, maxPerAccount: 0, ordersOverOne: 0, ordersBelowMin: 0 };
  }

  /** Đếm theo lần thanh toán (checkoutGroup): một giỏ hỗn hợp tách nhiều đơn vẫn là một lần đặt. Đơn lên hộ khách (placedForCustomer) và đơn đại lý không tính: đó không phải khách tự đặt. */
  private async freeShipRecycle(since: Date): Promise<FreeShipQueryRow> {
    const rows = await this.prisma.$queryRaw<FreeShipQueryRow[]>`
      SELECT count(DISTINCT COALESCE(o."checkoutGroup", o.id)) AS "totalOrders",
             count(DISTINCT COALESCE(o."checkoutGroup", o.id)) FILTER (WHERE o."hasRecyclingPickup") AS orders,
             count(DISTINCT o."userId") FILTER (WHERE o."hasRecyclingPickup") AS users,
             count(DISTINCT COALESCE(o."checkoutGroup", o.id)) FILTER (
               WHERE o."hasRecyclingPickup"
                 AND EXISTS (SELECT 1 FROM "waste_requests" w WHERE w."orderId" = o.id AND w.status = 'COMPLETED')
             ) AS "withConfirmedWaste"
        FROM "orders" o
       WHERE o."createdAt" >= ${ts(since)}::timestamp
         AND o.status <> 'CANCELLED'
         AND o.type = 'RETAIL'
         AND o."placedForCustomer" = false`;
    return rows[0] ?? { totalOrders: 0, orders: 0, users: 0, withConfirmedWaste: 0 };
  }

  private async secondOrder(now: Date): Promise<LaunchWatchSecondOrder> {
    const maturedTo = new Date(now.getTime() - SECOND_ORDER_DAYS * DAY_MS);
    const maturedFrom = new Date(now.getTime() - MATURED_OLDEST_DAYS * DAY_MS);
    const rows = await this.prisma.$queryRaw<SecondOrderQueryRow[]>`
      WITH grouped AS (
        SELECT o."userId" AS user_id,
               COALESCE(o."checkoutGroup", o.id) AS grp,
               min(o."createdAt") AS created_at
          FROM "orders" o
         WHERE o.status NOT IN ('CANCELLED', 'RETURNED', 'PENDING_PAYMENT')
           AND o.type = 'RETAIL'
           AND o."placedForCustomer" = false
         GROUP BY o."userId", COALESCE(o."checkoutGroup", o.id)
      ),
      ranked AS (
        SELECT user_id, created_at, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, grp) AS rn
          FROM grouped
      ),
      firsts AS (SELECT user_id, created_at FROM ranked WHERE rn = 1),
      seconds AS (SELECT user_id, created_at FROM ranked WHERE rn = 2)
      SELECT count(*) FILTER (WHERE f.created_at > ${ts(maturedFrom)}::timestamp AND f.created_at <= ${ts(maturedTo)}::timestamp) AS "maturedCustomers",
             count(*) FILTER (
               WHERE f.created_at > ${ts(maturedFrom)}::timestamp AND f.created_at <= ${ts(maturedTo)}::timestamp
                 AND s.created_at <= f.created_at + make_interval(days => ${SECOND_ORDER_DAYS}::int)
             ) AS "maturedWithSecond",
             count(*) FILTER (WHERE f.created_at > ${ts(maturedTo)}::timestamp AND f.created_at <= ${ts(now)}::timestamp) AS "pendingCustomers",
             count(*) FILTER (
               WHERE f.created_at > ${ts(maturedTo)}::timestamp AND f.created_at <= ${ts(now)}::timestamp
                 AND s.created_at IS NOT NULL
             ) AS "pendingWithSecond"
        FROM firsts f
        LEFT JOIN seconds s ON s.user_id = f.user_id`;
    const r = rows[0] ?? { maturedCustomers: 0, maturedWithSecond: 0, pendingCustomers: 0, pendingWithSecond: 0 };
    return {
      windowDays: SECOND_ORDER_DAYS,
      matured: { customers: num(r.maturedCustomers), withSecond: num(r.maturedWithSecond) },
      pending: { customers: num(r.pendingCustomers), withSecond: num(r.pendingWithSecond) },
    };
  }
}
