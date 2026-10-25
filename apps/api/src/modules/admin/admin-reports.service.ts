import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GMV_ORDER_SQL, REVENUE_ORDER_SQL, foldRevenueRows, type RevenueRow } from './admin-revenue';
import { orderPlatformLabel, orderSourceLabel } from './order-channel';
import { resolveReportRange } from './report-range';
import { CAMPAIGN_PREFIX, NEW_CUSTOMER_SQL, NO_CAMPAIGN, SOURCE_REPORT_MAX_SOURCES, SOURCE_REPORT_WINDOW_DAYS, foldSourceRows, type SourceRow } from './admin-source-report';
import { vnDateKey } from '../../common/vn-time';

/** Báo cáo theo ngày × kênh là một nhóm nhỏ mỗi ngày; một năm là đủ cho kế toán và vẫn bị chặn trên. */
export const REVENUE_REPORT_MAX_DAYS = 366;

/** Bảng nguồn × tuần nối khách với đơn của họ, nặng hơn báo cáo doanh thu nên giới hạn hẹp hơn. */
export const SOURCE_REPORT_MAX_DAYS = 180;

const UNKNOWN = 'unknown';

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Doanh thu theo ngày đặt (giờ VN) × kênh (Order.source) trong khoảng ngày. "Doanh thu" dùng đúng định nghĩa của KPI tổng
   * quan (admin-revenue.ts): đơn huỷ/trả/đã hoàn không tính, COD đối tác không tính, phần đã hoàn một phần được trừ.
   * Tiền ghi về NGÀY ĐẶT của đơn (không phải ngày thanh toán hay ngày hoàn), nên số cùng ngày khớp danh sách đơn lọc theo ngày.
   */
  async revenueReport(q: { from?: string; to?: string }, now = new Date()) {
    const range = resolveReportRange(q.from, q.to, { maxDays: REVENUE_REPORT_MAX_DAYS, now });
    const [rows, newUsers] = await Promise.all([
      this.prisma.$queryRaw<
        {
          day: string;
          channel: string;
          platform: string;
          orders: number;
          cancelled: number;
          paid_orders: number;
          gross: bigint;
          partial_refund: bigint;
          gmv: bigint;
        }[]
      >(Prisma.sql`
        -- createdAt là timestamp không múi giờ lưu UTC; VN cố định UTC+7, không DST (cùng cách với analytics-aggregation).
        SELECT to_char(o."createdAt" + interval '7 hours', 'YYYY-MM-DD') AS day,
               COALESCE(o.source, ${UNKNOWN}) AS channel,
               COALESCE(o.platform, ${UNKNOWN}) AS platform,
               COUNT(*)::int AS orders,
               COUNT(*) FILTER (WHERE o.status IN ('CANCELLED', 'RETURNED'))::int AS cancelled,
               COUNT(*) FILTER (WHERE ${REVENUE_ORDER_SQL})::int AS paid_orders,
               COALESCE(SUM(o.total) FILTER (WHERE ${REVENUE_ORDER_SQL}), 0)::bigint AS gross,
               COALESCE(SUM(pr.refund) FILTER (WHERE ${REVENUE_ORDER_SQL}), 0)::bigint AS partial_refund,
               COALESCE(SUM(o.total) FILTER (WHERE ${GMV_ORDER_SQL}), 0)::bigint AS gmv
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT SUM(r."refundAmount" + r."shippingRefund") AS refund
          FROM return_requests r
          WHERE r."orderId" = o.id AND r.status = 'APPROVED'
        ) pr ON true
        WHERE o."createdAt" >= ${range.start} AND o."createdAt" < ${range.end}
        GROUP BY 1, 2, 3`),
      this.prisma
        .$queryRaw<{ n: number }[]>(
          Prisma.sql`SELECT COUNT(*)::int AS n FROM users u WHERE u."createdAt" >= ${range.start} AND u."createdAt" < ${range.end} AND ${NEW_CUSTOMER_SQL}`,
        )
        .then((r) => r[0]?.n ?? 0),
    ]);
    const folded = foldRevenueRows(
      rows.map(
        (r): RevenueRow => ({
          day: r.day,
          channel: r.channel,
          platform: r.platform,
          orders: r.orders,
          cancelled: r.cancelled,
          paidOrders: r.paid_orders,
          gross: Number(r.gross),
          partialRefund: Number(r.partial_refund),
          gmv: Number(r.gmv),
        }),
      ),
    );
    const channelLabel = (key: string) => orderSourceLabel(key === UNKNOWN ? null : key);
    const platformLabel = (key: string) => orderPlatformLabel(key === UNKNOWN ? null : key);
    return {
      range: { from: range.from, to: range.to, days: range.days },
      basis: 'ngày đặt đơn, giờ Việt Nam',
      totals: { ...folded.totals, newUsers },
      byDay: folded.byDay.map((d) => ({ ...d, label: channelLabel(d.channel) })),
      byChannel: folded.byChannel.map((c) => ({ ...c, label: channelLabel(c.key) })),
      byPlatform: folded.byPlatform.map((p) => ({ ...p, label: platformLabel(p.key) })),
    };
  }

  /**
   * Khách mới theo nguồn chạm đầu (User.firstTouchSource) × tuần tạo tài khoản (thứ Hai đầu tuần, giờ VN): bao nhiêu khách có đơn
   * đầu trong 30 ngày sau khi tạo, bao nhiêu có đơn hai trong 30 ngày sau đơn đầu, và doanh thu 30 ngày đầu của nhóm (cùng định nghĩa
   * doanh thu với KPI: admin-revenue.ts). `by=campaign` nhóm theo chiến dịch chạm đầu (User.firstTouchCampaign, vd card-2611) thay cho nguồn. "Đơn" là đơn còn hiệu lực (đã xác nhận trở đi, không huỷ/trả, không còn chờ thanh toán);
   * các đơn cùng checkoutGroup (một lần thanh toán tách theo nơi giao) tính là một lần mua, còn doanh thu vẫn cộng từng đơn.
   *
   * "Khách mới" theo NEW_CUSTOMER_SQL (không tính tài khoản ADMIN/STAFF, dòng khách vãng lai đã gộp, khách cũ được gắn nguồn lúc gộp;
   * xem impl/source.md mục 3), cùng định nghĩa với thẻ "Khách mới" của revenueReport. Khách chưa có nguồn (tài khoản trước khi có cột) vào "Không rõ".
   */
  async sourceReport(q: { from?: string; to?: string; by?: 'source' | 'campaign' }, now = new Date()) {
    const dimension = q.by === 'campaign' ? Prisma.sql`CASE WHEN NULLIF(u."firstTouchCampaign", '') IS NULL THEN ${NO_CAMPAIGN} ELSE ${CAMPAIGN_PREFIX} || u."firstTouchCampaign" END` : Prisma.sql`COALESCE(u."firstTouchSource", ${UNKNOWN})`;
    const range = resolveReportRange(q.from, q.to, { maxDays: SOURCE_REPORT_MAX_DAYS, now });
    const window = Prisma.raw(`interval '${SOURCE_REPORT_WINDOW_DAYS} days'`);
    const window2 = Prisma.raw(`interval '${SOURCE_REPORT_WINDOW_DAYS * 2} days'`);
    const rows = await this.prisma.$queryRaw<
      { week: string; source: string; new_users: number; first_order_users: number; second_order_users: number; revenue: bigint }[]
    >(Prisma.sql`
      WITH cohort AS (
        SELECT u.id,
               u."createdAt" AS created_at,
               ${dimension} AS source,
               to_char(date_trunc('week', u."createdAt" + interval '7 hours'), 'YYYY-MM-DD') AS week
        FROM users u
        WHERE u."createdAt" >= ${range.start} AND u."createdAt" < ${range.end}
          AND ${NEW_CUSTOMER_SQL}
      ),
      purchase AS (
        -- Checkout tách một lần thanh toán thành nhiều đơn (mỗi nơi giao một đơn, cùng checkoutGroup): đó là MỘT lần mua.
        SELECT c.id AS user_id,
               COALESCE(o."checkoutGroup", o.code) AS purchase_key,
               MIN(o."createdAt") AS at
        FROM cohort c
        JOIN orders o ON o."userId" = c.id
        WHERE ${GMV_ORDER_SQL}
          AND o."createdAt" >= c.created_at AND o."createdAt" < c.created_at + ${window2}
        GROUP BY c.id, COALESCE(o."checkoutGroup", o.code)
      ),
      -- Một lần gộp theo khách thay cho các CTE tự join: Postgres không có thống kê cho CTE nên ước 1 dòng, và ở kế hoạch
      -- generic (Prisma tái dùng câu đã prepare từ lần gọi thứ 6) chọn Nested Loop bình phương theo số khách mới.
      by_user AS (
        SELECT p.user_id,
               (array_agg(p.at ORDER BY p.at, p.purchase_key))[1] AS first_at,
               (array_agg(p.at ORDER BY p.at, p.purchase_key))[2] AS second_at
        FROM purchase p
        GROUP BY p.user_id
      ),
      revenue AS (
        SELECT c.id AS user_id, SUM(o.total - COALESCE(pr.refund, 0)) AS amount
        FROM cohort c
        JOIN orders o ON o."userId" = c.id
        LEFT JOIN LATERAL (
          SELECT SUM(r."refundAmount" + r."shippingRefund") AS refund
          FROM return_requests r
          WHERE r."orderId" = o.id AND r.status = 'APPROVED'
        ) pr ON true
        WHERE ${REVENUE_ORDER_SQL}
          AND o."createdAt" >= c.created_at AND o."createdAt" < c.created_at + ${window}
        GROUP BY c.id
      )
      SELECT c.week, c.source,
             COUNT(*)::int AS new_users,
             (COUNT(*) FILTER (WHERE b.first_at < c.created_at + ${window}))::int AS first_order_users,
             (COUNT(*) FILTER (WHERE b.first_at < c.created_at + ${window} AND b.second_at <= b.first_at + ${window}))::int AS second_order_users,
             COALESCE(SUM(r.amount), 0)::bigint AS revenue
      FROM cohort c
      LEFT JOIN by_user b ON b.user_id = c.id
      LEFT JOIN revenue r ON r.user_id = c.id
      GROUP BY c.week, c.source`);
    const folded = foldSourceRows(
      rows.map(
        (r): SourceRow => ({
          week: r.week,
          source: r.source,
          newUsers: r.new_users,
          firstOrderUsers: r.first_order_users,
          secondOrderUsers: r.second_order_users,
          revenue: Number(r.revenue),
        }),
      ),
      { maxSources: SOURCE_REPORT_MAX_SOURCES, today: vnDateKey(now) },
    );
    return {
      range: { from: range.from, to: range.to, days: range.days },
      windowDays: SOURCE_REPORT_WINDOW_DAYS,
      ...folded,
    };
  }
}
