import { Injectable } from '@nestjs/common';
import {
  PURCHASE_FUNNEL_STEPS,
  type PurchaseFunnelDTO,
  type PurchaseFunnelRow,
  type PurchaseFunnelStep,
  type PurchaseFunnelWindowDTO,
} from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WINDOWS = ['h72', 'd7', 'd30'] as const;
type Window = (typeof WINDOWS)[number];
const WINDOW_MS: Record<Window, number> = { h72: 72 * HOUR_MS, d7: 7 * DAY_MS, d30: 30 * DAY_MS };

/** Cùng mức của bảng Theo dõi 72h: ADMIN bấm Làm mới liên tục không dồn truy vấn quét `analytics_events` vào DB. */
const CACHE_TTL_MS = 60_000;

/**
 * Đơn đặt sau sự kiện cuối của phiên tới ngần này phút vẫn tính cho phiên: bước "Đặt hàng" ghi `place_order_click` trước khi máy chủ
 * trả kết quả, và đơn chuyển khoản/ví có thể được ghi `order_placed` muộn hơn vài phút.
 */
export const ORDER_MATCH_GRACE_MINUTES = 30;

/**
 * Một phiên chỉ thuộc cửa sổ (ngày VN, 72 giờ…) chứa sự kiện ĐẦU của nó: phiên 23:59 → 00:01 thuộc ngày bắt đầu, kể cả các bước làm sau 00:00,
 * và ngày sau không đếm lại. Để biết sự kiện đầu, truy vấn đọc thêm ngần này giờ trước cửa sổ (phiên đổi mã sau 30 phút không thao tác, nên
 * phiên dài hơn mốc này gần như không có); phiên bắt đầu trước đó hơn 12 giờ bị coi như bắt đầu trong cửa sổ.
 */
export const SESSION_LOOKBACK_HOURS = 12;

/**
 * Bước làm sau mốc cuối cửa sổ tới ngần này giờ vẫn tính cho phiên. Giữ cộng ân hạn đặt đơn (2 giờ 30) dưới 3 giờ: snapshot ngày chạy lúc 03:00
 * (`AnalyticsAggregationService.runNightly`) đã thấy đủ mọi sự kiện nó dùng, nên tính lại hay bù ngày đó sau này ra đúng số cũ.
 */
export const SESSION_LOOKAHEAD_HOURS = 2;

type Count = number | bigint;

interface FunnelQueryRow {
  platform: string;
  sessions: Count;
  product_viewed: Count;
  add_or_buy: Count;
  checkout_started: Count;
  place_order_click: Count;
  order_placed: Count;
}

const num = (v: Count | null | undefined): number => (v == null ? 0 : Number(v));
const ts = (d: Date): string => d.toISOString();

/**
 * Đếm phễu của các phiên có sự kiện đầu (`receivedAt` nhỏ nhất) trong [since, until), mỗi phiên tính mọi bước của nó kể cả bước sau `until`
 * (xem `SESSION_LOOKBACK_HOURS`, `SESSION_LOOKAHEAD_HOURS`). Dùng chung cho bảng sống (72 giờ / 7 / 30 ngày) và snapshot từng ngày VN (`AnalyticsAggregationService`),
 * nên hai nơi cùng một định nghĩa bước và một phiên qua nửa đêm chỉ vào một ngày. `order_placed` khớp tới `ended_at` + ân hạn, có thể rơi
 * sang ngày sau.
 */
