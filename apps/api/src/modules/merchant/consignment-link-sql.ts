import { Prisma } from '@prisma/client';

/**
 * Biến thể của dòng `oi` liên kết với gian hàng `store` lúc đặt đơn `o` ([linkedAt, unlinkedAt)). `confirmedOnly`: liên kết
 * takeover chỉ tính đơn đặt từ lúc admin xác nhận hàng ký gửi.
 */
export function consignmentLinkedSql(store: Prisma.Sql, confirmedOnly: boolean): Prisma.Sql {
  return Prisma.sql`EXISTS (
      SELECT 1 FROM "merchant_pancake_links" l
       WHERE l."storefrontId" = ${store} AND l."variationId" = oi."variationId"
         AND o."createdAt" >= l."linkedAt" AND (l."unlinkedAt" IS NULL OR o."createdAt" < l."unlinkedAt")
         ${confirmedOnly ? Prisma.sql`AND (NOT l."takeover" OR (l."consignmentConfirmedAt" IS NOT NULL AND o."createdAt" >= l."consignmentConfirmedAt"))` : Prisma.empty})`;
}
