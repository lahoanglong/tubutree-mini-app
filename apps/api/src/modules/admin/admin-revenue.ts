import { Prisma } from '@prisma/client';

/**
 * Định nghĩa DUY NHẤT của "Doanh thu" trong admin (KPI tổng quan, báo cáo theo ngày × kênh, báo cáo theo nguồn khách):
 * tiền đã thu thật, tức đơn không huỷ/trả, không bị lật hoàn tiền, và hoặc đã thanh toán, hoặc là COD đã giao do kho Tubu
 * giao. COD của đơn gian hàng tự giao do đối tác thu nên không phải tiền Tubu thu. Phần đã hoàn của lần trả hàng một
 * phần (return_requests APPROVED: refundAmount + shippingRefund) trừ riêng khỏi tổng.
 * Hai dạng cùng một luật: Prisma where (aggregate/count) và mảnh SQL (truy vấn thô, bảng `orders` đặt bí danh `o`).
 */
export const REVENUE_ORDER_WHERE: Prisma.OrderWhereInput = {
  status: { notIn: ['CANCELLED', 'RETURNED'] },
  paymentStatus: { not: 'REFUNDED' },
  OR: [{ paymentStatus: 'PAID' }, { status: 'DELIVERED', paymentMethod: 'COD', fulfiller: { not: 'MERCHANT' } }],
};

export const REVENUE_ORDER_SQL = Prisma.sql`(
  o.status NOT IN ('CANCELLED', 'RETURNED')
  AND o."paymentStatus" <> 'REFUNDED'
  AND (o."paymentStatus" = 'PAID' OR (o.status = 'DELIVERED' AND o."paymentMethod" = 'COD' AND o.fulfiller <> 'MERCHANT'))
)`;

/** Đơn đang chạy hoặc đã giao: giá trị đặt (GMV), chưa nhất thiết đã thu tiền. */
export const GMV_STATUSES = ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const;
export const GMV_ORDER_WHERE: Prisma.OrderWhereInput = { status: { in: [...GMV_STATUSES] } };
export const GMV_ORDER_SQL = Prisma.sql`o.status IN ('CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED')`;

/** Một nhóm (ngày giờ VN, kênh, nền tảng) do truy vấn trả về; kênh/nền tảng null đã đổi thành 'unknown'. */
export interface RevenueRow {
  day: string;
  channel: string;
  platform: string;
  orders: number;
  cancelled: number;
  paidOrders: number;
  gross: number;
  partialRefund: number;
  gmv: number;
}

export interface RevenueTotals {
  orders: number;
  cancelled: number;
  paidOrders: number;
  gross: number;
  partialRefund: number;
  revenue: number;
  gmv: number;
}

export interface RevenueByDayChannel extends RevenueTotals {
  day: string;
  channel: string;
}
export interface RevenueByKey extends RevenueTotals {
  key: string;
}

const empty = (): RevenueTotals => ({ orders: 0, cancelled: 0, paidOrders: 0, gross: 0, partialRefund: 0, revenue: 0, gmv: 0 });

function add(acc: RevenueTotals, r: RevenueRow) {
  acc.orders += r.orders;
  acc.cancelled += r.cancelled;
  acc.paidOrders += r.paidOrders;
  acc.gross += r.gross;
  acc.partialRefund += r.partialRefund;
  acc.revenue += r.gross - r.partialRefund;
  acc.gmv += r.gmv;
}

function group<K extends string>(rows: readonly RevenueRow[], keyOf: (r: RevenueRow) => K) {
  const map = new Map<K, RevenueTotals>();
  for (const r of rows) {
    const acc = map.get(keyOf(r)) ?? empty();
    add(acc, r);
    map.set(keyOf(r), acc);
  }
  return map;
}

/** Gộp các nhóm (ngày, kênh, nền tảng) thành bảng ngày × kênh, tổng theo kênh, theo nền tảng và tổng chung. */
export function foldRevenueRows(rows: readonly RevenueRow[]) {
  const byDayChannel = group(rows, (r) => `${r.day}|${r.channel}`);
  const byDay: RevenueByDayChannel[] = [...byDayChannel.entries()]
    .map(([k, v]) => {
      const [day, channel] = k.split('|') as [string, string];
      return { day, channel, ...v };
    })
    .sort((a, b) => (a.day === b.day ? a.channel.localeCompare(b.channel) : a.day.localeCompare(b.day)));
  const byKey = (m: Map<string, RevenueTotals>): RevenueByKey[] =>
    [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.revenue - a.revenue || a.key.localeCompare(b.key));
  const totals = empty();
  for (const r of rows) add(totals, r);
  return {
    byDay,
    byChannel: byKey(group(rows, (r) => r.channel)),
    byPlatform: byKey(group(rows, (r) => r.platform)),
    totals,
  };
}
