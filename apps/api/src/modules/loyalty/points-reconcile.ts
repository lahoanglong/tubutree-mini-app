/**
 * Đối soát pointsBalance theo sổ cái PointsTransaction.
 *
 * Bất biến của hệ thống: MỌI thay đổi User.pointsBalance đều ghi kèm 1 PointsTransaction
 * trong cùng $transaction (credit đơn, reverse, ORDER_REDEEM checkout, GAME_SPIN_COST,
 * review, game credit) — và chưa có cron trừ điểm hết hạn. Do đó:
 *
 *     pointsBalance ĐÚNG  ==  SUM(PointsTransaction.delta)  của user đó.
 *
 * Khi migration 20260623010000_loyalty_credit_unique dedupe các dòng ORDER_DELIVERED trùng
 * (do bug double-credit), SUM(delta) giảm đúng phần dư nhưng pointsBalance KHÔNG tự giảm →
 * chênh lệch (balance - ledgerSum) = đúng phần điểm đã cộng dư. Đặt lại balance về ledgerSum
 * là phép sửa đúng & tổng quát: user không lệch → no-op; chạy lại nhiều lần → vẫn no-op.
 */
export type BalanceRow = { userId: string; pointsBalance: number; ledgerSum: number };
export type Correction = { userId: string; from: number; to: number; drift: number };
export type ReconcileReport = {
  corrections: Correction[];
  affectedCount: number;
  /** Tổng chênh ròng (Σ ledgerSum − balance): âm = đang cộng dư, dương = đang thiếu. */
  totalDrift: number;
  /** Tổng giá trị tuyệt đối của chênh lệch — thể hiện quy mô sai lệch bất kể chiều. */
  totalAbsDrift: number;
};

export function diffPointsBalances(rows: BalanceRow[]): ReconcileReport {
  const corrections: Correction[] = [];
  let totalDrift = 0;
  let totalAbsDrift = 0;
  for (const row of rows) {
    const drift = row.ledgerSum - row.pointsBalance;
    if (drift === 0) continue;
    corrections.push({ userId: row.userId, from: row.pointsBalance, to: row.ledgerSum, drift });
    totalDrift += drift;
    totalAbsDrift += Math.abs(drift);
  }
  return { corrections, affectedCount: corrections.length, totalDrift, totalAbsDrift };
}
