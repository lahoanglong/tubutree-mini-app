import { Prisma, type PrismaClient } from '@prisma/client';
import {
  REMARKETING_ATTRIBUTION_HOURS,
  REMARKETING_NOTICES,
  type RemarketingAttributionDTO,
  type RemarketingNotice,
} from '@tubutree/shared-types';
import type { SystemConfigService } from '../system-config/system-config.service';
import { NOT_PILOT_CLEANED_SQL, REVENUE_ORDER_SQL } from '../admin/admin-revenue';
import { readProactiveCap } from '../notifications/notification-proactive-cap';
import { REFILL_REMINDER_TEMPLATE } from '../notifications/refill-reminder.rules';

/**
 * Mẫu tin của từng dòng "Tin nào ra đơn". Nhắc chuyển khoản viết chữ thay vì nhập hằng của cron huỷ đơn (file đó kéo theo cả service đơn);
 * spec đối chiếu với `ORDER_PAYMENT_REMINDER_TEMPLATE`.
 */
export const REMARKETING_TEMPLATES: Readonly<Record<RemarketingNotice, string>> = {
  abandoned_cart: 'CART_ABANDONED',
  winback: 'WINBACK_VOUCHER',
  wishlist_price_drop: 'PRICE_DROP_ALERT',
  refill_21d: REFILL_REMINDER_TEMPLATE,
  payment_reminder: 'ORDER_PAYMENT_REMINDER',
};

/** Sự kiện NotificationsService ghi khi trần tin chủ động bỏ bản ZNS của một tin (props.templateCode). */
export const NOTIFICATION_SUPPRESSED_EVENT = 'notification_suppressed';

type Count = number | bigint;
const num = (v: Count | null | undefined): number => (v == null ? 0 : Number(v));
const ts = (d: Date): string => d.toISOString();

const CODES = REMARKETING_NOTICES.map((n) => REMARKETING_TEMPLATES[n]);
const PAY_CODE = REMARKETING_TEMPLATES.payment_reminder;

/**
 * Gán đơn cho tin nhắc chủ động gửi trong [since, until] ("Tin nào ra đơn" ở Trung tâm tăng trưởng).
 *
 * - Tin: mỗi lần gửi có đúng một log trong app (`INAPP`), kể cả khi bản ZNS bị trần hay mẫu chưa có mã ZNS, nên đếm tin theo log INAPP.
 *   ZNS đã nhận là log `ZNS` trạng thái `SENT`. Bản ZNS bị trần đếm từ sự kiện `notification_suppressed`.
 * - Đơn: đơn thành công như các số khác của trang (bán lẻ, khách tự đặt, bỏ huỷ/trả/chờ thanh toán, bỏ đơn thử Giờ G), gộp các đơn tách
 *   theo nhà bán của cùng một lần đặt. Tiền là Doanh thu đã thu theo REVENUE_ORDER_SQL, trừ phần hoàn của lần trả hàng một phần.
 * - Luật gán, tin cuối thắng, mỗi đơn chỉ gán một lần:
 *   1. Nhắc chuyển khoản nói về chính một đơn (mã đơn trong dữ liệu tin): đơn đó được trả tiền trong 72 giờ sau tin thì gán cho tin. Tin này
 *      luôn tới sau lúc đặt đơn nên là tin cuối.
 *   2. Còn lại: tin gần nhất của bốn loại kia gửi cho cùng khách trong 72 giờ trước lúc đặt đơn.
 *   Chỉ đọc tin gửi trong kỳ: đơn mà tin cuối gửi trước kỳ thì không tính, nên tỷ lệ ra đơn so trên cùng một nhóm tin. Tin của 3 ngày gần
 *   nhất chưa hết 72 giờ chờ.
 */
