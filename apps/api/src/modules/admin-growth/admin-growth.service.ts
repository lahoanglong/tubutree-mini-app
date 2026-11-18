import { Injectable } from '@nestjs/common';
import type { AdminGrowthOverviewDTO, GrowthDailyPoint, GrowthGameRow, GrowthWindowDays } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { vnDateKey } from '../../common/vn-time';
import { PurchaseFunnelService } from '../analytics/purchase-funnel.service';
import { MATCHER_GAME } from '../game/mini/matcher/matcher.rules';

const DAY_MS = 86_400_000;
/** Cùng mức của Phễu mua: ADMIN bấm qua lại 7/30 ngày không dồn truy vấn quét bảng đơn vào DB. */
const CACHE_TTL_MS = 60_000;
/** Dòng tổng của truy vấn game (mọi game, mỗi người chơi một lần). */
const ALL_GAMES = '*';

type Count = number | bigint;
const num = (v: Count | null | undefined): number => (v == null ? 0 : Number(v));
const ts = (d: Date): string => d.toISOString();

interface RepeatRow {
  buyers: Count;
  returning_buyers: Count;
  new_buyers: Count;
  new_with_second: Count;
}

/** Ngày VN liên tiếp từ `sinceDay` tới `today`, để biểu đồ có cả ngày không có đơn. */
export function vnDayRange(sinceDay: string, today: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${sinceDay}T00:00:00Z`); t <= Date.parse(`${today}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Số liệu của Trung tâm tăng trưởng. Đơn tính như bảng Theo dõi 72h (đơn thứ hai): bán lẻ, khách tự đặt, bỏ đơn huỷ, trả hàng và chờ thanh toán,
 * gộp các đơn tách theo nhà bán của cùng một lần đặt (`checkoutGroup`). Người chơi là tài khoản đã nộp một ván game mini, hoặc có một lượt
 * Chọn Chuẩn Xanh (game đó chỉ ghi lượt có thưởng và để `submittedAt` trống). Kỳ là `days` ngày VN gần nhất, gồm cả hôm nay.
 */
@Injectable()
export class AdminGrowthService {
  private readonly cache = new Map<GrowthWindowDays, { at: number; value: Promise<AdminGrowthOverviewDTO> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseFunnel: PurchaseFunnelService,
  ) {}

  overview(days: GrowthWindowDays, now: Date = new Date()): Promise<AdminGrowthOverviewDTO> {
    const hit = this.cache.get(days);
    const age = hit ? now.getTime() - hit.at : -1;
    if (hit && age >= 0 && age < CACHE_TTL_MS) return hit.value;
    const value = this.compute(days, now);
    const entry = { at: now.getTime(), value };
    this.cache.set(days, entry);
    value.catch(() => {
      if (this.cache.get(days) === entry) this.cache.delete(days);
    });
    return value;
  }

  /** Tuần tự: mỗi lần hết đệm chỉ chiếm một kết nối, giống Phễu mua. */
  private async compute(days: GrowthWindowDays, now: Date): Promise<AdminGrowthOverviewDTO> {
    const today = vnDateKey(now);
    const sinceDay = vnDateKey(new Date(now.getTime() - (days - 1) * DAY_MS));
    const since = new Date(`${sinceDay}T00:00:00+07:00`);
    const funnelSnap = await this.purchaseFunnel.getSnapshot(now);
    const repeat = await this.repeat(since, now);
    const games = await this.games(sinceDay, since, now);
    const daily = await this.daily(sinceDay, today, since, now);
    return {
      generatedAt: now.toISOString(),
      days,
      sinceDay,
      funnel: days === 30 ? funnelSnap.windows.d30 : funnelSnap.windows.d7,
      repeat,
      games,
      daily,
    };
  }

  private async repeat(since: Date, now: Date): Promise<AdminGrowthOverviewDTO['repeat']> {
    const rows = await this.prisma.$queryRaw<RepeatRow[]>`
      WITH grouped AS (
        SELECT o."userId" AS user_id,
               COALESCE(o."checkoutGroup", o.id) AS grp,
               min(o."createdAt") AS created_at
          FROM "orders" o
         WHERE o.status NOT IN ('CANCELLED', 'RETURNED', 'PENDING_PAYMENT')
           AND o.type = 'RETAIL'
           AND o."placedForCustomer" = false
           AND o."createdAt" <= ${ts(now)}::timestamp
         GROUP BY o."userId", COALESCE(o."checkoutGroup", o.id)
      ),
      ranked AS (
        SELECT user_id,
               created_at,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, grp) AS rn,
               count(*) OVER (PARTITION BY user_id) AS total
          FROM grouped
      )
      SELECT count(DISTINCT user_id) FILTER (WHERE created_at >= ${ts(since)}::timestamp) AS buyers,
             count(DISTINCT user_id) FILTER (WHERE created_at >= ${ts(since)}::timestamp AND rn >= 2) AS returning_buyers,
             count(*) FILTER (WHERE created_at >= ${ts(since)}::timestamp AND rn = 1) AS new_buyers,
             count(*) FILTER (WHERE created_at >= ${ts(since)}::timestamp AND rn = 1 AND total >= 2) AS new_with_second
        FROM ranked`;
    const r = rows[0];
    return {
      buyers: num(r?.buyers),
      returningBuyers: num(r?.returning_buyers),
      newBuyers: num(r?.new_buyers),
      newBuyersWithSecond: num(r?.new_with_second),
    };
  }

  private async games(sinceDay: string, since: Date, now: Date): Promise<AdminGrowthOverviewDTO['games']> {
    const rows = await this.prisma.$queryRaw<Array<{ game: string; players: Count; buyers: Count }>>`
      WITH plays AS (
        SELECT r."userId" AS user_id, r.game AS game, min(r."issuedAt") AS first_play
          FROM "game_play_rounds" r
         WHERE r."dayKey" >= ${sinceDay}
           AND r."issuedAt" <= ${ts(now)}::timestamp
           AND (r."submittedAt" IS NOT NULL OR r.game = ${MATCHER_GAME})
         GROUP BY r."userId", r.game
      ),
      players AS (
        SELECT user_id, ${ALL_GAMES}::text AS game, min(first_play) AS first_play FROM plays GROUP BY user_id
        UNION ALL
        SELECT user_id, game, first_play FROM plays
      ),
      orders_g AS (
        SELECT o."userId" AS user_id, min(o."createdAt") AS created_at
          FROM "orders" o
         WHERE o.status NOT IN ('CANCELLED', 'RETURNED', 'PENDING_PAYMENT')
           AND o.type = 'RETAIL'
           AND o."placedForCustomer" = false
           AND o."createdAt" >= ${ts(since)}::timestamp
           AND o."createdAt" <= ${ts(now)}::timestamp
         GROUP BY o."userId", COALESCE(o."checkoutGroup", o.id)
      )
      SELECT p.game AS game,
             count(*) AS players,
             count(*) FILTER (
               WHERE EXISTS (SELECT 1 FROM orders_g og WHERE og.user_id = p.user_id AND og.created_at >= p.first_play)
             ) AS buyers
        FROM players p
       GROUP BY p.game`;
    const all = rows.find((r) => r.game === ALL_GAMES);
    const byGame: GrowthGameRow[] = rows
      .filter((r) => r.game !== ALL_GAMES)
      .map((r) => ({ game: r.game, players: num(r.players), buyers: num(r.buyers) }))
      .sort((a, b) => b.players - a.players || a.game.localeCompare(b.game));
    return { players: num(all?.players), buyers: num(all?.buyers), byGame };
  }

  private async daily(sinceDay: string, today: string, since: Date, now: Date): Promise<GrowthDailyPoint[]> {
    const orders = await this.prisma.$queryRaw<Array<{ day: string; n: Count }>>`
      SELECT to_char(g.created_at + interval '7 hours', 'YYYY-MM-DD') AS day, count(*) AS n
        FROM (
          SELECT min(o."createdAt") AS created_at
            FROM "orders" o
           WHERE o.status NOT IN ('CANCELLED', 'RETURNED', 'PENDING_PAYMENT')
             AND o.type = 'RETAIL'
             AND o."placedForCustomer" = false
             AND o."createdAt" >= ${ts(since)}::timestamp
             AND o."createdAt" <= ${ts(now)}::timestamp
           GROUP BY COALESCE(o."checkoutGroup", o.id)
        ) g
       GROUP BY 1`;
    const players = await this.prisma.$queryRaw<Array<{ day: string; n: Count }>>`
      SELECT r."dayKey" AS day, count(DISTINCT r."userId") AS n
        FROM "game_play_rounds" r
       WHERE r."dayKey" >= ${sinceDay}
         AND r."dayKey" <= ${today}
         AND (r."submittedAt" IS NOT NULL OR r.game = ${MATCHER_GAME})
       GROUP BY r."dayKey"`;
    const ordersBy = new Map(orders.map((r) => [r.day, num(r.n)]));
    const playersBy = new Map(players.map((r) => [r.day, num(r.n)]));
    return vnDayRange(sinceDay, today).map((day) => ({ day, orders: ordersBy.get(day) ?? 0, players: playersBy.get(day) ?? 0 }));
  }
}
