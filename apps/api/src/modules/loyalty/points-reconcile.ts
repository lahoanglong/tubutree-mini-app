import { Prisma, type PointsLot, type PrismaClient } from '@prisma/client';

/**
 * Đối soát số dư Điểm Xanh theo sổ cái PointsTransaction, TỪNG LÔ (PD-3).
 *
 * Bất biến của hệ thống: MỌI thay đổi số dư điểm đều ghi kèm 1 PointsTransaction mang đúng `lot`
 * trong cùng $transaction (credit đơn, reverse, ORDER_REDEEM checkout, GAME_SPIN_COST, review, game
 * credit, cron hết hạn, quy đổi xu). Do đó:
 *
 *     users.pointsBalance          == SUM(delta) WHERE lot = 'STANDARD'
 *     users.pointsConvertedBalance == SUM(delta) WHERE lot = 'CONVERTED'
 *
 * Đối soát theo tổng hai lô sẽ để lọt lỗi ghi nhầm lô (vd hoàn điểm quy đổi về lô thường: tổng vẫn
 * khớp nhưng tiền trả trước thành điểm có hạn), nên mỗi lô so riêng với cột số dư của nó.
 *
 * Khi migration 20260623010000_loyalty_credit_unique dedupe các dòng ORDER_DELIVERED trùng
 * (do bug double-credit), SUM(delta) giảm đúng phần dư nhưng pointsBalance KHÔNG tự giảm →
 * chênh lệch (balance - ledgerSum) = đúng phần điểm đã cộng dư. Đặt lại balance về ledgerSum
 * là phép sửa đúng & tổng quát: user không lệch → no-op; chạy lại nhiều lần → vẫn no-op.
 */
export const POINTS_LOT_BALANCE_COLUMN = {
  STANDARD: 'pointsBalance',
  CONVERTED: 'pointsConvertedBalance',
} as const satisfies Record<PointsLot, string>;

export type LotBalanceRow = { userId: string; lot: PointsLot; balance: number; ledgerSum: number };
export type Correction = { userId: string; lot: PointsLot; from: number; to: number; drift: number };
type DriftTotals = { affectedCount: number; totalDrift: number; totalAbsDrift: number };
export type ReconcileReport = DriftTotals & {
  corrections: Correction[];
  byLot: Record<PointsLot, DriftTotals>;
};

const emptyTotals = (): DriftTotals => ({ affectedCount: 0, totalDrift: 0, totalAbsDrift: 0 });

/**
 * `totalDrift` = Σ (ledgerSum − balance): âm = đang cộng dư, dương = đang thiếu. `totalAbsDrift` thể
 * hiện quy mô sai lệch bất kể chiều.
 */
export function diffPointsBalances(rows: LotBalanceRow[]): ReconcileReport {
  const corrections: Correction[] = [];
  const all = emptyTotals();
  const byLot: Record<PointsLot, DriftTotals> = { STANDARD: emptyTotals(), CONVERTED: emptyTotals() };
  for (const row of rows) {
    const drift = row.ledgerSum - row.balance;
    if (drift === 0) continue;
    corrections.push({ userId: row.userId, lot: row.lot, from: row.balance, to: row.ledgerSum, drift });
    for (const t of [all, byLot[row.lot]]) {
      t.affectedCount += 1;
      t.totalDrift += drift;
      t.totalAbsDrift += Math.abs(drift);
    }
  }
  return { corrections, ...all, byLot };
}

/**
 * Các (user, lô) đang lệch sổ. LEFT JOIN + COALESCE để phủ cả user chưa có dòng nào ở lô đó
 * (ledgerSum = 0) mà số dư vẫn khác 0. `userIds` giới hạn phạm vi (race spec); bỏ trống = toàn bảng.
 */
export function findPointsLotDrift(
  db: Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient,
  userIds?: string[],
): Promise<LotBalanceRow[]> {
  const scope = userIds ? Prisma.sql`AND u."id" = ANY(${userIds}::text[])` : Prisma.empty;
  return db.$queryRaw<LotBalanceRow[]>`
    SELECT * FROM (
      SELECT u."id" AS "userId", 'STANDARD'::text AS "lot", u."pointsBalance" AS "balance",
             COALESCE(s.sum, 0)::int AS "ledgerSum"
        FROM "users" u
        LEFT JOIN (SELECT "userId", SUM("delta")::int AS sum FROM "points_transactions"
                    WHERE "lot" = 'STANDARD' GROUP BY "userId") s ON s."userId" = u."id"
       WHERE u."pointsBalance" <> COALESCE(s.sum, 0) ${scope}
      UNION ALL
      SELECT u."id", 'CONVERTED'::text, u."pointsConvertedBalance", COALESCE(s.sum, 0)::int
        FROM "users" u
        LEFT JOIN (SELECT "userId", SUM("delta")::int AS sum FROM "points_transactions"
                    WHERE "lot" = 'CONVERTED' GROUP BY "userId") s ON s."userId" = u."id"
       WHERE u."pointsConvertedBalance" <> COALESCE(s.sum, 0) ${scope}
    ) d
    ORDER BY ABS(d."balance" - d."ledgerSum") DESC, d."userId", d."lot"`;
}
