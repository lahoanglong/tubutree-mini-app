import type { Prisma } from '@prisma/client';
import { startOfVnDay } from '../../../common/vn-time';

/**
 * Monthly quota counter of a PARTNER point (§11.4). The upsert's WHERE guards only the ON CONFLICT branch, so a first
 * confirmation larger than the quota would be inserted unchecked: that case is refused before any SQL.
 * Returns the new pointsUsed, or null when the quota would be exceeded.
 */
export async function incrementPointUsage(
  tx: Prisma.TransactionClient,
  pointId: string,
  monthKey: string,
  points: number,
  quota: number,
): Promise<number | null> {
  if (!Number.isInteger(points) || points <= 0) throw new Error('incrementPointUsage: points must be a positive integer');
  if (points > quota) return null;
  const rows = await tx.$queryRaw<{ pointsUsed: number }[]>`
    INSERT INTO waste_point_usage ("pointId", "monthKey", "pointsUsed", confirmations) VALUES (${pointId}, ${monthKey}, ${points}::int, 1)
    ON CONFLICT ("pointId", "monthKey") DO UPDATE SET "pointsUsed" = waste_point_usage."pointsUsed" + EXCLUDED."pointsUsed", confirmations = waste_point_usage.confirmations + 1
    WHERE waste_point_usage."pointsUsed" + EXCLUDED."pointsUsed" <= ${quota}::int RETURNING "pointsUsed"`;
  const row = rows[0];
  return row ? Number(row.pointsUsed) : null;
}

export async function pointUsage(
  db: Prisma.TransactionClient,
  pointId: string,
  monthKey: string,
): Promise<{ pointsUsed: number; confirmations: number }> {
  const row = await db.wastePointUsage.findUnique({
    where: { pointId_monthKey: { pointId, monthKey } },
    select: { pointsUsed: true, confirmations: true },
  });
  return row ?? { pointsUsed: 0, confirmations: 0 };
}

/** Points the staff member confirmed in the VN calendar day of `now` (§5.5 staff cap); reversed rows still count. */
export async function staffConfirmedToday(tx: Prisma.TransactionClient, staffUserId: string, now: Date): Promise<number> {
  const start = startOfVnDay(now);
  const end = new Date(start.getTime() + 86_400_000);
  const agg = await tx.wasteRequest.aggregate({
    where: {
      confirmedByUserId: staffUserId,
      status: { in: ['COMPLETED', 'REVERSED'] },
      completedAt: { gte: start, lt: end },
    },
    _sum: { pointsAwarded: true },
  });
  return agg._sum.pointsAwarded ?? 0;
}