export async function remarketingAttribution(
  db: Pick<PrismaClient, '$queryRaw'>,
  config: SystemConfigService | undefined,
  since: Date,
  until: Date,
): Promise<RemarketingAttributionDTO> {
  const codes = Prisma.join(CODES);
  const hours = REMARKETING_ATTRIBUTION_HOURS;

  const sentRows = await db.$queryRaw<Array<{ code: string; sent: Count; zns_sent: Count }>>`
    SELECT l."templateCode" AS code,
           count(*) FILTER (WHERE l.channel = 'INAPP') AS sent,
           count(*) FILTER (WHERE l.channel = 'ZNS' AND l.status = 'SENT') AS zns_sent
      FROM "notification_logs" l
     WHERE l."templateCode" IN (${codes})
       AND l."sentAt" >= ${ts(since)}::timestamp
       AND l."sentAt" <= ${ts(until)}::timestamp
     GROUP BY 1`;

  const cappedRows = await db.$queryRaw<Array<{ code: string; n: Count }>>`
    SELECT e.props->>'templateCode' AS code, count(*) AS n
      FROM "analytics_events" e
     WHERE e."eventName" = ${NOTIFICATION_SUPPRESSED_EVENT}
       AND e."occurredAt" >= ${ts(since)}::timestamp
       AND e."occurredAt" <= ${ts(until)}::timestamp
       AND e.props->>'templateCode' IN (${codes})
     GROUP BY 1`;

  const orderRows = await db.$queryRaw<Array<{ code: string; orders: Count; revenue: Count }>>`
    WITH touches AS (
      SELECT l."userId" AS user_id,
             l."templateCode" AS code,
             l."sentAt" AS sent_at,
             CASE WHEN l."templateCode" = ${PAY_CODE} THEN l.payload->'data'->>'order_code' END AS order_code
        FROM "notification_logs" l
       WHERE l.channel = 'INAPP'
         AND l."templateCode" IN (${codes})
         AND l."sentAt" >= ${ts(since)}::timestamp
         AND l."sentAt" <= ${ts(until)}::timestamp
    ),
    ords AS (
      SELECT o.code AS code,
             o."userId" AS user_id,
             COALESCE(o."checkoutGroup", o.id) AS grp,
             o."createdAt" AS created_at,
             o."paidAt" AS paid_at,
             CASE WHEN ${REVENUE_ORDER_SQL} THEN o.total - COALESCE(pr.refund, 0) ELSE 0 END AS revenue
        FROM "orders" o
        LEFT JOIN LATERAL (
          SELECT SUM(r."refundAmount" + r."shippingRefund") AS refund
            FROM "return_requests" r
           WHERE r."orderId" = o.id AND r.status = 'APPROVED'
        ) pr ON true
       WHERE o.status NOT IN ('CANCELLED', 'RETURNED', 'PENDING_PAYMENT')
         AND o.type = 'RETAIL'
         AND o."placedForCustomer" = false
         AND ${NOT_PILOT_CLEANED_SQL}
         AND o."createdAt" <= ${ts(until)}::timestamp
         AND (o."createdAt" >= ${ts(since)}::timestamp OR o.code IN (SELECT t.order_code FROM touches t WHERE t.order_code IS NOT NULL))
    ),
    groups AS (
      SELECT user_id, grp, min(created_at) AS created_at, sum(revenue) AS revenue
        FROM ords
       GROUP BY user_id, grp
    ),
    pay_hit AS (
      SELECT DISTINCT ON (o.user_id, o.grp) o.user_id, o.grp, t.code
        FROM ords o
        JOIN touches t ON t.order_code = o.code AND t.user_id = o.user_id
       WHERE o.paid_at > t.sent_at
         AND o.paid_at <= t.sent_at + ${hours}::int * interval '1 hour'
       ORDER BY o.user_id, o.grp, t.sent_at DESC
    ),
    pre_hit AS (
      SELECT DISTINCT ON (g.user_id, g.grp) g.user_id, g.grp, t.code
        FROM groups g
        JOIN touches t ON t.user_id = g.user_id AND t.code <> ${PAY_CODE}
       WHERE t.sent_at < g.created_at
         AND g.created_at <= t.sent_at + ${hours}::int * interval '1 hour'
       ORDER BY g.user_id, g.grp, t.sent_at DESC, t.code
    )
    SELECT COALESCE(p.code, q.code) AS code, count(*) AS orders, COALESCE(sum(g.revenue), 0)::bigint AS revenue
      FROM groups g
      LEFT JOIN pay_hit p ON p.user_id = g.user_id AND p.grp = g.grp
      LEFT JOIN pre_hit q ON q.user_id = g.user_id AND q.grp = g.grp
     WHERE p.code IS NOT NULL OR q.code IS NOT NULL
     GROUP BY 1`;

  const proactiveCap = await readProactiveCap(config);

  const sent = new Map(sentRows.map((r) => [r.code, r]));
  const capped = new Map(cappedRows.map((r) => [r.code, num(r.n)]));
  const orders = new Map(orderRows.map((r) => [r.code, r]));
  return {
    windowHours: hours,
    rows: REMARKETING_NOTICES.map((notice) => {
      const code = REMARKETING_TEMPLATES[notice];
      return {
        notice,
        sent: num(sent.get(code)?.sent),
        znsSent: num(sent.get(code)?.zns_sent),
        znsCapped: capped.get(code) ?? 0,
        orders: num(orders.get(code)?.orders),
        revenue: num(orders.get(code)?.revenue),
      };
    }),
    proactiveCap,
  };
}
