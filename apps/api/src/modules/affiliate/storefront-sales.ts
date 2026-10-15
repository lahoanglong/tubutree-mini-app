import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/** Đơn không phải bán thật — cùng định nghĩa BrandService.getOwnedSales. */
export const SALES_ORDER_STATUS_EXCLUDED = ['PENDING_PAYMENT', 'CANCELLED', 'RETURNED'] as const;
export const SALES_ORDER_PAYMENT_EXCLUDED = ['REFUNDED', 'FAILED'] as const;

type Db = Pick<PrismaService, '$queryRaw'>;

const num = (v: bigint | number | string | null | undefined) => Number(v ?? 0);

/**
 * Số đơn bán thật và doanh thu theo từng gian hàng của CTV `userId` (đơn có referrerUserId = chủ gian hàng), tổng hợp ngay
 * trong DB: CTV nhiều chục nghìn đơn không được nạp về Node, cũng không được gửi `orderId IN (...)` (giới hạn ~32.766 tham
 * số bind). Doanh thu = Order.total trừ tiền hàng + phí ship của các yêu cầu trả MỘT PHẦN đã duyệt (APPROVED, fullReturn =
 * false — cùng bộ lọc partialReturnTotals). LATERAL gom tiền đã hoàn theo từng đơn nên một đơn có nhiều yêu cầu trả không bị
 * nhân dòng; kẹp ≥ 0 làm ở nơi gọi (mức gian hàng). `since` giới hạn theo ngày tạo đơn.
 */
export async function storefrontSalesByStore(
  db: Db,
  userId: string,
  slugs: string[],
  since?: Date,
): Promise<Map<string, { orders: number; revenue: number }>> {
  if (!slugs.length) return new Map();
  const rows = await db.$queryRaw<{ slug: string; orders: bigint | number; revenue: bigint | number | string | null }[]>(Prisma.sql`
    SELECT o."storefrontSlug" AS slug, COUNT(*) AS orders, SUM(o."total" - COALESCE(r.refunded, 0)) AS revenue
    FROM "orders" o
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(rr."refundAmount", 0) + rr."shippingRefund") AS refunded
      FROM "return_requests" rr
      WHERE rr."orderId" = o."id" AND rr."status" = 'APPROVED' AND rr."fullReturn" = false
    ) r ON true
    WHERE o."storefrontSlug" = ANY(${slugs}::text[])
      AND o."referrerUserId" = ${userId}
      AND NOT (o."status"::text = ANY(${[...SALES_ORDER_STATUS_EXCLUDED]}::text[]))
      AND NOT (o."paymentStatus"::text = ANY(${[...SALES_ORDER_PAYMENT_EXCLUDED]}::text[]))
      ${since ? Prisma.sql`AND o."createdAt" >= ${since.toISOString()}::timestamp` : Prisma.empty}
    GROUP BY o."storefrontSlug"`);
  return new Map(rows.map((r) => [r.slug, { orders: num(r.orders), revenue: num(r.revenue) }]));
}

/**
 * Số lượng và doanh thu theo sản phẩm của một gian hàng (cùng bộ lọc đơn bán thật), theo `OrderItem.total`. Phần đã trả MỘT
 * PHẦN bị trừ theo dòng: còn lại = total − round(total × đã trả / số lượng), trả hết dòng = 0 (cùng cách BrandService.getOwnedSales).
 */
export async function storefrontSalesByProduct(
  db: Db,
  userId: string,
  slug: string,
  since: Date,
): Promise<{ productSlug: string; productName: string; qty: number; revenue: number }[]> {
  const rows = await db.$queryRaw<
    { productSlug: string; productName: string; qty: bigint | number | null; revenue: bigint | number | string | null }[]
  >(Prisma.sql`
    SELECT COALESCE(oi."productSlug", '') AS "productSlug", MIN(oi."productName") AS "productName",
           SUM(oi."quantity" - LEAST(ret.q, oi."quantity")) AS qty,
           SUM(CASE WHEN ret.q >= oi."quantity" THEN 0
                    ELSE oi."total" - ROUND(oi."total"::numeric * ret.q / oi."quantity") END) AS revenue
    FROM "orders" o
    JOIN "order_items" oi ON oi."orderId" = o."id"
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(ri."quantity"), 0) AS q
      FROM "return_request_items" ri
      JOIN "return_requests" rr ON rr."id" = ri."returnRequestId"
      WHERE ri."orderItemId" = oi."id" AND rr."status" = 'APPROVED' AND rr."fullReturn" = false
    ) ret ON true
    WHERE o."storefrontSlug" = ${slug}
      AND o."referrerUserId" = ${userId}
      AND o."createdAt" >= ${since.toISOString()}::timestamp
      AND NOT (o."status"::text = ANY(${[...SALES_ORDER_STATUS_EXCLUDED]}::text[]))
      AND NOT (o."paymentStatus"::text = ANY(${[...SALES_ORDER_PAYMENT_EXCLUDED]}::text[]))
    GROUP BY COALESCE(oi."productSlug", '__unknown:' || oi."productName"), COALESCE(oi."productSlug", '')`);
  return rows.map((r) => ({ productSlug: r.productSlug, productName: r.productName, qty: num(r.qty), revenue: Math.max(0, num(r.revenue)) }));
}
