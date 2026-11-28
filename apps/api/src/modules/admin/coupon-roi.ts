import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { GMV_ORDER_SQL } from './admin-revenue';

type Num = number | bigint | string | null | undefined;

/** Số đếm/tiền từ Postgres (bigint hoặc chuỗi) về số nguyên không âm; giá trị lạ về 0 để một dòng hỏng không làm cả danh sách vỡ. */
export function toCount(v: Num): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Hiệu quả tiền của một mã giảm giá, tính trên các đơn đang chạy hoặc đã giao đã dùng mã (cùng định nghĩa GMV với báo cáo admin, `GMV_ORDER_SQL`):
 * đơn huỷ/trả, đơn chưa thanh toán xong và đơn thử đã dọn không tính. Giỏ tách nhiều đơn giao (cùng `checkoutGroup`) chỉ ghi lượt dùng mã ở đơn đầu,
 * nhưng mỗi đơn con mang phần giảm của mình, nên các đơn con tính chung với đơn đầu: số đơn là số đơn thật, không phải số lượt dùng mã.
 */
export interface CouponRoi {
  /** Số đơn đã dùng mã. */
  ordersCount: number;
  /** Tổng giá trị các đơn đó (`orders.total`, tiền khách trả sau mọi khoản giảm). */
  gmv: number;
  /** Tiền giảm do mã: tổng `couponDiscount` của các đơn đó (mỗi đơn dùng tối đa một mã nên không đếm trùng giữa các mã). */
  discountCost: number;
  /** `gmv / ordersCount` làm tròn; 0 khi chưa có đơn. */
  avgOrderValue: number;
}

export const ZERO_COUPON_ROI: Readonly<CouponRoi> = { ordersCount: 0, gmv: 0, discountCost: 0, avgOrderValue: 0 };

export function averageOrderValue(gmv: number, ordersCount: number): number {
  return ordersCount > 0 ? Math.round(gmv / ordersCount) : 0;
}

/**
 * Hiệu quả của một lô mã (một truy vấn cho cả trang danh sách, không truy vấn từng mã). Mã chưa có đơn nào không có trong kết quả:
 * nơi dùng đọc `?? ZERO_COUPON_ROI`. Một mã chỉ có một dòng `coupon_redemptions` cho mỗi đơn (`@@unique([couponId, orderId])`) và mỗi giỏ chỉ dùng một mã, nên một đơn con không bị đếm hai lần trong cùng một mã.
 */
export async function couponRoiBatch(db: Pick<PrismaClient, '$queryRaw'>, couponIds: readonly string[]): Promise<Map<string, CouponRoi>> {
  const out = new Map<string, CouponRoi>();
  if (couponIds.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ id: string; orders: Num; gmv: Num; discount: Num }>>`
    SELECT r."couponId" AS id,
           count(*) AS orders,
           COALESCE(SUM(o.total), 0) AS gmv,
           COALESCE(SUM(o."couponDiscount"), 0) AS discount
      FROM coupon_redemptions r
      JOIN orders p ON p.id = r."orderId"
      JOIN orders o ON o.id = p.id OR o."checkoutGroup" = p."checkoutGroup"
     WHERE r."couponId" IN (${Prisma.join([...couponIds])})
       AND ${GMV_ORDER_SQL}
     GROUP BY r."couponId"`;
  for (const row of rows) {
    const ordersCount = toCount(row.orders);
    const gmv = toCount(row.gmv);
    out.set(row.id, { ordersCount, gmv, discountCost: toCount(row.discount), avgOrderValue: averageOrderValue(gmv, ordersCount) });
  }
  return out;
}
