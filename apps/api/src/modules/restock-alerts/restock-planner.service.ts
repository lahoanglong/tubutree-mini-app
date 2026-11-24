import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NOT_PILOT_CLEANED_SQL } from '../admin/admin-revenue';
import { TUBU_OWNED_VARIATION_WHERE } from '../cart/partner-goods';
import { SELLABLE_VARIATION_WHERE } from '../cart/sellable';
import { RESTOCK_NO_SUPPLIER, RESTOCK_VELOCITY_WINDOW_DAYS, type RestockPlanInput } from './restock-planner';

/**
 * Biến thể lập kế hoạch nhập: bán được (SELLABLE_VARIATION_WHERE), kho Tubu giao và là hàng của Tubu (TUBU_OWNED_VARIATION_WHERE). Hàng của gian
 * hàng đối tác, kể cả loại "Tubu giao hộ", là tồn của đối tác: Tubu không đặt nhà cung cấp cho hàng đó.
 */
export const RESTOCK_PLAN_VARIATION_WHERE = {
  ...SELLABLE_VARIATION_WHERE,
  product: { ...SELLABLE_VARIATION_WHERE.product, ...TUBU_OWNED_VARIATION_WHERE.product, fulfilment: 'TUBU' },
} as const satisfies Prisma.VariationWhereInput;

/** Cột đọc: không có mã Pancake, giá vốn hay cấu hình tích hợp nào. */
export const RESTOCK_PLAN_VARIATION_SELECT = {
  id: true,
  sku: true,
  name: true,
  stock: true,
  product: { select: { id: true, name: true, brand: true, brandRef: { select: { name: true } } } },
} as const satisfies Prisma.VariationSelect;

type CountRow = { variationId: string; n: number };

/**
 * Đọc số liệu thô cho "Kế hoạch nhập hàng" (`/admin/doi-soat-kho?tab=nhap-hang`). Bốn câu đọc song song, không ghi gì:
 * biến thể + tồn bán được, số đã bán trong cửa sổ, số khách đang chờ chuông báo hàng về, số đại lý đặt trước chưa có hàng.
 */
@Injectable()
export class RestockPlannerService {
  constructor(private readonly prisma: PrismaService) {}

  async inputs(now: Date = new Date()): Promise<RestockPlanInput[]> {
    const since = new Date(now.getTime() - RESTOCK_VELOCITY_WINDOW_DAYS * 86_400_000);
    const [variations, sold, waiting, backordered] = await Promise.all([
      this.prisma.variation.findMany({ where: RESTOCK_PLAN_VARIATION_WHERE, select: RESTOCK_PLAN_VARIATION_SELECT, orderBy: { sku: 'asc' } }),
      // Đơn đặt trong cửa sổ (theo lúc đặt, không theo lúc giao): cầu thật của khách. Cùng tập đơn của GMV (admin-revenue.ts): đã xác nhận
      // trở đi, chưa huỷ/trả, không phải đơn thử Giờ G đã dọn. Dòng quà 0đ không phải hàng khách mua. Đơn đại lý đặt theo lô nên không quy ra
      // tốc độ bán mỗi ngày (một lô 200 thành 429 khi quy ra 30 ngày); phần đại lý còn thiếu vào kế hoạch qua số đặt trước ở câu thứ tư.
      this.prisma.$queryRaw<CountRow[]>`
        SELECT oi."variationId", COALESCE(SUM(oi."quantity"), 0)::int AS n
          FROM "order_items" oi
          JOIN "orders" o ON o."id" = oi."orderId"
         WHERE oi."isGift" = false
           AND o."type" <> 'DEALER'
           AND o."createdAt" >= ${since}
           AND o."createdAt" <= ${now}
           AND o."status" IN ('CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED')
           AND ${NOT_PILOT_CLEANED_SQL}
         GROUP BY oi."variationId"`,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT ra."variationId", COUNT(*)::int AS n
          FROM "restock_alerts" ra
         WHERE ra."notifiedAt" IS NULL
         GROUP BY ra."variationId"`,
      // Cùng điều kiện với job lấp đặt trước (DealerBackorderService.reconcile): dòng còn thiếu hàng của đơn chưa huỷ/trả.
      this.prisma.$queryRaw<CountRow[]>`
        SELECT oi."variationId", COALESCE(SUM(oi."backorderedQty"), 0)::int AS n
          FROM "order_items" oi
          JOIN "orders" o ON o."id" = oi."orderId"
         WHERE oi."backorderedQty" > 0
           AND o."status" NOT IN ('CANCELLED', 'RETURNED')
         GROUP BY oi."variationId"`,
    ]);
    const toMap = (rows: CountRow[]) => new Map(rows.map((r) => [r.variationId, Number(r.n)]));
    const soldBy = toMap(sold);
    const waitingBy = toMap(waiting);
    const backorderBy = toMap(backordered);
    return variations.map((v) => ({
      variationId: v.id,
      productId: v.product.id,
      productName: v.product.name,
      variationName: v.name,
      sku: v.sku,
      supplier: supplierName(v.product),
      stock: v.stock,
      sold: soldBy.get(v.id) ?? 0,
      waiting: waitingBy.get(v.id) ?? 0,
      backordered: backorderBy.get(v.id) ?? 0,
    }));
  }
}

/** Tên thương hiệu đã liên kết (bảng brands) nếu có, không thì chuỗi thương hiệu ghi trên sản phẩm; trống thì nhóm "chưa ghi". */
export function supplierName(p: { brand: string | null; brandRef: { name: string } | null }): string {
  return (p.brandRef?.name ?? p.brand ?? '').trim() || RESTOCK_NO_SUPPLIER;
}
