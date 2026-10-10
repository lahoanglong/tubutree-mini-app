import { Prisma } from '@prisma/client';

/**
 * Đối soát Ví Tubu với sổ cái wallet_transactions (C-060).
 *
 * Bất biến: mọi thay đổi users.walletBalance đi qua applyWalletDelta, ghi đúng 1 dòng sổ trong cùng
 * transaction, và migration wallet_ledger đã ghi dòng OPENING = số dư lúc bắt đầu ghi sổ. Vì vậy
 *
 *     walletBalance  ==  SUM(wallet_transactions.delta)  của user đó.
 *
 * Lệch nghĩa là có chỗ ghi số dư bỏ qua sổ (code cũ còn chạy sau migration, SQL tay, bug mới).
 * Khác với reconcile:points, KHÔNG tự sửa: đây là tiền thật rút được, phải tra nguyên nhân rồi mới
 * ghi dòng ADJUST qua applyWalletDelta — đặt thẳng số dư = tổng sổ có thể xoá mất tiền của khách.
 */
export type WalletBalanceRow = { userId: string; walletBalance: number; ledgerSum: number; entries: number };
export type WalletDrift = WalletBalanceRow & {
  /** walletBalance − ledgerSum: dương = ví đang nhiều hơn sổ ghi nhận, âm = ví đang thiếu. */
  drift: number;
};
export type WalletReconcileReport = {
  drifts: WalletDrift[];
  affectedCount: number;
  totalDrift: number;
  totalAbsDrift: number;
};

export function diffWalletBalances(rows: WalletBalanceRow[]): WalletReconcileReport {
  const drifts: WalletDrift[] = [];
  let totalDrift = 0;
  let totalAbsDrift = 0;
  for (const row of rows) {
    // SUM/COUNT của Postgres về tới JS là bigint hoặc chuỗi tuỳ kiểu cột — so sánh trên number.
    const walletBalance = Number(row.walletBalance);
    const ledgerSum = Number(row.ledgerSum);
    const drift = walletBalance - ledgerSum;
    if (drift === 0) continue;
    drifts.push({ userId: row.userId, walletBalance, ledgerSum, drift, entries: Number(row.entries) });
    totalDrift += drift;
    totalAbsDrift += Math.abs(drift);
  }
  return { drifts, affectedCount: drifts.length, totalDrift, totalAbsDrift };
}

type RawQueryClient = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };

/**
 * Tìm mọi user có số dư ví lệch tổng sổ. `userIds` giới hạn phạm vi (test, tra một nhóm khách);
 * bỏ trống = toàn hệ thống. LEFT JOIN để bắt cả user có số dư nhưng chưa có dòng sổ nào.
 */
export async function findWalletLedgerDrift(
  db: RawQueryClient,
  opts: { userIds?: string[] } = {},
): Promise<WalletReconcileReport> {
  const scope =
    opts.userIds !== undefined
      ? opts.userIds.length === 0
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND u.id IN (${Prisma.join(opts.userIds)})`
      : Prisma.empty;
  const rows = await db.$queryRaw<WalletBalanceRow[]>(Prisma.sql`
    SELECT u.id AS "userId",
           u."walletBalance" AS "walletBalance",
           COALESCE(s.sum, 0)::bigint AS "ledgerSum",
           COALESCE(s.n, 0)::bigint AS "entries"
    FROM "users" u
    LEFT JOIN (
      SELECT "userId", SUM("delta") AS sum, COUNT(*) AS n
      FROM "wallet_transactions"
      GROUP BY "userId"
    ) s ON s."userId" = u.id
    WHERE u."walletBalance" <> COALESCE(s.sum, 0) ${scope}
    ORDER BY ABS(u."walletBalance" - COALESCE(s.sum, 0)) DESC`);
  return diffWalletBalances(rows);
}