export async function countPurchaseFunnel(
  prisma: Pick<PrismaService, '$queryRaw'>,
  since: Date,
  until: Date,
): Promise<PurchaseFunnelWindowDTO> {
  const raw = await prisma.$queryRaw<FunnelQueryRow[]>`
    WITH s AS (
      SELECT e."sessionId" AS sid,
             e.platform AS platform,
             max(e."userId") AS user_id,
             min(e."receivedAt") AS started_at,
             max(e."receivedAt") AS ended_at,
             bool_or(e."eventName" = 'product_viewed') AS pv,
             bool_or(e."eventName" = 'pdp_action' AND e.props->>'action' IN ('add_to_cart', 'buy_now')) AS ab,
             bool_or(e."eventName" = 'checkout_started') AS cs,
             bool_or(e."eventName" = 'checkout_step' AND e.props->>'step' = 'place_order_click') AS poc
        FROM "analytics_events" e
       WHERE e."receivedAt" >= ${ts(since)}::timestamp - make_interval(hours => ${SESSION_LOOKBACK_HOURS}::int)
         AND e."receivedAt" < ${ts(until)}::timestamp + make_interval(hours => ${SESSION_LOOKAHEAD_HOURS}::int)
         AND e."sessionId" IS NOT NULL
         AND e.platform IN ('web', 'miniapp')
       GROUP BY e."sessionId", e.platform
      HAVING min(e."receivedAt") >= ${ts(since)}::timestamp
         AND min(e."receivedAt") < ${ts(until)}::timestamp
    )
    SELECT s.platform AS platform,
           count(*) AS sessions,
           count(*) FILTER (WHERE s.pv) AS product_viewed,
           count(*) FILTER (WHERE s.ab) AS add_or_buy,
           count(*) FILTER (WHERE s.cs) AS checkout_started,
           count(*) FILTER (WHERE s.poc) AS place_order_click,
           count(*) FILTER (
             WHERE s.poc
               AND s.user_id IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM "analytics_events" o
                  WHERE o."eventName" = 'order_placed'
                    AND o."userId" = s.user_id
                    AND o.platform = s.platform
                    AND o."receivedAt" >= s.started_at
                    AND o."receivedAt" <= s.ended_at + make_interval(mins => ${ORDER_MATCH_GRACE_MINUTES}::int)
               )
           ) AS order_placed
      FROM s
     GROUP BY s.platform`;
  const by = new Map(raw.map((r) => [r.platform, r]));
  const web = by.get('web');
  const mini = by.get('miniapp');
  const rows: PurchaseFunnelRow[] = PURCHASE_FUNNEL_STEPS.map((step: PurchaseFunnelStep) => {
    const w = num(web?.[step]);
    const m = num(mini?.[step]);
    return { step, web: w, miniapp: m, total: w + m };
  });
  const sw = num(web?.sessions);
  const sm = num(mini?.sessions);
  return { rows, sessions: { web: sw, miniapp: sm, total: sw + sm } };
}

/**
 * Phễu mua theo PHIÊN (`sessionId`), tách web/Mini App: mỗi bước đếm số phiên có sự kiện của bước đó trong cửa sổ, không buộc phải qua
 * bước trước (Giờ vàng mua thẳng không qua trang sản phẩm). `order_placed` là sự kiện máy chủ không có `sessionId`, nên ghép theo tài khoản:
 * phiên có bấm Đặt hàng, có userId (từ bất kỳ sự kiện nào trong phiên) và có `order_placed` cùng tài khoản, cùng nền tảng, trong khoảng
 * phiên đó. Buộc có bấm Đặt hàng để phiên chỉ xem hàng (Mini App mở lại sinh phiên mới) hay đơn CTV đặt hộ khách không được tính là đặt đơn.
 * Chỉ trả số đếm, không trả định danh nào.
 */
@Injectable()
export class PurchaseFunnelService {
  private cache: { at: number; value: Promise<PurchaseFunnelDTO> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  getSnapshot(now: Date = new Date()): Promise<PurchaseFunnelDTO> {
    const age = this.cache ? now.getTime() - this.cache.at : -1;
    if (this.cache && age >= 0 && age < CACHE_TTL_MS) return this.cache.value;
    const value = this.compute(now);
    const entry = { at: now.getTime(), value };
    this.cache = entry;
    value.catch(() => {
      if (this.cache === entry) this.cache = null;
    });
    return value;
  }

  /** Tuần tự từng cửa sổ: mỗi lần hết cache chỉ chiếm một kết nối. */
  private async compute(now: Date): Promise<PurchaseFunnelDTO> {
    const windows = {} as Record<Window, PurchaseFunnelWindowDTO>;
    for (const w of WINDOWS) windows[w] = await this.windowSnapshot(new Date(now.getTime() - WINDOW_MS[w]), now);
    return { generatedAt: now.toISOString(), windows };
  }

  private windowSnapshot(since: Date, now: Date): Promise<PurchaseFunnelWindowDTO> {
    return countPurchaseFunnel(this.prisma, since, now);
  }
}
