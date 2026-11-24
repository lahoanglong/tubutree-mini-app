import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { startOfVnDay } from '../../common/vn-time';
import { NOT_PILOT_CLEANED_SQL } from './admin-revenue';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY, DEFAULT_AFFILIATE_AUTO_WALLET_TRANSFER_ENABLED } from '../affiliate/affiliate-auto-transfer-config';

/** Biến thể có tồn bán được từ 0 tới số này là "sắp hết" trên thẻ điều phối. */
export const COMMAND_CENTER_LOW_STOCK_MAX = 5;
/** Số biến thể sắp hết liệt kê tên trên thẻ (tồn thấp nhất trước); phần còn lại chỉ đếm. */
export const COMMAND_CENTER_LOW_STOCK_LIST = 5;

export type CommandCenterBucket = 'paid' | 'bankTransferUnpaid' | 'cod' | 'merchantCod' | 'cancelled' | 'pilot' | 'other';

interface BucketTotals {
  count: number;
  amount: number;
}

export interface CommandCenterSummary {
  generatedAt: string;
  /**
   * Đơn đặt hôm nay (giờ VN), cùng tập với số "Đơn hôm nay" của `GET /admin/dashboard/today`, chia theo tiền: mỗi đơn vào đúng một nhóm,
   * xét theo thứ tự đơn thử Giờ G đã dọn → huỷ/hoàn → COD gian hàng tự giao (đối tác thu) → COD kho Tubu → đã thanh toán → chuyển khoản chưa
   * nhận tiền → còn lại (cổng thanh toán chưa xong). Hai nhóm đầu và COD gian hàng không phải tiền Tubu thu, như luật Doanh thu (admin-revenue.ts).
   */
  ordersToday: { total: number } & Record<CommandCenterBucket, BucketTotals>;
  /** Biến thể đang bán của hàng kho Tubu có tồn ≤ `threshold` (hàng gian hàng tự giao không tính, vì đối tác tự lo tồn). */
  lowStock: {
    threshold: number;
    count: number;
    outOfStock: number;
    items: { sku: string; productName: string; variationName: string; stock: number }[];
  };
  /** Hoa hồng CTV chưa chi, theo trạng thái dòng hoa hồng (trước thuế TNCN). */
  ctvPayouts: {
    /** Đã duyệt, chưa vào Ví (APPROVED, đơn đã giao, không nằm trong lệnh rút ngân hàng cũ): cùng số "có thể chuyển" của màn CTV. */
    approvedAmount: number;
    approvedCtvs: number;
    /** Đơn đã giao, đang trong thời gian giữ trước khi duyệt (LOCKED). */
    holdingAmount: number;
    /** Đơn chưa giao (PENDING): chưa chắc thành tiền. */
    pendingAmount: number;
    /** Đã duyệt nhưng nằm trong lệnh rút ngân hàng cũ chưa chi xong (APPROVED có payoutBatchId): kế toán chi theo lệnh, không tự vào Ví. */
    withdrawingAmount: number;
    /** Cờ tự chuyển hoa hồng đã duyệt vào Ví mỗi sáng. */
    autoWalletTransfer: boolean;
  };
}

type Db = Pick<PrismaService, '$queryRaw'>;
type Config = { get<T>(key: string, fallback?: T): Promise<T> };

const BUCKETS: readonly CommandCenterBucket[] = ['paid', 'bankTransferUnpaid', 'cod', 'merchantCod', 'cancelled', 'pilot', 'other'];

/**
 * Biến thể đang bán (biến thể bật, sản phẩm hiện công khai như PUBLIC_PRODUCT_WHERE) của hàng kho Tubu, tồn bán được ≤ ngưỡng. Hàng gian hàng
 * tự giao (fulfilment MERCHANT) do đối tác tự giữ tồn nên không báo ở đây.
 */
const LOW_STOCK_SQL = Prisma.sql`v."isActive" = true
         AND p."isActive" = true
         AND p."approvalStatus" = 'APPROVED'
         AND p.fulfilment = 'TUBU'
         AND v.stock <= ${COMMAND_CENTER_LOW_STOCK_MAX}`;

/**
 * Số liệu cho thẻ điều phối ở trang "Hôm nay" của quản trị viên: tiền của đơn hôm nay, hàng sắp hết, hoa hồng CTV chờ chi. Bốn truy vấn
 * đọc chạy song song (tối đa 4 kết nối), không ghi gì.
 */
