import { Prisma } from '@prisma/client';
import { HARVEST_COUPON_CODE_PREFIXES } from './game.constants';

/**
 * SQL đếm mã thu hoạch của một khách theo ngày và theo tháng, một lượt quét. Mã thu hoạch (lô nhà `HARVEST…`, lô phụ
 * `GARDEN…`) luôn tạo với scope USER_GROUP + scopeMeta.userId nên `scope = 'USER_GROUP'` và `scopeMeta ->> 'userId'` khớp đúng
 * partial index `coupons_user_group_userId_idx`; đếm bằng `tx.coupon.count` với `scopeMeta.path` thì Postgres không dùng
 * được index đó và quét cả bảng trong tx Serializable.
 */
export function harvestCouponCountSql(userId: string, dayStart: Date, monthStart: Date): Prisma.Sql {
  const prefixes = Prisma.join(
    HARVEST_COUPON_CODE_PREFIXES.map((prefix) => Prisma.sql`"code" LIKE ${`${prefix}%`}`),
    ' OR ',
  );
  return Prisma.sql`
    SELECT count(*) FILTER (WHERE "startAt" >= ${dayStart}) AS "day",
           count(*) FILTER (WHERE "startAt" >= ${monthStart}) AS "month"
    FROM "coupons"
    WHERE "scope" = 'USER_GROUP'
      AND ("scopeMeta" ->> 'userId') = ${userId}
      AND (${prefixes})`;
}

/** Số mã thu hoạch đã cấp cho khách trong ngày và trong tháng (chung trần cho lô nhà và lô phụ). */
export async function countHarvestCoupons(
  tx: Prisma.TransactionClient,
  userId: string,
  dayStart: Date,
  monthStart: Date,
): Promise<{ day: number; month: number }> {
  const [row] = await tx.$queryRaw<{ day: bigint | number; month: bigint | number }[]>(harvestCouponCountSql(userId, dayStart, monthStart));
  return { day: Number(row?.day ?? 0), month: Number(row?.month ?? 0) };
}
