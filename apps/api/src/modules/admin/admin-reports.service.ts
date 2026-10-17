import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GMV_ORDER_SQL, REVENUE_ORDER_SQL, foldRevenueRows, type RevenueRow } from './admin-revenue';
import { orderPlatformLabel, orderSourceLabel } from './order-channel';
import { resolveReportRange } from './report-range';

/** Báo cáo theo ngày × kênh là một nhóm nhỏ mỗi ngày; một năm là đủ cho kế toán và vẫn bị chặn trên. */
export const REVENUE_REPORT_MAX_DAYS = 366;

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
      this.prisma.user.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
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
}