export async function loadCommandCenter(db: Db, config: Config, now: Date = new Date()): Promise<CommandCenterSummary> {
  const dayStart = startOfVnDay(now);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const [orderRows, lowRows, lowItems, commissionRows, autoFlag] = await Promise.all([
    db.$queryRaw<{ bucket: string; n: number; amount: bigint | null }[]>`
      SELECT t.bucket, COUNT(*)::int AS n, COALESCE(SUM(t.total), 0)::bigint AS amount
        FROM (
          SELECT o.total,
                 CASE
                   WHEN NOT (${NOT_PILOT_CLEANED_SQL}) THEN 'pilot'
                   WHEN o.status IN ('CANCELLED', 'RETURNED') OR o."paymentStatus" IN ('REFUNDED', 'FAILED') THEN 'cancelled'
                   WHEN o."paymentMethod" = 'COD' AND o.fulfiller = 'MERCHANT' THEN 'merchantCod'
                   WHEN o."paymentMethod" = 'COD' THEN 'cod'
                   WHEN o."paymentStatus" = 'PAID' THEN 'paid'
                   WHEN o."paymentMethod" = 'BANK_TRANSFER' AND o."paymentStatus" = 'UNPAID' THEN 'bankTransferUnpaid'
                   ELSE 'other'
                 END AS bucket
            FROM orders o
           WHERE o."createdAt" >= ${dayStart} AND o."createdAt" < ${dayEnd}
        ) t
       GROUP BY t.bucket`,
    db.$queryRaw<{ n: number; out: number }[]>`
      SELECT COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE v.stock <= 0))::int AS out
        FROM variations v
        JOIN products p ON p.id = v."productId"
       WHERE ${LOW_STOCK_SQL}`,
    db.$queryRaw<{ sku: string; product_name: string; variation_name: string; stock: number }[]>`
      SELECT v.sku, p.name AS product_name, v.name AS variation_name, v.stock
        FROM variations v
        JOIN products p ON p.id = v."productId"
       WHERE ${LOW_STOCK_SQL}
       ORDER BY v.stock ASC, p.name ASC, v.name ASC, v.id ASC
       LIMIT ${COMMAND_CENTER_LOW_STOCK_LIST}`,
    db.$queryRaw<{ status: string; amount: bigint | null; ctvs: number }[]>`
      SELECT CASE WHEN c.status = 'APPROVED' AND c."payoutBatchId" IS NOT NULL THEN 'WITHDRAWING' ELSE c.status::text END AS status,
             COALESCE(SUM(c.amount), 0)::bigint AS amount, COUNT(DISTINCT c."affiliateUserId")::int AS ctvs
        FROM commissions c
        JOIN orders o ON o.id = c."orderId"
       WHERE c.status IN ('PENDING', 'LOCKED')
          OR (c.status = 'APPROVED' AND c."payoutBatchId" IS NULL AND o.status = 'DELIVERED')
          OR (c.status = 'APPROVED' AND c."payoutBatchId" IS NOT NULL)
       GROUP BY 1`,
    config.get<unknown>(AFFILIATE_AUTO_WALLET_TRANSFER_KEY, DEFAULT_AFFILIATE_AUTO_WALLET_TRANSFER_ENABLED),
  ]);

  const ordersToday = { total: 0 } as CommandCenterSummary['ordersToday'];
  for (const b of BUCKETS) ordersToday[b] = { count: 0, amount: 0 };
  for (const r of orderRows) {
    const bucket = (BUCKETS as readonly string[]).includes(r.bucket) ? (r.bucket as CommandCenterBucket) : 'other';
    ordersToday[bucket].count += r.n;
    ordersToday[bucket].amount += Number(r.amount ?? 0);
    ordersToday.total += r.n;
  }

  const byStatus = new Map(commissionRows.map((r) => [r.status, r]));
  const amountOf = (s: string) => Number(byStatus.get(s)?.amount ?? 0);
  return {
    generatedAt: now.toISOString(),
    ordersToday,
    lowStock: {
      threshold: COMMAND_CENTER_LOW_STOCK_MAX,
      count: lowRows[0]?.n ?? 0,
      outOfStock: lowRows[0]?.out ?? 0,
      items: lowItems.map((r) => ({ sku: r.sku, productName: r.product_name, variationName: r.variation_name, stock: r.stock })),
    },
    ctvPayouts: {
      approvedAmount: amountOf('APPROVED'),
      approvedCtvs: byStatus.get('APPROVED')?.ctvs ?? 0,
      holdingAmount: amountOf('LOCKED'),
      pendingAmount: amountOf('PENDING'),
      withdrawingAmount: amountOf('WITHDRAWING'),
      autoWalletTransfer: autoFlag === true,
    },
  };
}
