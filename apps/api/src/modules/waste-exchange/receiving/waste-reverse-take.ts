import { lotRecoverable, recycleLotKey, type PointExpiryTxn } from '../../loyalty/loyalty-expiry.service';

/**
 * Số điểm Thu hồi trừ của một yêu cầu đổi rác: tối đa số đã cộng, không quá phần còn thu hồi được của lô, không quá số dư
 * STANDARD hiện có (kể cả điểm của đơn còn trong hạn trả). Server trừ thật và hộp xác nhận của admin dùng chung hàm này.
 */
export function reverseTake(awarded: number, txns: PointExpiryTxn[], requestId: string, pointsBalance: number): number {
  if (awarded <= 0) return 0;
  const recoverable = lotRecoverable(txns, recycleLotKey(requestId)) ?? awarded;
  return Math.min(awarded, recoverable, Math.max(0, pointsBalance));
}
